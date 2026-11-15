import { Router } from "express";
import type { CortexDb } from "@cortex/db";
import { DEMO_STORE_ID } from "@cortex/db";
import { decideDecision, dispatchInboundText } from "@cortex/runtime";
import { parseWhatsAppWebhook, getWhatsAppLinkStatus, getVoiceProvider, SarvamVoiceProvider, type IndicVoiceProvider } from "@cortex/channels";
import { SimulatorInboundSchema } from "@cortex/shared";

export function channelsRouter(db: CortexDb): Router {
  const router = Router();
  const storeId = DEMO_STORE_ID;

  // Baileys QR-link status (OpenClaw's approach) — poll this to render the
  // QR code and know when a real WhatsApp is actually linked.
  router.get("/whatsapp/status", (_req, res) => {
    res.json(getWhatsAppLinkStatus());
  });

  // Meta webhook verification handshake (AGENTS.md §5.12). Live inbound
  // message handling is wired in the P3 gateways milestone.
  router.get("/whatsapp/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === (process.env.WHATSAPP_VERIFY_TOKEN ?? "cortex-verify")) {
      return res.status(200).send(challenge);
    }
    res.sendStatus(403);
  });

  router.post("/whatsapp/webhook", async (req, res) => {
    // Not verifiable in this environment — no Meta app/token exists here.
    // Structurally wired to the same channel-agnostic pipeline the
    // simulator and Telegram use, gated on WHATSAPP_ACCESS_TOKEN being set.
    res.sendStatus(200); // ack immediately; Meta retries on non-2xx
    if (!process.env.WHATSAPP_ACCESS_TOKEN) return;

    const event = parseWhatsAppWebhook(req.body, storeId);
    if (!event) return;

    try {
      if (event.kind === "BUTTON" && event.button) {
        await decideDecision(db, { decisionId: event.button.decisionId, storeId, action: event.button.action, source: "WHATSAPP" });
      } else if (event.kind === "TEXT" && event.text) {
        await dispatchInboundText({ db, storeId, role: event.role, identityId: event.identityId, text: event.text });
      }
    } catch (err) {
      console.error("[whatsapp] webhook handling failed:", err);
    }
  });

  router.post("/simulator/inbound", async (req, res) => {
    const parsed = SimulatorInboundSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
    }
    const input = parsed.data;

    if (input.button) {
      let outcome;
      try {
        outcome = await decideDecision(db, {
          decisionId: input.button.decision_id,
          storeId,
          action: input.button.action,
          source: input.channel,
        });
      } catch (err) {
        console.error("[simulator] decision action failed:", err);
        return res.status(500).json({ accepted: false, error: "DECISION_INTEGRITY_ERROR" });
      }
      if (!outcome.ok) {
        return res.status(outcome.httpStatus).json({ accepted: false, error: outcome.error });
      }
      return res.json({ accepted: true, routed_to: input.button.decision_id });
    }

    if (input.text) {
      const outcome = await dispatchInboundText({
        db,
        storeId,
        role: input.role,
        identityId: input.identity_id,
        text: input.text,
      });
      return res.json({ accepted: true, ...(outcome.routedTo ? { routed_to: outcome.routedTo } : {}) });
    }

    res.json({ accepted: true });
  });

  // --- Voice & Soundbox Engine (Sarvam AI & OS TTS) ---
  router.get("/voice/status", (_req, res) => {
    const isSarvam = Boolean(process.env.SARVAM_API_KEY && process.env.SARVAM_API_KEY.trim().length > 0);
    res.json({
      provider: isSarvam ? "SARVAM" : "OS_TTS",
      configured: isSarvam,
      llm_configured: isSarvam,
      llm_model: process.env.SARVAM_LLM_MODEL || "sarvam-105b-conversations",
      default_language: process.env.SARVAM_DEFAULT_LANGUAGE || "hi-IN",
      default_speaker: process.env.SARVAM_DEFAULT_SPEAKER || "meera",
      supported_languages: [
        "hi-IN", "bn-IN", "kn-IN", "ml-IN", "mr-IN",
        "od-IN", "pa-IN", "ta-IN", "te-IN", "gu-IN", "en-IN"
      ],
      speakers: [
        { id: "meera", gender: "Female", persona: "Meera (Staff Desk & Soundbox)" },
        { id: "arvind", gender: "Male", persona: "Aman (Support & Disputes)" },
        { id: "amartya", gender: "Male", persona: "Vikram (Procurement)" },
        { id: "ratan", gender: "Male", persona: "Munim (Accounts & Khata)" },
        { id: "pavithra", gender: "Female", persona: "Regional Counter Vocalist" },
        { id: "maitreyi", gender: "Female", persona: "Formal Indic Vocalist" }
      ]
    });
  });

  router.post("/voice/speak", async (req, res) => {
    const text = String(req.body.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "Missing 'text' in request body." });
    }

    try {
      const voice = getVoiceProvider();
      await voice.speak(text);
      res.json({
        success: true,
        message: "Spoken aloud through Soundbox speaker.",
        provider: voice instanceof SarvamVoiceProvider ? "SARVAM" : "OS_TTS",
        spoken_text: text,
      });
    } catch (err) {
      console.error("[voice/speak] failed:", err);
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/voice/synthesize", async (req, res) => {
    const text = String(req.body.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "Missing 'text' in request body." });
    }

    const voice = getVoiceProvider();
    if (!("synthesize" in voice)) {
      return res.status(501).json({
        error: "VOICE_SYNTHESIS_UNAVAILABLE",
        message: "Sarvam AI is not configured. Set SARVAM_API_KEY to enable audio byte synthesis."
      });
    }

    try {
      const audioBuffer = await (voice as IndicVoiceProvider).synthesize(text, {
        speaker: req.body.speaker,
        languageCode: req.body.language_code || req.body.languageCode,
      });

      const base64 = audioBuffer.toString("base64");
      res.json({
        success: true,
        mime_type: "audio/wav",
        data_url: `data:audio/wav;base64,${base64}`,
        audio_base64: base64,
        provider: "SARVAM",
      });
    } catch (err) {
      console.error("[voice/synthesize] failed:", err);
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/voice/transcribe", async (req, res) => {
    const audioBase64 = req.body.audio_base64 || req.body.audio;
    if (!audioBase64) {
      return res.status(400).json({ error: "Missing 'audio_base64' string in request body." });
    }

    const voice = getVoiceProvider();
    if (!("transcribe" in voice)) {
      return res.status(501).json({
        error: "VOICE_TRANSCRIPTION_UNAVAILABLE",
        message: "Sarvam AI is not configured. Set SARVAM_API_KEY to enable Indic speech-to-text."
      });
    }

    try {
      const audioBuffer = Buffer.from(audioBase64, "base64");
      const transcript = await (voice as IndicVoiceProvider).transcribe(
        audioBuffer,
        req.body.mime_type || "audio/wav"
      );

      res.json({
        success: true,
        transcript,
        provider: "SARVAM",
      });
    } catch (err) {
      console.error("[voice/transcribe] failed:", err);
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  return router;
}
