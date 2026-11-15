import { and, desc, eq } from "drizzle-orm";
import type { CortexDb } from "@cortex/db";
import { schema } from "@cortex/db";
import { makeId, now, type LlmMessage } from "@cortex/runtime";

/** One line of the WhatsApp thread — either the merchant/staff or an AI employee. */
export interface ChatTurn {
  role: "USER" | "AGENT";
  agentId?: string;
  agentName?: string;
  content: string;
  at: Date;
}

function historyLimit(): number {
  const raw = Number(process.env.CORTEX_CHAT_HISTORY_TURNS ?? 12);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 40) : 12;
}

/**
 * Loads the last `limit` turns for one chat thread, oldest-first so it can be
 * fed straight into the LLM. Without this every WhatsApp message is a cold
 * start — which is exactly why the chat felt dumb ("haan bhejo" had no idea
 * what it was approving).
 */
export async function loadRecentTurns(
  db: CortexDb,
  storeId: string,
  channel: "WHATSAPP" | "TELEGRAM",
  threadId: string,
  limit = historyLimit(),
): Promise<ChatTurn[]> {
  try {
    const rows = await db
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.storeId, storeId),
          eq(schema.chatMessages.channel, channel),
          eq(schema.chatMessages.threadId, threadId),
        ),
      )
      .orderBy(desc(schema.chatMessages.createdAt))
      .limit(limit);

    return rows.reverse().map((r) => ({
      role: r.role === "AGENT" ? "AGENT" : "USER",
      ...(r.agentId ? { agentId: r.agentId } : {}),
      ...(r.agentName ? { agentName: r.agentName } : {}),
      content: r.content,
      at: r.createdAt,
    }));
  } catch (err) {
    console.error("[chat-history] load failed:", (err as Error).message);
    return [];
  }
}

export async function appendTurn(
  db: CortexDb,
  args: {
    storeId: string;
    channel: "WHATSAPP" | "TELEGRAM";
    threadId: string;
    role: "USER" | "AGENT";
    content: string;
    agentId?: string;
    agentName?: string;
  },
): Promise<void> {
  try {
    await db.insert(schema.chatMessages).values({
      id: makeId("chat"),
      storeId: args.storeId,
      channel: args.channel,
      threadId: args.threadId,
      role: args.role,
      agentId: args.agentId,
      agentName: args.agentName,
      content: args.content,
      createdAt: now(),
    });
  } catch (err) {
    console.error("[chat-history] append failed:", (err as Error).message);
  }
}

/** The AI employee that last replied in this thread — the "current" agent. */
export function lastAgentId(turns: ChatTurn[]): string | undefined {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn?.role === "AGENT" && turn.agentId && turn.agentId !== "cortex-orchestrator") return turn.agentId;
  }
  return undefined;
}

/** Prior turns as LLM messages (assistant turns keep just the text, not the header). */
export function toLlmHistory(turns: ChatTurn[]): LlmMessage[] {
  return turns
    .filter((t) => t.content.trim().length > 0)
    .map((t) => ({ role: t.role === "AGENT" ? ("assistant" as const) : ("user" as const), content: t.content }));
}
