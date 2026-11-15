import { useState, useEffect } from "react";
import { soundboxAudio, type SoundboxAudioState } from "../services/soundboxAudio.js";

export function SoundboxWidget(props: {
  compact?: boolean;
  onClose?: () => void;
}) {
  const [audioState, setAudioState] = useState<SoundboxAudioState>(soundboxAudio.getState());

  useEffect(() => {
    return soundboxAudio.subscribe(setAudioState);
  }, []);

  const { unlocked, muted, volume, isPlaying, lastAnnouncement, edgeLagActive } = audioState;

  function handleQuickAnnounce(text: string, isEdge = false) {
    if (!unlocked) {
      void soundboxAudio.unlock().then(() => {
        soundboxAudio.queueAnnouncement(text, { isEdgeOverride: isEdge });
      });
      return;
    }
    soundboxAudio.queueAnnouncement(text, { isEdgeOverride: isEdge });
  }

  // Compact Header / Chip view
  if (props.compact) {
    return (
      <div className="soundbox-chip-container">
        <button
          className={`soundbox-status-chip ${isPlaying ? "speaking" : ""} ${edgeLagActive ? "edge-active" : ""}`}
          onClick={() => soundboxAudio.toggleMute()}
          title="Click to toggle Soundbox audio or unmute"
        >
          <span className="soundbox-icon">🔊</span>
          <span className="soundbox-label">
            {muted ? "Muted" : isPlaying ? "Announcing…" : "Soundbox Live"}
          </span>
          <span className={`led-dot blue ${unlocked ? "active" : ""}`} title="Power LED" />
          <span className={`led-dot green ${isPlaying ? "pulsing" : ""}`} title="Speaker Active LED" />
          {edgeLagActive && <span className="led-dot amber active" title="Cellular Lag Edge Override" />}
        </button>
      </div>
    );
  }

  // Full Hardware Visual Controller
  return (
    <div className="soundbox-hardware-card">
      <div className="soundbox-hardware-header">
        <div className="paytm-badge">
          <span className="paytm-logo-text">paytm</span>
          <span className="soundbox-edition">Soundbox 3.0</span>
        </div>
        <div className="soundbox-telemetry">
          <span className="telemetry-item">📶 4G LTE</span>
          <span className="telemetry-item">🔋 88%</span>
          {props.onClose && (
            <button className="soundbox-close-btn" onClick={props.onClose}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Speaker Grille & Visualizer */}
      <div className={`soundbox-speaker-grille ${isPlaying ? "active" : ""}`}>
        <div className="soundbox-eq-bars">
          <span className={`eq-bar bar-1 ${isPlaying ? "animate" : ""}`} />
          <span className={`eq-bar bar-2 ${isPlaying ? "animate" : ""}`} />
          <span className={`eq-bar bar-3 ${isPlaying ? "animate" : ""}`} />
          <span className={`eq-bar bar-4 ${isPlaying ? "animate" : ""}`} />
          <span className={`eq-bar bar-5 ${isPlaying ? "animate" : ""}`} />
        </div>
        <div className="soundbox-center-logo">
          <div className="mic-icon">🔊</div>
        </div>
      </div>

      {/* Physical-Style Tri-Color LEDs */}
      <div className="soundbox-led-cluster">
        <div className="led-indicator">
          <span className={`physical-led blue ${unlocked ? "lit" : ""}`} />
          <label>PWR</label>
        </div>
        <div className="led-indicator">
          <span className={`physical-led green ${isPlaying ? "lit blink" : ""}`} />
          <label>AUDIO</label>
        </div>
        <div className="led-indicator">
          <span className={`physical-led amber ${edgeLagActive ? "lit blink-fast" : ""}`} />
          <label>EDGE</label>
        </div>
      </div>

      {/* Browser Autoplay Unlock Notice */}
      {!unlocked && (
        <div className="soundbox-unlock-banner">
          <span>🔇 Browser audio muted</span>
          <button className="btn btn-sm primary" onClick={() => void soundboxAudio.unlock()}>
            🔊 Tap to Enable Audio
          </button>
        </div>
      )}

      {/* Last Spoken Ticker */}
      <div className="soundbox-ticker">
        <span className="ticker-label">LATEST BROADCAST:</span>
        <span className="ticker-text">
          {lastAnnouncement || "Soundbox standby — waiting for payments or agent briefings."}
        </span>
      </div>

      {/* Volume & Audio Controls */}
      <div className="soundbox-audio-controls">
        <button
          className={`btn btn-sm ${muted ? "secondary" : "primary"}`}
          onClick={() => soundboxAudio.toggleMute()}
        >
          {muted ? "🔇 Unmute Audio" : "🔊 Audio Active"}
        </button>

        <div className="volume-slider-group">
          <span className="vol-icon">🔉</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => soundboxAudio.setVolume(Number(e.target.value))}
          />
          <span className="vol-percent">{Math.round(volume * 100)}%</span>
        </div>
      </div>

      {/* Fast Demo Showcase Triggers */}
      <div className="soundbox-demo-triggers">
        <div className="triggers-heading">⚡ 1-Tap Soundbox Demos (Hardware-Free)</div>
        <div className="trigger-buttons-grid">
          <button
            className="trigger-btn chime-btn"
            onClick={() => void soundboxAudio.playPaytmChime()}
          >
            🔔 Paytm Chime
          </button>
          <button
            className="trigger-btn override-btn"
            onClick={() => handleQuickAnnounce("Paytm par teen sau pachaas rupaye prapt huye!", true)}
          >
            🛡️ ₹350 Edge Override
          </button>
          <button
            className="trigger-btn payment-btn"
            onClick={() => handleQuickAnnounce("Paytm par paanch sau rupaye prapt huye!")}
          >
            💰 ₹500 Payment
          </button>
          <button
            className="trigger-btn priya-btn"
            onClick={() => handleQuickAnnounce("Paytm par 28 regular customers ko recovery offer bhej diya gaya hai!")}
          >
            🎯 Priya 28 Vouchers
          </button>
          <button
            className="trigger-btn munim-btn"
            onClick={() => handleQuickAnnounce("Munim alert: 3 customers ko udhaar reminder bhej diya gaya hai.")}
          >
            📒 Munim Khata Alert
          </button>
          <button
            className="trigger-btn meera-btn"
            onClick={() => handleQuickAnnounce("Namaste! Sabhi staff sadasyon ka haaziri record darj ho gaya hai.")}
          >
            👷 Meera Staff Alert
          </button>
        </div>
      </div>
    </div>
  );
}
