import type { ActivityEvent, MetricsResponse, WorkforceResponse } from "@cortex/shared";
import type { PendingDecision } from "../hooks/usePendingDecisions.js";
import { useDecisionAction } from "../hooks/useDecisionAction.js";
import type { DecisionActionResponse, DecisionRejectResponse } from "@cortex/shared";
import { IconArrowRight, IconCheck, IconMic, IconPlay } from "./icons.js";

type DecisionResponse = DecisionActionResponse | DecisionRejectResponse | undefined;

const KIND_LABEL: Record<PendingDecision["decision_kind"], string> = {
  VOUCHER_CAMPAIGN: "Voucher campaign",
  PURCHASE_ORDER: "Purchase order",
  PAYROLL_PAYOUT: "Payroll payout",
  KHATA_REMINDER_BATCH: "Udhaar reminders",
  CUSTOM_AGENT_ACTION: "Custom agent",
};

const rupees = (value: number) => `₹${value.toLocaleString("en-IN")}`;

/**
 * Mobile counter — the merchant's home screen.
 * Order is deliberate: money that needs a decision first, then today's numbers,
 * then the workforce and the live feed. Nothing here is a placeholder: every
 * figure comes from /api/cortex/metrics, and every approval is a signed decision
 * contract (AGENTS.md §5.3).
 */
export function MobileCounterView(props: {
  workforce?: WorkforceResponse;
  metrics?: MetricsResponse;
  metricsStale?: boolean;
  events: ActivityEvent[];
  pending: PendingDecision[];
  onDecision: (decisionId: string, action: "APPROVE" | "REJECT") => Promise<DecisionResponse>;
  onTriggerAgent: (agentId: string) => Promise<void>;
  onOpenPayCheck: () => void;
  onOpenVoice: () => void;
  onRefresh: () => void;
}) {
  const { decide, busyId, notice } = useDecisionAction({
    onDecision: props.onDecision,
    onSettled: props.onRefresh,
  });

  const metrics = props.metrics;
  const attributedPct = metrics?.ai_attributed_percentage ?? 0;
  const agents = props.workforce?.agents ?? [];
  const feed = props.events.slice(-6).reverse();

  return (
    <div className="m-stack">
      {/* 1. Today's money ------------------------------------------------ */}
      <section className="m-card m-hero" aria-labelledby="m-hero-title">
        <p className="m-eyebrow" id="m-hero-title">
          Today · UPI collection
        </p>
        {metrics ? (
          <p className="m-hero__value">{rupees(metrics.today_upi_total)}</p>
        ) : (
          <div className="m-skel m-skel--value" aria-label="Loading today's collection" />
        )}
        <dl className="m-hero__split">
          <div>
            <dt>AI-attributed</dt>
            <dd>
              {metrics ? rupees(metrics.ai_attributed_revenue) : "—"}
              <span className="m-hero__pct">
                {`${attributedPct.toFixed(1).replace(/\.0$/, "")}%`}
              </span>
            </dd>
          </div>
          <div>
            <dt>Disputes cleared</dt>
            <dd>
              {metrics ? metrics.disputes_resolved_count : "—"}
              {metrics && metrics.disputes_resolved_amount > 0 && (
                <span className="m-hero__pct">{rupees(metrics.disputes_resolved_amount)}</span>
              )}
            </dd>
          </div>
        </dl>
        {props.metricsStale && <p className="m-note">Offline — showing the last known figures.</p>}
      </section>

      {/* 2. Approvals ---------------------------------------------------- */}
      <section className="m-section" aria-labelledby="m-approvals-title">
        <div className="m-section__head">
          <h2 className="m-section__title" id="m-approvals-title">
            Needs your approval
          </h2>
          {props.pending.length > 0 && <span className="m-count">{props.pending.length}</span>}
        </div>

        {notice && (
          <p className={`m-receipt ${notice.tone === "success" ? "is-ok" : "is-bad"}`} role="status">
            {notice.text}
          </p>
        )}

        {props.pending.length === 0 ? (
          <div className="m-card m-empty">
            <span className="m-empty__icon" aria-hidden="true">
              <IconCheck size={18} />
            </span>
            <div>
              <p className="m-empty__title">All clear — nothing is waiting on you.</p>
              <p className="m-empty__body">
                When a voucher, purchase order or payout needs your one tap, it appears here.
              </p>
            </div>
          </div>
        ) : (
          <ul className="m-decisions">
            {props.pending.map((p) => {
              const busy = busyId === p.decision_id;
              const approveLabel = p.buttons.find((b) => b.action === "APPROVE")?.label ?? "Approve";
              const rejectLabel = p.buttons.find((b) => b.action === "REJECT")?.label ?? "Reject";
              return (
                <li key={p.decision_id} className="m-card m-decision">
                  <div className="m-decision__head">
                    <span className="m-decision__avatar" aria-hidden="true">
                      {p.agent_avatar}
                    </span>
                    <span className="m-decision__agent">{p.agent_name}</span>
                    <span className="m-chip">{KIND_LABEL[p.decision_kind]}</span>
                  </div>
                  <p className="m-decision__message">{p.message}</p>
                  <p className="m-decision__meta">Staged {p.staged_at} · signed decision contract</p>
                  <div className="m-decision__actions">
                    <button
                      type="button"
                      className="m-btn m-btn--approve"
                      disabled={busyId !== undefined}
                      onClick={() => void decide(p.decision_id, "APPROVE")}
                    >
                      {busy ? "Approving…" : approveLabel}
                    </button>
                    <button
                      type="button"
                      className="m-btn m-btn--reject"
                      disabled={busyId !== undefined}
                      onClick={() => void decide(p.decision_id, "REJECT")}
                    >
                      {rejectLabel}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 3. Instant payment check ---------------------------------------- */}
      <section className="m-section">
        <div className="m-section__head">
          <h2 className="m-section__title">Payment check</h2>
        </div>
        <button type="button" className="m-card m-row-btn" onClick={props.onOpenPayCheck}>
          <span className="m-row-btn__body">
            <span className="m-row-btn__title">Aman checks a payment for you</span>
            <span className="m-row-btn__sub">
              &ldquo;₹350 kat gaya, Soundbox nahi bola?&rdquo; — reconcile with Paytm PG in seconds.
            </span>
          </span>
          <IconArrowRight />
        </button>
        <button type="button" className="m-card m-row-btn m-row-btn--voice" onClick={props.onOpenVoice}>
          <span className="m-row-btn__body">
            <span className="m-row-btn__title">
              <IconMic size={16} /> Bol ke batao
            </span>
            <span className="m-row-btn__sub">Hindi ya English — the team listens and answers.</span>
          </span>
          <IconArrowRight />
        </button>
      </section>

      {/* 4. Workforce ---------------------------------------------------- */}
      <section className="m-section" aria-labelledby="m-roster-title">
        <div className="m-section__head">
          <h2 className="m-section__title" id="m-roster-title">
            Your workforce
          </h2>
          <span className="m-section__hint">{agents.length} hired</span>
        </div>
        {agents.length === 0 ? (
          <div className="m-card m-empty">
            <p className="m-empty__body">Connecting to your workforce…</p>
          </div>
        ) : (
          <ul className="m-roster">
            {agents.map((agent) => (
              <li key={agent.id} className="m-agent">
                <div className="m-agent__top">
                  <span className="m-agent__avatar" aria-hidden="true">
                    {agent.avatar}
                  </span>
                  <span className={`m-agent__status is-${agent.status.toLowerCase()}`}>{agent.status}</span>
                </div>
                <p className="m-agent__name">{agent.name}</p>
                <p className="m-agent__role">{agent.role}</p>
                <p className="m-agent__metric">
                  <span>{agent.metric_label}</span>
                  {agent.metric_value}
                </p>
                <button
                  type="button"
                  className="m-agent__run"
                  onClick={() => void props.onTriggerAgent(agent.id)}
                  aria-label={`Run ${agent.name} now`}
                >
                  <IconPlay size={14} /> Run
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 5. Live feed ---------------------------------------------------- */}
      <section className="m-section" aria-labelledby="m-feed-title">
        <div className="m-section__head">
          <h2 className="m-section__title" id="m-feed-title">
            Live feed
          </h2>
          <span className="m-section__hint">newest first</span>
        </div>
        <div className="m-card m-feed" aria-live="polite">
          {feed.length === 0 && <p className="m-empty__body">Your team has not filed an event yet.</p>}
          {feed.map((e) => (
            <div key={e.id} className="m-feed__item">
              <span className={`m-feed__dot is-${e.severity.toLowerCase()}`} aria-hidden="true" />
              <div className="m-feed__body">
                <p className="m-feed__msg">{e.message}</p>
                <p className="m-feed__meta">
                  <span aria-hidden="true">{e.agent_avatar}</span> {e.agent_name} · {e.timestamp}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
