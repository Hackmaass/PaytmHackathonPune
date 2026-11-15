import { getDb } from "../packages/db/src/client.js";
import { seedDemoStore } from "../packages/db/src/seed.js";

async function main() {
  const db = await getDb();
  await seedDemoStore(db);
  console.log("Seed completed successfully");
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  // Check chat messages after failed seed
  const { schema } = await import("../packages/db/src/client.js");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  const messages = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.storeId, "store-ramesh"));
  console.log("Chat messages after seed:", messages.length);
  process.exit(1);
});