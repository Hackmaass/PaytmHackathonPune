import type { StudioFlow, StudioTemplate, StudioTool } from "@cortex/shared";

/** Template blueprint = the wire-facing StudioTemplate (with a ready-to-edit
 * flow) plus the policy knobs the compiler reads. */
export interface TemplateBlueprint extends StudioTemplate {
  maxMessagesPerDay: number;
  /** One-line "why a real merchant cares" used in the Studio gallery. */
  whyItMatters: string;
}

function flow(
  trigger: string,
  nodes: Array<{
    id: string;
    kind: StudioFlow["nodes"][number]["kind"];
    label: string;
    config: StudioFlow["nodes"][number]["config"];
  }>,
): StudioFlow {
  return {
    nodes: nodes.map((n, i) => ({ ...n, position: { x: 40 + i * 240, y: 90 } })),
    edges: nodes.slice(1).map((n, i) => ({ id: `${nodes[i]!.id}->${n.id}`, source: nodes[i]!.id, target: n.id })),
  };
}

// PAYTM_WORKFORCE_STUDIO_PROPOSAL.md §4 — Studio starter templates. Each one
// compiles to a real, runnable flow: trigger -> read -> filter -> guardrail
// -> draft -> merchant approval. Thresholds are editable on the canvas.
export const STUDIO_TEMPLATES: TemplateBlueprint[] = [
  {
    template_id: "udhaar-recovery-agent",
    name: "Udhaar Recovery Agent",
    avatar: "🧾",
    role: "Wholesale Credit Guardian",
    description: "Balances over ₹5,000 unpaid for 15+ days → polite WhatsApp reminder with a Paytm UPI link.",
    whyItMatters: "Udhaar is the biggest silent cash leak in a kirana. This recovers it without an awkward phone call.",
    prompt: "Track customer credit dues (khata). If balance exceeds ₹5,000 for more than 15 days, send a WhatsApp reminder with a Paytm UPI link.",
    trigger: "CRON_HEARTBEAT_DAILY_1100",
    tools: ["KHATA_READ", "WHATSAPP_DRAFT", "PAYTM_UPI_LINK_GENERATOR"],
    maxMessagesPerDay: 50,
    flow: flow("CRON_HEARTBEAT_DAILY_1100", [
      { id: "trigger", kind: "TRIGGER", label: "Every day · 11:00 AM", config: { trigger: "CRON_HEARTBEAT_DAILY_1100" } },
      { id: "read-khata", kind: "READ", label: "Read khata ledger", config: { dataset: "KHATA" } },
      {
        id: "filter-overdue",
        kind: "FILTER",
        label: "Overdue & large",
        config: {
          filters: [
            { field: "balance", op: "gt", value: 5000 },
            { field: "oldestDueDays", op: "gte", value: 15 },
          ],
        },
      },
      {
        id: "guardrails",
        kind: "GUARDRAIL",
        label: "Quiet hours & caps",
        config: { minRows: 1, quietHours: "20:00-10:00", maxMessages: 50 },
      },
      {
        id: "draft-reminder",
        kind: "DRAFT",
        label: "Draft UPI reminder",
        config: {
          text: "Namaste {{name}} ji! Aapka udhaar ₹{{balance}} baaki hai ({{oldestDueDays}} din se). Kripya is link se bhugtan karein: {{upi_link}} — Ramesh Sweets",
        },
      },
      { id: "approve", kind: "APPROVAL", label: "Merchant approves batch", config: {} },
    ]),
  },
  {
    template_id: "pharmacy-expiry-sentinel",
    name: "Expiry Sentinel",
    avatar: "💊",
    role: "Batch Shelf-Life Auditor",
    description: "Batches expiring within 30 days → clearance / supplier-credit alert before the stock is dead.",
    whyItMatters: "Every expired kg is 100% margin lost. A 30-day heads-up turns wastage into a discount offer.",
    prompt: "Track batch expiry dates. If a batch is within 30 days of expiry, flag it for a supplier credit claim or a clearance discount.",
    trigger: "CRON_HEARTBEAT_DAILY_0900",
    tools: ["POS_STOCK_READ", "WHATSAPP_DRAFT"],
    maxMessagesPerDay: 20,
    flow: flow("CRON_HEARTBEAT_DAILY_0900", [
      { id: "trigger", kind: "TRIGGER", label: "Every day · 9:00 AM", config: { trigger: "CRON_HEARTBEAT_DAILY_0900" } },
      { id: "read-stock", kind: "READ", label: "Read stock & batches", config: { dataset: "INVENTORY" } },
      { id: "filter-expiry", kind: "FILTER", label: "Expiring within 30 days", config: { filters: [{ field: "daysToExpiry", op: "lte", value: 30 }] } },
      { id: "guardrails", kind: "GUARDRAIL", label: "Quiet hours & caps", config: { minRows: 1, quietHours: "20:00-08:00", maxMessages: 20 } },
      {
        id: "draft-alert",
        kind: "DRAFT",
        label: "Draft clearance alert",
        config: {
          per_row: false,
          text: "⏳ {{count}} batches expire soon:\n{{list}}\n\nReply CLEAR to put them on a clearance discount today.",
        },
      },
      { id: "approve", kind: "APPROVAL", label: "Merchant approves alert", config: {} },
    ]),
  },
  {
    template_id: "compliance-chaser",
    name: "Compliance Chaser",
    avatar: "🗓️",
    role: "Licence & Filing Watchdog",
    description: "GST / FSSAI / shop-licence deadlines 15 days out → owner reminder while there is still time.",
    whyItMatters: "One missed FSSAI renewal can shut the counter. This is the cheapest insurance a shop can buy.",
    prompt: "Remind me about GST, FSSAI and shop licence deadlines 15 days before they are due.",
    trigger: "CRON_HEARTBEAT_DAILY_0900",
    tools: ["COMPLIANCE_READ", "WHATSAPP_DRAFT"],
    maxMessagesPerDay: 10,
    flow: flow("CRON_HEARTBEAT_DAILY_0900", [
      { id: "trigger", kind: "TRIGGER", label: "Every day · 9:00 AM", config: { trigger: "CRON_HEARTBEAT_DAILY_0900" } },
      { id: "read-compliance", kind: "READ", label: "Read compliance calendar", config: { dataset: "COMPLIANCE" } },
      { id: "filter-due", kind: "FILTER", label: "Due within 15 days", config: { filters: [{ field: "daysLeft", op: "lte", value: 15 }] } },
      { id: "guardrails", kind: "GUARDRAIL", label: "Quiet hours & caps", config: { minRows: 1, quietHours: "20:00-08:00", maxMessages: 10 } },
      {
        id: "draft-alert",
        kind: "DRAFT",
        label: "Draft deadline alert",
        config: { per_row: false, text: "🗓️ {{count}} compliance deadline(s) coming up:\n{{list}}\n\nMunim can draft the filing — just say the word." },
      },
      { id: "approve", kind: "APPROVAL", label: "Merchant approves alert", config: {} },
    ]),
  },
  {
    template_id: "attendance-watch",
    name: "Attendance Watch",
    avatar: "👷",
    role: "Shift Discipline Desk",
    description: "Workers with no check-in by the shift cut-off → nudge the worker and tell the owner.",
    whyItMatters: "A missing cook at 9 AM costs the lunch rush. A nudge at 9:15 protects the day's revenue.",
    prompt: "If any staff member has not checked in by 9:30 AM, send them a WhatsApp nudge and tell me who is missing.",
    trigger: "CRON_HEARTBEAT_DAILY_0900",
    tools: ["STAFF_READ", "WHATSAPP_DRAFT"],
    maxMessagesPerDay: 20,
    flow: flow("CRON_HEARTBEAT_DAILY_0900", [
      { id: "trigger", kind: "TRIGGER", label: "Every day · 9:00 AM", config: { trigger: "CRON_HEARTBEAT_DAILY_0900" } },
      { id: "read-attendance", kind: "READ", label: "Read today's attendance", config: { dataset: "ATTENDANCE" } },
      { id: "filter-absent", kind: "FILTER", label: "Not checked in", config: { filters: [{ field: "status", op: "eq", value: "ABSENT" }] } },
      { id: "guardrails", kind: "GUARDRAIL", label: "Quiet hours & caps", config: { minRows: 1, quietHours: "20:00-08:00", maxMessages: 20 } },
      {
        id: "draft-nudge",
        kind: "DRAFT",
        label: "Nudge the worker",
        config: { text: "Namaste {{name}} ji! Aaj ki haaziri abhi tak nahi lagi. Counter par rush hone wala hai — jaldi aa jaiye. — Ramesh Sweets" },
      },
      { id: "approve", kind: "APPROVAL", label: "Merchant approves nudges", config: {} },
    ]),
  },
  {
    template_id: "rush-hour-reconciler",
    name: "Rush-Hour Reconciler",
    avatar: "🍽️",
    role: "Peak-Hour Revenue Watch",
    description: "Evening hours running below target → alert while the rush can still be saved.",
    whyItMatters: "6–9 PM is where the day is won or lost. Catching a weak evening at 7 PM is worth more than a report next morning.",
    prompt: "Watch evening sales between 6 PM and 9 PM. If any peak hour falls below ₹3,000, alert me immediately.",
    trigger: "CRON_HEARTBEAT_DAILY_1800",
    tools: ["SALES_READ", "WHATSAPP_DRAFT"],
    maxMessagesPerDay: 10,
    flow: flow("CRON_HEARTBEAT_DAILY_1800", [
      { id: "trigger", kind: "TRIGGER", label: "Every day · 6:00 PM", config: { trigger: "CRON_HEARTBEAT_DAILY_1800" } },
      { id: "read-sales", kind: "READ", label: "Read hourly sales", config: { dataset: "SALES" } },
      {
        id: "filter-evening",
        kind: "FILTER",
        label: "Weak evening hours",
        config: {
          filters: [
            { field: "hour", op: "gte", value: 18 },
            { field: "hour", op: "lte", value: 21 },
            { field: "amount", op: "lt", value: 3000 },
          ],
        },
      },
      { id: "guardrails", kind: "GUARDRAIL", label: "Quiet hours & caps", config: { minRows: 1, quietHours: "20:00-08:00", maxMessages: 10 } },
      {
        id: "draft-alert",
        kind: "DRAFT",
        label: "Draft evening alert",
        config: { per_row: false, text: "📉 Evening sales are soft — {{count}} hour-buckets under ₹3,000:\n{{list}}\n\nPriya can send a 10% recovery voucher to regulars in 1 tap." },
      },
      { id: "approve", kind: "APPROVAL", label: "Merchant approves alert", config: {} },
    ]),
  },
  {
    template_id: "apparel-slow-mover",
    name: "Slow-Mover Liquidator",
    avatar: "👗",
    role: "Dead-Stock Liquidator",
    description: "SKUs with 21+ days of cover → weekend bundle offer before capital sits idle.",
    whyItMatters: "Cash locked in dead stock cannot buy what is actually selling. Clear it while it still has value.",
    prompt: "Find SKUs with more than 21 days of stock cover and draft a weekend bundle offer for regular customers.",
    trigger: "CRON_HEARTBEAT_WEEKLY_FRI_1800",
    tools: ["POS_STOCK_READ", "WHATSAPP_DRAFT"],
    maxMessagesPerDay: 50,
    flow: flow("CRON_HEARTBEAT_WEEKLY_FRI_1800", [
      { id: "trigger", kind: "TRIGGER", label: "Every Friday · 6:00 PM", config: { trigger: "CRON_HEARTBEAT_WEEKLY_FRI_1800" } },
      { id: "read-stock", kind: "READ", label: "Read stock cover", config: { dataset: "INVENTORY" } },
      { id: "filter-slow", kind: "FILTER", label: "21+ days of cover", config: { filters: [{ field: "coverDays", op: "gt", value: 21 }] } },
      { id: "guardrails", kind: "GUARDRAIL", label: "Quiet hours & caps", config: { minRows: 1, quietHours: "20:00-08:00", maxMessages: 50 } },
      {
        id: "draft-bundle",
        kind: "DRAFT",
        label: "Draft weekend bundle",
        config: { per_row: false, text: "🛍️ {{count}} SKUs are moving slowly:\n{{list}}\n\nShall I draft a weekend bundle for regulars?" },
      },
      { id: "approve", kind: "APPROVAL", label: "Merchant approves bundle", config: {} },
    ]),
  },
];

export function findTemplate(templateId: string | null | undefined): TemplateBlueprint | undefined {
  if (!templateId) return undefined;
  return STUDIO_TEMPLATES.find((t) => t.template_id === templateId);
}

/** Extra tools a compiled spec needs, derived from the flow's nodes rather
 * than trusted from the request (the sandbox catalogue is closed). */
export function toolsForFlow(f: StudioFlow, base: StudioTool[] = []): StudioTool[] {
  const tools = new Set<StudioTool>(base);
  for (const node of f.nodes) {
    if (node.kind === "READ" && node.config.dataset) {
      const map: Record<string, StudioTool> = {
        KHATA: "KHATA_READ",
        INVENTORY: "POS_STOCK_READ",
        SALES: "SALES_READ",
        STAFF: "STAFF_READ",
        ATTENDANCE: "STAFF_READ",
        COMPLIANCE: "COMPLIANCE_READ",
        SETTLEMENTS: "SALES_READ",
        CUSTOMERS: "CUSTOMER_READ",
      };
      const tool = map[node.config.dataset];
      if (tool) tools.add(tool);
    }
    if (node.kind === "DRAFT") {
      tools.add("WHATSAPP_DRAFT");
      if (/\{\{\s*upi_link\s*\}\}|upi/i.test(node.config.text ?? "")) tools.add("PAYTM_UPI_LINK_GENERATOR");
    }
    if (node.kind === "NOTIFY") tools.add("SOUNDBOX_ANNOUNCE");
  }
  if (tools.size === 0) tools.add("WHATSAPP_DRAFT");
  return [...tools];
}
