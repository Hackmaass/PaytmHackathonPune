import { and, eq } from "drizzle-orm";
import type { CortexDb } from "@cortex/db";
import { schema } from "@cortex/db";
import {
  appendActivityEvent,
  checkPayoutCeiling,
  checkTotalCap,
  combineGuardrails,
  registerDecisionExecutor,
  registerInboundTextHandler,
  stageDecision,
  startRun,
  addSubTask,
  completeTask,
  setAgentMetric,
  makeId,
  isoDate,
  timeLabel,
  hhmm,
} from "@cortex/runtime";
import { mockUpiPayout } from "@cortex/connectors";
import { getActiveWhatsAppChannel } from "@cortex/channels";
import { POLICY } from "../policy.js";

export const AGENT_ID = "meera-staff";
const AGENT_NAME = "Meera";
const AGENT_AVATAR = "👷";
const MAX_ABSENT_NUDGES = 3;

registerInboundTextHandler(async ({ db, storeId, role, identityId, text }) => {
  if (role !== "STAFF" || !/haazir/i.test(text)) return { handled: false };
  await checkIn(db, storeId, identityId, "WHATSAPP");
  return { handled: true, routedTo: AGENT_ID };
});

async function upsertAttendance(
  db: CortexDb,
  storeId: string,
  workerId: string,
  patch: { checkIn?: string; checkOut?: string; status?: string },
): Promise<void> {
  const today = isoDate();
  const [existing] = await db
    .select()
    .from(schema.attendance)
    .where(and(eq(schema.attendance.storeId, storeId), eq(schema.attendance.workerId, workerId), eq(schema.attendance.date, today)));

  if (existing) {
    await db.update(schema.attendance).set(patch).where(eq(schema.attendance.id, existing.id));
  } else {
    await db.insert(schema.attendance).values({
      id: makeId("att"),
      storeId,
      workerId,
      date: today,
      status: "ABSENT",
      ...patch,
    });
  }
}

export async function checkIn(db: CortexDb, storeId: string, workerId: string, source: string): Promise<void> {
  const label = timeLabel();
  const shiftStart = POLICY.SHIFT_START;
  const lateMinutes = Math.max(0, minutesSince(shiftStart, hhmm()));
  const isLate = lateMinutes > 0;
  await upsertAttendance(db, storeId, workerId, { checkIn: label, status: isLate ? "LATE" : "PRESENT" });

  const [worker] = await db.select().from(schema.staff).where(and(eq(schema.staff.storeId, storeId), eq(schema.staff.id, workerId)));
  await appendActivityEvent(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentAvatar: AGENT_AVATAR,
    message: `${worker?.name ?? workerId} checked in via ${source} at ${label}${
      isLate ? ` — late by ${lateMinutes} min (shift starts ${shiftStart})` : " · on time"
    }.`,
    type: "ATTENDANCE_SUMMARY",
    severity: isLate ? "WARNING" : "INFO",
  });
}

/** Whole minutes from "HH:MM" to "HH:MM" on the same day (0 if same or earlier). */
function minutesSince(fromHHMM: string, toHHMM: string): number {
  const [fh, fm] = fromHHMM.split(":").map(Number);
  const [th, tm] = toHHMM.split(":").map(Number);
  return ((th ?? 0) * 60 + (tm ?? 0)) - ((fh ?? 0) * 60 + (fm ?? 0));
}

export async function run(db: CortexDb, storeId: string): Promise<{ runId: string }> {
  const { runId, taskId } = await startRun(db, { storeId, agentId: AGENT_ID, label: "Attendance & payroll sweep" });
  void execute(db, storeId, runId, taskId).catch((err) => {
    console.error(`[meera] sweep failed for run ${runId}:`, err);
  });
  return { runId };
}

async function execute(db: CortexDb, storeId: string, runId: string, taskId: string): Promise<void> {
  await postAttendanceSummary(db, storeId);
  await checkPayday(db, storeId, runId, taskId);
  await completeTask(db, taskId, "DONE");
}

async function postAttendanceSummary(db: CortexDb, storeId: string): Promise<void> {
  const today = isoDate();
  const [staff, attendance] = await Promise.all([
    db.select().from(schema.staff).where(eq(schema.staff.storeId, storeId)),
    db.select().from(schema.attendance).where(and(eq(schema.attendance.storeId, storeId), eq(schema.attendance.date, today))),
  ]);
  // A worker with no attendance row at all is absent too — before, they were
  // silently left out of the count, which flattered the summary.
  const byWorker = new Map(attendance.map((a) => [a.workerId, a]));
  const presentRows = staff
    .map((s) => byWorker.get(s.id))
    .filter((a): a is (typeof attendance)[number] => Boolean(a) && a!.status !== "ABSENT");
  const present = presentRows.length;
  const absentWorkers = staff.filter((s) => {
    const row = byWorker.get(s.id);
    return !row || row.status === "ABSENT";
  });
  const absentNames = absentWorkers.map((s) => s.name).join(", ");
  const lateRows = presentRows.filter((a) => a.status === "LATE");
  const lateNames = lateRows
    .map((a) => {
      const name = staff.find((s) => s.id === a.workerId)?.name ?? a.workerId;
      const mins = a.checkIn ? lateMinutesFrom(a.checkIn) : 0;
      return `${name}${mins > 0 ? ` +${mins}m` : ""}`;
    })
    .join(", ");

  await setAgentMetric(db, storeId, AGENT_ID, "Present Today", `${present} / ${staff.length} Staff`);
  await appendActivityEvent(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentAvatar: AGENT_AVATAR,
    message: `${present} of ${staff.length} staff checked in via WhatsApp.${lateNames ? ` Late: ${lateNames}.` : ""}${
      absentNames ? ` Marked absent: ${absentNames}.` : ""
    }`,
    type: "ATTENDANCE_SUMMARY",
    severity: absentWorkers.length > 0 ? "WARNING" : "INFO",
  });

  // Nudge the absentees themselves — one WhatsApp each, capped, so a shift
  // reminder never turns into a broadcast.
  for (const worker of absentWorkers.slice(0, MAX_ABSENT_NUDGES)) {
    try {
      await getActiveWhatsAppChannel().sendText({
        storeId,
        toIdentityId: worker.phone,
        text: `Namaste ${worker.name} ji, aaj ki haaziri darj nahi hui hai. Counter par pahunch kar "Haazir" bhej dijiye. — Ramesh Sweets`,
      });
    } catch (err) {
      console.error(`[meera] absent nudge failed for ${worker.id}:`, err);
    }
  }
}

/** "09:12 AM" -> minutes past the shift start (0 when on time). */
function lateMinutesFrom(checkInLabel: string): number {
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(checkInLabel);
  if (!match) return 0;
  let hour = Number(match[1]) % 12;
  if (match[3]!.toUpperCase() === "PM") hour += 12;
  return Math.max(0, hour * 60 + Number(match[2]) - minutesSince("00:00", POLICY.SHIFT_START));
}

async function checkPayday(db: CortexDb, storeId: string, runId: string, parentTaskId: string): Promise<void> {
  const staff = await db.select().from(schema.staff).where(eq(schema.staff.storeId, storeId));
  const payouts = staff.map((s) => ({
    workerId: s.id,
    name: s.name,
    netPay: Math.max(0, s.monthlySalary - s.advanceBalance),
  }));
  const total = payouts.reduce((sum, p) => sum + p.netPay, 0);
  if (total <= 0) return;

  const gross = staff.reduce((sum, s) => sum + s.monthlySalary, 0);
  const advances = staff.reduce((sum, s) => sum + s.advanceBalance, 0);

  const subTaskId = await addSubTask(db, { storeId, agentId: AGENT_ID, runId, parentTaskId, label: "Payday guardrail" });
  const guardrail = combineGuardrails([
    ...payouts.map((p) => checkPayoutCeiling({ payout: p.netPay, netPay: p.netPay })),
    checkTotalCap({ totalRupees: total, capRupees: POLICY.PAYROLL_TOTAL_CAP }),
  ]);

  await appendActivityEvent(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: "Guardrail",
    agentAvatar: "🛡️",
    message: `Payroll: ${payouts.length} workers, gross ₹${gross} − advances ₹${advances} = ₹${total} net. ${guardrail.summary}.`,
    type: guardrail.passed ? "GUARDRAIL_PASSED" : "GUARDRAIL_BLOCKED",
    severity: guardrail.passed ? "SUCCESS" : "CRITICAL",
  });

  if (!guardrail.passed) {
    await completeTask(db, subTaskId, "FAILED");
    return;
  }

  const dayOfMonth = Number(isoDate().slice(8, 10));
  const isPayday = dayOfMonth === 1;
  await stageDecision(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentAvatar: AGENT_AVATAR,
    kind: "PAYROLL_PAYOUT",
    payload: { payouts, total },
    message: isPayday
      ? `Payday! ${payouts.length} staff ki salary ₹${total} (gross ₹${gross}, advances ₹${advances} adjusted). Sabko UPI se bhej du?`
      : `Payday rehearsal — ${payouts.length} staff, net ₹${total} (gross ₹${gross}, advances ₹${advances} adjusted). Approve to pay now, or let it fire on the 1st.`,
    idempotencyKey: `payroll:${storeId}:${isoDate().slice(0, 7)}`,
  });

  await completeTask(db, subTaskId, "DONE");
}

registerDecisionExecutor("PAYROLL_PAYOUT", async ({ db, storeId, decisionId, payload }) => {
  const payouts = payload.payouts as Array<{ workerId: string; name: string; netPay: number }>;
  const total = payload.total as number;

  for (const p of payouts) {
    mockUpiPayout({ toVpaOrPhone: p.workerId, amount: p.netPay });
    const [worker] = await db.select().from(schema.staff).where(and(eq(schema.staff.storeId, storeId), eq(schema.staff.id, p.workerId)));
    await db
      .update(schema.staff)
      .set({ advanceBalance: 0 })
      .where(and(eq(schema.staff.storeId, storeId), eq(schema.staff.id, p.workerId)));
    try {
      await getActiveWhatsAppChannel().sendVoiceNote({
        storeId,
        toIdentityId: worker?.phone ?? p.workerId,
        script: `${p.name} ji, is mahine aapki salary ₹${p.netPay} aapke UPI khaate mein bhej di gayi hai. Dhanyavaad!`,
      });
    } catch (err) {
      console.error(`[meera] payslip delivery failed for ${p.workerId}:`, err);
    }
  }

  await db.insert(schema.payroll).values({
    id: makeId("pay"),
    storeId,
    decisionId,
    period: isoDate().slice(0, 7),
    workersPaid: payouts.length,
    totalPaid: total,
  });

  return {
    result: { workers_paid: payouts.length, total_paid: total },
    soundboxTriggered: false,
  };
});
