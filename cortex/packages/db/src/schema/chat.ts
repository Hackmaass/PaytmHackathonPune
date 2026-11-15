import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Append-only WhatsApp/Telegram conversation log. One row per inbound user
// message and per outbound agent reply, keyed by channel + chat thread
// (identityId). This is what gives every agent short-term memory: the
// orchestrator replays the last N turns into the LLM so follow-ups like
// "haan bhejo" or "aur kitna?" stay in context.
export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  channel: text("channel").notNull(), // WHATSAPP | TELEGRAM
  threadId: text("thread_id").notNull(), // identityId / phone JID
  role: text("role").notNull(), // USER | AGENT
  agentId: text("agent_id"), // which AI employee replied (AGENT rows)
  agentName: text("agent_name"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const CHAT_MESSAGES_DDL = `
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  agent_id TEXT,
  agent_name TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx
  ON chat_messages (store_id, channel, thread_id, created_at);
`;
