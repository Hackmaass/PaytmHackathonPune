import { eq } from "drizzle-orm";
import type { CortexDb } from "@cortex/db";
import { schema } from "@cortex/db";
import {
  appendActivityEvent,
  checkQuietHours,
  combineGuardrails,
  daysBetween,
  hhmm,
  isoDate,
  now,
  redactPhone,
  stageDecision,
  type GuardrailResult,
} from "@cortex/runtime";
import { generateUpiLink } from "@cortex/connectors";
import type {
  CustomAgentSpec,
  StudioDataset,
  StudioFlow,
  StudioFlowNode,
  StudioPreviewMessage,
  StudioTraceStep,
} from "@cortex/shared";
import { getKhataSummary } from "../munim/ledger.js";

/** A single row a Studio flow can filter/draft against. Derived fields
 * (coverDays, daysToExpiry, upi_link, …) are computed here so the builder's
 * filters stay simple and business-readable. */
export type StudioRow = Record<string, string | number | boolean | null>;

export interface StudioFlowRunResult {
  trace: StudioTraceStep[];
  messages: StudioPreviewMessage[];
  needsApproval: boolean;
  blocked: boolean;
  decisionId?: string;
  headline: string;
}

const OWNER_IDENTITY = "owner";
const MAX_STEPS = 24;
const MAX_PREVIEW_LIST = 8;

export interface RunStudioFlowArgs {
  db: CortexDb;
  storeId: string;
  spec: CustomAgentSpec;
  /** Dry-run = builder preview: computes everything, sends/records nothing. */
  dryRun: boolean;
}

export async function runStudioFlow(args: RunStudioFlowArgs): Promise<StudioFlowRunResult> {
  const { db, storeId, spec, dryRun } = args;
  const flow = spec.flow;
  if (!flow) {
    return {
      trace: [],
      messages: [],
      needsApproval: false,
      blocked: false,
      headline: `${spec.name} has no flow configured yet — open it in Studio.`,
    };
  }

  const trace: StudioTraceStep[] = [];
  let rows: StudioRow[] = [];
  let dataset: StudioDataset | undefined;
  let messages: StudioPreviewMessage[] = [];
  let needsApproval = false;
  let blocked = false;
  let decisionId: string | undefined;

  const emit = async (input: Parameters<typeof appendActivityEvent>[1]): Promise<void> => {
    if (dryRun) return;
    await appendActivityEvent(db, input);
  };

  let current: StudioFlowNode | undefined = flow.nodes.find((n) => n.kind === "TRIGGER") ?? flow.nodes[0];
  const visited = new Set<string>();

  while (current && visited.size < MAX_STEPS) {
    visited.add(current.id);
    const node = current;

    if (node.kind === "TRIGGER") {
      trace.push({
        node_id: node.id,
        kind: node.kind,
        label: node.label,
        status: "PASS",
        detail: `Woke up · ${node.label}`,
      });
      if (!dryRun) {
        await emit({
          storeId,
          agentId: spec.agent_id,
          agentName: spec.name,
          agentAvatar: spec.avatar,
          message: `${spec.name} started — ${node.label.toLowerCase()}.`,
          type: "ACTION_EXECUTED",
          severity: "INFO",
        });
      }
    } else if (node.kind === "READ") {
      const ds = node.config.dataset;
      if (!ds) {
        trace.push({ node_id: node.id, kind: node.kind, label: node.label, status: "SKIPPED", detail: "No dataset selected." });
      } else {
        dataset = ds;
        rows = await readDataset(db, storeId, ds);
        trace.push({
          node_id: node.id,
          kind: node.kind,
          label: node.label,
          status: rows.length > 0 ? "PASS" : "EMPTY",
          detail: `${rows.length} row(s) read from ${ds.toLowerCase()}.`,
          row_count: rows.length,
        });
        if (!dryRun) {
          await emit({
            storeId,
            agentId: spec.agent_id,
            agentName: spec.name,
            agentAvatar: spec.avatar,
            message: `${spec.name} read ${rows.length} row(s) from ${ds.toLowerCase()}.`,
            type: "ACTION_EXECUTED",
            severity: "INFO",
          });
        }
      }
    } else if (node.kind === "FILTER") {
      const before = rows.length;
      const conditions = node.config.filters ?? [];
      if (conditions.length > 0) rows = rows.filter((r) => conditions.every((c) => compare(r[c.field] ?? null, c.op, c.value)));
      const description = conditions.map((c) => `${c.field} ${c.op} ${c.value}`).join(" and ") || "no conditions";
      trace.push({
        node_id: node.id,
        kind: node.kind,
        label: node.label,
        status: rows.length > 0 ? "PASS" : "EMPTY",
        detail: `${rows.length} of ${before} row(s) matched ${description}.`,
        row_count: rows.length,
      });
      if (rows.length === 0) {
        return finish({
          trace,
          messages: [],
          headline: `${spec.name} found nothing to act on (${description}).`,
          blocked: false,
          needsApproval: false,
        });
      }
    } else if (node.kind === "GUARDRAIL") {
      const checks: GuardrailResult[] = [];
      const cfg = node.config;
      if (cfg.minRows) {
        checks.push({
          passed: rows.length >= cfg.minRows,
          code: "MIN_ROWS",
          reason: `${rows.length} row(s) matched (need ≥ ${cfg.minRows})`,
        });
      }
      if (cfg.quietHours) checks.push(checkQuietHours({ nowHHMM: hhmm(), range: cfg.quietHours }));
      if (cfg.maxMessages) {
        checks.push({
          passed: rows.length <= cfg.maxMessages,
          code: "MESSAGE_CAP",
          reason: `${rows.length} message(s) ≤ cap ${cfg.maxMessages}`,
        });
      }
      const combined = combineGuardrails(checks);
      trace.push({
        node_id: node.id,
        kind: node.kind,
        label: node.label,
        status: combined.passed ? "PASS" : "BLOCKED",
        detail: checks.length > 0 ? combined.summary : "No guardrail configured — merchant approval still required.",
      });
      if (!combined.passed) {
        blocked = true;
        if (!dryRun) {
          await emit({
            storeId,
            agentId: spec.agent_id,
            agentName: "Guardrail",
            agentAvatar: "🛡️",
            message: `${spec.name} held back: ${combined.summary}`,
            type: "GUARDRAIL_BLOCKED",
            severity: "CRITICAL",
          });
        }
        return finish({ trace, messages: [], headline: `${spec.name} was blocked by a guardrail — ${combined.summary}`, blocked: true, needsApproval: false });
      }
      if (!dryRun) {
        await emit({
          storeId,
          agentId: spec.agent_id,
          agentName: "Guardrail",
          agentAvatar: "🛡️",
          message: `${spec.name} guardrail passed — ${combined.summary}`,
          type: "GUARDRAIL_PASSED",
          severity: "SUCCESS",
        });
      }
    } else if (node.kind === "DRAFT") {
      const text = node.config.text ?? "";
      const rowsHavePhone = rows.some((r) => typeof r.phone === "string" && String(r.phone).trim().length > 0);
      const perRow = node.config.per_row ?? rowsHavePhone;
      const cap = node.config.maxMessages ?? 50;
      const targets = rows.slice(0, cap);

      messages = perRow
        ? targets.map((row) => ({
            to: String(row.phone ?? OWNER_IDENTITY),
            to_label: String(row.name ?? row.sku ?? row.workerName ?? "Owner"),
            text: renderTemplate(text, row, rows, dataset),
          }))
        : [
            {
              to: OWNER_IDENTITY,
              to_label: "You (owner)",
              text: renderTemplate(text, undefined, targets.length ? targets : rows, dataset),
            },
          ];

      trace.push({
        node_id: node.id,
        kind: node.kind,
        label: node.label,
        status: messages.length > 0 ? "PASS" : "EMPTY",
        detail: `${messages.length} personalised message(s) drafted${perRow ? "" : " (summary mode)"}.`,
        row_count: messages.length,
      });
      if (messages.length === 0) {
        return finish({ trace, messages: [], headline: `${spec.name} had no message to draft.`, blocked: false, needsApproval: false });
      }
    } else if (node.kind === "APPROVAL") {
      needsApproval = true;
      const headline = `${spec.name} prepared ${messages.length} ${messages.length === 1 ? "message" : "messages"} from ${rows.length} matched row(s).`;
      trace.push({
        node_id: node.id,
        kind: node.kind,
        label: node.label,
        status: "PASS",
        detail: dryRun ? "Preview only — nothing sent." : "1-tap approval card staged for the merchant.",
      });

      if (!dryRun) {
        const decision = await stageDecision(db, {
          storeId,
          agentId: spec.agent_id,
          agentName: spec.name,
          agentAvatar: spec.avatar,
          kind: "CUSTOM_AGENT_ACTION",
          payload: {
            agent_id: spec.agent_id,
            headline,
            dataset: dataset ?? null,
            row_count: rows.length,
            messages: messages.map((m) => ({ to: m.to, to_label: m.to_label, text: m.text })),
          },
          message: `${headline} ${messages.length === 1 ? "Tap approve to send it." : "Tap approve to send the batch."}`,
          idempotencyKey: `custom:${storeId}:${spec.agent_id}:${isoDate()}`,
        });
        decisionId = decision.id;
      }
      return finish({ trace, messages, needsApproval: true, blocked: false, headline, decisionId });
    } else if (node.kind === "NOTIFY") {
      const message = renderTemplate(node.config.message ?? `${spec.name} finished its check.`, undefined, rows, dataset);
      trace.push({ node_id: node.id, kind: node.kind, label: node.label, status: "PASS", detail: message });
      if (!dryRun) {
        await emit({
          storeId,
          agentId: spec.agent_id,
          agentName: spec.name,
          agentAvatar: spec.avatar,
          message,
          type: "ACTION_EXECUTED",
          severity: "INFO",
        });
      }
    }

    const nextEdge = flow.edges.find((e) => e.source === node.id && !visited.has(e.target));
    current = nextEdge ? flow.nodes.find((n) => n.id === nextEdge.target) : undefined;
  }

  return finish({
    trace,
    messages,
    needsApproval,
    blocked,
    decisionId,
    headline: messages.length > 0 ? `${spec.name} drafted ${messages.length} message(s) — no approval node in the flow, nothing was sent.` : `${spec.name} finished its check.`,
  });
}

function finish(result: Omit<StudioFlowRunResult, "needsApproval" | "blocked"> & { needsApproval: boolean; blocked: boolean }): StudioFlowRunResult {
  return result;
}

// ---------------------------------------------------------------------------
// Dataset readers — every one is a live store query, scoped by storeId.
// ---------------------------------------------------------------------------

const IST_TZ = "Asia/Kolkata";

function istHour(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: IST_TZ, hour: "2-digit", hour12: false }).format(date));
}

export async function readDataset(db: CortexDb, storeId: string, dataset: StudioDataset): Promise<StudioRow[]> {
  switch (dataset) {
    case "KHATA": {
      const [rows, store] = await Promise.all([
        getKhataSummary(db, storeId),
        db.select().from(schema.stores).where(eq(schema.stores.id, storeId)),
      ]);
      const payeeName = store[0]?.name ?? "Store";
      return rows.map((r) => ({
        customerId: r.customerId,
        name: r.name,
        phone: r.phone,
        balance: Math.round(r.balance),
        oldestDueDays: r.oldestDueDays,
        status: r.status,
        upi_link: generateUpiLink({
          payeeVpa: "ramesh@paytm",
          payeeName,
          amount: Math.round(r.balance),
          note: "Khata Payment",
        }),
      }));
    }
    case "INVENTORY": {
      const items = await db.select().from(schema.inventory).where(eq(schema.inventory.storeId, storeId));
      return items.map((i) => ({
        sku: i.sku,
        unit: i.unit,
        qtyOnHand: Math.round(i.qtyOnHand * 10) / 10,
        dailyVelocity: i.dailyVelocity,
        reorderLevel: i.reorderLevel,
        lastPrice: i.lastPrice,
        grossMarginPct: i.grossMarginPct,
        coverDays: i.dailyVelocity > 0 ? Math.round((i.qtyOnHand / i.dailyVelocity) * 10) / 10 : 999,
        daysToExpiry: i.expiryDate ? daysBetween(now(), i.expiryDate) : 999,
      }));
    }
    case "SALES": {
      const rows = await db.select().from(schema.sales).where(eq(schema.sales.storeId, storeId));
      return rows.map((r) => ({
        date: isoDate(r.hourBucket),
        hour: istHour(r.hourBucket),
        amount: Math.round(r.amount),
        qty: r.qty,
      }));
    }
    case "STAFF": {
      const staff = await db.select().from(schema.staff).where(eq(schema.staff.storeId, storeId));
      return staff.map((s) => ({
        workerId: s.id,
        name: s.name,
        phone: s.phone,
        role: s.role,
        monthlySalary: s.monthlySalary,
        advanceBalance: s.advanceBalance,
      }));
    }
    case "ATTENDANCE": {
      const today = isoDate();
      const [staff, attendance] = await Promise.all([
        db.select().from(schema.staff).where(eq(schema.staff.storeId, storeId)),
        db.select().from(schema.attendance).where(eq(schema.attendance.storeId, storeId)),
      ]);
      return staff.map((s) => {
        const a = attendance.find((x) => x.workerId === s.id && x.date === today);
        return {
          workerId: s.id,
          name: s.name,
          phone: s.phone,
          role: s.role,
          status: a?.status ?? "ABSENT",
          checkIn: a?.checkIn ?? null,
        };
      });
    }
    case "COMPLIANCE": {
      const items = await db.select().from(schema.complianceItems).where(eq(schema.complianceItems.storeId, storeId));
      return items.map((c) => ({
        title: c.title,
        authority: c.authority,
        dueDate: c.dueDate,
        daysLeft: daysBetween(now(), new Date(c.dueDate)),
        status: c.status,
      }));
    }
    case "SETTLEMENTS": {
      const rows = await db.select().from(schema.settlements).where(eq(schema.settlements.storeId, storeId));
      return rows.map((s) => {
        const mismatches = (s.mismatches as Array<{ amount: number }> | null) ?? [];
        return {
          date: s.date,
          posSalesTotal: s.posSalesTotal,
          pgSettledTotal: s.pgSettledTotal,
          cashTotal: s.cashTotal,
          mismatchCount: mismatches.length,
          mismatchAmount: Math.round(mismatches.reduce((sum, m) => sum + m.amount, 0)),
        };
      });
    }
    case "CUSTOMERS": {
      const rows = await db.select().from(schema.customers).where(eq(schema.customers.storeId, storeId));
      return rows.map((c) => ({ customerId: c.id, name: c.name, phone: c.phone, isRegular: c.isRegular }));
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Filtering & templating helpers (pure)
// ---------------------------------------------------------------------------

export function compare(actual: StudioRow[string], op: string, expected: number | string): boolean {
  const a = typeof actual === "string" && expected !== undefined && !isNaN(Number(actual)) ? Number(actual) : actual;
  const numeric = typeof a === "number" || typeof expected === "number";
  const left = numeric ? Number(a) : String(a ?? "").toLowerCase();
  const right = numeric ? Number(expected) : String(expected).toLowerCase();

  switch (op) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "contains":
      return String(left).includes(String(right));
    default:
      return false;
  }
}

export function renderTemplate(text: string, row: StudioRow | undefined, rows: StudioRow[], dataset?: StudioDataset): string {
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (key === "count") return String(rows.length);
    if (key === "list") return summarizeRows(rows, dataset);
    const value = row?.[rawKey] ?? row?.[key];
    if (value === undefined || value === null) return "";
    if (typeof value === "number") return value.toLocaleString("en-IN");
    return String(value);
  });
}

function summarizeRows(rows: StudioRow[], dataset?: StudioDataset): string {
  const lines = rows.slice(0, MAX_PREVIEW_LIST).map((r) => {
    switch (dataset) {
      case "KHATA":
        return `• ${r.name} — ₹${Number(r.balance).toLocaleString("en-IN")} · ${r.oldestDueDays}d overdue`;
      case "INVENTORY":
        return `• ${r.sku} — ${r.qtyOnHand}${r.unit} left · ${Number(r.daysToExpiry) > 900 ? "no expiry" : `${r.daysToExpiry}d to expiry`}`;
      case "SALES":
        return `• ${r.date} ${String(r.hour).padStart(2, "0")}:00 — ₹${Number(r.amount).toLocaleString("en-IN")}`;
      case "ATTENDANCE":
        return `• ${r.name} (${r.role}) — ${r.status}`;
      case "STAFF":
        return `• ${r.name} (${r.role})`;
      case "COMPLIANCE":
        return `• ${r.title} — due ${r.dueDate} (${r.daysLeft}d)`;
      case "SETTLEMENTS":
        return `• ${r.date} — ₹${Number(r.mismatchAmount).toLocaleString("en-IN")} mismatch`;
      case "CUSTOMERS":
        return `• ${r.name} — ${r.phone}`;
      default:
        return `• ${Object.values(r).slice(0, 3).join(" · ")}`;
    }
  });
  if (rows.length > MAX_PREVIEW_LIST) lines.push(`…and ${rows.length - MAX_PREVIEW_LIST} more`);
  return lines.join("\n");
}

/** Masked recipient for the builder preview (never show raw PII in a screenshot). */
export function maskRecipient(to: string): string {
  return /^\+?[\d\s-]{6,}$/.test(to) ? redactPhone(to) : to;
}

/** Does this agent's trigger fire at `at`? Used by the server's minutely
 * custom-agent ticker so hired Studio agents really run on schedule. */
export function shouldRunTrigger(triggerId: string, at: Date): boolean {
  const time = hhmm(at);
  const daily = /^CRON_HEARTBEAT_DAILY_(\d{2})(\d{2})$/.exec(triggerId);
  if (daily) return time === `${daily[1]}:${daily[2]}`;

  const weekly = /^CRON_HEARTBEAT_WEEKLY_([A-Z]{3})_(\d{2})(\d{2})$/.exec(triggerId);
  if (weekly) {
    return istWeekday(at) === weekly[1] && time === `${weekly[2]}:${weekly[3]}`;
  }

  const monthly = /^CRON_HEARTBEAT_MONTHLY_DAY(\d{1,2})_(\d{2})(\d{2})$/.exec(triggerId);
  if (monthly) {
    const day = Number(new Intl.DateTimeFormat("en-GB", { timeZone: IST_TZ, day: "numeric" }).format(at));
    return day === Number(monthly[1]) && time === `${monthly[2]}:${monthly[3]}`;
  }
  return false;
}

function istWeekday(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: IST_TZ, weekday: "short" }).format(date).toUpperCase();
}

export type { StudioFlow };
