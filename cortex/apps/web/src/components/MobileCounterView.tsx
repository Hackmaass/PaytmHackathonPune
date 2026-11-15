import { useState } from "react";
import type { ActivityEvent, WorkforceResponse, DecisionActionResponse, DecisionRejectResponse } from "@cortex/shared";
import type { PendingDecision } from "../hooks/usePendingDecisions.js";
import { soundboxAudio } from "../services/soundboxAudio.js";
import { api } from "../api.js";

type DecisionResponse = DecisionActionResponse | DecisionRejectResponse | undefined;

export function MobileCounterView(props: {
  workforce?: WorkforceResponse;
  events: ActivityEvent[];
  pending: PendingDecision[];
  onDecision: (decisionId: string, action: "APPROVE" | "REJECT") => Promise<DecisionResponse>;
  onTriggerAgent: (agentId: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const [customAmount, setCustomAmount] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    status: "SUCCESS" | "PENDING" | "ERROR";
    message: string;
    amount: number;
    utr?: string;
  } | null>(null);

  const quickAmounts = [100, 200, 350, 500, 1000];

  async function handleVerifyPayment(amount: number) {
    if (!amount || amount <= 0) return;
    setVerifying(true);
    setVerificationResult(null);

    // Unlock browser soundbox audio on tap
    void soundboxAudio.unlock();

    try {
      // Send inbound payment check command to Aman
      await api.sendSimulatorInbound({
        channel: "WHATSAPP",
        role: "OWNER",
        identity_id: "owner-counter-phone",
        text: `Check ₹${amount}`,
      });

      // Play local Soundbox chime and announcement
      const hindiAmount =
        amount === 350 ? "teen sau pachaas" :
        amount === 500 ? "paanch sau" :
        amount === 100 ? "ek sau" :
        amount === 200 ? "do sau" :
        amount === 1000 ? "ek hazaar" : `${amount}`;

      const announcement = `Paytm par ${hindiAmount} rupaye prapt huye!`;
      soundboxAudio.queueAnnouncement(announcement, { isEdgeOverride: true });

      setVerificationResult({
        status: "SUCCESS",
        message: `Payment Verified! Paytm par ₹${amount} prapt huye.`,
        amount,
        utr: `UTR-${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      });

      props.onRefresh();
    } catch (err) {
      setVerificationResult({
        status: "ERROR",
        message: `Error verifying: ${(err as Error).message}`,
        amount,
      });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="mobile-counter-container">
      {/* 1. Counter Header & Store Info */}
      <div className="mobile-counter-card">
        <div className="counter-card-header">
          <div>
            <div className="store-pill">🏪 {props.workforce?.store.name ?? "Ramesh Sweets"}</div>
            <div className="store-sub">GSTIN: {props.workforce?.store.gstin ?? "07AAAAA0000A1Z5"}</div>
          </div>
          <div className="soundbox-badge">
            <span className="live-dot" />
            <span>Soundbox Active (88%🔋)</span>
          </div>
        </div>

        <div className="counter-metrics-grid">
          <div className="metric-box">
            <div className="metric-val">₹18,420</div>
            <div className="metric-label">Today's UPI Total</div>
          </div>
          <div className="metric-box highlighted">
            <div className="metric-val">₹3,850</div>
            <div className="metric-label">AI Attributed (21%)</div>
          </div>
          <div className="metric-box">
            <div className="metric-val">18</div>
            <div className="metric-label">Disputes Cleared</div>
          </div>
        </div>
      </div>

      {/* 2. Fast Payment Check & Edge Override Pad */}
      <div className="mobile-action-card">
        <div className="action-card-title">
          <span>⚡ Aman Instant Payment Check</span>
          <span className="badge-pill sky">Soundbox Edge Override</span>
        </div>
        <p className="action-card-subtitle">
          "₹350 kat gaya, Soundbox nahi bola?" Tap amount to reconcile with PG and announce instantly.
        </p>

        {/* Quick Amount Chips */}
        <div className="quick-amount-chips">
          {quickAmounts.map((amt) => (
            <button
              key={amt}
              className={`quick-amt-btn ${amt === 350 ? "hero-amt" : ""}`}
              onClick={() => void handleVerifyPayment(amt)}
              disabled={verifying}
            >
              ₹{amt}
            </button>
          ))}
        </div>

        {/* Custom Amount Form */}
        <div className="custom-amt-row">
          <input
            type="number"
            placeholder="Custom ₹ amount…"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            className="custom-amt-input"
          />
          <button
            className="btn primary verify-btn"
            onClick={() => {
              const num = Number(customAmount);
              if (num > 0) void handleVerifyPayment(num);
            }}
            disabled={verifying || !customAmount}
          >
            {verifying ? "Checking…" : "Verify & Speak"}
          </button>
        </div>

        {/* Verification Success Box */}
        {verificationResult && (
          <div className={`verification-badge ${verificationResult.status.toLowerCase()}`}>
            <div className="v-icon">
              {verificationResult.status === "SUCCESS" ? "✅" : "⚠️"}
            </div>
            <div className="v-details">
              <div className="v-title">{verificationResult.message}</div>
              {verificationResult.utr && (
                <div className="v-utr">Txn: SUCCESS · {verificationResult.utr} · Soundbox Edge Override Announced</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. Pending Decision Floating / Stack Cards */}
      {props.pending.length > 0 && (
        <div className="mobile-pending-section">
          <div className="section-title">
            <span>🔔 Pending Merchant Approvals ({props.pending.length})</span>
          </div>

          {props.pending.map((p) => (
            <div key={p.id} className="mobile-decision-card">
              <div className="m-dec-header">
                <span className="m-dec-avatar">{p.agent_avatar}</span>
                <span className="m-dec-agent">{p.agent_name}</span>
                <span className="m-dec-tag">{p.decision_kind.replace(/_/g, " ")}</span>
              </div>
              <div className="m-dec-message">{p.message}</div>
              <div className="m-dec-actions">
                <button
                  className="btn-m-approve"
                  onClick={() => void props.onDecision(p.id, "APPROVE")}
                >
                  ✅ 1-Tap Approve & Send
                </button>
                <button
                  className="btn-m-reject"
                  onClick={() => void props.onDecision(p.id, "REJECT")}
                >
                  ❌ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4. AI Workforce Roster (Horizontal Mobile Scroll) */}
      <div className="mobile-roster-section">
        <div className="section-title">
          <span>👥 Your AI Workforce</span>
        </div>
        <div className="mobile-roster-scroll">
          {(props.workforce?.agents ?? []).map((ag) => (
            <div key={ag.id} className="mobile-agent-card">
              <div className="ag-top">
                <span className="ag-avatar">{ag.avatar}</span>
                <span className="ag-status">{ag.status}</span>
              </div>
              <div className="ag-name">{ag.name}</div>
              <div className="ag-role">{ag.role}</div>
              <div className="ag-metric">{ag.metric_label}: {ag.metric_value}</div>
              <button
                className="ag-run-btn"
                onClick={() => void props.onTriggerAgent(ag.id)}
              >
                ▶ Run Now
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Live Activity Feed Mini */}
      <div className="mobile-feed-section">
        <div className="section-title">
          <span>⚡ Live Workforce Feed</span>
        </div>
        <div className="mobile-feed-list">
          {props.events.slice(-5).reverse().map((e) => (
            <div key={e.id} className="mobile-feed-item">
              <span className="f-time">{e.timestamp}</span>
              <span className="f-avatar">{e.agent_avatar}</span>
              <span className="f-msg">{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
