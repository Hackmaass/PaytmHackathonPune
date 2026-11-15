import { useState } from "react";
import { usePolling } from "../hooks/usePolling.js";
import { api } from "../api.js";
import { soundboxAudio } from "../services/soundboxAudio.js";
import { StaleNotice } from "../components/StaleNotice.js";

const STATUS_COLOR: Record<string, string> = { REMINDER_DRAFTED: "amber", REMINDED: "blue", PAID: "green" };

export function KhataAccountsView() {
  const khata = usePolling(api.getKhata, 5000);
  const recon = usePolling(() => api.getReconciliation(), 5000);
  const compliance = usePolling(api.getComplianceCalendar, 15000);
  const [showAdd, setShowAdd] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function openWhatsAppReminder(name: string, phone: string, balance: number) {
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    const msg = encodeURIComponent(
      `Namaste ${name} ji! Umeed hai aap kushal mangal hain. Ramesh Sweets par aapka ₹${balance.toLocaleString("en-IN")} ka balance baaki hai. Suvidha ke liye Paytm UPI dwara bhugtan karein: paytm.me/ramesh-sweets 🙏`,
    );
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, "_blank");
    setActionNotice({ tone: "success", text: `WhatsApp draft opened for ${name} (₹${balance}).` });
    soundboxAudio.queueAnnouncement(`Munim: ${name} ji ko udhaar reminder WhatsApp bhej diya gaya hai.`);
    setTimeout(() => setActionNotice(null), 4000);
  }

  return (
    <div className="view">
      <div className="view-header">
        <h2>📒 Khata & Accounts</h2>
      </div>

      {actionNotice && (
        <div className={`banner ${actionNotice.tone === "success" ? "success" : "error"}`} style={{ marginBottom: 12 }} role="status">
          {actionNotice.text}
        </div>
      )}

      <StaleNotice error={khata.error} label="udhaar ledger" />

      <div className="split-60-40">
        <section className="card">
          <div className="card-title">
            <span>Udhaar Ledger — ₹{khata.data?.total_outstanding.toLocaleString("en-IN") ?? "—"} outstanding</span>
            <button className="btn" onClick={() => setShowAdd((v) => !v)}>
              + Add Entry
            </button>
          </div>
          {showAdd && (
            <AddEntryForm
              customers={khata.data?.entries ?? []}
              onDone={() => {
                setShowAdd(false);
                setActionNotice({ tone: "success", text: "Entry saved to the udhaar ledger." });
                setTimeout(() => setActionNotice(null), 4000);
                void khata.refresh();
              }}
              onError={(msg) => {
                setActionNotice({ tone: "error", text: msg });
                setTimeout(() => setActionNotice(null), 5000);
              }}
            />
          )}
          
          {/* Desktop Table View */}
          <div className="overflow-x desktop-only-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Balance</th>
                  <th>Oldest Due</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {khata.data?.entries.map((e) => (
                  <tr key={e.customer_id} className={e.balance > 5000 && e.oldest_due_days > 15 ? "highlight" : ""}>
                    <td><strong>{e.name}</strong></td>
                    <td>{e.phone}</td>
                    <td>₹{e.balance.toLocaleString("en-IN")}</td>
                    <td>{e.oldest_due_days}d</td>
                    <td>
                      <span className={`pill ${STATUS_COLOR[e.status] ?? "slate"}`}>{e.status.replace(/_/g, " ")}</span>
                    </td>
                    <td>
                      <button
                        className="btn btn-sm secondary"
                        onClick={() => openWhatsAppReminder(e.name, e.phone, e.balance)}
                        title="Send polite Hindi reminder via WhatsApp"
                      >
                        💬 WhatsApp
                      </button>
                    </td>
                  </tr>
                ))}
                {khata.data?.entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      No outstanding khata entries.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List View */}
          <div className="mobile-khata-cards">
            {khata.data?.entries.map((e) => (
              <div key={e.customer_id} className={`m-khata-card ${e.balance > 5000 && e.oldest_due_days > 15 ? "overdue-highlight" : ""}`}>
                <div className="m-khata-row">
                  <div>
                    <div className="m-khata-name">{e.name}</div>
                    <div className="m-khata-phone">{e.phone}</div>
                  </div>
                  <div className="m-khata-balance">₹{e.balance.toLocaleString("en-IN")}</div>
                </div>
                <div className="m-khata-row" style={{ marginTop: 8 }}>
                  <div className="m-khata-meta">
                    <span className="pill slate">{e.oldest_due_days} days due</span>
                    <span className={`pill ${STATUS_COLOR[e.status] ?? "slate"}`}>{e.status.replace(/_/g, " ")}</span>
                  </div>
                  <button
                    className="btn btn-sm primary"
                    onClick={() => openWhatsAppReminder(e.name, e.phone, e.balance)}
                  >
                    💬 Send WhatsApp
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-title">Daily Reconciliation {recon.data ? `— ${recon.data.date}` : ""}</div>
          {recon.data && (
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
              <div>POS Sales: ₹{recon.data.pos_sales_total.toLocaleString("en-IN")}</div>
              <div>Bank Settled (Paytm): ₹{recon.data.pg_settled_total.toLocaleString("en-IN")}</div>
              <div>Cash: ₹{recon.data.cash_total.toLocaleString("en-IN")}</div>
              {recon.data.mismatches.map((m) => (
                <div key={m.txn_id} className="pill amber" style={{ width: "fit-content" }}>
                  ₹{m.amount} — {m.reason} ({m.action})
                </div>
              ))}
              <div className="compiled-spec">
                <strong>GSTR-1 Draft ({recon.data.gstr1_draft.period})</strong>
                <div>Taxable Value: ₹{recon.data.gstr1_draft.taxable_value.toLocaleString("en-IN")}</div>
                <div>Tax: ₹{recon.data.gstr1_draft.tax.toLocaleString("en-IN")}</div>
                <a className="btn secondary" style={{ width: "fit-content" }} href={`${api.base}${recon.data.gstr1_draft.export_url}`} target="_blank" rel="noreferrer">
                  Download JSON
                </a>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-title">Compliance Calendar</div>
        <StaleNotice error={compliance.error} label="compliance calendar" />
        <div className="compliance-timeline">
          {compliance.data?.map((c) => (
            <div className="compliance-item" key={c.id}>
              <div className="compliance-item__title">{c.title}</div>
              <div className="compliance-item__auth">{c.authority}</div>
              <span className={`pill ${c.days_left <= 1 ? "red" : c.days_left <= 7 ? "amber" : "slate"}`}>{c.days_left}d left</span>
              <span className="pill blue">{c.status.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AddEntryForm(props: {
  customers: Array<{ customer_id: string; name: string }>;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [type, setType] = useState<"CREDIT" | "PAYMENT">("CREDIT");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const amountNum = Number(amount);
  const amountValid = amount !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const canSubmit = Boolean(customerId) && amountValid && !saving;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.addKhataEntry({ customer_id: customerId, type, amount: amountNum });
      props.onDone();
    } catch {
      props.onError("Couldn't save the entry — is the Cortex server running?");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--card-border)", flexWrap: "wrap" }}>
      <select
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
        style={{ padding: 6, border: "1px solid var(--card-border)", borderRadius: 6 }}
        aria-label="Customer"
      >
        <option value="">Select customer…</option>
        {props.customers.map((c) => (
          <option key={c.customer_id} value={c.customer_id}>
            {c.name}
          </option>
        ))}
      </select>
      <select value={type} onChange={(e) => setType(e.target.value as "CREDIT" | "PAYMENT")} style={{ padding: 6, border: "1px solid var(--card-border)", borderRadius: 6 }} aria-label="Entry type">
        <option value="CREDIT">Credit (udhaar given)</option>
        <option value="PAYMENT">Payment (received)</option>
      </select>
      <input
        placeholder="Amount (₹)"
        type="number"
        min={1}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{ padding: 6, border: "1px solid var(--card-border)", borderRadius: 6, width: 120 }}
        aria-label="Amount in rupees"
        aria-invalid={amount !== "" && !amountValid}
      />
      <button className="btn" onClick={() => void submit()} disabled={!canSubmit}>
        {saving ? "Saving…" : "Save"}
      </button>
      {amount !== "" && !amountValid && <span className="banner error" style={{ padding: "6px 10px" }}>Enter an amount above ₹0.</span>}
    </div>
  );
}
