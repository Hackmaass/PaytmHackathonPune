import { z } from "zod";
import { AgentStatusEnum } from "./enums.js";

// Sandboxed tool catalogue the Studio compiler may grant (AGENTS.md §4 / PROPOSAL §4).
// Every flow node kind maps to exactly one of these, so a compiled agent can
// never call something outside the catalogue (see packages/runtime/tool-gateway.ts).
export const STUDIO_TOOLS = [
  "WHATSAPP_DRAFT",
  "PAYTM_UPI_LINK_GENERATOR",
  "POS_STOCK_READ",
  "KHATA_READ",
  "SUPPLIER_RFQ",
  "SALES_READ",
  "CUSTOMER_READ",
  "STAFF_READ",
  "COMPLIANCE_READ",
  "SOUNDBOX_ANNOUNCE",
] as const;
export const StudioToolEnum = z.enum(STUDIO_TOOLS);
export type StudioTool = z.infer<typeof StudioToolEnum>;

// --- Datasets a flow can read. Each is a live query against the store DB,
// so a hired agent's output changes with real counter activity. ---
export const STUDIO_DATASETS = [
  "KHATA",
  "INVENTORY",
  "SALES",
  "STAFF",
  "ATTENDANCE",
  "COMPLIANCE",
  "SETTLEMENTS",
  "CUSTOMERS",
] as const;
export const StudioDatasetEnum = z.enum(STUDIO_DATASETS);
export type StudioDataset = z.infer<typeof StudioDatasetEnum>;

export const STUDIO_DATASET_LABELS: Record<StudioDataset, string> = {
  KHATA: "Khata ledger (udhaar)",
  INVENTORY: "Stock & batches",
  SALES: "Hourly sales",
  STAFF: "Staff roster",
  ATTENDANCE: "Today's attendance",
  COMPLIANCE: "Compliance calendar",
  SETTLEMENTS: "Paytm settlements",
  CUSTOMERS: "Customer list",
};

/** Tool each dataset requires — enforced before the engine reads a row. */
export const STUDIO_DATASET_TOOL: Record<StudioDataset, StudioTool> = {
  KHATA: "KHATA_READ",
  INVENTORY: "POS_STOCK_READ",
  SALES: "SALES_READ",
  STAFF: "STAFF_READ",
  ATTENDANCE: "STAFF_READ",
  COMPLIANCE: "COMPLIANCE_READ",
  SETTLEMENTS: "SALES_READ",
  CUSTOMERS: "CUSTOMER_READ",
};

/** Fields exposed by each dataset for filtering, in the order the UI shows them. */
export const STUDIO_FILTER_FIELDS: Record<StudioDataset, string[]> = {
  KHATA: ["balance", "oldestDueDays"],
  INVENTORY: ["coverDays", "daysToExpiry", "qtyOnHand", "dailyVelocity", "grossMarginPct"],
  SALES: ["amount", "hour"],
  STAFF: ["monthlySalary", "advanceBalance"],
  ATTENDANCE: ["status"],
  COMPLIANCE: ["daysLeft"],
  SETTLEMENTS: ["mismatchAmount"],
  CUSTOMERS: ["isRegular"],
};

// --- Node kinds: the n8n-style blocks the builder canvas is made of. ---
export const STUDIO_NODE_KINDS = ["TRIGGER", "READ", "FILTER", "GUARDRAIL", "DRAFT", "APPROVAL", "NOTIFY"] as const;
export const StudioNodeKindEnum = z.enum(STUDIO_NODE_KINDS);
export type StudioNodeKind = z.infer<typeof StudioNodeKindEnum>;

export const STUDIO_NODE_META: Record<
  StudioNodeKind,
  { title: string; icon: string; tint: string; blurb: string }
> = {
  TRIGGER: { title: "Trigger", icon: "⏰", tint: "#8b5cf6", blurb: "When this teammate wakes up" },
  READ: { title: "Read data", icon: "🗂️", tint: "#00baf2", blurb: "Pull live rows from the store" },
  FILTER: { title: "Filter", icon: "🔎", tint: "#0ea5e9", blurb: "Keep only rows worth acting on" },
  GUARDRAIL: { title: "Guardrail", icon: "🛡️", tint: "#f59e0b", blurb: "Hard limits that can block the run" },
  DRAFT: { title: "Draft message", icon: "💬", tint: "#25d366", blurb: "Personalised WhatsApp copy per row" },
  APPROVAL: { title: "Merchant approval", icon: "✅", tint: "#002970", blurb: "1-tap card before anything is sent" },
  NOTIFY: { title: "Notify", icon: "🔊", tint: "#64748b", blurb: "Log to the live stream / Soundbox" },
};

// --- Triggers ---
export const STUDIO_TRIGGERS = [
  { id: "CRON_HEARTBEAT_DAILY_0700", label: "Every day · 7:00 AM", cadence: "DAILY", time: "07:00" },
  { id: "CRON_HEARTBEAT_DAILY_0900", label: "Every day · 9:00 AM", cadence: "DAILY", time: "09:00" },
  { id: "CRON_HEARTBEAT_DAILY_1100", label: "Every day · 11:00 AM", cadence: "DAILY", time: "11:00" },
  { id: "CRON_HEARTBEAT_DAILY_1800", label: "Every day · 6:00 PM", cadence: "DAILY", time: "18:00" },
  { id: "CRON_HEARTBEAT_DAILY_2100", label: "Every day · 9:00 PM", cadence: "DAILY", time: "21:00" },
  { id: "CRON_HEARTBEAT_WEEKLY_FRI_1800", label: "Every Friday · 6:00 PM", cadence: "WEEKLY", time: "18:00" },
  { id: "CRON_HEARTBEAT_MONTHLY_DAY1_0900", label: "1st of every month · 9:00 AM", cadence: "MONTHLY", time: "09:00" },
  { id: "ON_INBOUND_MESSAGE", label: "When a WhatsApp message arrives", cadence: "EVENT", time: "" },
  { id: "ON_MANUAL_RUN", label: "Only when you press Run", cadence: "MANUAL", time: "" },
] as const;
export type StudioTrigger = (typeof STUDIO_TRIGGERS)[number];

export function triggerLabel(triggerId: string): string {
  const known = STUDIO_TRIGGERS.find((t) => t.id === triggerId);
  if (known) return known.label;
  // Legacy ids compiled by earlier builds (e.g. CRON_HEARTBEAT_DAILY_09AM)
  const legacy = /DAILY_(\d{2})(\d{2})$/.exec(triggerId);
  if (legacy) return `Every day · ${legacy[1]}:${legacy[2]}`;
  return triggerId.replace(/_/g, " ").toLowerCase();
}

export function isKnownTrigger(triggerId: string): boolean {
  return STUDIO_TRIGGERS.some((t) => t.id === triggerId);
}

// --- Flow graph ---
export const STUDIO_FILTER_OPS = ["gt", "gte", "lt", "lte", "eq", "neq", "contains"] as const;
export const StudioFilterOpEnum = z.enum(STUDIO_FILTER_OPS);
export type StudioFilterOp = z.infer<typeof StudioFilterOpEnum>;

export const StudioFilterConditionSchema = z.object({
  field: z.string().min(1),
  op: StudioFilterOpEnum,
  value: z.union([z.number(), z.string()]),
});
export type StudioFilterCondition = z.infer<typeof StudioFilterConditionSchema>;

export const StudioNodeConfigSchema = z.object({
  trigger: z.string().optional(),
  dataset: StudioDatasetEnum.optional(),
  filters: z.array(StudioFilterConditionSchema).max(6).optional(),
  minRows: z.number().int().min(1).max(500).optional(),
  quietHours: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/i).optional(),
  maxMessages: z.number().int().min(1).max(200).optional(),
  /** true (default) = one message per matched row; false = one summary message. */
  per_row: z.boolean().optional(),
  text: z.string().max(1200).optional(),
  message: z.string().max(600).optional(),
});
export type StudioNodeConfig = z.infer<typeof StudioNodeConfigSchema>;

export const StudioFlowNodeSchema = z.object({
  id: z.string().min(1),
  kind: StudioNodeKindEnum,
  label: z.string().min(1).max(60),
  config: StudioNodeConfigSchema.default({}),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
});
export type StudioFlowNode = z.infer<typeof StudioFlowNodeSchema>;

export const StudioFlowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
});
export type StudioFlowEdge = z.infer<typeof StudioFlowEdgeSchema>;

export const StudioFlowSchema = z.object({
  nodes: z.array(StudioFlowNodeSchema).min(1).max(24),
  edges: z.array(StudioFlowEdgeSchema).max(40),
});
export type StudioFlow = z.infer<typeof StudioFlowSchema>;

// --- Compile / generate requests ---
// AGENTS.md §5.4 generate request (kept wire-compatible: prompt + template_id),
// extended with an optional hand-edited flow from the visual builder.
export const CustomAgentGenerateRequestSchema = z.object({
  prompt: z.string().min(1),
  template_id: z.string().nullable(),
  flow: StudioFlowSchema.optional(),
  name: z.string().max(60).optional(),
  avatar: z.string().max(8).optional(),
  role: z.string().max(80).optional(),
  trigger: z.string().max(60).optional(),
});
export type CustomAgentGenerateRequest = z.infer<typeof CustomAgentGenerateRequestSchema>;

// Builder-first compile request: a flow with no prompt is valid.
export const CustomAgentCompileRequestSchema = z.object({
  prompt: z.string().default(""),
  template_id: z.string().nullable().optional(),
  flow: StudioFlowSchema.optional(),
  name: z.string().max(60).optional(),
  avatar: z.string().max(8).optional(),
  role: z.string().max(80).optional(),
  trigger: z.string().max(60).optional(),
});
export type CustomAgentCompileRequest = z.infer<typeof CustomAgentCompileRequestSchema>;

export const CustomAgentGuardrailsSchema = z.object({
  max_messages_per_day: z.number().int().positive(),
  restricted_hours: z.string(),
  require_merchant_approval: z.literal(true),
});
export type CustomAgentGuardrails = z.infer<typeof CustomAgentGuardrailsSchema>;

// AGENTS.md §5.4 generate response (status DRAFT until hired)
export const CustomAgentSpecSchema = z.object({
  agent_id: z.string(),
  name: z.string(),
  avatar: z.string(),
  role: z.string(),
  description: z.string().default(""),
  trigger: z.string(),
  tools: z.array(StudioToolEnum),
  guardrails: CustomAgentGuardrailsSchema,
  status: AgentStatusEnum,
  flow: StudioFlowSchema.optional(),
});
export type CustomAgentSpec = z.infer<typeof CustomAgentSpecSchema>;

export const StudioTemplateSchema = z.object({
  template_id: z.string(),
  name: z.string(),
  avatar: z.string(),
  role: z.string(),
  description: z.string(),
  prompt: z.string(),
  trigger: z.string(),
  tools: z.array(StudioToolEnum),
  flow: StudioFlowSchema,
});
export type StudioTemplate = z.infer<typeof StudioTemplateSchema>;

// --- Dry-run / test response (no decision staged, no message sent) ---
export const StudioTraceStepSchema = z.object({
  node_id: z.string(),
  kind: StudioNodeKindEnum,
  label: z.string(),
  status: z.enum(["PASS", "BLOCKED", "EMPTY", "SKIPPED"]),
  detail: z.string(),
  row_count: z.number().int().optional(),
});
export type StudioTraceStep = z.infer<typeof StudioTraceStepSchema>;

export const StudioPreviewMessageSchema = z.object({
  to_label: z.string(),
  to: z.string(),
  text: z.string(),
});
export type StudioPreviewMessage = z.infer<typeof StudioPreviewMessageSchema>;

export const StudioTestRunResponseSchema = z.object({
  success: z.boolean(),
  agent_id: z.string(),
  steps: z.array(StudioTraceStepSchema),
  messages: z.array(StudioPreviewMessageSchema),
  needs_approval: z.boolean(),
  headline: z.string(),
});
export type StudioTestRunResponse = z.infer<typeof StudioTestRunResponseSchema>;
