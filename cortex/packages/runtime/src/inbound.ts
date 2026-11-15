import type { CortexDb } from "@cortex/db";
import type { IdentityRole } from "@cortex/shared";

export interface InboundTextContext {
  db: CortexDb;
  storeId: string;
  role: IdentityRole;
  identityId: string;
  text: string;
  senderName?: string;
  channel?: "WHATSAPP" | "TELEGRAM";
  /** For voice notes: the transcribed text (already in `text`), plus the original audio for TTS reply context */
  audioBuffer?: Buffer;
  audioMimeType?: string;
}

export interface InboundTextOutcome {
  handled: boolean;
  routedTo?: string;
  replyText?: string;
  /** Optional audio reply for voice-to-voice conversations */
  replyAudio?: Buffer;
  replyAudioMimeType?: string;
}

export type InboundTextHandler = (ctx: InboundTextContext) => Promise<InboundTextOutcome>;

const handlers: InboundTextHandler[] = [];

/** Agents register intent handlers here (e.g. Aman's "check ₹350" lookup)
 * so the channel routes stay agent-agnostic. First handler to claim the
 * message wins. */
export function registerInboundTextHandler(handler: InboundTextHandler): void {
  handlers.push(handler);
}

export async function dispatchInboundText(ctx: InboundTextContext): Promise<InboundTextOutcome> {
  for (const handler of handlers) {
    const outcome = await handler(ctx);
    if (outcome.handled) return outcome;
  }
  return { handled: false };
}

/** Type guard for voice-capable providers (full STT + TTS) */
export interface VoiceCapableProvider {
  transcribe(audio: Buffer, mimeType?: string): Promise<string>;
  synthesize(text: string, options?: { languageCode?: string; speaker?: string }): Promise<Buffer>;
}

/** Provider that can synthesize speech (TTS only) */
export interface TtsProvider {
  speak(text: string): Promise<void>;
  synthesize(text: string, options?: { languageCode?: string; speaker?: string }): Promise<Buffer>;
}
