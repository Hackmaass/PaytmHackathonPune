import { and, eq } from "drizzle-orm";
import type { CortexDb } from "@cortex/db";
import { schema } from "@cortex/db";
import {
  appendActivityEvent,
  combineGuardrails,
  checkPriceVarianceCap,
  checkTotalCap,
  registerDecisionExecutor,
  registerInboundTextHandler,
  stageDecision,
  startRun,
  addSubTask,
  completeTask,
  makeId,
  isoDate,
  setAgentMetric,
} from "@cortex/runtime";
import { getSupplierQuotes } from "@cortex/connectors";
import { getActiveWhatsAppChannel } from "@cortex/channels";
import type { SupplierQuote } from "@cortex/shared";
import { POLICY } from "../policy.js";

export const AGENT_ID = "vikram-procurement";
const AGENT_NAME = "Vikram";
const AGENT_AVATAR = "📦";
const COVER_DAYS_THRESHOLD = 1;
/** Days of stock a reorder should leave on the shelf (lead time + review). */
const TARGET_COVER_DAYS = 2;

interface ReorderOutcome {
  sku: string;
  qty: number;
  blocked: boolean;
  total: number;
  supplier?: string;
  unitPrice?: number;
  guardrail: string;
  /** Units that would still fit the daily PO cap — the blocked-path escape hatch. */
  capFitsUnits?: number;
}

export async function run(db: CortexDb, storeId: string): Promise<{ runId: string }> {
  const { runId, taskId } = await startRun(db, { storeId, agentId: AGENT_ID, label: "Stock cover & reorder scan" });
  void execute(db, storeId, runId, taskId).catch((err) => {
    console.error(`[vikram] stock scan failed for run ${runId}:`, err);
  });
  return { runId };
}

async function execute(db: CortexDb, storeId: string, runId: string, taskId: string): Promise<void> {
  const items = await db.select().from(schema.inventory).where(eq(schema.inventory.storeId, storeId));
  const lowStock = items.filter((i) => i.dailyVelocity > 0 && i.qtyOnHand / i.dailyVelocity < COVER_DAYS_THRESHOLD);

  await setAgentMetric(db, storeId, AGENT_ID, "Low Stock SKUs", `${lowStock.length} SKU${lowStock.length === 1 ? "" : "s"}`);

  if (lowStock.length === 0) {
    await completeTask(db, taskId, "DONE");
    return;
  }

  for (const item of lowStock) {
    await reorderSku(db, storeId, runId, taskId, item);
  }

  await completeTask(db, taskId, "DONE");
}

/**
 * Reorder quantity restores ~`TARGET_COVER_DAYS` of cover (never below the
 * SKU's own reorder level) instead of a flat "1 day of sales" — a 1-day
 * order means ordering again tomorrow, which is how small shops end up
 * paying delivery twice.
 */
function reorderQtyFor(item: typeof schema.inventory.$inferSelect): number {
  const target = Math.max(item.reorderLevel, item.dailyVelocity * TARGET_COVER_DAYS);
  return Math.max(1, Math.ceil(target - item.qtyOnHand));
}

async function reorderSku(
  db: CortexDb,
  storeId: string,
  runId: string,
  parentTaskId: string,
  item: typeof schema.inventory.$inferSelect,
  qtyOverride?: number,
): Promise<ReorderOutcome> {
  const coverDays = item.qtyOnHand / item.dailyVelocity;
  const reorderQty = qtyOverride ?? reorderQtyFor(item);

  const subTaskId = await addSubTask(db, { storeId, agentId: AGENT_ID, runId, parentTaskId, label: `Reorder ${item.sku}` });
  await appendActivityEvent(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentAvatar: AGENT_AVATAR,
    message: qtyOverride
      ? `Merchant-requested order: ${item.sku} × ${reorderQty} ${item.unit}. Requesting quotes from 3 suppliers.`
      : `${item.sku} cover < ${COVER_DAYS_THRESHOLD} day (${coverDays.toFixed(2)}d). Requesting quotes from 3 suppliers for ${reorderQty} ${item.unit} (${TARGET_COVER_DAYS}-day cover).`,
    type: "ANOMALY_DETECTED",
    severity: "WARNING",
  });

  const quotes = getSupplierQuotes(item.lastPrice);
  const selected = quotes.find((q) => q.selected) ?? quotes[0]!;
  const total = Math.round(selected.unit_price * reorderQty);

  const guardrail = combineGuardrails([
    checkPriceVarianceCap({ quotedPrice: selected.unit_price, lastPrice: item.lastPrice, maxVariancePct: POLICY.PRICE_VARIANCE_CAP_PCT }),
    checkTotalCap({ totalRupees: total, capRupees: POLICY.PROCUREMENT_TOTAL_CAP }),
  ]);

  const capFitsUnits = Math.floor(POLICY.PROCUREMENT_TOTAL_CAP / selected.unit_price);
  const result: ReorderOutcome = {
    sku: item.sku,
    qty: reorderQty,
    blocked: !guardrail.passed,
    total,
    supplier: selected.supplier,
    unitPrice: selected.unit_price,
    guardrail: guardrail.summary,
    capFitsUnits,
  };

  await appendActivityEvent(db, {
    storeId,
    agentId: AGENT_ID,
    agentName: "Guardrail",
    agentAvatar: "🛡️",
    message: `${item.sku} — best of 3 supplier quotes: ${selected.supplier} ₹${selected.unit_price}/${item.unit} × ${reorderQty} ${item.unit} = ₹${total}. ${guardrail.summary}.${
      guardrail.passed ? "" : ` Only ${capFitsUnits} ${item.unit} fit the ₹${POLICY.PROCUREMENT_TOTAL_CAP} PO cap — order a partial quantity to proceed.`
    }`,
    type: guardrail.passed ? "GUARDRAIL_PASSED" : "GUARDRAIL_BLOCKED",
    severity: guardrail.passed ? "SUCCESS" : "CRITICAL",
  });

  if (!guardrail.passed) {
    await completeTask(db, subTaskId, "FAILED");
    return result;
  }

  const decisionId = makeId("dec");
  const poId = makeId("PO");
  await db.insert(schema.purchaseOrders).values({
    id: poId,
    storeId,
    decisionId,
    sku: item.sku,
    qty: reorderQty,
    status: "AWAITING_APPROVAL",
    quotes,
    total,
    lastPrice: item.lastPrice,
    guardrailNote: guardrail.summary,
  });

  const coverAfter = (item.qtyOnHand + reorderQty) / item.dailyVelocity;
  await stageDecision(db, {
    id: decisionId,
    storeId,
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentAvatar: AGENT_AVATAR,
    kind: "PURCHASE_ORDER",
    payload: { poId, sku: item.sku, qty: reorderQty, unit: item.unit, total, supplier: selected.supplier, quotes },
    message: `${item.sku} cover < ${COVER_DAYS_THRESHOLD} day. Best rate: ${selected.supplier} ₹${selected.unit_price}/${item.unit} × ${reorderQty} ${item.unit} = ₹${total}. PO bhej du? (${coverAfter.toFixed(1)} days cover after delivery)`,
    idempotencyKey: `po:${storeId}:${item.sku}:${isoDate()}`,
  });

  await completeTask(db, subTaskId, "DONE");
  return result;
}

/**
 * "order paneer 20" / "order ghee 30 tins" — an explicit quantity from the
 * merchant overrides the forecast. Requires a number, so plain "order paneer"
 * still falls through to the orchestrator's conversational answer.
 */
const ORDER_COMMAND = /^\s*(?:order|kharido|manga)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(kg|kgs|tin|tins|l|ltr|litre|litres|pcs|piece|pieces)?\s*$/i;

registerInboundTextHandler(async ({ db, storeId, identityId, text }) => {
  const match = ORDER_COMMAND.exec(text);
  if (!match) return { handled: false };
  const wanted = match[1]!.toLowerCase().trim();
  const qty = Number(match[2]);

  const items = await db.select().from(schema.inventory).where(eq(schema.inventory.storeId, storeId));
  const item =
    items.find((i) => i.sku.toLowerCase() === wanted) ??
    items.find((i) => i.sku.toLowerCase().includes(wanted) || wanted.includes(i.sku.toLowerCase()));

  if (!item || !Number.isFinite(qty) || qty <= 0) {
    const available = items.map((i) => i.sku).join(", ");
    await reply(storeId, identityId, `📦 Vikram: "${match[1]}" SKU nahi mila. Available: ${available}.`);
    return { handled: true, routedTo: AGENT_ID };
  }

  const { runId, taskId } = await startRun(db, { storeId, agentId: AGENT_ID, label: `Manual order ${item.sku} × ${qty}` });
  const outcome = await reorderSku(db, storeId, runId, taskId, item, Math.ceil(qty));
  await completeTask(db, taskId, "DONE");

  const replyText = outcome.blocked
    ? `📦 Vikram: ${outcome.qty} ${item.unit} ${item.sku} ka order ₹${outcome.total} — PO cap se zyada (${outcome.guardrail}). Sirf ${outcome.capFitsUnits} ${item.unit} fit hote hain, "order ${item.sku.toLowerCase()} ${outcome.capFitsUnits}" bhejein.`
    : `📦 Vikram: ${outcome.qty} ${item.unit} ${item.sku} @ ₹${outcome.unitPrice}/${item.unit} = ₹${outcome.total}, ${outcome.supplier} se. Approval card bhej diya — approve karke PO send karein.`;
  await reply(storeId, identityId, replyText);
  return { handled: true, routedTo: AGENT_ID, replyText };
});

async function reply(storeId: string, identityId: string, text: string): Promise<void> {
  try {
    await getActiveWhatsAppChannel().sendText({ storeId, toIdentityId: identityId, text });
  } catch (err) {
    console.error(`[vikram] reply delivery failed for ${identityId}:`, err);
  }
}

registerDecisionExecutor("PURCHASE_ORDER", async ({ db, storeId, decisionId, payload }) => {
  const poId = payload.poId as string;
  const sku = payload.sku as string;
  const qty = payload.qty as number;
  const total = payload.total as number;
  const supplier = payload.supplier as string;
  const quotes = payload.quotes as SupplierQuote[];

  await db
    .update(schema.purchaseOrders)
    .set({ status: "EXECUTED", quotes, supplierId: supplier })
    .where(eq(schema.purchaseOrders.decisionId, decisionId));

  const [item] = await db
    .select()
    .from(schema.inventory)
    .where(and(eq(schema.inventory.storeId, storeId), eq(schema.inventory.sku, sku)));
  if (item) {
    await db
      .update(schema.inventory)
      .set({ qtyOnHand: item.qtyOnHand + qty, lastPrice: quotes.find((q) => q.selected)?.unit_price ?? item.lastPrice })
      .where(eq(schema.inventory.id, item.id));
  }

  // getSupplierQuotes is a deterministic mock independent of the seeded
  // `suppliers` table (AGENTS.md §P5) — resolve a real phone by name match
  // when one exists; otherwise fall through to the name itself, which
  // resolves fine against the simulator and fails safely (caught below)
  // against a live channel.
  const [supplierRow] = await db.select().from(schema.suppliers).where(and(eq(schema.suppliers.storeId, storeId), eq(schema.suppliers.name, supplier)));
  try {
    await getActiveWhatsAppChannel().sendText({
      storeId,
      toIdentityId: supplierRow?.phone ?? supplier,
      text: `✅ PO confirmed: ${qty} ${sku} @ ₹${total}. Please deliver as quoted.`,
    });
  } catch (err) {
    console.error(`[vikram] PO confirmation delivery failed for ${supplier}:`, err);
  }

  return {
    result: { po_id: poId, supplier, total },
    soundboxTriggered: false,
  };
});
