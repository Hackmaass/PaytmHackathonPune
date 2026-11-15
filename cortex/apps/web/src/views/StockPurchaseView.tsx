import type { DecisionActionResponse, DecisionRejectResponse } from "@cortex/shared";
import { usePolling } from "../hooks/usePolling.js";
import { useDecisionAction } from "../hooks/useDecisionAction.js";
import { api } from "../api.js";
import { StaleNotice } from "../components/StaleNotice.js";

type DecisionResponse = DecisionActionResponse | DecisionRejectResponse | undefined;

/** Translates the server's guardrail verdict into the owner's language. */
function guardrailCopy(verdict: string): { icon: string; text: string } {
  if (verdict.startsWith("PASSED")) return { icon: "✅", text: `Price check passed — ${verdict.replace(/^PASSED\s*\(?/, "").replace(/\)$/, "")}` };
  if (verdict.startsWith("BLOCKED")) return { icon: "🚫", text: "Blocked: this order breaks a spending limit." };
  return { icon: "🛡️", text: verdict };
}


export function StockPurchaseView(props: { onDecision: (decisionId: string, action: "APPROVE" | "REJECT") => Promise<DecisionResponse> }) {
  const pos = usePolling(api.getPurchaseOrders, 4000);
  const { decide, busyId, notice } = useDecisionAction({
    onDecision: props.onDecision,
    onSettled: () => void pos.refresh(),
  });

  return (
    <div className="view">
      <div className="view-header">
        <h2>📦 Stock & Purchase</h2>
      </div>

      <StaleNotice error={pos.error} label="purchase orders" />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {pos.data?.map((po) => (
          <span key={po.po_id} className="pill amber">
            {po.sku}: {po.qty}
          </span>
        ))}
        {pos.data?.length === 0 && <span className="empty-state">No low-stock SKUs right now.</span>}
      </div>

      {pos.data?.map((po) => (
        <section className="card" key={po.po_id}>
          <div className="card-title">
            <span>
              {po.sku} — {po.qty} units — {po.po_id}
            </span>
            <span className={`pill ${po.status === "AWAITING_APPROVAL" ? "amber" : po.status === "EXECUTED" ? "green" : "red"}`}>
              {po.status.replace(/_/g, " ")}
            </span>
          </div>
          <div className="overflow-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Unit Price</th>
                  <th>ETA</th>
                </tr>
              </thead>
              <tbody>
                {po.quotes.map((q) => (
                  <tr key={q.supplier} className={q.selected ? "highlight" : ""}>
                    <td>
                      {q.supplier} {q.selected && "✅"}
                    </td>
                    <td>₹{q.unit_price}</td>
                    <td>{q.eta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 16px", fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
            <div>
              Total: <strong>₹{po.total.toLocaleString("en-IN")}</strong> (last price ₹{po.last_price})
            </div>
            <div className="empty-state" style={{ padding: 0, textAlign: "left" }}>
              {guardrailCopy(po.guardrail).icon} {guardrailCopy(po.guardrail).text}
            </div>
            {notice && (
              <div className={notice.tone === "success" ? "banner success" : "banner error"} role="status">
                {notice.text}
              </div>
            )}
            {po.status === "AWAITING_APPROVAL" && (
              <div className="inline-decision-actions">
                <button className="approve" disabled={busyId !== undefined} onClick={() => void decide(po.decision_id, "APPROVE")}>
                  {busyId === po.decision_id ? "Sending…" : `Approve — ₹${po.total.toLocaleString("en-IN")}`}
                </button>
                <button className="reject" disabled={busyId !== undefined} onClick={() => void decide(po.decision_id, "REJECT")}>
                  Reject
                </button>
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
