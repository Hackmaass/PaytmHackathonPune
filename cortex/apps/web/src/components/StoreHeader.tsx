import { useState, useEffect } from "react";
import type { Store } from "@cortex/shared";
import { soundboxAudio, type SoundboxAudioState } from "../services/soundboxAudio.js";

export function StoreHeader(props: {
  store?: Store;
  live: boolean;
  stale?: boolean;
  onOpenSoundbox?: () => void;
}) {
  const { store } = props;
  const [audioState, setAudioState] = useState<SoundboxAudioState>(soundboxAudio.getState());

  useEffect(() => {
    return soundboxAudio.subscribe(setAudioState);
  }, []);

  return (
    <header className="store-header">
      <div className="store-header__left">
        <div className="store-header__badge">paytm</div>
        <div className="store-header__name">{store?.name ?? "Loading store…"}</div>
        {store && <div className="store-header__gstin">GSTIN: {store.gstin}</div>}
      </div>
      <div className="store-header__right">
        {store && (
          <>
            {/* Interactive Soundbox Audio Status Chip */}
            <button
              className={`status-chip soundbox-chip-clickable ${audioState.isPlaying ? "speaking" : ""} ${audioState.muted ? "muted" : ""}`}
              onClick={() => {
                if (!audioState.unlocked) {
                  void soundboxAudio.unlock();
                } else if (props.onOpenSoundbox) {
                  props.onOpenSoundbox();
                } else {
                  soundboxAudio.toggleMute();
                }
              }}
              title="Click to open Soundbox controller or unmute"
            >
              <span className="audio-icon">{audioState.muted ? "🔇" : "🔊"}</span>
              <span>
                Soundbox: {audioState.muted ? "Muted" : audioState.isPlaying ? "Speaking…" : "Active"} ({store.soundbox.battery}%🔋)
              </span>
              <span className={`status-dot ${audioState.isPlaying ? "pulsing-green" : "active"}`} />
            </button>

            <ChannelChip label="WhatsApp" status={store.channels.whatsapp} icon="🟢" />
            <ChannelChip label="Telegram" status={store.channels.telegram} icon="✈️" />
          </>
        )}
        <span className="status-chip" title="Live activity stream connection">
          <span className={`status-dot${props.live ? "" : " simulator"}`} />
          {props.live ? "Live" : "Polling"}
        </span>
        {props.stale && (
          <span className="pill red" title="The last refresh failed — data may be out of date">
            Data paused
          </span>
        )}
      </div>
    </header>
  );
}

function ChannelChip(props: { label: string; status: string; icon: string }) {
  const isSim = props.status === "SIMULATOR";
  return (
    <span className="status-chip">
      {props.icon} {props.label}: {isSim ? <span className="pill amber">SIMULATOR</span> : "Connected"}
    </span>
  );
}
