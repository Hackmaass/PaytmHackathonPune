import { useState, useRef, useEffect } from "react";
import { soundboxAudio } from "../services/soundboxAudio.js";
import { api } from "../api.js";

// Web Speech API interface declarations for TypeScript
interface IWindow extends Window {
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
}

export function MobileVoiceMic(props: {
  onActivityRefreshed?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [lastResponse, setLastResponse] = useState<{
    agent: string;
    avatar: string;
    text: string;
  } | null>(null);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const win = window as unknown as IWindow;
    const SpeechClass = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (SpeechClass) {
      const recognition = new SpeechClass();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "hi-IN"; // Hindi / Hinglish primary

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let current = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          current += event.results[i][0].transcript;
        }
        setTranscript(current);
      };

      recognition.onerror = (err: any) => {
        console.warn("[voiceMic] speech recognition error:", err);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  function startListening() {
    // Unlock audio context first
    void soundboxAudio.unlock();
    setTranscript("");
    setLastResponse(null);
    setIsOpen(true);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {
        // Already started or busy
      }
    }
  }

  function stopListening() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsListening(false);
    if (transcript.trim()) {
      void executeQuery(transcript.trim());
    }
  }

  async function executeQuery(text: string) {
    if (!text.trim()) return;
    setIsThinking(true);
    setLastResponse(null);

    try {
      // 1. Dispatch text to Cortex Central Orchestrator
      const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3200";
      const res = await fetch(`${BASE}/api/cortex/voice-query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          reply_text?: string;
          routed_to?: string;
        };

        const reply = data.reply_text || `Aapka request process ho gaya: "${text}"`;
        const agentName = data.routed_to || "Cortex Assistant";
        const avatar =
          agentName.includes("aman") ? "🛡️" :
          agentName.includes("munim") ? "📒" :
          agentName.includes("priya") ? "🎯" :
          agentName.includes("vikram") ? "📦" :
          agentName.includes("meera") ? "👷" : "🤖";

        setLastResponse({
          agent: agentName,
          avatar,
          text: reply,
        });

        // 2. Play soundbox chime and speak reply aloud
        await soundboxAudio.playPaytmChime();
        await soundboxAudio.speakText(reply);
      } else {
        // Fallback via simulator endpoint
        await api.sendSimulatorInbound({
          channel: "WHATSAPP",
          role: "OWNER",
          identity_id: "owner-mic",
          text,
        });
        setLastResponse({
          agent: "Aman / Cortex Assistant",
          avatar: "🛡️",
          text: `Command sent: "${text}". Checked counter records.`,
        });
      }
      props.onActivityRefreshed?.();
    } catch (err) {
      setLastResponse({
        agent: "Cortex Assistant",
        avatar: "⚠️",
        text: `Error processing query: ${(err as Error).message}`,
      });
    } finally {
      setIsThinking(false);
    }
  }

  return (
    <>
      {/* Floating Action Button (Always reachable by thumb) */}
      <button
        className={`floating-voice-fab ${isListening ? "listening" : ""}`}
        onClick={() => {
          if (isListening) stopListening();
          else startListening();
        }}
        title="Tap to speak in Hindi or English (Cortex Voice Assistant)"
      >
        <span className="fab-mic-icon">🎙️</span>
        <span className="fab-pulse-ring" />
      </button>

      {/* Voice Assistant Modal / Bottom Sheet */}
      {isOpen && (
        <div className="voice-modal-backdrop" onClick={() => setIsOpen(false)}>
          <div className="voice-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="voice-sheet-header">
              <div className="voice-sheet-title">
                <span className="voice-indicator-dot" />
                <span>Cortex Hindi Voice Remote</span>
              </div>
              <button className="voice-sheet-close" onClick={() => setIsOpen(false)}>
                ✕
              </button>
            </div>

            {/* Listening Visualizer */}
            <div className="voice-visualizer-area">
              <div className={`voice-ripple-circle ${isListening ? "active" : ""}`}>
                <span className="mic-large-icon">{isListening ? "🔴" : "🎙️"}</span>
              </div>
              <div className="voice-status-text">
                {isThinking ? "Thinking… (विचार कर रहे हैं)" :
                 isListening ? "Listening… बोलिए (Speak now)" :
                 "Tap mic to speak or choose a quick prompt"}
              </div>
            </div>

            {/* Realtime Live Transcript */}
            <div className="voice-transcript-box">
              <input
                className="voice-transcript-input"
                placeholder="बोलिए ya type karein (e.g. Check ₹350, Udhaar report)..."
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void executeQuery(transcript)}
              />
              <button
                className="btn btn-sm primary"
                onClick={() => void executeQuery(transcript)}
                disabled={!transcript.trim() || isThinking}
              >
                Send
              </button>
            </div>

            {/* Response Card */}
            {lastResponse && (
              <div className="voice-response-card">
                <div className="response-agent-header">
                  <span className="agent-avatar">{lastResponse.avatar}</span>
                  <span className="agent-name">{lastResponse.agent}</span>
                </div>
                <div className="response-body">{lastResponse.text}</div>
                <button
                  className="btn-replay-voice"
                  onClick={() => void soundboxAudio.speakText(lastResponse.text)}
                >
                  🔊 Replay on Soundbox
                </button>
              </div>
            )}

            {/* Quick 1-Tap Bharat Prompts */}
            <div className="voice-quick-chips">
              <div className="chips-label">Quick Voice Queries:</div>
              <div className="chips-list">
                <button
                  className="voice-chip"
                  onClick={() => {
                    setTranscript("Check ₹350 payment");
                    void executeQuery("Check ₹350 payment");
                  }}
                >
                  🛡️ "Check ₹350"
                </button>
                <button
                  className="voice-chip"
                  onClick={() => {
                    setTranscript("Munim, kitna udhaar baaki hai?");
                    void executeQuery("Munim, kitna udhaar baaki hai?");
                  }}
                >
                  📒 "Munim, kitna udhaar baaki hai?"
                </button>
                <button
                  className="voice-chip"
                  onClick={() => {
                    setTranscript("Staff attendance summary dikhao");
                    void executeQuery("Staff attendance summary dikhao");
                  }}
                >
                  👷 "Staff attendance summary"
                </button>
                <button
                  className="voice-chip"
                  onClick={() => {
                    setTranscript("Priya sales report aur winback offer");
                    void executeQuery("Priya sales report aur winback offer");
                  }}
                >
                  🎯 "Priya sales report"
                </button>
                <button
                  className="voice-chip"
                  onClick={() => {
                    setTranscript("Vikram paneer stock order");
                    void executeQuery("Vikram paneer stock order");
                  }}
                >
                  📦 "Vikram paneer stock order"
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
