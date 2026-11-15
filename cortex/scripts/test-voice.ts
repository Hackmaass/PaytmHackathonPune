import { getVoiceProvider, SarvamClient, SarvamVoiceProvider, OsTtsVoiceProvider, AGENT_VOICE_PERSONAS } from "../packages/channels/src/index.js";

async function main() {
  console.log("==================================================");
  console.log(" CORTEX VOICE ENGINE & SARVAM AI VERIFICATION");
  console.log("==================================================");

  const sarvamKey = process.env.SARVAM_API_KEY;
  console.log(`SARVAM_API_KEY: ${sarvamKey ? `Configured (${sarvamKey.slice(0, 6)}...)` : "Not set (using offline OS TTS fallback)"}`);

  const provider = getVoiceProvider();
  console.log(`Active Voice Provider: ${provider instanceof SarvamVoiceProvider ? "SarvamVoiceProvider (Cloud Indic AI)" : "OsTtsVoiceProvider (Local Windows SAPI)"}`);

  console.log("\nConfigured Agent Voice Personas:");
  for (const [agent, persona] of Object.entries(AGENT_VOICE_PERSONAS)) {
    console.log(`  • ${agent.padEnd(20)}: Speaker "${persona.speaker}" (${persona.languageCode}) — ${persona.description}`);
  }

  const testPhrase = "Paytm par teen sau pachaas rupaye prapt huye";
  console.log(`\nTesting Soundbox audio announcement: "${testPhrase}"...`);

  if (sarvamKey) {
    try {
      const client = new SarvamClient(sarvamKey);
      console.log("Invoking Sarvam Bulbul TTS (hi-IN, speaker: meera)...");
      const audioBuffer = await client.textToSpeech(testPhrase, {
        speaker: "meera",
        target_language_code: "hi-IN",
      });
      console.log(`[SUCCESS] Sarvam TTS returned ${audioBuffer.length} bytes of WAV audio.`);
      console.log("Playing audio through local audio device...");
      await provider.speak(testPhrase);
      console.log("[SUCCESS] Audio playback completed.");
    } catch (err) {
      console.error("[ERROR] Sarvam TTS call failed:", (err as Error).message);
    }
  } else {
    console.log("Running offline SAPI speak test (Windows SpeechSynthesizer)...");
    await provider.speak(testPhrase);
    console.log("[SUCCESS] Spoken via Windows OS TTS.");
  }

  console.log("\nVoice engine status: READY.");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

