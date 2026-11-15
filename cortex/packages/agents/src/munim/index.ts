import { eq, inArray } from "drizzle-orm";
import type { CortexDb } from "@cortex/db";
import { schema } from "@cortex/db";
import {
  appendActivityEvent,
  checkQuietHours,
  combineGuardrails,
  registerDecisionExecutor,
  stageDecision,
  startRun,
  addSubTask,
  completeTask,
  hhmm,
  isoDate,
  daysBetween,
  now,
} from "@cortex/runtime";
import { generateUpiLink } from "@cortex/connectors";
import { getActiveWhatsAppChannel } from "@cortex/channels";
import type { ReconciliationMismatch } from "@cortex/shared";
import { POLICY } from "../policy.js";
import { getKhataSummary } from "./ledger.js";

export { getKhataSummary } from "./ledger.js";

export const AGENT_ID = "munim-accounts";
const AGENT_NAME = "Munim";
const AGENT_AVATAR = "📒";

export async function run(db: CortexDb, storeId: string): Promise<{ runId: string }> {
  const { runId, taskId } = await startRun(db, { storeId, agentId: AGENT_ID, label: "Daily accounts & khata sweep" });
  void execute(db, storeId, runId, taskId).catch((err) => {
    console.error(`[munim] sweep failed for run ${runId}:`, err);
  });
  return { runId };
}

async function execute(db: CortexDb, storeId: string, runId: string, taskId: string): Promise<void> {
  await checkReconciliation(db, storeId, runId, taskId);
  await checkKhataBatch(db, storeId, runId, taskId);
  await checkComplianceCalendar(db, storeId, runId, taskId);
  await completeTask(db, taskId, "DONE");
}

async function checkReconciliation(db: CortexDb, storeId: string, runId: string, parentTaskId: string): Promise<void> {
  const [settlement] = await db.select().from(schema.settlements).where(eq(schema.settlements.storeId, storeId));
  if (!settlement) return;

  const mismatches = (settlement.mismatches as ReconciliationMismatch[] | null) ?? [];
  if (mismatches.length === 0) return;

  const subTaskId = await addSubTask(db, { storeId, agentId: AGENT_ID, runId, parentTaskId, label: "Reconciliation check" });
  for (const m of mismatches) {
    await appendActivityEvent(db, {
      storeId,
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      agentAvatar: AGENT_AVATAR,
      message: `Settlement mismatch: ₹${m.amount} short on ${m.txn_id} (${m.reason}). ${m.action}.`,
      type: "RECONCILIATION_MISMATCH",
      severity: "WARNING",
    });
  }

  const shortfall = mismatches.reduce((sum, m) => sum + m.amount, 0);
  const expected = settlement.pgSettledTotal + shortfall;
  await appendActivityEvent(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentAvatar: AGENT_AVATAR,
    message: `Day close ${settlement.date}: POS ₹${settlement.posSalesTotal} · PG settled ₹${settlement.pgSettledTotal} · cash ₹${settlement.cashTotal}. ₹${shortfall} of ₹${expected} expected PG money is still in transit across ${mismatches.length} txn(s) — Aman is following up.`,
    type: "RECONCILIATION_MISMATCH",
    severity: shortfall > 1000 ? "CRITICAL" : "WARNING",
  });
  await completeTask(db, subTaskId, "DONE");
}

/** Ageing buckets — how the money is spread, not just one total. */
function ageBuckets(customers: Array<{ oldestDueDays: number; balance: number }>): string {
  const buckets = [
    { label: "15–30d", test: (d: number) => d <= 30 },
    { label: "31–60d", test: (d: number) => d > 30 && d <= 60 },
    { label: "60d+", test: (d: number) => d > 60 },
  ];
  return buckets
    .map((b) => {
      const rows = customers.filter((c) => b.test(c.oldestDueDays));
      const sum = rows.reduce((acc, c) => acc + c.balance, 0);
      return rows.length > 0 ? `${b.label}: ₹${sum} (${rows.length})` : "";
    })
    .filter(Boolean)
    .join(" · ");
}

async function checkKhataBatch(db: CortexDb, storeId: string, runId: string, parentTaskId: string): Promise<void> {
  const summary = await getKhataSummary(db, storeId);
  const overdue = summary.filter(
    (c) => c.balance > POLICY.KHATA_BALANCE_THRESHOLD && c.oldestDueDays > POLICY.KHATA_DAYS_THRESHOLD && c.status !== "REMINDED",
  );
  if (overdue.length === 0) return;

  const subTaskId = await addSubTask(db, { storeId, agentId: AGENT_ID, runId, parentTaskId, label: "Khata reminder batch" });
  const totalOutstanding = overdue.reduce((sum, c) => sum + c.balance, 0);
  const buckets = ageBuckets(overdue);
  const oldest = overdue.slice().sort((a, b) => b.oldestDueDays - a.oldestDueDays)[0];

  const guardrail = combineGuardrails([checkQuietHours({ nowHHMM: hhmm(), range: POLICY.STORE_QUIET_HOURS })]);
  await appendActivityEvent(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: guardrail.passed ? "Guardrail" : "Guardrail",
    agentAvatar: "🛡️",
    message: guardrail.passed
      ? `Quiet-hours check: ${guardrail.summary}. Guardrail PASSED.`
      : `Khata reminder batch deferred: ${guardrail.summary}`,
    type: guardrail.passed ? "GUARDRAIL_PASSED" : "GUARDRAIL_BLOCKED",
    severity: guardrail.passed ? "SUCCESS" : "CRITICAL",
  });

  if (!guardrail.passed) {
    await completeTask(db, subTaskId, "FAILED");
    return;
  }

  await appendActivityEvent(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentAvatar: AGENT_AVATAR,
    message: `${overdue.length} customers have udhaar > ₹${POLICY.KHATA_BALANCE_THRESHOLD} for ${POLICY.KHATA_DAYS_THRESHOLD}+ days (total ₹${totalOutstanding}). Ageing — ${buckets}. Oldest: ${oldest?.name ?? "—"} at ${oldest?.oldestDueDays ?? 0} days. Drafting tiered reminders with UPI links.`,
    type: "COHORT_BUILT",
    severity: "INFO",
  });

  await stageDecision(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentAvatar: AGENT_AVATAR,
    kind: "KHATA_REMINDER_BATCH",
    payload: {
      customers: overdue.map((c) => ({ customerId: c.customerId, name: c.name, phone: c.phone, balance: c.balance, oldestDueDays: c.oldestDueDays })),
      amountOutstanding: totalOutstanding,
      ageing: buckets,
    },
    message: `${overdue.length} customers ka udhaar ₹${POLICY.KHATA_BALANCE_THRESHOLD} se zyada aur ${POLICY.KHATA_DAYS_THRESHOLD}+ din purana hai (₹${totalOutstanding}; ${buckets}). Polite reminder + Paytm UPI link bhej du?`,
    idempotencyKey: `khata:${storeId}:${isoDate()}`,
  });

  await completeTask(db, subTaskId, "DONE");
}

async function checkComplianceCalendar(db: CortexDb, storeId: string, runId: string, parentTaskId: string): Promise<void> {
  const items = await db.select().from(schema.complianceItems).where(eq(schema.complianceItems.storeId, storeId));
  // Fire for anything inside the 7-day window (not just exactly T-7/T-1) so a
  // skipped server day can never swallow a filing deadline, plus anything
  // already overdue.
  const dueSoon = items
    .map((c) => ({ ...c, daysLeft: daysBetween(now(), new Date(c.dueDate)) }))
    .filter((c) => c.daysLeft <= 7);
  if (dueSoon.length === 0) return;

  const subTaskId = await addSubTask(db, { storeId, agentId: AGENT_ID, runId, parentTaskId, label: "Compliance calendar check" });
  for (const item of dueSoon) {
    const when = item.daysLeft < 0 ? `overdue by ${Math.abs(item.daysLeft)} day(s)` : item.daysLeft === 0 ? "due TODAY" : `due in ${item.daysLeft} day(s)`;
    const next = item.status === "DRAFT_READY" ? "Draft is ready — export and send to your CA." : "Open the compliance tab to start the draft.";
    await appendActivityEvent(db, {
      storeId,
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      agentAvatar: AGENT_AVATAR,
      message: `${item.title} ${when} (${item.authority}). ${next}`,
      type: "COMPLIANCE_DUE",
      severity: item.daysLeft <= 1 ? "CRITICAL" : "WARNING",
    });
  }
  await completeTask(db, subTaskId, "DONE");
}

/** Tone escalates with age: nudge → firm → final notice. Same UPI link, so
 * the customer can pay from any of them. */
function dunningMessage(c: { name: string; balance: number; oldestDueDays: number }, link: string): string {
  if (c.oldestDueDays > 60) {
    return `Namaste ${c.name} ji. Aapka ₹${c.balance} udhaar ${c.oldestDueDays} din se pending hai. Yeh final reminder hai — kripya aaj hi ${link} se bhugtan karein, warna humein aapko phone karna padega. — Ramesh Sweets`;
  }
  if (c.oldestDueDays > 30) {
    return `Namaste ${c.name} ji. Aapka ₹${c.balance} udhaar ${c.oldestDueDays} din se baaki hai. Kripya is hafte ${link} se payment kar dein. Partial payment bhi chalta hai. — Ramesh Sweets`;
  }
  return `Namaste ${c.name} ji! Aapka udhaar ₹${c.balance} baaki hai. Kripya is link se bhugtan karein: ${link} — Ramesh Sweets`;
}

registerDecisionExecutor("KHATA_REMINDER_BATCH", async ({ db, storeId, agentId, payload }) => {
  const customers = payload.customers as Array<{ customerId: string; name: string; phone: string; balance: number; oldestDueDays?: number }>;
  const amountOutstanding = payload.amountOutstanding as number;

  let sent = 0;
  for (const c of customers) {
    const link = generateUpiLink({
      payeeVpa: "ramesh@paytm",
      payeeName: "Ramesh Sweets",
      amount: c.balance,
      note: "Khata Payment",
    });
    try {
      await getActiveWhatsAppChannel().sendText({
        storeId,
        toIdentityId: c.phone,
        text: dunningMessage({ name: c.name, balance: c.balance, oldestDueDays: c.oldestDueDays ?? 0 }, link),
      });
      sent += 1;
    } catch (err) {
      console.error(`[munim] khata reminder delivery failed for ${c.customerId}:`, err);
    }
  }

  const customerIds = customers.map((c) => c.customerId);
  if (customerIds.length > 0) {
    await db
      .update(schema.khataEntries)
      .set({ status: "REMINDED" })
      .where(inArray(schema.khataEntries.customerId, customerIds));
  }

  await appendActivityEvent(db, {
    storeId,
    agentId,
    agentName: "Munim",
    agentAvatar: AGENT_AVATAR,
    message: `Khata reminders sent to ${sent}/${customers.length} customers — ₹${amountOutstanding} outstanding, UPI links included.`,
    type: "ACTION_EXECUTED",
    severity: "SUCCESS",
  });

  return {
    result: { reminders_sent: sent, amount_outstanding: amountOutstanding },
    soundboxTriggered: false,
  };
});
