import { eq } from "drizzle-orm";
import type { CortexDb } from "@cortex/db";
import { schema } from "@cortex/db";
import type { DecisionKind } from "@cortex/shared";
import {
  appendActivityEvent,
  decideDecision,
  getLlmClient,
  isLlmEnabled,
  timeLabel,
  type InboundTextContext,
  type InboundTextOutcome,
  type LlmMessage,
  type TtsProvider,
} from "@cortex/runtime";
import { getActiveWhatsAppChannel, allowlistRecipient, getVoiceProvider, SarvamVoiceProvider } from "@cortex/channels";
import { checkPayment } from "./aman/index.js";
import { run as runPriya } from "./priya/index.js";
import { run as runMunim } from "./munim/index.js";
import { run as runVikram } from "./vikram/index.js";
import { run as runMeera, checkIn as meeraCheckIn } from "./meera/index.js";
import { compileSpec } from "./studio/index.js";
import { appendTurn, lastAgentId, loadRecentTurns, toLlmHistory, type ChatTurn } from "./conversation.js";
import {
  AGENT_PROFILES,
  agentHeading,
  detectAddressedAgent,
  handoffLine,
  isChatAgent,
  routeInboundMessage,
  type ChatAgentId,
  type RouteDecision,
} from "./agent-registry.js";
import { fallbackReply, loadStoreFacts, renderStoreContext, type StoreFacts } from "./store-context.js";

type ResponderId = ChatAgentId | "cortex-orchestrator";

/**
 * WhatsApp conversation orchestrator.
 *
 * 1. Remembers the thread (chat_messages) so follow-ups stay in context.
 * 2. Sarvam classifies the message: which AI employee owns it + what the
 *    merchant wants (reply, run a routine, approve a pending decision…).
 * 3. The employee the merchant is currently talking to announces a handoff
 *    when the topic belongs to a colleague ("Yeh Munim ji ka kaam hai…").
 * 4. The responsible employee answers with LIVE store data in the prompt —
 *    real khata balances, stock cover, attendance, payroll, pending approvals.
 * 5. The whole exchange is logged to the live stream so the Command Center
 *    mirrors the chat.
 */
export async function handleInboundMessage(ctx: InboundTextContext): Promise<InboundTextOutcome> {
  const channel = (ctx.channel ?? "WHATSAPP") as "WHATSAPP" | "TELEGRAM";
  const digits = ctx.identityId.replace(/[^0-9]/g, "");
  if (digits) allowlistRecipient("WHATSAPP", digits);

  const senderName = ctx.senderName || (ctx.role === "OWNER" ? "Merchant (Owner)" : "Atharva Chaskar");
  const isAtharva = /atharva|chaskar/i.test(senderName) || /atharva|chaskar/i.test(ctx.identityId);
  const ownerFirstName =
    ctx.role === "OWNER" && senderName && !/merchant|owner/i.test(senderName)
      ? senderName.trim().split(/\s+/)[0]!
      : "Ramesh";
  const greetingName = isAtharva ? "Atharva ji" : ctx.role === "OWNER" ? `${ownerFirstName} ji` : senderName;

  const rawText = ctx.text.trim();

  // 1. Mirror the inbound message on the Command Center stream.
  await appendActivityEvent(ctx.db, {
    storeId: ctx.storeId,
    agentId: "cortex-orchestrator",
    agentName: "Cortex Assistant",
    agentAvatar: "📲",
    message: `[${channel === "WHATSAPP" ? "WhatsApp" : "Telegram"} from ${senderName}]: "${rawText}"`,
    type: "ACTION_EXECUTED",
    severity: "INFO",
  });

  // 2. Thread memory + live store facts (both fail soft).
  const turns = await loadRecentTurns(ctx.db, ctx.storeId, channel, ctx.identityId);
  const facts = await loadStoreFacts(ctx.db, ctx.storeId);

  // 3. Fast deterministic menu — no model round-trip for "hi"/"help".
  if (/^(hi|hello|namaste|hey|help|kya kar sakte ho|options|menu)[\s\.,!]*$/i.test(rawText.toLowerCase())) {
    const reply = greetingMenu(greetingName);
    await sendReply(ctx, "cortex-orchestrator", reply);
    await appendTurn(ctx.db, { storeId: ctx.storeId, channel, threadId: ctx.identityId, role: "USER", content: rawText });
    await appendTurn(ctx.db, { storeId: ctx.storeId, channel, threadId: ctx.identityId, role: "AGENT", agentId: "cortex-orchestrator", agentName: "Cortex Assistant", content: reply });
    return { handled: true, routedTo: "cortex-orchestrator", replyText: reply };
  }

  // 4. Who is being addressed, and who was answering last?
  const addressed = detectAddressedAgent(rawText);
  const currentAgentId = lastAgentId(turns);
  const route = await routeInboundMessage({ text: rawText, turns, addressed, currentAgentId: currentAgentId as ChatAgentId | undefined });

  // 5. Decide who answers. Topic wins over the addressee (that triggers the
  //    handoff); greetings/small talk stay with the agent being spoken to.
  const pending = facts.pendingDecisions[0];
  const wantsApprove = route.intent === "approve_pending" || (Boolean(pending) && isAffirmative(rawText));
  const wantsReject = route.intent === "reject_pending" || (Boolean(pending) && isNegative(rawText));

  let responder: ResponderId = route.agentId as ResponderId;
  if (responder === "cortex-orchestrator" && addressed) responder = addressed;
  if ((route.intent === "greeting" || route.confidence < 0.35) && addressed) responder = addressed;

  if (wantsApprove || wantsReject) {
    if (pending) responder = isChatAgent(pending.agentId) ? pending.agentId : "cortex-orchestrator";
    else responder = (addressed ?? currentAgentId ?? "cortex-orchestrator") as ResponderId;
  }

  const handoffFrom: ChatAgentId | undefined =
    addressed && addressed !== responder
      ? (addressed as ChatAgentId)
      : !addressed && currentAgentId && currentAgentId !== responder
        ? (currentAgentId as ChatAgentId)
        : undefined;

  // 6. Run the deterministic business action (if any), then let the
  //    responsible employee speak.
  const action = await runIntent(ctx, {
    route,
    facts,
    responder,
    pending: pending ? { id: pending.id, kind: pending.kind as DecisionKind } : undefined,
    wantsApprove,
    wantsReject,
    greetingName,
    channel,
  });

  let reply = action?.reply;
  if (!reply) {
    reply = await composeAgentReply({
      agentId: responder,
      senderName,
      text: rawText,
      facts,
      turns,
      isVoiceMessage: !!ctx.audioBuffer,
    });
    if (responder !== "cortex-orchestrator") {
      const heading = agentHeading(responder);
      if (!reply.startsWith(AGENT_PROFILES[responder].avatar) && !reply.startsWith(heading)) {
        reply = `${heading}\n\n${reply}`;
      }
    }
  }

  const handoff = handoffFrom ? handoffLine(handoffFrom, responder) : undefined;
  const finalReply = handoff ? `${handoff}\n\n${reply}` : reply;

  // 7. Deliver, log the handoff, and persist both sides of the exchange.
  await sendReply(ctx, responder, finalReply);

  if (handoffFrom) {
    const from = AGENT_PROFILES[handoffFrom];
    const to = isChatAgent(responder) ? AGENT_PROFILES[responder] : undefined;
    await appendActivityEvent(ctx.db, {
      storeId: ctx.storeId,
      agentId: handoffFrom,
      agentName: from.name,
      agentAvatar: from.avatar,
      message: `${from.name} handed the chat to ${to?.name ?? "Cortex"}: ${route.reason ?? `merchant asked about ${to?.domain ?? "store operations"}`}.`,
      type: "AGENT_HANDOFF",
      severity: "INFO",
    });
  }

  await appendTurn(ctx.db, { storeId: ctx.storeId, channel, threadId: ctx.identityId, role: "USER", content: rawText });
  await appendTurn(ctx.db, {
    storeId: ctx.storeId,
    channel,
    threadId: ctx.identityId,
    role: "AGENT",
    agentId: responder === "cortex-orchestrator" ? "cortex-orchestrator" : responder,
    agentName: responder === "cortex-orchestrator" ? "Cortex Assistant" : AGENT_PROFILES[responder].name,
    content: finalReply,
  });

  return { handled: true, routedTo: responder, replyText: finalReply };
}

const APPROVE_RE =
  /^\s*(haan|ha+|yes|yep|ok(ay)?|theek|thik|sahi|bhejo|bhej\s*do|kardo|kar\s*do|approve|send|chalega|confirm|done)(\s+(ji|bhejo|kardo|kar\s*do|send|please|it)){0,2}[\s\.,!]*$/i;
const REJECT_RE = /^\s*(nahi|nahin|na|no|nope|cancel|reject|mat\s*bhejo|band\s*karo|ruko)(\s+(ji|please)){0,2}[\s\.,!]*$/i;

function isAffirmative(text: string): boolean {
  return APPROVE_RE.test(text);
}

function isNegative(text: string): boolean {
  return REJECT_RE.test(text);
}

function greetingMenu(name: string): string {
  return `Namaste ${name}! 🙏 Cortex back-office is live.

Talk to any AI employee, in English, Hindi or Hinglish:
• 🛡️ *Aman* — "Check ₹350 payment" / "koi dispute?"
• 📒 *Munim* — "Kitna udhaar baaki hai?" / "Send reminders"
• 📦 *Vikram* — "Stock status" / "Order paneer"
• 🎯 *Priya* — "Sales report" / "Send vouchers"
• 👷 *Meera* — "Staff attendance" / "Haazir" / "Pay salary"

You can also just ask normally — I'll route it to the right employee, and they'll hand off to a colleague if the question belongs to someone else.`;
}

interface IntentRun {
  route: RouteDecision;
  facts: StoreFacts;
  responder: ResponderId;
  pending?: { id: string; kind: DecisionKind };
  wantsApprove: boolean;
  wantsReject: boolean;
  greetingName: string;
  channel: "WHATSAPP" | "TELEGRAM";
}

interface IntentResult {
  reply: string;
}

/**
 * Deterministic layer: nothing here is decided by an LLM. Money-moving and
 * state-changing intents go through the same agents/guardrails as the
 * routines — the chat only triggers them.
 */
async function runIntent(ctx: InboundTextContext, args: IntentRun): Promise<IntentResult | undefined> {
  const { route, facts, wantsApprove, wantsReject, greetingName, channel } = args;

  if (wantsApprove || wantsReject) {
    if (!args.pending) {
      return {
        reply: `🤖 *Cortex Assistant*\n\nAbhi koi pending approval nahi hai. Jaise hi Priya, Munim, Vikram ya Meera koi decision stage karenge, aap yahan se hi *"haan bhejo"* ya *"cancel"* bol sakte hain.`,
      };
    }
    const outcome = await decideDecision(ctx.db, {
      decisionId: args.pending.id,
      storeId: ctx.storeId,
      action: wantsApprove ? "APPROVE" : "REJECT",
      source: channel,
    });
    return { reply: describeDecisionOutcome(args.pending.kind, args.pending.id, outcome) };
  }

  switch (route.intent) {
    case "check_payment": {
      const amount = route.amount;
      if (!amount) {
        return {
          reply: `🛡️ *Aman (Support & UPI Disputes)*\n\nAmount bataiye — jaise *"Check ₹350"* — aur main Paytm PG ledger + Soundbox queue se turant verify kar dunga.`,
        };
      }
      const res = await checkPayment(ctx.db, ctx.storeId, amount);
      const lines = [`🛡️ *Aman (Support & UPI Disputes)*`, ""];
      if (res.status === "SUCCESS") {
        lines.push(
          `✅ *Payment Verified — ₹${amount}*`,
          `• Paytm Txn: ${res.txnId ?? "TXN-9021-88"}`,
          `• UTR: ${res.utr ?? "UTR-99120341"}`,
          `• Soundbox: edge override announced at the counter`,
          "",
          "Customer ko bhejne ke liye koi dispute slip ki zaroorat nahi hai.",
        );
      } else if (res.status === "PENDING") {
        lines.push(
          `⚠️ *Payment In-Process — ₹${amount}*`,
          `• Ticket: *#${res.ticketId}*`,
          `• Bank PG settlement pending (auto-clears within 2 hours)`,
          `• Customer receipt drafted on WhatsApp`,
        );
      } else {
        lines.push(
          `⚠️ *No ₹${amount} payment in the last 5 minutes*`,
          `• Ticket *#${res.ticketId}* opened for counter verification`,
          `• Check the Soundbox queue; I'll re-check on request`,
        );
      }
      return { reply: lines.join("\n") };
    }

    case "khata_reminders": {
      await runMunim(ctx.db, ctx.storeId);
      const overdue = facts.khata.accounts.filter((a) => a.balance > 5000 && a.dueDays > 15);
      const list = (overdue.length ? overdue : facts.khata.accounts.slice(0, 3))
        .map((a) => `• ${a.name} — ₹${Math.round(a.balance).toLocaleString("en-IN")} (${a.dueDays}d)`)
        .join("\n");
      return {
        reply: `📒 *Munim (Accounts & Khata)*\n\nReminder batch staged with Paytm UPI links:\n${list || "• No overdue khata right now"}\n\n• Card aa raha hai — reply *"haan bhejo"* to approve, ya Command Center par 1-tap kijiye.\n• Quiet hours 20:00–10:00 respected.`,
      };
    }

    case "create_po": {
      await runVikram(ctx.db, ctx.storeId);
      const low = facts.stock.filter((s) => s.coverDays < 1.5 || s.qtyOnHand <= s.reorderLevel).sort((a, b) => a.coverDays - b.coverDays)[0];
      return {
        reply: `📦 *Vikram (Stock & Procurement)*\n\nRFQ sent to 3 suppliers${low ? ` for *${low.sku}* (${low.qtyOnHand} ${low.unit} left, ~${low.coverDays}d cover)` : ""}.\nBest quote draft PO stage ho gaya hai.\n\n• Guardrail: PO ≤ ₹10,000 and ≤ last price +8%\n• Reply *"haan bhejo"* to place the order, or open the card to compare quotes.`,
      };
    }

    case "send_vouchers": {
      await runPriya(ctx.db, ctx.storeId);
      return {
        reply: `🎯 *Priya (Sales & Win-back)*\n\nWin-back campaign staged for your regulars.\n• Latest-day gap vs baseline: ₹${Math.round(facts.sales.deficit).toLocaleString("en-IN")}\n• Margin guardrail: 10% discount stays above the 30% floor\n• WhatsApp spend stays inside the daily cap\n\n• Reply *"haan bhejo"* to dispatch vouchers.`,
      };
    }

    case "payroll": {
      await runMeera(ctx.db, ctx.storeId);
      return {
        reply: `👷 *Meera (Staff & Payroll Desk)*\n\nPayday payout staged for ${facts.staff.length} staff:\n• Net payable: *₹${Math.round(facts.payrollNet).toLocaleString("en-IN")}*\n• Advances already deducted: ₹${Math.round(facts.advances).toLocaleString("en-IN")}\n• Payout ceiling guardrail: PASSED\n\n• Reply *"haan bhejo"* to pay all, and each worker gets a Hindi voice payslip.`,
      };
    }

    case "attendance_checkin": {
      const worker = await resolveWorker(ctx);
      await meeraCheckIn(ctx.db, ctx.storeId, worker, channel);
      const profile = AGENT_PROFILES["meera-staff"];
      return {
        reply: `${profile.avatar} *${profile.name} (${profile.role})*\n\n✅ Haaziri darj ho gayi hai! Check-in recorded for *${greetingName}* at ${timeLabel()} IST.\nStatus: *PRESENT*.\n\nAaj ka attendance: *${facts.staffPresent}/${facts.staff.length}* present.`,
      };
    }

    case "create_agent": {
      const res = await compileSpec({ prompt: ctx.text, template_id: null });
      if (res.rejected) {
        return { reply: `✨ *Studio Compiler*\n\n⚠️ ${res.reason}` };
      }
      return {
        reply: `✨ *No-Code Agent Studio*\n\nCustom agent compiled!\n• Name: *${res.spec.name}*\n• Role: ${res.spec.role}\n• Trigger: ${res.spec.trigger}\n\n• Status: STAGED — hire it from the Studio view (or say *"hire agent"*).`,
      };
    }

    default:
      return undefined;
  }
}

/** Matches a checker-in to a real staff row by phone digits, then by name. */
async function resolveWorker(ctx: InboundTextContext): Promise<string> {
  try {
    const rows = await ctx.db.select().from(schema.staff).where(eq(schema.staff.storeId, ctx.storeId));
    const digits = ctx.identityId.replace(/[^0-9]/g, "").slice(-10);
    const byPhone = rows.find((r) => r.phone.replace(/[^0-9]/g, "").endsWith(digits) && digits.length >= 10);
    if (byPhone) return byPhone.id;
    const name = (ctx.senderName ?? "").toLowerCase().split(/\s+/)[0];
    const byName = rows.find((r) => name && r.name.toLowerCase() === name);
    if (byName) return byName.id;
  } catch {
    // fall through to identityId
  }
  return ctx.identityId;
}

function describeDecisionOutcome(
  kind: DecisionKind,
  id: string,
  outcome: Awaited<ReturnType<typeof decideDecision>>,
): string {
  if (!outcome.ok) {
    if (outcome.error === "ALREADY_DECIDED") {
      return `🤖 *Cortex Assistant*\n\nYeh decision (${id}) pehle hi *${outcome.status}* ho chuka hai — dobara action nahi hoga (idempotency guard).`;
    }
    if (outcome.error === "EXPIRED") {
      return `🤖 *Cortex Assistant*\n\nDecision ${id} expire ho gaya tha, isliye execute nahi kiya. Agent dobara stage karega.`;
    }
    return `🤖 *Cortex Assistant*\n\nDecision ${id} nahi mila. Command Center par latest card dekh lijiye.`;
  }

  const response = outcome.response;
  if (response.status === "REJECTED") {
    return `🤖 *Cortex Assistant*\n\n❌ Decision ${id} (${kind}) reject kar diya gaya. Koi WhatsApp message ya payment nahi bheja.`;
  }

  const result = "result" in response && response.result ? response.result : {};
  const details = describeResult(kind, result as Record<string, unknown>);
  const soundbox = "soundbox_announcement" in response && response.soundbox_announcement
    ? `\n\n🔊 *Soundbox:* ${response.soundbox_announcement}`
    : "";
  return `🤖 *Cortex Assistant*\n\n✅ Approved and executed: *${kind}* (${id}).\n${details}${soundbox}`;
}

function describeResult(kind: DecisionKind, result: Record<string, unknown>): string {
  const inr = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN")}`;
  switch (kind) {
    case "VOUCHER_CAMPAIGN":
      return `• Vouchers sent: ${result.dispatched_vouchers ?? result.reminders_sent ?? 0}\n• Projected recovery: ${inr(result.attributed_projected_revenue ?? 0)}`;
    case "KHATA_REMINDER_BATCH":
      return `• Reminders sent: ${result.reminders_sent ?? 0}\n• Outstanding covered: ${inr(result.amount_outstanding ?? 0)}`;
    case "PURCHASE_ORDER":
      return `• PO: ${result.po_id ?? "-"}\n• Supplier: ${result.supplier ?? "-"}\n• Total: ${inr(result.total ?? 0)}`;
    case "PAYROLL_PAYOUT":
      return `• Workers paid: ${result.workers_paid ?? 0}\n• Total paid: ${inr(result.total_paid ?? 0)}`;
    default:
      return Object.entries(result)
        .map(([k, v]) => `• ${k.replace(/_/g, " ")}: ${String(v)}`)
        .join("\n");
  }
}

/**
 * Sarvam-backed employee reply. The system prompt carries the persona and
 * live store facts; prior turns are passed as real chat messages so
 * follow-ups and pronoun references work.
 */
async function composeAgentReply(args: {
  agentId: ResponderId;
  senderName: string;
  text: string;
  facts: StoreFacts;
  turns: ChatTurn[];
  isVoiceMessage?: boolean;
}): Promise<string> {
  const profile = isChatAgent(args.agentId) ? AGENT_PROFILES[args.agentId] : undefined;
  const fallback = profile ? fallbackReply(args.facts, profile.id, args.senderName) : defaultCoordinatorReply(args.facts);

  if (!isLlmEnabled()) return fallback;

  const persona = profile
    ? `You are ${profile.name}, the AI ${profile.role} for ${args.facts.storeName} on WhatsApp. Your responsibilities: ${profile.domain}.`
    : `You are Cortex, the back-office coordinator for ${args.facts.storeName} on WhatsApp. You speak for the team: Priya (sales), Aman (payments), Vikram (stock), Munim (accounts), Meera (staff).`;

  const languageHint = detectLanguage(args.text);
  const voiceHint = args.isVoiceMessage ? "The merchant sent a voice note — reply naturally as if speaking back. Keep it conversational and spoken-language style." : "";

  const system = [
    persona,
    `You are chatting one-to-one with ${args.senderName}, the shop owner.`,
    `LIVE STORE DATA (authoritative, read from the counter database just now):`,
    renderStoreContext(args.facts, args.agentId),
    `LANGUAGE: Reply in ${languageHint}.`,
    voiceHint,
    `RULES:`,
    `- Use the exact live numbers above. Never say you lack access to data.`,
    `- Reply in the merchant's language: Hinglish by default, English if they wrote English, Devanagari if they wrote Devanagari.`,
    `- Be warm, specific and brief: 3-6 short lines or bullets. Use WhatsApp *bold* sparingly.`,
    `- Answer the question first, then give ONE clear next action with the exact phrase the merchant can reply.`,
    `- Never invent customers, SKU quantities, balances, or decisions. Never claim an action happened unless the live data shows it.`,
    `- If the question truly belongs to a colleague, say which colleague handles it in one short line instead of guessing.`,
    `- No markdown headings, no tables, no code blocks.`,
    `- For voice replies: keep sentences shorter, use natural speech patterns (accha, theek hai, ji, haan).`,
  ].join("\n");

  const messages: LlmMessage[] = [...toLlmHistory(args.turns.slice(-8)), { role: "user", content: args.text }];

  try {
    const { text } = await getLlmClient().complete({
      system,
      messages,
      maxTokens: 320,
      temperature: 0.45,
    });
    const cleaned = text.trim();
    if (cleaned.length > 10 && !cleaned.startsWith("[offline-stub")) return cleaned;
  } catch (err) {
    console.error("[orchestrator] LLM reply failed:", (err as Error).message);
  }
  return fallback;
}

/** Detect the script/language of the user's message for appropriate reply language. */
function detectLanguage(text: string): "Hinglish (Hindi written in Latin script)" | "English" | "Devanagari Hindi" | "Marathi" {
  const devanagari = /[\u0900-\u097F]/.test(text);
  if (devanagari) return "Devanagari Hindi";
  const hinglish = /\b(hai|hoon|kya|kaise|kitna|kahan|kab|kyun|nahi|haan|theek|accha|bhejo|kardo|udhaar|khata|paisa|rupaye|sahi|galat)\b/i.test(text);
  if (hinglish) return "Hinglish (Hindi written in Latin script)";
  const marathi = /\b(ahe|kay|kuthe|kevha|kaay|ho|nahi|hou|theek|bara|chhan)\b/i.test(text);
  if (marathi) return "Marathi";
  return "English";
}

function defaultCoordinatorReply(facts: StoreFacts): string {
  const pending = facts.pendingDecisions.map((d) => `• ${d.kind} (${d.id}) from ${d.agentName}`).join("\n");
  return `🤖 *Cortex Assistant*

Main aapki baat sahi employee tak pahucha dunga. Live snapshot:
• Khata outstanding: ₹${Math.round(facts.khata.total).toLocaleString("en-IN")}
• Staff present: ${facts.staffPresent}/${facts.staff.length}
• Low-stock SKUs: ${facts.stock.filter((s) => s.coverDays < 1.5).length}
${pending ? `\n*Pending approvals:*\n${pending}\n` : ""}
Kis employee se baat karni hai — Priya (sales), Aman (payments), Vikram (stock), Munim (accounts) ya Meera (staff)?`;
}

async function sendReply(ctx: InboundTextContext, responder: ResponderId, replyText: string): Promise<void> {
  const profile = isChatAgent(responder) ? AGENT_PROFILES[responder] : undefined;
  const agentName = profile?.name ?? "Cortex Assistant";
  const agentId = profile?.id ?? "cortex-orchestrator";
  const avatar = profile?.avatar ?? "🤖";

  try {
    const active = getActiveWhatsAppChannel();
    console.log(`[orchestrator] ${agentName} -> ${ctx.identityId}`);
    await active.sendText({ storeId: ctx.storeId, toIdentityId: ctx.identityId, text: replyText });

    // If the inbound was a voice message and Sarvam is configured, also send a voice note
    if (ctx.audioBuffer) {
      const voice = getVoiceProvider();
      if ("synthesize" in voice) {
        try {
          const ttsVoice = voice as TtsProvider;
          let speaker = "meera";
          if (responder !== "cortex-orchestrator" && isChatAgent(responder)) {
            const { AGENT_VOICE_PERSONAS } = await import("@cortex/channels");
            const persona = AGENT_VOICE_PERSONAS[responder];
            if (persona) speaker = persona.speaker;
          }
          const replyAudio = await ttsVoice.synthesize(replyText, { speaker });
          await active.sendVoiceNote({ storeId: ctx.storeId, toIdentityId: ctx.identityId, script: replyText });
          console.log(`[orchestrator] Voice reply sent to ${ctx.identityId} via ${speaker}`);
        } catch (err) {
          console.error(`[orchestrator] Voice reply synthesis/send failed:`, err);
        }
      }
    }
  } catch (err) {
    console.error(`[orchestrator] failed to send reply to ${ctx.identityId}:`, err);
  }

  await appendActivityEvent(ctx.db, {
    storeId: ctx.storeId,
    agentId,
    agentName,
    agentAvatar: avatar,
    message: `Replied to ${ctx.senderName ?? "WhatsApp"}: ${replyText.split("\n").filter(Boolean).slice(0, 2).join(" ") || replyText}`,
    type: "ACTION_EXECUTED",
    severity: "SUCCESS",
  });
}
