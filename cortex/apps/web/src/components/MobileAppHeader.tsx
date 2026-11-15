import { useEffect, useState } from "react";
import type { Store } from "@cortex/shared";
import { soundboxAudio, type SoundboxAudioState } from "../services/soundboxAudio.js";
import { IconMic, IconSpeaker } from "./icons.js";

/**
 * Compact mobile app bar. One 56px row: brand, store, soundbox state, voice.
 * The desktop StoreHeader keeps its multi-chip layout; on a 390px handset those
 * chips wrapped into three rows and pushed the merchant's work below the fold.
 */
export function MobileAppHeader(props: {
  store?: Store;
  live: boolean;
  onOpenSoundbox: () => void;
  onOpenVoice: () => void;
}) {
  const [audio, setAudio] = useState<SoundboxAudioState>(soundboxAudio.getState());

  useEffect(() => soundboxAudio.subscribe(setAudio), []);

  const battery = props.store?.soundbox.battery;
  const batteryLow = typeof battery === "number" && battery <= 20;
  const soundboxLabel = audio.muted
    ? "Soundbox muted"
    : audio.isPlaying
      ? "Soundbox speaking"
      : "Soundbox active";

  return (
    <header className="m-header">
      <div className="m-header__brand" aria-hidden="true">
        paytm
      </div>

      <div className="m-header__store">
        <div className="m-header__name">{props.store?.name ?? "Loading store…"}</div>
        <div className="m-header__meta">
          <span className={`m-live ${props.live ? "is-live" : "is-polling"}`} aria-hidden="true" />
          <span>{props.live ? "Live" : "Polling"}</span>
          {typeof battery === "number" && (
            <>
              <span className="m-header__dot" aria-hidden="true">
                ·
              </span>
              <span className={batteryLow ? "m-header__battery is-low" : "m-header__battery"}>
                Soundbox {battery}%
              </span>
            </>
          )}
        </div>
      </div>

      <div className="m-header__actions">
        <button
          type="button"
          className={`m-icon-btn ${audio.isPlaying ? "is-speaking" : ""} ${audio.muted ? "is-muted" : ""}`}
          onClick={props.onOpenSoundbox}
          aria-label={`${soundboxLabel}. Open Soundbox controller.`}
        >
          <IconSpeaker muted={audio.muted} />
        </button>
        <button
          type="button"
          className="m-icon-btn is-primary"
          onClick={props.onOpenVoice}
          aria-label="Speak a command in Hindi or English"
        >
          <IconMic />
        </button>
      </div>
    </header>
  );
}
