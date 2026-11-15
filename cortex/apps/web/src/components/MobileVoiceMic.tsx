import { useEffect, useRef, useState } from "react";
import { soundboxAudio } from "../services/soundboxAudio.js";
import { api } from "../api.js";
import { IconClose, IconMic } from "./icons.js";

interface SpeechShim extends Window {
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  SpeechRecognition?: new () => SpeechRecognitionLike;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

const AGENT_AVATAR: Record<string, string> = {
  "aman-support": "🛡️",
  "munim-accounts": "📒",
  "priya-sales": "🎯",
  "vikram-procurement": "📦",
  "meera-staff": "👷",
};

const QUICK_PROMPTS = [
  { label: "Check ₹350", text: "Check ₹350 payment" },
  { label: "Munim, kitna udhaar baaki hai?", text: "Munim, kitna udhaar baaki hai?" },
  { label: "Staff attendance", text: "Staff attendance summary dikhao" },
  { label: "Priya sales report", text: "Priya sales report aur winback offer" },
  { label: "Vikram paneer stock", text: "Vikram paneer stock order" },
];

/**
 * Hindi/Hinglish voice remote as a proper bottom sheet: dialog semantics,
 * Escape to dismiss, focus moved to the field on open, recognition stopped on
 * close (the old floating sheet kept the microphone live after dismissal).
 */
export function MobileVoiceSheet(props: {
  open: boolean;
  onClose: () => void;
  onActivityRefreshed?: () => void;
}) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [thinking, setThinking] = useState(false);
  const [reply, setReply] = useState<{ agent: string; avatar: string; text: string } | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);

  // One recognition instance for the life of the sheet.
  useEffect(() => {
    const win = window as unknown as SpeechShim;
    const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "hi-IN";
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const alt = event.results[i]?.[0];
        if (alt) text += alt.transcript;
      }
      setTranscript(text);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    return () => {
      recognition.abort?.();
      recognitionRef.current = null;
    };
  }, []);

  // Open: remember the trigger, focus the field, lock background scroll.
  useEffect(() => {
    if (!props.open) return;
    openerRef.current = document.activeElement;
    setReply(null);
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, [props.open]);

  // Close: stop the microphone immediately. A live mic behind a closed sheet is
  // a privacy incident, not a visual bug.
  useEffect(() => {
    if (props.open) return;
    setListening(false);
    try {
      recognitionRef.current?.stop();
    } catch {
      /* not started */
    }
  }, [props.open]);

  // Escape dismisses; Tab stays inside the sheet.
  useEffect(() => {
    if (!props.open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  function toggleMic() {
    void soundboxAudio.unlock();
    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* already stopped */
      }
      setListening(false);
      return;
    }
    setTranscript("");
    setReply(null);
    try {
      recognitionRef.current?.start();
    } catch {
      /* busy — the sheet still accepts typed input */
    }
  }

  async function ask(text: string): Promise<void> {
    const query = text.trim();
    if (!query || thinking) return;
    setThinking(true);
    setReply(null);
    try {
      const res = await api.sendVoiceQuery(query);
      const agent = res.routed_to ?? "assistant";
      const message =
        res.reply_text || `Request "${query}" bhej diya — the team is on it. Check the live feed above.`;
      setReply({ agent, avatar: AGENT_AVATAR[agent] ?? "🤖", text: message });
      props.onActivityRefreshed?.();
    } catch (err) {
      setReply({
        agent: "offline",
        avatar: "⚠️",
        text: `The counter service is unreachable: ${(err as Error).message}`,
      });
    } finally {
      setThinking(false);
    }
  }

  return (
    <div className="m-sheet-backdrop" onClick={props.onClose}>
      <div
        ref={sheetRef}
        className="m-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="m-voice-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="m-sheet__grabber" aria-hidden="true" />
        <div className="m-sheet__head">
          <div>
            <h2 className="m-sheet__title" id="m-voice-title">
              Bol ke batao
            </h2>
            <p className="m-sheet__sub" lang="hi">
              हिंदी या English — अपने team से बोलिए
            </p>
          </div>
          <button type="button" className="m-icon-btn m-icon-btn--light" onClick={props.onClose} aria-label="Close voice assistant">
            <IconClose />
          </button>
        </div>

        <div className="m-sheet__mic">
          <button
            type="button"
            className={`m-mic ${listening ? "is-listening" : ""}`}
            onClick={toggleMic}
            aria-pressed={listening}
            aria-label={listening ? "Stop listening" : "Start listening"}
          >
            <IconMic size={26} />
          </button>
          <p className="m-mic__state" aria-live="polite">
            {thinking
              ? "Soch rahe hain…"
              : listening
                ? "Sun rahe hain — boliye"
                : "Tap the mic, or type below"}
          </p>
        </div>

        <form
          className="m-sheet__input"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(transcript);
          }}
        >
          <label className="sr-only" htmlFor="m-voice-input">
            Ask your AI team
          </label>
          <input
            id="m-voice-input"
            ref={inputRef}
            className="m-input"
            placeholder="Check ₹350 · kitna udhaar baaki hai?"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="m-btn m-btn--primary" disabled={thinking || !transcript.trim()}>
            {thinking ? "…" : "Ask"}
          </button>
        </form>

        {reply && (
          <div className="m-reply" role="status">
            <div className="m-reply__head">
              <span aria-hidden="true">{reply.avatar}</span>
              <span>{reply.agent}</span>
            </div>
            <p className="m-reply__body">{reply.text}</p>
            <button
              type="button"
              className="m-btn m-btn--ghost m-btn--sm"
              onClick={() => void soundboxAudio.speakText(reply.text)}
            >
              🔊 Play on Soundbox
            </button>
          </div>
        )}

        <div className="m-sheet__prompts">
          <p className="m-eyebrow">Quick asks</p>
          <div className="m-chips">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="m-quick m-quick--chip"
                onClick={() => {
                  setTranscript(p.text);
                  void ask(p.text);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
