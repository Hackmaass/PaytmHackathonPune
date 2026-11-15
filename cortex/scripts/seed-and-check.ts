import { getDb } from "../packages/db/src/client.js";
import { seedDemoStore } from "../packages/db/src/seed.js";
import { schema } from "../packages/db/src/client.js";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  await seedDemoStore(db);
  console.log("Seed completed successfully");
  
  const messages = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.storeId, "store-ramesh")).orderBy(schema.chatMessages.createdAt);
  console.log("Chat messages:", messages.length);
  messages.forEach(m => console.log(`[${m.createdAt}] ${m.role} (${m.agentId || "user"}): ${m.content.slice(0, 80)}`));
}

main().catch(console.error);