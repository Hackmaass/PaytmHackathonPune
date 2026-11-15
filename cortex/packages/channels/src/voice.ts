import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Buffer } from "node:buffer";
import { SarvamClient, type SarvamSpeaker, type SarvamLanguage } from "./sarvam.js";

export interface VoiceProvider {
  /** Speaks `text` aloud (Hindi/Hinglish transliteration) through the
   * counter laptop / Bluetooth speaker acting as the Soundbox. */
  speak(text: string): Promise<void>;
}

/**
 * Pluggable Indic TTS/STT provider (AGENTS.md §3.3).
 * Powered by Sarvam AI for authentic Indian language synthesis and transcription.
 */
export interface IndicVoiceProvider extends VoiceProvider {
  transcribe(audio: Buffer, mimeType?: string): Promise<string>;
  synthesize(
    text: string,
    options?: { languageCode?: SarvamLanguage | string; speaker?: SarvamSpeaker | string },
  ): Promise<Buffer>;
}

/**
 * Sarvam AI Voice Provider — Authentic Indic Audio Engine.
 * 1. Speaks Soundbox announcements aloud in natural Hindi/Hinglish via Sarvam Bulbul TTS.
 * 2. Transcribes inbound WhatsApp audio notes into Hindi/Hinglish via Sarvam Saaras STT.
 * 3. Synthesizes voice payslips and audio cards for WhatsApp dispatch.
 * 4. Automatically degrades to local OS TTS if offline or when credentials fail.
 */
export class SarvamVoiceProvider implements IndicVoiceProvider {
  private readonly sarvam: SarvamClient;
  private readonly fallbackTts: OsTtsVoiceProvider;

  constructor(apiKey?: string) {
    this.sarvam = new SarvamClient(apiKey);
    this.fallbackTts = new OsTtsVoiceProvider();
  }

  /**
   * Speaks `text` aloud through the host audio output (simulating the Paytm Soundbox).
   * First attempts high-fidelity Sarvam Bulbul TTS; falls back to Windows SAPI if offline.
   */
  async speak(text: string): Promise<void> {
    try {
      if (!this.sarvam.isConfigured()) {
        await this.fallbackTts.speak(text);
        return;
      }

      const audioBuffer = await this.sarvam.textToSpeech(text, {
        speaker: process.env.SARVAM_DEFAULT_SPEAKER || "meera",
        target_language_code: (process.env.SARVAM_DEFAULT_LANGUAGE as SarvamLanguage) || "hi-IN",
      });

      // Play WAV audio through OS audio device
      await this.playWavBuffer(audioBuffer);
    } catch (err) {
      console.error("[voice:sarvam] TTS speak failed, falling back to OS TTS:", (err as Error).message);
      await this.fallbackTts.speak(text);
    }
  }

  /**
   * Transcribe an audio recording buffer (WhatsApp voice note, customer speech) into text.
   */
  async transcribe(audio: Buffer, mimeType?: string): Promise<string> {
    if (!this.sarvam.isConfigured()) {
      throw new Error("Cannot transcribe: SARVAM_API_KEY is not configured.");
    }
    const result = await this.sarvam.speechToText(audio, {
      mimeType,
      language_code: (process.env.SARVAM_DEFAULT_LANGUAGE as SarvamLanguage) || "hi-IN",
    });
    return result.transcript;
  }

  /**
   * Synthesize audio bytes for sending via WhatsApp voice notes or web playback.
   */
  async synthesize(
    text: string,
    options?: { languageCode?: SarvamLanguage | string; speaker?: SarvamSpeaker | string },
  ): Promise<Buffer> {
    if (!this.sarvam.isConfigured()) {
      throw new Error("Cannot synthesize: SARVAM_API_KEY is not configured.");
    }
    return this.sarvam.textToSpeech(text, {
      target_language_code: options?.languageCode,
      speaker: options?.speaker,
    });
  }

  private async playWavBuffer(buffer: Buffer): Promise<void> {
    if (process.platform !== "win32") {
      // Non-Windows fallback (Linux/macOS)
      return;
    }

    const tempFile = path.join(os.tmpdir(), `cortex-soundbox-${Date.now()}.wav`);
    await fs.writeFile(tempFile, buffer);

    return new Promise((resolve) => {
      // Use .NET SoundPlayer built into Windows PowerShell (zero extra dependencies)
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(New-Object System.Media.SoundPlayer '${tempFile}').PlaySync(); Remove-Item -Force '${tempFile}'`,
        ],
        { timeout: 15_000 },
        (err) => {
          if (err) {
            console.error("[voice:sarvam] SoundPlayer playback failed:", err.message);
          }
          // Best-effort cleanup
          void fs.unlink(tempFile).catch(() => {});
          resolve();
        },
      );
    });
  }
}

/**
 * OS TTS offline fallback (AGENTS.md §3.3: "OS TTS as offline fallback").
 * Uses Windows SAPI via PowerShell — no external API, no network, works
 * on the counter laptop with zero configuration. Fire-and-forget by
 * design: a demo shouldn't block on speech synthesis finishing.
 */
export class OsTtsVoiceProvider implements VoiceProvider {
  async speak(text: string): Promise<void> {
    const sanitized = text.replace(/["'`]/g, "");
    return new Promise((resolve) => {
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak("${sanitized}")`,
        ],
        { timeout: 10_000 },
        (err) => {
          if (err) console.error("[voice] OS TTS failed (non-Windows host or no audio device?):", err.message);
          resolve();
        },
      );
    });
  }
}

/** No-op provider for non-Windows/CI environments where OS TTS isn't available. */
export class SilentVoiceProvider implements VoiceProvider {
  async speak(): Promise<void> {}
}

export function getVoiceProvider(): VoiceProvider {
  if (process.env.SARVAM_API_KEY && process.env.SARVAM_API_KEY.trim().length > 0) {
    return new SarvamVoiceProvider();
  }
  return process.platform === "win32" ? new OsTtsVoiceProvider() : new SilentVoiceProvider();
}
