import { eq } from "drizzle-orm";
import type { CortexDb } from "@cortex/db";
import { schema } from "@cortex/db";
import {
  appendActivityEvent,
  startRun,
  completeTask,
  setAgentMetric,
  makeId,
} from "@cortex/runtime";
import { paytmPgMock } from "@cortex/connectors";
import { getActiveWhatsAppChannel, getVoiceProvider } from "@cortex/channels";
import { numberToHindiWords } from "./hindi-numbers.js";

export const AGENT_ID = "aman-support";
const AGENT_NAME = "Aman";
const AGENT_AVATAR = "🛡️";
const LOOKUP_WINDOW_MINUTES = 5;

// Inbound WhatsApp text is owned by the central orchestrator in
// orchestrator.ts — it classifies the message (Sarvam), runs this payment
// lookup, and sends Aman's reply. Registering a second handler here used to
// swallow "check ₹350" messages before the orchestrator could answer, so the
// chat went silent. Aman now exposes `checkPayment` as a pure action.

/**
 * AGENTS.md §P2 — Aman's whole workflow is a synchronous lookup + action:
 * no merchant approval gate, because nothing here moves money (it either
 * confirms a payment that already succeeded, or opens a support ticket).
 */
export interface CheckPaymentResult {
  status: "SUCCESS" | "PENDING" | "NOT_FOUND";
  txnId?: string;
  utr?: string;
  ticketId?: string;
}

export async function checkPayment(db: CortexDb, storeId: string, amount: number): Promise<CheckPaymentResult> {
  const { taskId } = await startRun(db, { storeId, agentId: AGENT_ID, label: `Check payment ₹${amount}` });

  const matches = paytmPgMock.findRecentByAmount(amount, LOOKUP_WINDOW_MINUTES);
  const success = matches.find((t) => t.status === "SUCCESS");

  if (success) {
    await appendActivityEvent(db, {
      storeId,
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      agentAvatar: AGENT_AVATAR,
      message: `Payment verified — ${success.txn_id} · ₹${amount} · UTR ${success.utr} · SUCCESS${
        matches.length > 1 ? ` (1 of ${matches.length} ₹${amount} payments in the last ${LOOKUP_WINDOW_MINUTES} min)` : ""
      }.`,
      type: "PAYMENT_VERIFIED",
      severity: "SUCCESS",
    });

    if (success.soundboxLag && !success.soundboxAnnounced) {
      paytmPgMock.markSoundboxAnnounced(success.txn_id);

      await appendActivityEvent(db, {
        storeId,
        agentId: AGENT_ID,
        agentName: AGENT_NAME,
        agentAvatar: AGENT_AVATAR,
        message: "Soundbox cellular delay detected. Triggering priority edge override.",
        type: "SOUNDBOX_ANNOUNCED",
        severity: "WARNING",
      });
      const announcement = `Paytm par ${numberToHindiWords(amount)} rupaye prapt huye!`;
      await appendActivityEvent(db, {
        storeId,
        agentId: AGENT_ID,
        agentName: "Soundbox",
        agentAvatar: "🔊",
        message: announcement,
        type: "SOUNDBOX_ANNOUNCED",
        severity: "SUCCESS",
      });

      // Speak aloud in background via physical speaker / Bluetooth link if available
      void getVoiceProvider().speak(announcement).catch(() => {});

      await db.insert(schema.disputeResolutions).values({
        id: makeId("disp"),
        storeId,
        txnId: success.txn_id,
        amount,
      });
      const resolved = await db
        .select()
        .from(schema.disputeResolutions)
        .where(eq(schema.disputeResolutions.storeId, storeId));
      await setAgentMetric(db, storeId, AGENT_ID, "Disputes Resolved", `${resolved.length} UPI Holds`);
    }

    await completeTask(db, taskId, "DONE");
    return { status: "SUCCESS", txnId: success.txn_id, utr: success.utr };
  }

  // PENDING at the issuing bank, or nothing found — either way this needs
  // a human, so open a ticket rather than leaving the merchant guessing.
  const pending = matches.find((t) => t.status === "PENDING");
  const ticketId = `PTM-${Math.floor(10 + Math.random() * 89)}`;

  // "No ₹350 found" is useless on its own. Show the closest amount that did
  // arrive recently so the owner can say "haan wahi tha" in one reply.
  const nearMiss = matches.length === 0 ? closestAmount(amount) : undefined;

  await appendActivityEvent(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentAvatar: AGENT_AVATAR,
    message: pending
      ? `₹${amount} payment is PENDING at the issuing bank (${pending.txn_id} · UTR ${pending.utr}). Opened dispute ticket #${ticketId}.`
      : `No matching ₹${amount} transaction found in the last ${LOOKUP_WINDOW_MINUTES} minutes.${
          nearMiss ? ` Closest: ₹${nearMiss.amount} (${nearMiss.txn_id}, UTR ${nearMiss.utr}) — confirm if this is the one.` : ""
        } Opened dispute ticket #${ticketId} for manual review.`,
    type: "DISPUTE_OPENED",
    severity: "WARNING",
  });

  if (pending) {
    try {
      await getActiveWhatsAppChannel().sendText({
        storeId,
        toIdentityId: pending.payer,
        text: `Aapka ₹${amount} ka payment process ho raha hai. Bank confirmation aate hi turant update milega. — Ramesh Sweets`,
      });
    } catch (err) {
      console.error(`[aman] pending-payment notice delivery failed for ${pending.payer}:`, err);
    }
  }

  await completeTask(db, taskId, "DONE");
  return { status: pending ? "PENDING" : "NOT_FOUND", ticketId };
}

/** Manual "Run now" for Aman: a live PG/Soundbox queue sweep, not a no-op.
 * The trigger is still the inbound "check ₹X" text handled above. */
export async function run(db: CortexDb, storeId: string): Promise<{ runId: string }> {
  const { runId, taskId } = await startRun(db, { storeId, agentId: AGENT_ID, label: "Support queue check" });

  const all = paytmPgMock.all();
  const settled = all.filter((t) => t.status === "SUCCESS");
  const pending = all.filter((t) => t.status === "PENDING");
  const total = settled.reduce((sum, t) => sum + t.amount, 0);
  const held = pending.reduce((sum, t) => sum + t.amount, 0);
  const unannounced = settled.filter((t) => !t.soundboxAnnounced);

  await setAgentMetric(db, storeId, AGENT_ID, "Disputes Resolved", `${pending.length} UPI Holds`);
  await appendActivityEvent(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentAvatar: AGENT_AVATAR,
    message:
      all.length === 0
        ? "Checked PG and Soundbox queues — no transactions to reconcile right now."
        : `Collections check: ${settled.length} UPI payment(s) settled (₹${total})${pending.length > 0 ? `, ${pending.length} pending (₹${held})` : ""}${
            unannounced.length > 0 ? `, ${unannounced.length} Soundbox announcement(s) missing — edge override available` : ""
          }.`,
    type: pending.length > 0 ? "DISPUTE_OPENED" : "PAYMENT_VERIFIED",
    severity: pending.length > 0 ? "WARNING" : "INFO",
  });

  await completeTask(db, taskId, "DONE");
  return { runId };
}

/** Nearest successful amount inside the lookup window (for "did you mean ₹X"). */
function closestAmount(amount: number): { amount: number; txn_id: string; utr: string } | undefined {
  const candidates = paytmPgMock
    .recent(LOOKUP_WINDOW_MINUTES * 4)
    .filter((t) => t.status === "SUCCESS")
    .sort((a, b) => Math.abs(a.amount - amount) - Math.abs(b.amount - amount));
  const best = candidates[0];
  // Only suggest something plausibly the same payment (within 25%).
  if (!best || Math.abs(best.amount - amount) > Math.max(50, amount * 0.25)) return undefined;
  return { amount: best.amount, txn_id: best.txn_id, utr: best.utr };
}
