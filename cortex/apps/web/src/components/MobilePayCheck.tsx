import { useEffect, useRef, useState } from "react";
import type { ActivityEvent } from "@cortex/shared";
import { api } from "../api.js";
import { soundboxAudio } from "../services/soundboxAudio.js";
import { IconBackspace, IconBolt, IconCheck } from "./icons.js";

type CheckPhase =
  | { phase: "idle" }
  | { phase: "checking"; amount: number }
  | {
      phase: "done";
      amount: number;
      status: "VERIFIED" | "DISPUTE" | "UNCONFIRMED";
      message: string;
      txn?: string;
      utr?: string;
      soundbox?: string;
    }
  | { phase: "error"; amount: number; message: string };

const QUICK_AMOUNTS = [100, 200, 350, 500, 1000];
const POLL_MS = 400;
const TIMEOUT_MS = 8000;

/** Indian digit grouping for the amount being typed (₹1,20,000). */
function groupDigits(digits: string): string {
  if (!digits) return "";
  const n = Number(digits);
  if (!Number.isFinite(n)) return digits;
  return n.toLocaleString("en-IN");
}

const amountRe = (amount: number) => new RegExp(`₹${amount}(?![\\d,])`);

/**
 * The gate at the counter. Sends "Check ₹X" to Aman over the simulator channel,
 * then reads the real answer off the activity stream — we never claim a payment
 * cleared unless the PG connector said so, and we never invent a UTR.
 */
function usePaymentCheck(onSettled: () => void) {
  const [state, setState] = useState<CheckPhase>({ phase: "idle" });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function check(amount: number): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0 || state.phase === "checking") return;
    void soundboxAudio.unlock(); // user gesture: allow the chime to speak
    setState({ phase: "checking", amount });

    const seen = new Set<string>();
    try {
      const before = await api.getStreamSnapshot();
      for (const e of before) seen.add(e.id);

      await api.sendSimulatorInbound({
        channel: "WHATSAPP",
        role: "OWNER",
        identity_id: "owner-counter-phone",
        text: `Check ₹${amount}`,
      });

      const deadline = Date.now() + TIMEOUT_MS;
      const pattern = amountRe(amount);
      let soundbox: string | undefined;

      while (Date.now() < deadline && alive.current) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const snapshot = await api.getStreamSnapshot();
        const fresh = snapshot.filter((e: ActivityEvent) => !seen.has(e.id));
        for (const e of fresh) seen.add(e.id);

        for (const e of fresh) {
          if (e.type === "SOUNDBOX_ANNOUNCED" && e.severity === "SUCCESS") soundbox = e.message;
        }

        const verified = fresh.find((e) => e.type === "PAYMENT_VERIFIED" && pattern.test(e.message));
        if (verified) {
          setState({
            phase: "done",
            amount,
            status: "VERIFIED",
            message: verified.message,
            txn: verified.message.match(/(TXN-[\w-]+)/)?.[1],
            utr: verified.message.match(/UTR\s+(\d+)/)?.[1],
            soundbox,
          });
          onSettled();
          return;
        }

        const dispute = fresh.find((e) => e.type === "DISPUTE_OPENED" && pattern.test(e.message));
        if (dispute) {
          setState({ phase: "done", amount, status: "DISPUTE", message: dispute.message, soundbox });
          onSettled();
          return;
        }
      }

      if (!alive.current) return;
      setState({
        phase: "done",
        amount,
        status: "UNCONFIRMED",
        message: `No confirmation for ${amount > 0 ? `₹${amount.toLocaleString("en-IN")}` : "this payment"} yet. Nothing was announced on the Soundbox.`,
        soundbox,
      });
      onSettled();
    } catch (err) {
      if (!alive.current) return;
      setState({ phase: "error", amount, message: (err as Error).message });
    }
  }

  return { state, check, reset: () => setState({ phase: "idle" }) };
}

export function MobilePayCheckView(props: { events: ActivityEvent[]; onRefresh: () => void }) {
  const [digits, setDigits] = useState("");
  const { state, check, reset } = usePaymentCheck(props.onRefresh);
  const checking = state.phase === "checking";

  const typed = Number(digits || "0");
  const recent = props.events
    .filter((e) => e.type === "PAYMENT_VERIFIED" || e.type === "DISPUTE_OPENED" || e.type === "SOUNDBOX_ANNOUNCED")
    .slice(-4)
    .reverse();

  function press(key: string) {
    if (checking) return;
    if (key === "del") {
      setDigits((d) => d.slice(0, -1));
      return;
    }
    setDigits((d) => {
      const next = `${d}${key}`.replace(/^0+(?=\d)/, "");
      return next.length > 7 ? d : next;
    });
  }

  return (
    <div className="m-stack">
      <section className="m-card m-pay">
        <div className="m-pay__head">
          <div>
            <p className="m-eyebrow">Aman · Instant payment check</p>
            <h1 className="m-pay__title">Kaunsa payment check karna hai?</h1>
          </div>
          <span className="m-chip m-chip--info">PG + Soundbox</span>
        </div>

        <div className="m-pay__display" aria-live="polite">
          <span className="m-pay__currency">₹</span>
          <span className={`m-pay__amount ${digits ? "" : "is-empty"}`}>
            {digits ? groupDigits(digits) : "0"}
          </span>
        </div>

        <div className="m-pay__quick">
          {QUICK_AMOUNTS.map((amt) => (
            <button
              key={amt}
              type="button"
              className={`m-quick ${typed === amt ? "is-active" : ""}`}
              disabled={checking}
              onClick={() => {
                setDigits(String(amt));
                void check(amt);
              }}
            >
              ₹{amt.toLocaleString("en-IN")}
            </button>
          ))}
        </div>

        <div className="m-pad" role="group" aria-label="Amount keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map((key) => (
            <button
              key={key}
              type="button"
              className="m-pad__key"
              disabled={checking}
              onClick={() => press(key)}
            >
              {key}
            </button>
          ))}
          <button
            type="button"
            className="m-pad__key m-pad__key--ghost"
            onClick={() => press("del")}
            disabled={checking || !digits}
            aria-label="Delete last digit"
          >
            <IconBackspace size={22} />
          </button>
        </div>

        <button
          type="button"
          className="m-btn m-btn--primary m-btn--block"
          disabled={checking || !digits}
          onClick={() => void check(typed)}
        >
          {checking ? (
            "Checking Paytm PG…"
          ) : (
            <>
              <IconBolt size={16} /> Check &amp; speak
            </>
          )}
        </button>
        <p className="m-note">
          Nothing moves money here. Aman reads Paytm PG and the Soundbox queue, then either
          confirms the payment or opens a dispute ticket.
        </p>
      </section>

      {state.phase === "done" && (
        <section
          className={`m-card m-result is-${state.status.toLowerCase()}`}
          role="status"
          aria-live="polite"
        >
          <div className="m-result__head">
            <span className="m-result__icon" aria-hidden="true">
              {state.status === "VERIFIED" ? <IconCheck size={18} /> : "!"}
            </span>
            <div>
              <p className="m-result__title">
                {state.status === "VERIFIED"
                  ? "Payment verified"
                  : state.status === "DISPUTE"
                    ? "Needs a human — ticket opened"
                    : "Not confirmed yet"}
              </p>
              <p className="m-result__amount">
                ₹{state.amount.toLocaleString("en-IN")}
                {state.status === "VERIFIED" && <span className="m-result__tag">SUCCESS</span>}
              </p>
            </div>
          </div>
          <p className="m-result__message">{state.message}</p>
          {(state.txn || state.utr) && (
            <dl className="m-result__grid">
              {state.txn && (
                <div>
                  <dt>Paytm txn</dt>
                  <dd>{state.txn}</dd>
                </div>
              )}
              {state.utr && (
                <div>
                  <dt>UTR</dt>
                  <dd>{state.utr}</dd>
                </div>
              )}
            </dl>
          )}
          {state.soundbox && (
            <p className="m-result__soundbox">
              <span aria-hidden="true">🔊</span> Soundbox ne bola: &ldquo;{state.soundbox}&rdquo;
            </p>
          )}
          <button type="button" className="m-btn m-btn--ghost m-btn--block" onClick={reset}>
            Check another payment
          </button>
        </section>
      )}

      {state.phase === "error" && (
        <section className="m-card m-result is-dispute" role="alert">
          <p className="m-result__title">Couldn&apos;t reach the counter service</p>
          <p className="m-result__message">{state.message}</p>
          <button type="button" className="m-btn m-btn--ghost m-btn--block" onClick={reset}>
            Try again
          </button>
        </section>
      )}

      <section className="m-section" aria-labelledby="m-pay-recent">
        <div className="m-section__head">
          <h2 className="m-section__title" id="m-pay-recent">
            Recent payment events
          </h2>
        </div>
        <div className="m-card m-feed">
          {recent.length === 0 && <p className="m-empty__body">No payment events yet today.</p>}
          {recent.map((e) => (
            <div key={e.id} className="m-feed__item">
              <span className={`m-feed__dot is-${e.severity.toLowerCase()}`} aria-hidden="true" />
              <div className="m-feed__body">
                <p className="m-feed__msg">{e.message}</p>
                <p className="m-feed__meta">
                  {e.agent_name} · {e.timestamp}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
