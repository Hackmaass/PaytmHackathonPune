import { Buffer } from "node:buffer";

export type SarvamSpeaker = "meera" | "pavithra" | "maitreyi" | "arvind" | "amartya" | "ratan";
export type SarvamLanguage =
  | "hi-IN"
  | "bn-IN"
  | "kn-IN"
  | "ml-IN"
  | "mr-IN"
  | "od-IN"
  | "pa-IN"
  | "ta-IN"
  | "te-IN"
  | "gu-IN"
  | "en-IN";

export interface SarvamTtsOptions {
  target_language_code?: SarvamLanguage | string;
  speaker?: SarvamSpeaker | string;
  pitch?: number;
  pace?: number;
  loudness?: number;
  speech_sample_rate?: number;
  enable_preprocessing?: boolean;
  model?: "bulbul:v1" | string;
}

export interface SarvamSttOptions {
  model?: "saaras:v1" | "saaras:v2" | string;
  language_code?: SarvamLanguage | "unknown" | string;
  mimeType?: string;
}

export interface SarvamSttResult {
  transcript: string;
  language_code?: string;
}

/**
 * Persona mapping per agent — gives each AI employee an authentic, distinctive
 * Indic vocal identity across Soundbox announcements, WhatsApp voice notes, and phone calls.
 */
export const AGENT_VOICE_PERSONAS: Record<
  string,
  { speaker: SarvamSpeaker; languageCode: SarvamLanguage; description: string }
> = {
  "priya-sales": {
    speaker: "meera",
    languageCode: "hi-IN",
    description: "Persuasive, energetic retail win-back specialist",
  },
  "aman-support": {
    speaker: "arvind",
    languageCode: "hi-IN",
    description: "Calm, reassuring dispute & customer support officer",
  },
  "vikram-procurement": {
    speaker: "amartya",
    languageCode: "hi-IN",
    description: "Decisive, direct supply chain & vendor negotiator",
  },
  "munim-accounts": {
    speaker: "ratan",
    languageCode: "hi-IN",
    description: "Mature, authoritative traditional Indian accountant",
  },
  "meera-staff": {
    speaker: "meera",
    languageCode: "hi-IN",
    description: "Empathetic, clear staff desk and payroll lead",
  },
  soundbox: {
    speaker: "meera",
    languageCode: "hi-IN",
    description: "Crisp, audible Paytm Soundbox edge announcement voice",
  },
};

/**
 * Sarvam AI Client — Premier Indic Foundation Models for Voice (TTS / STT).
 * Fully supports Hindi, Hinglish, Marathi, Tamil, Telugu, and other Bharat languages.
 */
export class SarvamClient {
  private readonly apiKey?: string;
  private readonly baseUrl = "https://api.sarvam.ai";

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.SARVAM_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Synthesize natural Indic voice audio using Sarvam Bulbul TTS.
   * Automatically splits inputs exceeding Sarvam's 500-character single-call limit.
   */
  async textToSpeech(text: string, options: SarvamTtsOptions = {}): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error("SARVAM_API_KEY is not configured.");
    }

    const cleanText = text.trim();
    if (!cleanText) {
      throw new Error("Text to synthesize cannot be empty.");
    }

    const targetLanguage = options.target_language_code || process.env.SARVAM_DEFAULT_LANGUAGE || "hi-IN";
    const speaker = options.speaker || process.env.SARVAM_DEFAULT_SPEAKER || "meera";

    // Sarvam API has a 500-char limit per chunk. For longer text, chunk by sentence.
    const chunks = this.chunkText(cleanText, 480);
    const audioBuffers: Buffer[] = [];

    for (const chunk of chunks) {
      const response = await fetch(`${this.baseUrl}/text-to-speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": this.apiKey,
        },
        body: JSON.stringify({
          inputs: [chunk],
          target_language_code: targetLanguage,
          speaker,
          pitch: options.pitch ?? 0,
          pace: options.pace ?? 1.0,
          loudness: options.loudness ?? 1.5,
          speech_sample_rate: options.speech_sample_rate ?? 8000,
          enable_preprocessing: options.enable_preprocessing ?? true,
          model: options.model ?? "bulbul:v1",
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Sarvam TTS API failed (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as { audios?: string[] };
      if (!data.audios || data.audios.length === 0 || !data.audios[0]) {
        throw new Error("Sarvam TTS API returned no audio content.");
      }

      audioBuffers.push(Buffer.from(data.audios[0], "base64"));
    }

    // If single chunk, return directly
    if (audioBuffers.length === 1) {
      return audioBuffers[0]!;
    }

    // For multiple chunks, concatenate WAV PCM payloads (stripping header on subsequent chunks)
    return this.concatenateWavBuffers(audioBuffers);
  }

  /**
   * Transcribe Indian voice note / speech audio using Sarvam Saaras STT.
   * Handles raw audio buffers from WhatsApp voice notes, phone calls, or microphone.
   */
  async speechToText(audio: Buffer, options: SarvamSttOptions = {}): Promise<SarvamSttResult> {
    if (!this.apiKey) {
      throw new Error("SARVAM_API_KEY is not configured.");
    }

    const mimeType = options.mimeType || "audio/wav";
    const fileName = mimeType.includes("ogg") ? "audio.ogg" : mimeType.includes("mp4") ? "audio.mp4" : "audio.wav";

    const formData = new FormData();
    const blob = new Blob([audio], { type: mimeType });
    formData.append("file", blob, fileName);
    formData.append("model", options.model || "saaras:v1");

    if (options.language_code && options.language_code !== "unknown") {
      formData.append("language_code", options.language_code);
    }

    const response = await fetch(`${this.baseUrl}/speech-to-text`, {
      method: "POST",
      headers: {
        "api-subscription-key": this.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Sarvam STT API failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as { transcript?: string; language_code?: string };
    return {
      transcript: data.transcript ?? "",
      language_code: data.language_code,
    };
  }

  /**
   * Translate text between Indian languages and English using Sarvam Mayura.
   */
  async translate(text: string, sourceLang = "auto", targetLang = "hi-IN"): Promise<string> {
    if (!this.apiKey) {
      throw new Error("SARVAM_API_KEY is not configured.");
    }

    const response = await fetch(`${this.baseUrl}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": this.apiKey,
      },
      body: JSON.stringify({
        input: text,
        source_language_code: sourceLang,
        target_language_code: targetLang,
        speaker_gender: "Female",
        mode: "formal",
        model: "mayura:v1",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Sarvam Translate API failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as { translated_text?: string };
    return data.translated_text ?? text;
  }

  private chunkText(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const sentences = text.match(/[^.!?।\n]+[.!?।\n]*/g) || [text];
    const chunks: string[] = [];
    let current = "";

    for (const sentence of sentences) {
      if ((current + sentence).length > maxLength) {
        if (current.trim()) chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [text.slice(0, maxLength)];
  }

  private concatenateWavBuffers(buffers: Buffer[]): Buffer {
    if (buffers.length === 0) return Buffer.alloc(0);
    if (buffers.length === 1) return buffers[0]!;

    // Find the data chunk size from the first buffer
    // Standard WAV header is 44 bytes. Subsequent buffers' data starts after 44 bytes.
    const header = Buffer.from(buffers[0]!.subarray(0, 44));
    const pcmChunks: Buffer[] = [buffers[0]!.subarray(44)];

    let totalDataLength = buffers[0]!.length - 44;

    for (let i = 1; i < buffers.length; i++) {
      const buf = buffers[i]!;
      if (buf.length > 44) {
        const chunk = buf.subarray(44);
        pcmChunks.push(chunk);
        totalDataLength += chunk.length;
      }
    }

    // Update RIFF chunk size (totalDataLength + 36) at bytes 4-8
    header.writeUInt32LE(totalDataLength + 36, 4);
    // Update data subchunk size (totalDataLength) at bytes 40-44
    header.writeUInt32LE(totalDataLength, 40);

    return Buffer.concat([header, ...pcmChunks]);
  }
}

