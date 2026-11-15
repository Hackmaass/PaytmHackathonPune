import { getLlmClient, isLlmEnabled, type LlmMessage } from "@cortex/runtime";
import type { ChatTurn } from "./conversation.js";
import { toLlmHistory } from "./conversation.js";

/** Every AI employee that can hold a WhatsApp conversation. */
export const CHAT_AGENT_IDS = [
  "priya-sales",
  "aman-support",
  "vikram-procurement",
  "munim-accounts",
  "meera-staff",
] as const;

export type ChatAgentId = (typeof CHAT_AGENT_IDS)[number];

/** What the merchant is asking for, independent of who answers. */
export const CHAT_INTENTS = [
  "query",
  "greeting",
  "check_payment",
  "khata_reminders",
  "create_po",
  "send_vouchers",
  "payroll",
  "attendance_checkin",
  "create_agent",
  "approve_pending",
  "reject_pending",
] as const;

export type ChatIntent = (typeof CHAT_INTENTS)[number];

export interface AgentProfile {
  id: ChatAgentId;
  name: string;
  avatar: string;
  role: string;
  gender: "F" | "M";
  /** Merchant-language description of what this employee owns (fed to the router). */
  domain: string;
  keywords: RegExp;
}

export const AGENT_PROFILES: Record<ChatAgentId, AgentProfile> = {
  "priya-sales": {
    id: "priya-sales",
    name: "Priya",
    avatar: "🎯",
    role: "Sales & Win-back",
    gender: "F",
    domain:
      "sales trends, revenue dips, footfall, average bill, discounts, vouchers/coupons, win-back campaigns, regular customers, business performance",
    keywords:
      /\b(priya|sale|sales|revenue|kamai|dhanda|dip|deficit|discount|voucher|coupon|offer|campaign|footfall|regulars?|win.?back)\b/i,
  },
  "aman-support": {
    id: "aman-support",
    name: "Aman",
    avatar: "🛡️",
    role: "Customer Support & UPI Disputes",
    gender: "M",
    domain:
      "payment verification, UPI/Paytm PG transactions, Soundbox announcements, refunds, customer disputes, 'paisa aaya ya nahi'",
    keywords: /\b(aman|payment|paisa|upi|txn|transaction|soundbox|refund|dispute|verify|utr|settled)\b/i,
  },
  "vikram-procurement": {
    id: "vikram-procurement",
    name: "Vikram",
    avatar: "📦",
    role: "Stock & Procurement",
    gender: "M",
    domain:
      "stock/inventory levels, out-of-stock risk, SKU cover, suppliers, quotes/rates, purchase orders, reorder quantity, batch expiry",
    keywords:
      /\b(vikram|stock|inventory|paneer|khoya|ghee|kaju|milk|samaan|maal|supplier|vendor|purchase|reorder|quote|rate|shortage|khatam|expiry|expire)\b/i,
  },
  "munim-accounts": {
    id: "munim-accounts",
    name: "Munim",
    avatar: "📒",
    role: "Accounts, Khata & GST",
    gender: "M",
    domain:
      "khata/udhaar/credit, who owes money, settlement reconciliation, mismatches, GST/GSTR filing, FSSAI and compliance deadlines",
    keywords:
      /\b(munim|khata|udhaar|udhar|credit|due|baaki|owe|owes|hisaab|settlement|reconcil|mismatch|gst|gstr|tax|fssai|compliance|licence|license|penalty)\b/i,
  },
  "meera-staff": {
    id: "meera-staff",
    name: "Meera",
    avatar: "👷",
    role: "Staff & Payroll Desk",
    gender: "F",
    domain:
      "staff attendance, 'haazir' check-ins, leave, advances, salary, payroll, payday payout, payslips, worker roster",
    keywords:
      /\b(meera|staff|worker|haazir|present|absent|attendance|chutti|leave|salary|tankhwah|payroll|payday|advance|payslip|raju|sunita|imran|deepak|anita|priyanka)\b/i,
  },
};

export function isChatAgent(id: string | undefined): id is ChatAgentId {
  return Boolean(id && (CHAT_AGENT_IDS as readonly string[]).includes(id));
}

export function agentProfile(id: string): AgentProfile | undefined {
  return isChatAgent(id) ? AGENT_PROFILES[id] : undefined;
}

/** WhatsApp header + persona label, e.g. "🎯 *Priya (Sales & Win-back)*". */
export function agentHeading(id: ChatAgentId): string {
  const p = AGENT_PROFILES[id];
  return `${p.avatar} *${p.name} (${p.role})*`;
}

const ADDRESS_ALIASES: Array<{ agent: ChatAgentId; re: RegExp }> = [
  { agent: "priya-sales", re: /\b(priya|sales\s*(agent|desk|wali))\b/i },
  { agent: "aman-support", re: /\b(aman|support\s*(agent|desk)|dispute\s*(agent|desk))\b/i },
  { agent: "vikram-procurement", re: /\b(vikram|stock\s*(agent|desk)|procurement\s*(agent|desk)|purchase\s*(agent|desk))\b/i },
  { agent: "munim-accounts", re: /\b(munim|munimji|accounts?\s*(agent|desk|wali)|accountant)\b/i },
  { agent: "meera-staff", re: /\b(meera|staff\s*(agent|desk)|payroll\s*(agent|desk)|hr\s*(agent|desk))\b/i },
];

/**
 * Who is the merchant talking *to* right now? A message like
 * "Vikram ji, udhaar kitna hai?" addresses Vikram even though the topic
 * belongs to Munim — that is exactly the case where Vikram should hand off.
 */
export function detectAddressedAgent(text: string): ChatAgentId | undefined {
  for (const alias of ADDRESS_ALIASES) {
    if (alias.re.test(text)) return alias.agent;
  }
  return undefined;
}

const GREETING_RE = /^\s*(hi+|hello+|hey+|namaste|namaskar|salaam|good\s*(morning|evening|afternoon)|help|menu|kya\s*kar\s*sakte\s*ho|options|start)[\s\.,!🙏]*$/i;

const PAYMENT_WORD_RE = /\b(payment|paisa|paise|upi|txn|transaction|soundbox|refund|dispute|verify|utr|kat\s*gaya|aaya|aaye)\b/i;
const AMOUNT_RE = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)|([\d,]{2,})(?:\.\d+)?\s*(?:rs|rupees?|rupaye|rupay|ka|ki)\b/i;

export function extractAmount(text: string): number | undefined {
  const m = text.match(AMOUNT_RE);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return undefined;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function scoreAgent(text: string, ignore?: ChatAgentId): { agent: ChatAgentId; score: number } | undefined {
  // When the merchant addresses someone by name, the name itself is not
  // evidence about the topic — strip it before scoring domains. This is what
  // makes "Vikram ji, udhaar kitna hai?" route to Munim (and trigger a
  // handoff from Vikram) instead of answering with stock data.
  const cleaned = ignore ? text.replace(new RegExp(`\\b${AGENT_PROFILES[ignore].name}\\b`, "gi"), " ") : text;
  let best: { agent: ChatAgentId; score: number } | undefined;
  for (const id of CHAT_AGENT_IDS) {
    const hits = cleaned.match(new RegExp(AGENT_PROFILES[id].keywords.source, "gi"))?.length ?? 0;
    if (hits > 0 && (!best || hits > best.score)) best = { agent: id, score: hits };
  }
  return best;
}

export interface RouteDecision {
  agentId: ChatAgentId | "cortex-orchestrator";
  intent: ChatIntent;
  amount?: number;
  confidence: number;
  source: "llm" | "keywords" | "fallback";
  reason?: string;
}

interface RouteArgs {
  text: string;
  turns: ChatTurn[];
  addressed?: ChatAgentId;
  currentAgentId?: ChatAgentId;
}

/** Deterministic classifier — used when Sarvam is unreachable or disabled. */
export function routeByKeywords(args: RouteArgs): RouteDecision {
  const { text, addressed, currentAgentId } = args;
  const amount = extractAmount(text);

  if (GREETING_RE.test(text)) {
    return { agentId: addressed ?? currentAgentId ?? "cortex-orchestrator", intent: "greeting", confidence: 0.95, source: "keywords" };
  }

  if (amount !== undefined && (PAYMENT_WORD_RE.test(text) || /₹/.test(text))) {
    return { agentId: "aman-support", intent: "check_payment", amount, confidence: 0.85, source: "keywords" };
  }

  if (/\b(haazir|hazir|present|check\s*-?\s*in|aa\s*gaya)\b/i.test(text)) {
    return { agentId: "meera-staff", intent: "attendance_checkin", confidence: 0.85, source: "keywords" };
  }

  if (/\b(pay\s*salary|salary\s*(do|bhejo|de|de do)|payroll|payday|payout|tankhwah)\b/i.test(text)) {
    return { agentId: "meera-staff", intent: "payroll", confidence: 0.8, source: "keywords" };
  }

  if (/(create|hire|new|banao|bana\s*do)\b.{0,25}\b(agent|automation)\b/i.test(text)) {
    return { agentId: addressed ?? "cortex-orchestrator", intent: "create_agent", confidence: 0.8, source: "keywords" };
  }

  if (/\b(remind|reminder|bhejo|send)\b.{0,30}\b(udhaar|khata|due|baaki|payment\s*link)\b/i.test(text) ||
      /\b(udhaar|khata)\b.{0,20}\b(remind|reminder|bhejo|send)\b/i.test(text)) {
    return { agentId: "munim-accounts", intent: "khata_reminders", confidence: 0.8, source: "keywords" };
  }

  if (/\b(voucher|coupon|offer|campaign|discount)\b.{0,30}\b(send|bhejo|chalao|run|karo)\b/i.test(text) ||
      /\b(send|bhejo|chalao|run)\b.{0,30}\b(voucher|coupon|offer|campaign)\b/i.test(text)) {
    return { agentId: "priya-sales", intent: "send_vouchers", confidence: 0.8, source: "keywords" };
  }

  if (/\b(order|reorder|khareed|khareedo|manga|purchase|po)\b/i.test(text) && /\b(paneer|stock|maal|samaan|ghee|supplier|dairy|kg|tin)\b/i.test(text)) {
    return { agentId: "vikram-procurement", intent: "create_po", confidence: 0.75, source: "keywords" };
  }

  const scored = scoreAgent(text, addressed);
  if (scored) {
    return { agentId: scored.agent, intent: "query", confidence: Math.min(0.55 + scored.score * 0.1, 0.85), source: "keywords" };
  }

  return {
    agentId: addressed ?? currentAgentId ?? "cortex-orchestrator",
    intent: "query",
    confidence: 0.25,
    source: "fallback",
  };
}

const ROUTER_SYSTEM = `You are Cortex Router — the dispatch brain of an AI back-office for an Indian MSME (Ramesh Sweets & Restaurant) on WhatsApp.
Your only job: pick the ONE AI employee who should answer the merchant's newest message, and name the intent.

EMPLOYEES
- priya-sales (Priya): sales trends, revenue dips, footfall, average bill, discounts, vouchers/coupons, win-back campaigns, regular customers.
- aman-support (Aman): payment verification, UPI/Paytm PG transactions, Soundbox, refunds, customer disputes.
- vikram-procurement (Vikram): stock levels, out-of-stock risk, suppliers, quotes, purchase orders, reorder quantity, batch expiry.
- munim-accounts (Munim): khata/udhaar/credit, who owes money, settlements, reconciliation, GST/GSTR, FSSAI, compliance deadlines.
- meera-staff (Meera): staff attendance, "haazir" check-ins, leave, advances, salary, payroll, payslips.

INTENTS (pick one): query, greeting, check_payment, khata_reminders, create_po, send_vouchers, payroll, attendance_checkin, create_agent, approve_pending, reject_pending.

RULES
- The newest message may be Hinglish, Hindi, Marathi, or English. Judge meaning, not keywords.
- Short follow-ups ("aur kitna?", "uska kya hua?") inherit the topic of the previous turns.
- "haan / ha / ok / bhejo / kardo / approve / send" right after a pending approval = approve_pending.
- "nahi / cancel / mat bhejo / reject" right after a pending approval = reject_pending.
- If the merchant names an employee but asks about another employee's domain, still return the domain owner (the named employee will hand off).
- If it is small talk or the topic is unclear, return the current employee (or cortex-orchestrator when there is none) with intent "query".

Return ONLY a minified JSON object, no markdown:
{"agent":"<id>","intent":"<intent>","confidence":<0-1>,"amount":<number or null>,"reason":"<max 8 words>"}`;

function parseRouteJson(text: string): Record<string, unknown> | undefined {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Sarvam-powered intent + agent routing. Falls back to the deterministic
 * keyword router on timeout, provider error, or malformed JSON — WhatsApp
 * must never go silent because a model hiccupped.
 */
export async function routeInboundMessage(args: RouteArgs): Promise<RouteDecision> {
  const fallback = routeByKeywords(args);
  if (!isLlmEnabled()) return fallback;

  const hints: string[] = [];
  if (args.addressed) hints.push(`The merchant is addressing: ${AGENT_PROFILES[args.addressed].name} (${args.addressed}).`);
  if (args.currentAgentId) hints.push(`Current employee in this chat: ${AGENT_PROFILES[args.currentAgentId].name} (${args.currentAgentId}).`);

  const messages: LlmMessage[] = [
    ...toLlmHistory(args.turns.slice(-6)),
    { role: "user", content: args.text },
  ];

  try {
    const { text: raw } = await getLlmClient().complete({
      system: [ROUTER_SYSTEM, ...hints].join("\n"),
      messages,
      maxTokens: 120,
      temperature: 0,
    });

    const parsed = parseRouteJson(raw);
    if (!parsed) return fallback;

    const agent = isChatAgent(typeof parsed.agent === "string" ? parsed.agent : undefined)
      ? (parsed.agent as ChatAgentId)
      : "cortex-orchestrator";
    const intent = (CHAT_INTENTS as readonly string[]).includes(String(parsed.intent))
      ? (parsed.intent as ChatIntent)
      : "query";
    const confidence = Number(parsed.confidence);
    const amountRaw = Number(parsed.amount);
    const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : fallback.amount;

    return {
      agentId: agent,
      intent,
      ...(amount !== undefined ? { amount } : {}),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.6,
      source: "llm",
      ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    };
  } catch (err) {
    console.error("[router] Sarvam routing failed, using keywords:", (err as Error).message);
    return fallback;
  }
}

/**
 * Spoken by the employee the merchant is currently talking to when the
 * question belongs to someone else. This is the "prompt the responsible
 * agent" behaviour — the handoff is announced in the same WhatsApp message
 * as the answer so the thread reads like a real team.
 */
export function handoffLine(fromId: ChatAgentId, toId: ChatAgentId | "cortex-orchestrator"): string {
  const from = AGENT_PROFILES[fromId];
  const to = agentProfile(toId);
  if (!to) {
    const verb = from.gender === "F" ? "leti" : "leta";
    return `${from.avatar} *${from.name}:* Yeh main hi dekh ${verb} hoon, ek second…`;
  }
  const verb = from.gender === "F" ? "kar rahi hoon" : "kar raha hoon";
  return `${from.avatar} *${from.name}:* Yeh ${to.name} ji ka kaam hai — main aapki baat unse ${verb}. 🔁`;
}
