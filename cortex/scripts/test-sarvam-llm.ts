import { getLlmClient, SARVAM_LLM_DEFAULT_MODEL } from "../packages/runtime/src/index.js";

async function main() {
  console.log("==================================================");
  console.log(" CORTEX SARVAM AI LLM INTEGRATION TEST");
  console.log("==================================================");

  const sarvamKey = process.env.SARVAM_API_KEY;
  console.log(`SARVAM_API_KEY: ${sarvamKey ? `Configured (${sarvamKey.slice(0, 6)}...)` : "Not set (testing offline fallback)"}`);
  console.log(`SARVAM_LLM_MODEL: ${process.env.SARVAM_LLM_MODEL ?? SARVAM_LLM_DEFAULT_MODEL}`);

  const llm = getLlmClient();
  console.log(`Active LLM Client: ${llm.constructor.name}`);

  const testPrompt = "Namaste Munim ji, Ramesh Sweets par aaj kitna udhaar baaki hai aur kin regular customers se recover karna hai?";
  console.log(`\nSending prompt to LLM:\n"${testPrompt}"\n`);

  const response = await llm.complete({
    system: "You are Munim, the traditional AI accountant for Ramesh Sweets & Restaurant. Answer in polite Hinglish.",
    prompt: testPrompt,
    maxTokens: 200,
  });

  console.log("--------------------------------------------------");
  console.log("LLM Response:\n");
  console.log(response.text);
  console.log("--------------------------------------------------");
  console.log(`Tokens: input=${response.inputTokens}, output=${response.outputTokens}`);
  console.log("\nSarvam LLM integration test complete: SUCCESS.");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
