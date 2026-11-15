import { getLlmClient, isLlmEnabled } from "../packages/runtime/src/llm.js";
import { getVoiceProvider, SarvamVoiceProvider, AGENT_VOICE_PERSONAS } from "../packages/channels/src/index.js";
import { dispatchInboundText } from "../packages/runtime/src/inbound.js";
import { getDb } from "../packages/db/src/client.js";

async function main() {
  console.log("==================================================");
  console.log(" CORTEX FULL VOICE PIPELINE TEST");
  console.log(" STT → LLM Routing → Agent Reply → TTS");
  console.log("==================================================");

  const sarvamKey = process.env.SARVAM_API_KEY;
  console.log(`SARVAM_API_KEY: ${sarvamKey ? `Configured (${sarvamKey.slice(0, 6)}...)` : "Not set (testing offline fallback)"}`);
  console.log(`LLM Enabled: ${isLlmEnabled()}`);
  console.log(`LLM Client: ${getLlmClient().constructor.name}`);
  console.log(`Voice Provider: ${getVoiceProvider().constructor.name}`);

  // Initialize DB
  const db = await getDb();
  const storeId = "store-ramesh";

  // Test cases simulating voice messages from merchant
  const testCases = [
    {
      name: "Payment Check (Aman's domain)",
      voiceText: "Aman ji, check karo ₹350 ka payment aaya kya",
      expectedAgent: "aman-support",
    },
    {
      name: "Khata Query (Munim's domain)",
      voiceText: "Munim ji, aaj kitna udhaar baaki hai",
      expectedAgent: "munim-accounts",
    },
    {
      name: "Stock Check (Vikram's domain)",
      voiceText: "Vikram, paneer ka stock kitna bacha hai",
      expectedAgent: "vikram-procurement",
    },
    {
      name: "Sales Report (Priya's domain)",
      voiceText: "Priya, kal sales kaise the",
      expectedAgent: "priya-sales",
    },
    {
      name: "Staff Attendance (Meera's domain)",
      voiceText: "Meera, aaj ka attendance batao",
      expectedAgent: "meera-staff",
    },
    {
      name: "Cross-agent Handoff (Vikram addressed, Khata query)",
      voiceText: "Vikram ji, Gupta Caterers ka udhaar kitna hai",
      expectedAgent: "munim-accounts", // Should handoff from Vikram to Munim
    },
    {
      name: "Approval Follow-up",
      voiceText: "Haan bhejo",
      expectedAgent: "cortex-orchestrator", // Handles pending approval
    },
  ];

  const ownerPhone = "+91 9876543210";

  for (const tc of testCases) {
    console.log(`\n┌──────────────────────────────────────────────`);
    console.log(`│ TEST: ${tc.name}`);
    console.log(`│ Voice Input: "${tc.voiceText}"`);
    console.log(`└──────────────────────────────────────────────`);

    try {
      // Simulate the full pipeline: voice text → dispatch → agent reply
      const outcome = await dispatchInboundText({
        db,
        storeId,
        role: "OWNER",
        identityId: ownerPhone,
        text: tc.voiceText,
        senderName: "Ramesh Ji",
        channel: "WHATSAPP",
        // In real scenario, audioBuffer would come from WhatsApp voice note download
      });

      console.log(`✅ Routed to: ${outcome.routedTo}`);
      console.log(`✅ Reply: ${outcome.replyText?.slice(0, 200)}...`);

      // Test TTS synthesis for the reply (if Sarvam configured)
      if (sarvamKey && outcome.replyText) {
        const voice = getVoiceProvider();
        if ("synthesize" in voice) {
          try {
            const persona = AGENT_VOICE_PERSONAS[outcome.routedTo || "priya-sales"];
            const speaker = persona?.speaker || "meera";
            const audioBuffer = await (voice as any).synthesize(outcome.replyText, { speaker });
            console.log(`🔊 TTS Synthesis: SUCCESS (${audioBuffer.length} bytes, speaker: ${speaker})`);
          } catch (err) {
            console.log(`🔊 TTS Synthesis: FAILED - ${(err as Error).message}`);
          }
        }
      }

      // Verify routing correctness
      if (tc.expectedAgent && outcome.routedTo !== tc.expectedAgent) {
        console.log(`⚠️  ROUTING MISMATCH: Expected ${tc.expectedAgent}, got ${outcome.routedTo}`);
      } else if (tc.expectedAgent) {
        console.log(`✅ Routing correct: ${outcome.routedTo}`);
      }
    } catch (err) {
      console.error(`❌ Test failed:`, err);
    }
  }

  // Test STT + TTS roundtrip with real audio (if Sarvam configured)
  if (sarvamKey) {
    console.log("\n┌──────────────────────────────────────────────");
    console.log("│ TEST: STT → LLM → TTS Roundtrip (Real Audio)");
    console.log("└──────────────────────────────────────────────");

    try {
      const { SarvamClient } = await import("../packages/channels/src/sarvam.js");
      const client = new SarvamClient(sarvamKey);

      // Generate test audio using Sarvam TTS first
      const testPhrase = "Aman ji, check karo teen sau pachaas rupaye ka payment";
      console.log(`Generating test audio: "${testPhrase}"`);
      const audioBuffer = await client.textToSpeech(testPhrase, { speaker: "meera", target_language_code: "hi-IN" });
      console.log(`Generated ${audioBuffer.length} bytes of WAV audio`);

      // Transcribe it back
      console.log("Transcribing with Sarvam Saaras STT...");
      const sttResult = await client.speechToText(audioBuffer, { mimeType: "audio/wav", language_code: "hi-IN" });
      console.log(`STT Result: "${sttResult.transcript}"`);

      // Process through orchestrator
      const outcome = await dispatchInboundText({
        db,
        storeId,
        role: "OWNER",
        identityId: ownerPhone,
        text: sttResult.transcript,
        senderName: "Ramesh Ji",
        channel: "WHATSAPP",
        audioBuffer,
        audioMimeType: "audio/wav",
      });
      console.log(`Routed to: ${outcome.routedTo}`);
      console.log(`Reply: ${outcome.replyText?.slice(0, 200)}...`);

      // Synthesize reply
      if (outcome.replyText) {
        const voice = getVoiceProvider();
        if ("synthesize" in voice) {
          const replyAudio = await (voice as any).synthesize(outcome.replyText, { speaker: "arvind" });
          console.log(`Reply TTS: SUCCESS (${replyAudio.length} bytes, speaker: arvind)`);
        }
      }

      console.log("✅ Full STT → LLM → TTS roundtrip SUCCESS!");
    } catch (err) {
      console.error("❌ Roundtrip test failed:", err);
    }
  }

  console.log("\n==================================================");
  console.log(" VOICE PIPELINE TEST COMPLETE");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});