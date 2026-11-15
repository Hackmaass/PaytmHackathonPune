/**
 * Soundbox Audio Engine — High-Fidelity Web Audio & Indic Voice Synthesizer
 *
 * Designed specifically for live demos when physical Paytm Soundbox hardware is absent:
 * 1. Synthesizes the authentic 4-tone ascending musical Paytm Soundbox chime using Web Audio API.
 * 2. Fetches authentic Hindi/Hinglish voice audio via Sarvam Bulbul TTS (/api/channels/voice/synthesize).
 * 3. Gracefully degrades to browser window.speechSynthesis (hi-IN) when offline or no Sarvam key.
 * 4. Listens to SSE live activity stream events and automatically announces SOUNDBOX_ANNOUNCED events.
 * 5. Provides manual test triggers, volume control, and browser autoplay unlock management.
 */

export interface SoundboxAudioState {
  unlocked: boolean;
  muted: boolean;
  volume: number;
  isPlaying: boolean;
  activeLanguage: string;
  lastAnnouncement: string | null;
  lastAnnouncedAt: Date | null;
  edgeLagActive: boolean;
}

type StateListener = (state: SoundboxAudioState) => void;

class SoundboxAudioService {
  private audioCtx: AudioContext | null = null;
  private state: SoundboxAudioState = {
    unlocked: false,
    muted: false,
    volume: 0.9,
    isPlaying: false,
    activeLanguage: "hi-IN",
    lastAnnouncement: null,
    lastAnnouncedAt: null,
    edgeLagActive: false,
  };
  private listeners: Set<StateListener> = new Set();
  private queue: Array<{ text: string; language?: string; isEdgeOverride?: boolean }> = [];
  private isProcessingQueue = false;
  private seenEventIds = new Set<string>();

  constructor() {
    // Load persisted mute preference
    if (typeof window !== "undefined") {
      try {
        const savedMute = localStorage.getItem("cortex_soundbox_muted");
        if (savedMute !== null) this.state.muted = savedMute === "true";
      } catch {}
    }
  }

  public getState(): SoundboxAudioState {
    return { ...this.state };
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const current = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(current);
      } catch (err) {
        console.error("[soundboxAudio] listener error:", err);
      }
    }
  }

  /**
   * Unlock AudioContext on first user interaction (click/touch).
   * Browsers block autoplay until user has interacted with the document.
   */
  public async unlock(): Promise<boolean> {
    try {
      if (!this.audioCtx) {
        const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.audioCtx = new AudioCtxClass();
      }
      if (this.audioCtx.state === "suspended") {
        await this.audioCtx.resume();
      }
      this.state.unlocked = true;
      this.state.muted = false;
      try {
        localStorage.setItem("cortex_soundbox_muted", "false");
      } catch {}
      this.notify();
      return true;
    } catch (err) {
      console.warn("[soundboxAudio] unlock failed:", err);
      return false;
    }
  }

  public setMuted(muted: boolean): void {
    this.state.muted = muted;
    try {
      localStorage.setItem("cortex_soundbox_muted", String(muted));
    } catch {}
    this.notify();
  }

  public toggleMute(): void {
    if (!this.state.unlocked) {
      void this.unlock();
      return;
    }
    this.setMuted(!this.state.muted);
  }

  public setVolume(volume: number): void {
    this.state.volume = Math.max(0, Math.min(1, volume));
    this.notify();
  }

  public setLanguage(lang: string): void {
    this.state.activeLanguage = lang;
    this.notify();
  }

  /**
   * Synthesize the authentic Paytm 4-tone ascending musical chime.
   * Pitch sequence: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz) -> C6 (1046Hz).
   */
  public async playPaytmChime(): Promise<void> {
    if (this.state.muted) return;

    try {
      if (!this.audioCtx) {
        const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.audioCtx = new AudioCtxClass();
      }
      if (this.audioCtx.state === "suspended") {
        await this.audioCtx.resume();
      }

      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const notes = [
        { freq: 523.25, start: 0.0, duration: 0.08 }, // C5
        { freq: 659.25, start: 0.09, duration: 0.08 }, // E5
        { freq: 783.99, start: 0.18, duration: 0.09 }, // G5
        { freq: 1046.5, start: 0.28, duration: 0.35 }, // C6
      ];

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(this.state.volume * 0.45, now);
      masterGain.connect(ctx.destination);

      for (const note of notes) {
        const osc = ctx.createOscillator();
        const noteGain = ctx.createGain();

        // Warm sine + subtle triangle blend for speaker bell chime
        osc.type = "sine";
        osc.frequency.setValueAtTime(note.freq, now + note.start);

        // Quick attack, gentle bell decay
        const startTime = now + note.start;
        const endTime = startTime + note.duration;
        noteGain.gain.setValueAtTime(0.001, startTime);
        noteGain.gain.exponentialRampToValueAtTime(1.0, startTime + 0.015);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

        osc.connect(noteGain);
        noteGain.connect(masterGain);

        osc.start(startTime);
        osc.stop(endTime);
      }

      // Allow chime to ring out before speech
      await new Promise((resolve) => setTimeout(resolve, 520));
    } catch (err) {
      console.warn("[soundboxAudio] Chime synthesis error:", err);
    }
  }

  /**
   * Speak announcement text using Sarvam Bulbul TTS (or fallback to window.speechSynthesis).
   */
  public async speakText(text: string, languageCode?: string): Promise<void> {
    if (this.state.muted) return;
    const lang = languageCode || this.state.activeLanguage;

    // 1. First attempt: High-fidelity Sarvam Bulbul audio from Cortex server
    try {
      const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3200";
      const res = await fetch(`${BASE}/api/channels/voice/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          language_code: lang,
          speaker: "meera",
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { data_url?: string; audio_base64?: string };
        const audioSrc = data.data_url || (data.audio_base64 ? `data:audio/wav;base64,${data.audio_base64}` : null);
        if (audioSrc) {
          await this.playAudioElement(audioSrc);
          return;
        }
      }
    } catch {
      // Fallback to local browser speech synthesis
    }

    // 2. Second attempt: Local browser SpeechSynthesis API
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      await this.speakViaWebSpeech(text, lang);
    }
  }

  private playAudioElement(src: string): Promise<void> {
    return new Promise((resolve) => {
      const audio = new Audio(src);
      audio.volume = this.state.volume;
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
  }

  private speakViaWebSpeech(text: string, lang: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang || "hi-IN";
        utterance.volume = this.state.volume;
        utterance.rate = 0.95;
        utterance.pitch = 1.05;

        // Try to match an Indic/Hindi voice if installed in browser
        const voices = window.speechSynthesis.getVoices();
        const hindiVoice = voices.find((v) => v.lang.startsWith("hi") || v.lang.includes("IN") || /hindi/i.test(v.name));
        if (hindiVoice) {
          utterance.voice = hindiVoice;
        }

        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } catch {
        resolve();
      }
    });
  }

  /**
   * Queue a Soundbox announcement (Chime + Speech).
   */
  public queueAnnouncement(text: string, options?: { language?: string; isEdgeOverride?: boolean }): void {
    this.queue.push({
      text,
      language: options?.language,
      isEdgeOverride: options?.isEdgeOverride,
    });
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.queue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) continue;

      this.state.isPlaying = true;
      this.state.lastAnnouncement = item.text;
      this.state.lastAnnouncedAt = new Date();
      this.state.edgeLagActive = Boolean(item.isEdgeOverride);
      this.notify();

      try {
        // 1. Play signature chime
        await this.playPaytmChime();
        // 2. Announce speech text
        await this.speakText(item.text, item.language);
      } catch (err) {
        console.error("[soundboxAudio] announcement failed:", err);
      } finally {
        // Brief pause between announcements
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }

    this.state.isPlaying = false;
    this.state.edgeLagActive = false;
    this.isProcessingQueue = false;
    this.notify();
  }

  /**
   * Inspect an incoming activity event and announce if it has soundbox content.
   */
  public handleActivityEvent(event: {
    id: string;
    type: string;
    message: string;
    agent_id?: string;
  }): void {
    if (this.seenEventIds.has(event.id)) return;
    this.seenEventIds.add(event.id);

    // Filter for Soundbox announcements or edge overrides
    if (event.type === "SOUNDBOX_ANNOUNCED") {
      const isOverride = /cellular delay|priority edge override/i.test(event.message);
      if (isOverride) {
        this.state.edgeLagActive = true;
        this.notify();
        return;
      }
      this.queueAnnouncement(event.message, { isEdgeOverride: this.state.edgeLagActive });
    }
  }
}

export const soundboxAudio = new SoundboxAudioService();
