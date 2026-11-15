import { and, desc, eq } from "drizzle-orm";
import type { CortexDb } from "@cortex/db";
import { schema } from "@cortex/db";
import { daysBetween, isoDate, now } from "@cortex/runtime";
import { AGENT_PROFILES, type ChatAgentId } from "./agent-registry.js";

/**
 * Everything the AI employees are allowed to know about the store, read live
 * from the counter database on every message. Prompting the LLM with real
 * rows (instead of hardcoded demo prose) is what stops it from answering
 * "mere paas live record nahi hai".
 */

export interface KhataAccount {
  name: string;
  balance: number;
  dueDays: number;
}

export interface StockItem {
  sku: string;
  unit: string;
  qtyOnHand: number;
  dailyVelocity: number;
  reorderLevel: number;
  lastPrice: number;
  coverDays: number;
  expiryDays?: number;
}

export interface StaffRow {
  name: string;
  role: string;
  status: string;
  checkIn: string | null;
  monthlySalary: number;
  advanceBalance: number;
}

export interface ComplianceRow {
  title: string;
  authority: string;
  dueDate: string;
  daysLeft: number;
  status: string;
}

export interface PendingDecision {
  id: string;
  kind: string;
  agentId: string;
  agentName: string;
  message: string;
}

export interface StoreFacts {
  storeName: string;
  khata: { total: number; accounts: KhataAccount[] };
  stock: StockItem[];
  staff: StaffRow[];
  staffPresent: number;
  payrollNet: number;
  advances: number;
  settlement?: {
    date: string;
    posSalesTotal: number;
    pgSettledTotal: number;
    cashTotal: number;
    mismatches: Array<{ txn_id?: string; amount?: number; reason?: string }>;
  };
  compliance: ComplianceRow[];
  sales: { lastDayTotal: number; baselineAvg: number; deficit: number };
  pendingDecisions: PendingDecision[];
}

const EMPTY_FACTS: StoreFacts = {
  storeName: "Ramesh Sweets & Restaurant",
  khata: { total: 0, accounts: [] },
  stock: [],
  staff: [],
  staffPresent: 0,
  payrollNet: 0,
  advances: 0,
  compliance: [],
  sales: { lastDayTotal: 0, baselineAvg: 0, deficit: 0 },
  pendingDecisions: [],
};

const inr = (n: number): string => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n))}`;

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[store-context] ${label} failed:`, (err as Error).message);
    return fallback;
  }
}

export async function loadStoreFacts(db: CortexDb, storeId: string): Promise<StoreFacts> {
  const facts: StoreFacts = { ...EMPTY_FACTS, khata: { total: 0, accounts: [] }, sales: { lastDayTotal: 0, baselineAvg: 0, deficit: 0 } };

  const [storeRows, customers, khataRows, inventory, staffRows, attendanceRows, settlements, compliance, salesRows, decisions] =
    await Promise.all([
      safe("store", () => db.select().from(schema.stores).where(eq(schema.stores.id, storeId)), []),
      safe("customers", () => db.select().from(schema.customers).where(eq(schema.customers.storeId, storeId)), []),
      safe("khata", () => db.select().from(schema.khataEntries).where(eq(schema.khataEntries.storeId, storeId)), []),
      safe("inventory", () => db.select().from(schema.inventory).where(eq(schema.inventory.storeId, storeId)), []),
      safe("staff", () => db.select().from(schema.staff).where(eq(schema.staff.storeId, storeId)), []),
      safe("attendance", () => db.select().from(schema.attendance).where(eq(schema.attendance.storeId, storeId)), []),
      safe(
        "settlements",
        () => db.select().from(schema.settlements).where(eq(schema.settlements.storeId, storeId)).orderBy(desc(schema.settlements.date)).limit(1),
        [],
      ),
      safe("compliance", () => db.select().from(schema.complianceItems).where(eq(schema.complianceItems.storeId, storeId)), []),
      safe("sales", () => db.select().from(schema.sales).where(eq(schema.sales.storeId, storeId)), []),
      safe(
        "pending decisions",
        () =>
          db
            .select()
            .from(schema.decisions)
            .where(and(eq(schema.decisions.storeId, storeId), eq(schema.decisions.status, "AWAITING_APPROVAL")))
            .orderBy(desc(schema.decisions.createdAt))
            .limit(3),
        [],
      ),
    ]);

  facts.storeName = storeRows[0]?.name ?? EMPTY_FACTS.storeName;

  // --- Khata: balance per customer = CREDIT - PAYMENT ---
  const names = new Map(customers.map((c) => [c.id, c.name]));
  const oldestCredit = new Map<string, Date>();
  const balances = new Map<string, number>();
  for (const row of khataRows) {
    const signed = row.type === "PAYMENT" ? -row.amount : row.amount;
    balances.set(row.customerId, (balances.get(row.customerId) ?? 0) + signed);
    if (row.type === "CREDIT") {
      const prev = oldestCredit.get(row.customerId);
      if (!prev || row.createdAt < prev) oldestCredit.set(row.customerId, row.createdAt);
    }
  }
  facts.khata.accounts = [...balances.entries()]
    .filter(([, balance]) => balance > 0)
    .map(([customerId, balance]) => ({
      name: names.get(customerId) ?? customerId,
      balance,
      dueDays: Math.max(0, daysBetween(oldestCredit.get(customerId) ?? now(), now())),
    }))
    .sort((a, b) => b.balance - a.balance);
  facts.khata.total = facts.khata.accounts.reduce((sum, a) => sum + a.balance, 0);

  // --- Stock: cover in days, nearest expiry ---
  facts.stock = inventory.map((i) => {
    const velocity = Math.max(i.dailyVelocity, 0.1);
    const item: StockItem = {
      sku: i.sku,
      unit: i.unit,
      qtyOnHand: i.qtyOnHand,
      dailyVelocity: i.dailyVelocity,
      reorderLevel: i.reorderLevel,
      lastPrice: i.lastPrice,
      coverDays: Math.round((i.qtyOnHand / velocity) * 10) / 10,
    };
    if (i.expiryDate) item.expiryDays = Math.max(0, daysBetween(now(), i.expiryDate));
    return item;
  });

  // --- Staff + today's attendance ---
  const today = isoDate();
  const todayById = new Map(attendanceRows.filter((a) => a.date === today).map((a) => [a.workerId, a]));
  facts.staff = staffRows.map((s) => {
    const att = todayById.get(s.id);
    return {
      name: s.name,
      role: s.role,
      status: att?.status ?? "ABSENT",
      checkIn: att?.checkIn ?? null,
      monthlySalary: s.monthlySalary,
      advanceBalance: s.advanceBalance,
    };
  });
  facts.staffPresent = facts.staff.filter((s) => s.status !== "ABSENT").length;
  facts.payrollNet = facts.staff.reduce((sum, s) => sum + s.monthlySalary - s.advanceBalance, 0);
  facts.advances = facts.staff.reduce((sum, s) => sum + s.advanceBalance, 0);

  const settlement = settlements[0];
  if (settlement) {
    facts.settlement = {
      date: settlement.date,
      posSalesTotal: settlement.posSalesTotal,
      pgSettledTotal: settlement.pgSettledTotal,
      cashTotal: settlement.cashTotal,
      mismatches: Array.isArray(settlement.mismatches)
        ? (settlement.mismatches as Array<{ txn_id?: string; amount?: number; reason?: string }>)
        : [],
    };
  }

  facts.compliance = compliance
    .map((c) => ({
      title: c.title,
      authority: c.authority,
      dueDate: c.dueDate,
      daysLeft: Math.max(0, daysBetween(now(), new Date(`${c.dueDate}T00:00:00Z`))),
      status: c.status,
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // --- Sales: most recent day vs the baseline average before it ---
  const byDate = new Map<string, number>();
  for (const row of salesRows) {
    const key = row.hourBucket.toISOString().slice(0, 10);
    byDate.set(key, (byDate.get(key) ?? 0) + row.amount);
  }
  const dates = [...byDate.keys()].sort();
  const lastKey = dates.at(-1);
  const lastDayTotal = lastKey ? (byDate.get(lastKey) ?? 0) : 0;
  const earlier = dates.slice(0, -1).map((d) => byDate.get(d) ?? 0);
  const baselineAvg = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : 0;
  facts.sales = {
    lastDayTotal,
    baselineAvg,
    deficit: Math.max(0, baselineAvg - lastDayTotal),
  };

  facts.pendingDecisions = decisions.map((d) => ({
    id: d.id,
    kind: d.kind,
    agentId: d.agentId,
    agentName: AGENT_PROFILES[d.agentId as ChatAgentId]?.name ?? d.agentId,
    message: String((d.payload as { message?: string })?.message ?? d.kind),
  }));

  return facts;
}

function stockLine(item: StockItem): string {
  const expiry = item.expiryDays !== undefined ? `, expiry in ${item.expiryDays}d` : "";
  return `${item.sku}: ${item.qtyOnHand} ${item.unit} left, ~${item.coverDays}d cover (reorder at ${item.reorderLevel} ${item.unit}, last price ₹${item.lastPrice}/${item.unit}${expiry})`;
}

/** Compact, factual brief injected into every agent's system prompt. */
export function renderStoreContext(facts: StoreFacts, agentId: ChatAgentId | "cortex-orchestrator"): string {
  const lines: string[] = [`STORE: ${facts.storeName} (single outlet, counter + UPI/Paytm Soundbox).`];

  const pending = facts.pendingDecisions.length
    ? `PENDING APPROVALS: ${facts.pendingDecisions.map((d) => `${d.kind} ${d.id} from ${d.agentName}`).join("; ")}.`
    : "PENDING APPROVALS: none.";
  lines.push(pending);

  if (agentId === "munim-accounts" || agentId === "cortex-orchestrator") {
    if (facts.khata.accounts.length) {
      lines.push(`KHATA OUTSTANDING: ${inr(facts.khata.total)} across ${facts.khata.accounts.length} customers:`);
      for (const a of facts.khata.accounts) lines.push(`- ${a.name}: ${inr(a.balance)}, ${a.dueDays} days old`);
    } else {
      lines.push("KHATA OUTSTANDING: none.");
    }
    if (facts.settlement) {
      const gap = facts.settlement.posSalesTotal - facts.settlement.pgSettledTotal;
      lines.push(
        `SETTLEMENT (${facts.settlement.date}): POS ${inr(facts.settlement.posSalesTotal)}, PG settled ${inr(facts.settlement.pgSettledTotal)}, cash ${inr(facts.settlement.cashTotal)}, gap ${inr(gap)}.`,
      );
      for (const m of facts.settlement.mismatches) {
        lines.push(`- Mismatch ${m.txn_id ?? ""} ${inr(m.amount ?? 0)} (${m.reason ?? "unknown"})`);
      }
    }
    if (facts.compliance.length) {
      lines.push(`COMPLIANCE: ${facts.compliance.map((c) => `${c.title} due ${c.dueDate} (${c.daysLeft}d, ${c.status})`).join("; ")}.`);
    }
  }

  if (agentId === "vikram-procurement" || agentId === "cortex-orchestrator") {
    const low = facts.stock.filter((s) => s.coverDays < 1.5 || s.qtyOnHand <= s.reorderLevel).sort((a, b) => a.coverDays - b.coverDays);
    lines.push(low.length ? "LOW STOCK:" : "LOW STOCK: none.");
    for (const item of low) lines.push(`- ${stockLine(item)}`);
    if (low.length === 0) {
      for (const item of facts.stock) lines.push(`- ${stockLine(item)}`);
    }
    lines.push("SUPPLIERS ON FILE: Sharma Dairy, Fresh Farms, City Wholesale (RFQ by WhatsApp; guardrail: PO ≤ ₹10,000 and ≤ last price +8%).");
  }

  if (agentId === "meera-staff" || agentId === "cortex-orchestrator") {
    const absent = facts.staff.filter((s) => s.status === "ABSENT").map((s) => s.name);
    lines.push(`STAFF: ${facts.staffPresent}/${facts.staff.length} present today${absent.length ? `, absent: ${absent.join(", ")}` : ""}.`);
    for (const s of facts.staff) {
      lines.push(`- ${s.name} (${s.role}): ${s.status}${s.checkIn ? ` at ${s.checkIn}` : ""}, salary ${inr(s.monthlySalary)}, advance ${inr(s.advanceBalance)}`);
    }
    lines.push(`PAYROLL: net payable ${inr(facts.payrollNet)} (advances ${inr(facts.advances)} already deducted).`);
  }

  if (agentId === "priya-sales" || agentId === "cortex-orchestrator") {
    lines.push(
      `SALES: most recent day ${inr(facts.sales.lastDayTotal)} vs 30-day baseline ${inr(facts.sales.baselineAvg)} (gap ${inr(facts.sales.deficit)}).`,
    );
  }

  if (agentId === "aman-support" || agentId === "cortex-orchestrator") {
    lines.push("PAYMENTS: Paytm Soundbox is ONLINE with edge override; payment lookups cover the last 5 minutes by amount.");
  }

  return lines.join("\n");
}

/**
 * Deterministic, fact-grounded answer used when Sarvam is unavailable (or
 * LLM calls are disabled for tests/demo). Never invents numbers.
 */
export function fallbackReply(facts: StoreFacts, agentId: ChatAgentId, greetingName: string): string {
  const profile = AGENT_PROFILES[agentId];
  const header = `${profile.avatar} *${profile.name} (${profile.role})*`;

  switch (agentId) {
    case "munim-accounts": {
      const top = facts.khata.accounts.slice(0, 3);
      const accounts = top.length
        ? top.map((a, i) => `${i + 1}. *${a.name}*: ${inr(a.balance)} (${a.dueDays} days overdue)`).join("\n")
        : "• No outstanding udhaar right now.";
      const gap = facts.settlement ? facts.settlement.posSalesTotal - facts.settlement.pgSettledTotal : 0;
      const nextCompliance = facts.compliance[0];
      return `${header}

Pranaam ${greetingName}! Munim here. Live khata position:

*Total udhaar: ${inr(facts.khata.total)}* across ${facts.khata.accounts.length} customers
${accounts}

• Settlement gap today: *${inr(gap)}* (POS vs PG)
• Compliance: ${nextCompliance ? `*${nextCompliance.title}* due ${nextCompliance.dueDate} (${nextCompliance.daysLeft} days, ${nextCompliance.status})` : "nothing due"}

Reply *"send reminders"* to send polite WhatsApp reminders with Paytm UPI links.`;
    }
    case "vikram-procurement": {
      const low = facts.stock
        .filter((s) => s.coverDays < 1.5 || s.qtyOnHand <= s.reorderLevel)
        .sort((a, b) => a.coverDays - b.coverDays);
      const lines = low.length
        ? low.map((s) => `- *${s.sku}*: ${s.qtyOnHand} ${s.unit} left (~${s.coverDays}d cover, reorder at ${s.reorderLevel} ${s.unit})`).join("\n")
        : facts.stock.slice(0, 4).map((s) => `- ${s.sku}: ${s.qtyOnHand} ${s.unit} (~${s.coverDays}d cover)`).join("\n");
      return `${header}

Namaste ${greetingName}! Vikram here. Live counter stock:

${lines}

Suppliers on file: *Sharma Dairy* (best rate), Fresh Farms, City Wholesale.

Reply *"Order paneer"* and I will draft the PO from the best quote (guardrail: ≤ ₹10,000 and ≤ last price +8%).`;
    }
    case "priya-sales": {
      return `${header}

Namaste ${greetingName}! Priya here. Live sales snapshot:

• Latest day: *${inr(facts.sales.lastDayTotal)}*
• 30-day baseline: ${inr(facts.sales.baselineAvg)}
• Gap: *${inr(facts.sales.deficit)}*
• Playbook: 10% win-back voucher to regulars, margin floor 30%.

Reply *"send vouchers"* to stage the campaign for your 1-tap approval.`;
    }
    case "aman-support": {
      return `${header}

Namaste ${greetingName}! Aman here. I monitor Paytm Soundbox, counter payments and UPI holds in real time.

To verify a payment, send the amount — e.g. *"Check ₹350"* — and I will reconcile it against the Paytm PG ledger within seconds.`;
    }
    case "meera-staff": {
      const absent = facts.staff.filter((s) => s.status === "ABSENT").map((s) => s.name);
      const roster = facts.staff
        .map((s) => `${s.status === "ABSENT" ? "❌" : "✅"} ${s.name} (${s.role})${s.checkIn ? ` — ${s.checkIn}` : ""}`)
        .join("\n");
      return `${header}

Namaste ${greetingName}! Meera here. Attendance today: *${facts.staffPresent}/${facts.staff.length} present*${absent.length ? `, absent: ${absent.join(", ")}` : ""}.

${roster}

• Net payroll ready: *${inr(facts.payrollNet)}* (advances ${inr(facts.advances)} deducted)
Reply *"pay salary"* to stage the payday payout.`;
    }
  }
}
