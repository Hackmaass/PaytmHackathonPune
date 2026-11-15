import { and, eq } from "drizzle-orm";
import type { CortexDb } from "@cortex/db";
import { schema } from "@cortex/db";
import {
  appendActivityEvent,
  completeTask,
  getLlmClient,
  makeId,
  recordCost,
  registerDecisionExecutor,
  setAgentMetric,
  startRun,
} from "@cortex/runtime";
import {
  CustomAgentSpecSchema,
  StudioFlowSchema,
  type CustomAgentCompileRequest,
  type CustomAgentGenerateRequest,
  type CustomAgentSpec,
  type StudioFlow,
  type StudioFlowNode,
  type StudioTestRunResponse,
  type StudioTool,
} from "@cortex/shared";
import { getActiveWhatsAppChannel } from "@cortex/channels";
import { POLICY } from "../policy.js";
import { STUDIO_TEMPLATES, findTemplate, toolsForFlow, type TemplateBlueprint } from "./templates.js";
import { maskRecipient, runStudioFlow, shouldRunTrigger } from "./engine.js";

export { STUDIO_TEMPLATES, shouldRunTrigger };
export type { TemplateBlueprint };

/**
 * Prompts that ask the compiler to remove the safety rails it's designed to
 * always attach. AGENTS.md §4 / PROPOSAL §4: "The compiler cannot grant a
 * tool outside the sandboxed catalogue, remove the approval gate on money
 * actions, or exceed store-level caps." Since `require_merchant_approval`
 * is hardcoded `true` below (never derived from the prompt), a spec can
 * never actually violate that invariant — so this is the request-level
 * guard that surfaces the rejection explicitly instead of just silently
 * ignoring the unsafe part of the ask.
 */
const UNSAFE_REQUEST_PATTERN = /auto[- ]?approve|without (merchant |owner )?approval|no approval|skip approval|\bsms\b|twilio|send email/i;

const KEYWORD_TOOL_MAP: Array<{ pattern: RegExp; templateId: string }> = [
  { pattern: /expir|shelf.?life|batch/i, templateId: "pharmacy-expiry-sentinel" },
  { pattern: /rush|evening|peak.?hour|delivery|commission/i, templateId: "rush-hour-reconciler" },
  { pattern: /slow.?mov|unsold|dead.?stock|liquidat|bundle/i, templateId: "apparel-slow-mover" },
  { pattern: /khata|udhaar|credit due|wholesale|recover/i, templateId: "udhaar-recovery-agent" },
  { pattern: /gst|fssai|licen[cs]e|compliance|deadline|filing/i, templateId: "compliance-chaser" },
  { pattern: /attendance|haazir|absent|late|shift/i, templateId: "attendance-watch" },
];

export interface GenerateResult {
  rejected: false;
  spec: CustomAgentSpec;
}
export interface RejectResult {
  rejected: true;
  reason: string;
}

/**
 * Compiles a merchant request into a validated, sandboxed agent spec.
 *
 * Three inputs, in priority order:
 *   1. an explicit `flow` from the visual builder (validated & hardened),
 *   2. a curated template selected by id or keyword,
 *   3. the LLM classifier as a last resort (closed set of template ids only).
 *
 * Every field that matters for safety — the tool catalogue, guardrails, the
 * approval gate — is constructed in TypeScript and re-validated against
 * `CustomAgentSpecSchema` before it is ever persisted. The LLM never
 * authors tools, triggers or guardrails.
 */
export async function compileSpec(input: CustomAgentGenerateRequest): Promise<GenerateResult | RejectResult>;
export async function compileSpec(input: CustomAgentCompileRequest): Promise<GenerateResult | RejectResult>;
export async function compileSpec(input: CustomAgentGenerateRequest | CustomAgentCompileRequest): Promise<GenerateResult | RejectResult> {
  const prompt = input.prompt ?? "";
  if (UNSAFE_REQUEST_PATTERN.test(prompt)) {
    return {
      rejected: true,
      reason: "Requests that bypass merchant approval or use tools outside the sandboxed catalogue are not permitted.",
    };
  }

  const template = findTemplate(input.template_id) ?? matchByKeyword(prompt) ?? (await classifyByLlm(prompt));
  const builtFromFlow = Boolean(input.flow);

  // Start from an explicit flow when the builder sent one, otherwise from the
  // matched template, otherwise from a safe generic scaffold.
  const flow = input.flow
    ? hardenFlow(input.flow, prompt)
    : template
      ? extractThresholds(cloneFlow(template.flow), prompt)
      : genericFlow(prompt);

  const trigger =
    input.trigger ??
    flow.nodes.find((n) => n.kind === "TRIGGER")?.config.trigger ??
    template?.trigger ??
    "CRON_HEARTBEAT_DAILY_0900";

  const name = input.name?.trim()
    ? input.name.trim()
    : builtFromFlow || template
      ? (template?.name ?? deriveName(prompt))
      : deriveName(prompt);

  const maxMessagesPerDay = Math.min(
    flow.nodes.find((n) => n.kind === "GUARDRAIL")?.config.maxMessages ?? template?.maxMessagesPerDay ?? 20,
    POLICY.DAILY_MESSAGE_CAP,
  );

  const spec: CustomAgentSpec = CustomAgentSpecSchema.parse({
    agent_id: makeId("custom"),
    name,
    avatar: input.avatar?.trim() || template?.avatar || "✨",
    role: input.role?.trim() || template?.role || "Custom Teammate",
    description: prompt.trim() || template?.description || "Hired from the Studio canvas.",
    trigger,
    tools: toolsForFlow(flow, template?.tools ?? []),
    guardrails: {
      max_messages_per_day: maxMessagesPerDay,
      restricted_hours:
        flow.nodes.find((n) => n.kind === "GUARDRAIL")?.config.quietHours ?? POLICY.STUDIO_QUIET_HOURS,
      require_merchant_approval: true,
    },
    status: "DRAFT",
    flow,
  });

  return { rejected: false, spec };
}

function deriveName(prompt: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
  return words ? `${capitalize(words)} - Custom Teammate` : "Custom Teammate";
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function cloneFlow(flow: StudioFlow): StudioFlow {
  return { nodes: flow.nodes.map((n) => ({ ...n, config: { ...n.config } })), edges: flow.edges.map((e) => ({ ...e })) };
}

/**
 * Pull numeric thresholds out of the merchant's own words so the compiled
 * flow matches what they asked for ("over ₹8,000", "30 days").
 */
function extractThresholds(flow: StudioFlow, prompt: string): StudioFlow {
  const amount = /₹\s*([\d,]+)|rs\.?\s*([\d,]+)|([\d,]{3,})\s*(?:rupees|rupaye)/i.exec(prompt);
  const days = /(\d{1,3})\s*(?:days?|din)/i.exec(prompt);

  const amountValue = amount ? Number((amount[1] ?? amount[2] ?? amount[3] ?? "").replace(/,/g, "")) : undefined;
  const daysValue = days ? Number(days[1]) : undefined;

  return {
    nodes: flow.nodes.map((node) => {
      if (node.kind !== "FILTER" || !node.config.filters) return node;
      const filters = node.config.filters.map((f) => {
        if (amountValue && f.field === "balance" && f.op === "gt") return { ...f, value: amountValue };
        if (daysValue && (f.field === "oldestDueDays" || f.field === "daysLeft") && f.op === "gte") {
          return { ...f, value: daysValue };
        }
        if (daysValue && f.field === "daysToExpiry" && f.op === "lte") return { ...f, value: daysValue };
        return f;
      });
      return { ...node, config: { ...node.config, filters } };
    }),
    edges: flow.edges,
  };
}

/**
 * Hardening pass for hand-edited flows. This is the invariant enforcement
 * point for the visual builder: whatever the merchant wired up, the stored
 * flow always (a) starts at exactly one trigger, (b) contains the merchant
 * approval node, (c) enforces a quiet-hours guardrail, and (d) stays inside
 * the node/edge budget. Only the *shape* is enforced here — the engine and
 * tool gateway enforce behaviour at run time.
 */
export function hardenFlow(input: StudioFlow, prompt = ""): StudioFlow {
  const parsed = StudioFlowSchema.parse(input);
  const flow = cloneFlow(parsed);

  // (a) exactly one trigger, first.
  const triggerNodes = flow.nodes.filter((n) => n.kind === "TRIGGER");
  const trigger = triggerNodes[0] ?? {
    id: "trigger",
    kind: "TRIGGER" as const,
    label: "Every day · 9:00 AM",
    config: { trigger: "CRON_HEARTBEAT_DAILY_0900" },
    position: { x: 40, y: 90 },
  };
  trigger.config.trigger = trigger.config.trigger ?? "CRON_HEARTBEAT_DAILY_0900";
  if (triggerNodes.length === 0) {
    flow.nodes.unshift({ ...trigger, config: { ...trigger.config } });
  }

  // Auto-layout anything dropped onto the canvas without a position.
  flow.nodes = flow.nodes.map((n, i) => ({
    ...n,
    position: n.position && (n.position.x !== 0 || n.position.y !== 0) ? n.position : { x: 40 + i * 240, y: 90 },
  }));

  // (c) a quiet-hours guardrail must exist — insert before the first DRAFT.
  if (!flow.nodes.some((n) => n.kind === "GUARDRAIL")) {
    const guardrail: StudioFlowNode = {
      id: "guardrails",
      kind: "GUARDRAIL",
      label: "Quiet hours & caps",
      config: { minRows: 1, quietHours: POLICY.STUDIO_QUIET_HOURS, maxMessages: POLICY.DAILY_MESSAGE_CAP },
      position: { x: 0, y: 0 },
    };
    const draftIndex = flow.nodes.findIndex((n) => n.kind === "DRAFT");
    const insertAt = draftIndex === -1 ? flow.nodes.length : draftIndex;
    flow.nodes.splice(insertAt, 0, guardrail);
    relinkAround(flow, insertAt);
  }

  // (b) the approval gate is mandatory for anything that sends a message.
  const hasDraft = flow.nodes.some((n) => n.kind === "DRAFT");
  const hasApproval = flow.nodes.some((n) => n.kind === "APPROVAL");
  if (hasDraft && !hasApproval) {
    const approval: StudioFlowNode = {
      id: "approve",
      kind: "APPROVAL",
      label: "Merchant approves",
      config: {},
      position: { x: 0, y: 0 },
    };
    flow.nodes.push(approval);
    const draftNode = flow.nodes.find((n) => n.kind === "DRAFT")!;
    const outgoing = flow.edges.find((e) => e.source === draftNode.id);
    if (outgoing) {
      flow.edges = flow.edges.filter((e) => e.id !== outgoing.id);
      flow.edges.push({ id: `${draftNode.id}->approve`, source: draftNode.id, target: approval.id });
      flow.edges.push({ id: `approve->${outgoing.target}`, source: approval.id, target: outgoing.target });
    } else {
      flow.edges.push({ id: `${draftNode.id}->approve`, source: draftNode.id, target: approval.id });
    }
  }

  // Drop dangling edges and refresh auto-layout for inserted nodes.
  const nodeIds = new Set(flow.nodes.map((n) => n.id));
  flow.edges = flow.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target);
  flow.nodes = flow.nodes.map((n, i) => (n.position.x === 0 && n.position.y === 0 ? { ...n, position: { x: 40 + i * 240, y: 90 } } : n));

  // Keep the extracted thresholds when the builder sent a template flow.
  return prompt ? extractThresholds(flow, prompt) : flow;
}

/** Re-point edges so an inserted node sits inline where it was spliced in. */
function relinkAround(flow: StudioFlow, index: number): void {
  const inserted = flow.nodes[index];
  if (!inserted) return;
  const before = flow.nodes[index - 1];
  const after = flow.nodes[index + 1];
  if (!before) return;
  const existing = flow.edges.find((e) => e.source === before.id);
  if (existing && after) {
    flow.edges = flow.edges.filter((e) => e.id !== existing.id);
    flow.edges.push({ id: `${before.id}->${inserted.id}`, source: before.id, target: inserted.id });
    flow.edges.push({ id: `${inserted.id}->${after.id}`, source: inserted.id, target: after.id });
  } else if (!existing && after) {
    flow.edges.push({ id: `${inserted.id}->${after.id}`, source: inserted.id, target: after.id });
  }
}

function matchByKeyword(prompt: string) {
  const hit = KEYWORD_TOOL_MAP.find((k) => k.pattern.test(prompt));
  return hit ? findTemplate(hit.templateId) : undefined;
}

/**
 * Only reached when the fast/free keyword regex above found nothing —
 * keeps the common demo prompts (which all hit a keyword) from depending on
 * a local model being up. Runs against the local Ollama model by default
 * (see @cortex/runtime's getLlmClient); if it's unreachable or returns
 * anything outside the closed template-id set, this returns undefined and
 * the caller falls through to the generic scaffold.
 */
async function classifyByLlm(prompt: string): Promise<TemplateBlueprint | undefined> {
  if (!prompt.trim()) return undefined;
  const catalogue = STUDIO_TEMPLATES.map((t) => `- ${t.template_id}: ${t.description}`).join("\n");
  const system = [
    "You classify a shop owner's request for an AI back-office teammate into one template id.",
    "Available templates:",
    catalogue,
    "- generic: none of the above genuinely fit",
    "",
    "Reply with ONLY the template id — lowercase, no punctuation, no explanation.",
  ].join("\n");

  try {
    const { text } = await getLlmClient().complete({ system, prompt, maxTokens: 20 });
    const answer = text.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    return findTemplate(answer);
  } catch {
    return undefined;
  }
}

function genericFlow(prompt: string): StudioFlow {
  const days = /(\d{1,3})\s*(?:days?|din)/i.exec(prompt);
  return hardenFlow({
    nodes: [
      { id: "trigger", kind: "TRIGGER", label: "Every day · 9:00 AM", config: { trigger: "CRON_HEARTBEAT_DAILY_0900" }, position: { x: 40, y: 90 } },
      { id: "read-khata", kind: "READ", label: "Read khata ledger", config: { dataset: "KHATA" }, position: { x: 280, y: 90 } },
      {
        id: "filter-overdue",
        kind: "FILTER",
        label: "Overdue balances",
        config: { filters: [{ field: "oldestDueDays", op: "gte", value: days ? Number(days[1]) : 15 }, { field: "balance", op: "gt", value: 5000 }] },
        position: { x: 520, y: 90 },
      },
      { id: "guardrails", kind: "GUARDRAIL", label: "Quiet hours & caps", config: { minRows: 1, quietHours: POLICY.STUDIO_QUIET_HOURS, maxMessages: 20 }, position: { x: 760, y: 90 } },
      {
        id: "draft-reminder",
        kind: "DRAFT",
        label: "Draft reminder",
        config: { text: "Namaste {{name}} ji! Aapka ₹{{balance}} udhaar {{oldestDueDays}} din se pending hai. Kripya {{upi_link}} se bhugtan karein. — Ramesh Sweets" },
        position: { x: 1000, y: 90 },
      },
      { id: "approve", kind: "APPROVAL", label: "Merchant approves", config: {}, position: { x: 1240, y: 90 } },
    ],
    edges: [
      { id: "trigger->read-khata", source: "trigger", target: "read-khata" },
      { id: "read-khata->filter-overdue", source: "read-khata", target: "filter-overdue" },
      { id: "filter-overdue->guardrails", source: "filter-overdue", target: "guardrails" },
      { id: "guardrails->draft-reminder", source: "guardrails", target: "draft-reminder" },
      { id: "draft-reminder->approve", source: "draft-reminder", target: "approve" },
    ],
  });
}

// ---------------------------------------------------------------------------
// Persistence & lifecycle
// ---------------------------------------------------------------------------

export async function persistDraft(db: CortexDb, storeId: string, spec: CustomAgentSpec): Promise<void> {
  await db.insert(schema.agents).values({
    id: spec.agent_id,
    storeId,
    name: spec.name,
    role: spec.role,
    avatar: spec.avatar,
    status: spec.status,
    metricLabel: "Status",
    metricValue: "Awaiting Hire",
    isCustom: true,
    spec,
    maxMessagesPerDay: spec.guardrails.max_messages_per_day,
    restrictedHours: spec.guardrails.restricted_hours,
  });
}

export async function getAgentSpec(db: CortexDb, storeId: string, agentId: string): Promise<CustomAgentSpec> {
  const [row] = await db.select().from(schema.agents).where(and(eq(schema.agents.storeId, storeId), eq(schema.agents.id, agentId)));
  if (!row || !row.isCustom) throw new Error("AGENT_NOT_FOUND");
  return CustomAgentSpecSchema.parse(row.spec as object);
}

/** Re-save an existing custom agent from the builder (rename, rewire, retune). */
export async function updateDraft(db: CortexDb, storeId: string, agentId: string, patch: CustomAgentCompileRequest): Promise<CustomAgentSpec> {
  const existing = await getAgentSpec(db, storeId, agentId);
  const flow = patch.flow ? hardenFlow(patch.flow, patch.prompt ?? "") : existing.flow;
  const spec = CustomAgentSpecSchema.parse({
    ...existing,
    name: patch.name?.trim() || existing.name,
    avatar: patch.avatar?.trim() || existing.avatar,
    role: patch.role?.trim() || existing.role,
    description: patch.prompt?.trim() || existing.description,
    trigger: patch.trigger ?? flow?.nodes.find((n) => n.kind === "TRIGGER")?.config.trigger ?? existing.trigger,
    tools: flow ? toolsForFlow(flow, existing.tools) : existing.tools,
    guardrails: {
      ...existing.guardrails,
      max_messages_per_day: Math.min(
        flow?.nodes.find((n) => n.kind === "GUARDRAIL")?.config.maxMessages ?? existing.guardrails.max_messages_per_day,
        POLICY.DAILY_MESSAGE_CAP,
      ),
      restricted_hours:
        flow?.nodes.find((n) => n.kind === "GUARDRAIL")?.config.quietHours ?? existing.guardrails.restricted_hours,
    },
    flow,
  });

  await db
    .update(schema.agents)
    .set({
      name: spec.name,
      role: spec.role,
      avatar: spec.avatar,
      spec,
      maxMessagesPerDay: spec.guardrails.max_messages_per_day,
      restrictedHours: spec.guardrails.restricted_hours,
    })
    .where(and(eq(schema.agents.storeId, storeId), eq(schema.agents.id, agentId)));

  return spec;
}

export async function hireAgent(db: CortexDb, storeId: string, agentId: string): Promise<CustomAgentSpec> {
  const [row] = await db.select().from(schema.agents).where(and(eq(schema.agents.storeId, storeId), eq(schema.agents.id, agentId)));
  if (!row || !row.isCustom) throw new Error("AGENT_NOT_FOUND");

  const existing = CustomAgentSpecSchema.parse(row.spec as object);
  const spec = CustomAgentSpecSchema.parse({ ...existing, status: "ACTIVE" });

  await db
    .update(schema.agents)
    .set({ status: "ACTIVE", metricLabel: "Status", metricValue: "Hired · Waiting For Trigger", spec })
    .where(eq(schema.agents.id, agentId));

  await appendActivityEvent(db, {
    storeId,
    agentId,
    agentName: spec.name,
    agentAvatar: spec.avatar,
    message: `${spec.name} hired — runs ${spec.trigger.replace(/CRON_HEARTBEAT_/, "").toLowerCase()}, tools: ${spec.tools.join(", ")}.`,
    type: "AGENT_HIRED",
    severity: "SUCCESS",
  });

  return spec;
}

export async function listHiredCustomAgents(db: CortexDb, storeId: string): Promise<Array<{ id: string; spec: CustomAgentSpec }>> {
  const rows = await db.select().from(schema.agents).where(eq(schema.agents.storeId, storeId));
  return rows
    .filter((r) => r.isCustom && r.status === "ACTIVE" && r.spec)
    .map((r) => {
      try {
        return { id: r.id, spec: CustomAgentSpecSchema.parse(r.spec as object) };
      } catch {
        return undefined;
      }
    })
    .filter((x): x is { id: string; spec: CustomAgentSpec } => Boolean(x));
}

/** Preview a flow without persisting or sending anything (builder "Test run"). */
export async function testAgentFlow(
  db: CortexDb,
  storeId: string,
  input: { agentId?: string; flow?: StudioFlow; name?: string; avatar?: string; role?: string; trigger?: string; prompt?: string },
): Promise<StudioTestRunResponse> {
  let spec: CustomAgentSpec;
  if (input.flow) {
    const compiled = await compileSpec({ prompt: input.prompt ?? "", template_id: null, flow: input.flow, name: input.name, avatar: input.avatar, role: input.role, trigger: input.trigger });
    if (compiled.rejected) throw new Error(compiled.reason);
    spec = compiled.spec;
  } else if (input.agentId) {
    spec = await getAgentSpec(db, storeId, input.agentId);
  } else {
    throw new Error("NO_FLOW");
  }

  const result = await runStudioFlow({ db, storeId, spec, dryRun: true });
  return {
    success: !result.blocked,
    agent_id: spec.agent_id,
    steps: result.trace,
    messages: result.messages.map((m) => ({ to_label: m.to_label, to: maskRecipient(m.to), text: m.text })),
    needs_approval: result.needsApproval,
    headline: result.headline,
  };
}

/** Real run: reads live data, logs the audit trail, and stages a 1-tap
 * approval card when the flow reaches its APPROVAL node. */
export async function runCustomAgent(db: CortexDb, storeId: string, agentId: string): Promise<{ runId: string }> {
  const [row] = await db.select().from(schema.agents).where(and(eq(schema.agents.storeId, storeId), eq(schema.agents.id, agentId)));
  if (!row) throw new Error("AGENT_NOT_FOUND");

  const spec = CustomAgentSpecSchema.parse(row.spec as object);
  const { runId, taskId } = await startRun(db, { storeId, agentId, label: `${row.name} check` });

  if (!spec.flow) {
    await appendActivityEvent(db, {
      storeId,
      agentId,
      agentName: row.name,
      agentAvatar: row.avatar,
      message: `${row.name} has no Studio flow configured yet — open it in Studio to wire it up.`,
      type: "ACTION_EXECUTED",
      severity: "WARNING",
    });
    await completeTask(db, taskId, "DONE");
    return { runId };
  }

  const result = await runStudioFlow({ db, storeId, spec, dryRun: false });

  await setAgentMetric(
    db,
    storeId,
    agentId,
    result.needsApproval ? "Awaiting Approval" : result.blocked ? "Blocked" : "Actions",
    result.needsApproval
      ? `${result.messages.length} draft${result.messages.length === 1 ? "" : "s"}`
      : result.blocked
        ? "Guardrail blocked"
        : `${result.messages.length} sent`,
  );

  await completeTask(db, taskId, result.blocked ? "FAILED" : "DONE");
  return { runId };
}

/** Server ticker entry point: run every ACTIVE custom agent whose trigger
 * fires at `at`. Idempotent per day via the decision idempotency key. */
export async function runDueCustomAgents(db: CortexDb, storeId: string, at: Date): Promise<number> {
  const hired = await listHiredCustomAgents(db, storeId);
  let ran = 0;
  for (const { spec } of hired) {
    if (!spec.flow) continue;
    if (!shouldRunTrigger(spec.trigger, at)) continue;
    try {
      await runCustomAgent(db, storeId, spec.agent_id);
      ran += 1;
    } catch (err) {
      console.error(`[studio] scheduled run failed for ${spec.agent_id}:`, err);
    }
  }
  return ran;
}

// ---------------------------------------------------------------------------
// Decision executor: the generic "send whatever the agent drafted" action.
// Only ever reached after the merchant taps Approve on the signed contract.
// ---------------------------------------------------------------------------

registerDecisionExecutor("CUSTOM_AGENT_ACTION", async ({ db, storeId, agentId, payload }) => {
  const messages = (payload.messages as Array<{ to: string; to_label: string; text: string }> | undefined) ?? [];
  const headline = typeof payload.headline === "string" ? payload.headline : "Studio agent action";
  const channel = getActiveWhatsAppChannel();

  let sent = 0;
  for (const [i, m] of messages.entries()) {
    if (i > 0 && channel.mode === "LIVE") await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      await channel.sendText({ storeId, toIdentityId: m.to, text: m.text });
      sent += 1;
    } catch (err) {
      console.error(`[studio] message delivery failed for ${m.to_label}:`, err);
    }
  }

  await recordCost(db, {
    storeId,
    agentId,
    kind: "WHATSAPP_MESSAGE",
    amount: sent * POLICY.COST_PER_WHATSAPP_MESSAGE,
    units: sent,
  });
  await setAgentMetric(db, storeId, agentId, "Actions", `${sent} sent`);

  await appendActivityEvent(db, {
    storeId,
    agentId,
    agentName: "Studio",
    agentAvatar: "✨",
    message: `Approved — ${sent} of ${messages.length} WhatsApp message(s) sent.`,
    type: "ACTION_EXECUTED",
    severity: "SUCCESS",
  });

  return {
    result: { messages_sent: sent, agent_id: agentId, headline },
    soundboxTriggered: false,
  };
});

export type { StudioTool };
