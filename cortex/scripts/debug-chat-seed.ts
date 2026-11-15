import { getDb } from "../packages/db/src/client.js";
import { schema } from "../packages/db/src/client.js";
import { seedWeekChatHistory } from "../packages/db/src/seed.js";

async function main() {
  const db = await getDb();
  console.log("Seeding chat history...");
  await seedWeekChatHistory(db, "store-ramesh");
  console.log("Chat history seed completed");
  
  const { eq } = await import("drizzle-orm");
  const messages = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.storeId, "store-ramesh")).orderBy(schema.chatMessages.createdAt);
  console.log("Chat messages:", messages.length);
  messages.forEach(m => console.log(`[${m.createdAt}] ${m.role} (${m.agentId || "user"}): ${m.content.slice(0, 80)}`));
}

main().catch(console.error);