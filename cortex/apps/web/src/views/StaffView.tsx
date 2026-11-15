import type { DecisionActionResponse, DecisionRejectResponse } from "@cortex/shared";
import { useState } from "react";
import { usePolling } from "../hooks/usePolling.js";
import { useDecisionAction } from "../hooks/useDecisionAction.js";
import { api } from "../api.js";
import { StaleNotice } from "../components/StaleNotice.js";
import type { PendingDecision } from "../hooks/usePendingDecisions.js";

type DecisionResponse = DecisionActionResponse | DecisionRejectResponse | undefined;

const STATUS_COLOR: Record<string, string> = { PRESENT: "green", LATE: "amber", ABSENT: "red" };

export function StaffView(props: {
  pending: PendingDecision[];
  onDecision: (decisionId: string, action: "APPROVE" | "REJECT") => Promise<DecisionResponse>;
}) {
  const staff = usePolling(api.getStaff, 4000);
  const { decide, busyId, notice } = useDecisionAction({
    onDecision: props.onDecision,
    onSettled: () => void staff.refresh(),
  });
  const [confirming, setConfirming] = useState(false);
  const payrollDecision = props.pending.find((p) => p.decision_kind === "PAYROLL_PAYOUT");

  const workers = staff.data?.workers ?? [];
  const workerCount = workers.length;
  const totalNet = workers.reduce((sum, w) => sum + (w.monthly_salary - w.advance_balance), 0);

  async function markPresent(workerId: string): Promise<void> {
    await api.markAttendance(workerId, "CHECK_IN");
    void staff.refresh();
  }

  return (
    <div className="view">
      <div className="view-header">
        <h2>👷 Staff</h2>
        {staff.data && (
          <span className="pill blue">
            Present {staff.data.present} / {staff.data.total}
          </span>
        )}
      </div>

      <StaleNotice error={staff.error} label="staff ledger" />

      {staff.data?.next_payday && (
        <section className="card">
          <div className="card-title">Next Payday — {staff.data.next_payday.date}</div>
          <div style={{ padding: 14, fontSize: 13, display: "flex", flexDirection: "column", gap: 10 }}>
            {!confirming && (
              <>
                <div>
                  Estimated total: <strong>₹{staff.data.next_payday.estimated_total.toLocaleString("en-IN")}</strong>
                  <span style={{ color: "var(--text-muted)" }}> for {workerCount} workers (advances deducted at payout)</span>
                </div>
                {payrollDecision && (
                  <>
                    <div>{payrollDecision.message}</div>
                    <div className="inline-decision-actions">
                      <button
                        className="approve"
                        disabled={busyId !== undefined}
                        onClick={() => setConfirming(true)}
                      >
                        Pay All — ₹{staff.data.next_payday.estimated_total.toLocaleString("en-IN")}
                      </button>
                      <button
                        className="reject"
                        disabled={busyId !== undefined}
                        onClick={() => void decide(payrollDecision.decision_id, "REJECT")}
                      >
                        Reject Payout
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {confirming && payrollDecision && (
              <div
                style={{
                  border: "1px solid var(--card-border)",
                  borderRadius: 10,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  background: "#f8fafc",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 13 }}>Confirm payout — this cannot be undone</div>
                <div className="overflow-x desktop-only-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Worker</th>
                        <th>Salary</th>
                        <th>Advance</th>
                        <th>Net Pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workers.map((w) => (
                        <tr key={w.worker_id}>
                          <td>{w.name}</td>
                          <td>₹{w.monthly_salary.toLocaleString("en-IN")}</td>
                          <td>{w.advance_balance > 0 ? `− ₹${w.advance_balance.toLocaleString("en-IN")}` : "—"}</td>
                          <td>
                            <strong>₹{(w.monthly_salary - w.advance_balance).toLocaleString("en-IN")}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="m-ledger">
                  {workers.map((w) => (
                    <li key={w.worker_id} className="m-ledger__row">
                      <span className="m-ledger__name">{w.name}</span>
                      <span className="m-ledger__math">
                        ₹{w.monthly_salary.toLocaleString("en-IN")}
                        {w.advance_balance > 0 && ` − ₹${w.advance_balance.toLocaleString("en-IN")}`} ={" "}
                        <strong>₹{(w.monthly_salary - w.advance_balance).toLocaleString("en-IN")}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
                <div>
                  Total: <strong>₹{totalNet.toLocaleString("en-IN")}</strong> to {workerCount} workers via UPI.
                  <span className="pill green" style={{ marginLeft: 8 }}>
                    Guardrail: payout ≤ computed net pay
                  </span>
                </div>
                {notice && (
                  <div className={notice.tone === "success" ? "banner success" : "banner error"} role="status">
                    {notice.text}
                  </div>
                )}
                <div className="inline-decision-actions">
                  <button
                    className="approve"
                    disabled={busyId !== undefined}
                    onClick={() => void decide(payrollDecision.decision_id, "APPROVE").then(() => setConfirming(false))}
                  >
                    {busyId === payrollDecision.decision_id ? "Paying…" : "✅ Confirm & Pay All"}
                  </button>
                  <button className="reject" disabled={busyId !== undefined} onClick={() => setConfirming(false)}>
                    Back
                  </button>
                </div>
              </div>
            )}

            {!confirming && notice && (
              <div className={notice.tone === "success" ? "banner success" : "banner error"} role="status">
                {notice.text}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-title">Worker Ledger</div>
        <div className="overflow-x desktop-only-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Check-in</th>
                <th>Status</th>
                <th>Salary</th>
                <th>Advance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.data?.workers.map((w) => (
                <tr key={w.worker_id}>
                  <td>{w.name}</td>
                  <td>{w.role}</td>
                  <td>{w.check_in ?? "—"}</td>
                  <td>
                    <span className={`pill ${STATUS_COLOR[w.status] ?? "slate"}`}>{w.status}</span>
                  </td>
                  <td>₹{w.monthly_salary.toLocaleString("en-IN")}</td>
                  <td>₹{w.advance_balance.toLocaleString("en-IN")}</td>
                  <td>
                    {w.status === "ABSENT" && (
                      <button className="btn secondary" onClick={() => void markPresent(w.worker_id)}>
                        Mark Present
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="m-staff-list">
          {workers.length === 0 && <li className="m-empty__body">No workers on the roster yet.</li>}
          {workers.map((w) => (
            <li key={w.worker_id} className="m-staff">
              <div className="m-staff__head">
                <div>
                  <p className="m-staff__name">{w.name}</p>
                  <p className="m-staff__role">
                    {w.role} · in at {w.check_in ?? "—"}
                  </p>
                </div>
                <span className={`pill ${STATUS_COLOR[w.status] ?? "slate"}`}>{w.status}</span>
              </div>
              <div className="m-staff__math">
                <span>Salary ₹{w.monthly_salary.toLocaleString("en-IN")}</span>
                <span>Advance ₹{w.advance_balance.toLocaleString("en-IN")}</span>
              </div>
              {w.status === "ABSENT" && (
                <button
                  type="button"
                  className="m-btn m-btn--ghost m-btn--block"
                  onClick={() => void markPresent(w.worker_id)}
                >
                  Mark present
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
