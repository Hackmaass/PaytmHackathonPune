import { useCallback, useState } from "react";
import type { DecisionActionResponse, DecisionRejectResponse } from "@cortex/shared";

type DecisionResponse = DecisionActionResponse | DecisionRejectResponse | undefined;

export interface DecisionNotice {
  tone: "success" | "error";
  text: string;
}

const rupees = (value: number) => `₹${value.toLocaleString("en-IN")}`;

/** What actually happened, in the merchant's terms — no generic "Executed." */
function describeResult(res: DecisionActionResponse): string {
  switch (res.decision_kind) {
    case "VOUCHER_CAMPAIGN":
      return `${res.result.dispatched_vouchers} vouchers sent · ${rupees(res.result.attributed_projected_revenue)} projected`;
    case "PURCHASE_ORDER":
      return `${res.result.po_id} sent to ${res.result.supplier} · ${rupees(res.result.total)}`;
    case "PAYROLL_PAYOUT":
      return `${res.result.workers_paid} workers paid · ${rupees(res.result.total_paid)}`;
    case "KHATA_REMINDER_BATCH":
      return `${res.result.reminders_sent} reminders sent · ${rupees(res.result.amount_outstanding)} outstanding`;
    default:
      return "the decision was executed";
  }
}

/**
 * Single guarded wrapper for every approve/reject button in the app.
 * - Blocks double-fires (one in-flight decision at a time per component)
 * - Catches failures and turns them into accurate copy instead of silent
 *   unhandled rejections (409 = already decided elsewhere, not an error)
 * - Emits a short-lived notice the component renders near the action
 */
export function useDecisionAction(props: {
  onDecision: (decisionId: string, action: "APPROVE" | "REJECT") => Promise<DecisionResponse>;
  onSettled?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<DecisionNotice | undefined>(undefined);

  const decide = useCallback(
    async (decisionId: string, action: "APPROVE" | "REJECT"): Promise<DecisionResponse> => {
      if (busyId) return undefined; // already acting on a decision — ignore extra clicks
      setBusyId(decisionId);
      try {
        const res = await props.onDecision(decisionId, action);
        if (res && "result" in res) {
          setNotice({
            tone: "success",
            text: `✅ Executed — ${describeResult(res)}${res.soundbox_triggered ? " · Soundbox announced" : ""}.`,
          });
        } else if (res) {
          setNotice({ tone: "success", text: "Rejected — the decision was not sent." });
        }
        return res;
      } catch (err) {
        const status = (err as Error & { status?: number }).status;
        setNotice({
          tone: "error",
          text:
            status === 409
              ? "Already decided — this approval was actioned from another device."
              : `Couldn't record the decision: ${(err as Error).message}. Check the connection and try again.`,
        });
        return undefined;
      } finally {
        setBusyId(undefined);
        props.onSettled?.();
        window.setTimeout(() => setNotice(undefined), 4500);
      }
    },
    [busyId, props.onDecision, props.onSettled],
  );

  return { decide, busyId, notice };
}
