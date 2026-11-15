import { randomUUID } from "node:crypto";
import { generateBaselineWithDip, paytmPgMock, mockUtr } from "@cortex/connectors";
import type { CortexDb } from "./client.js";
import { schema } from "./client.js";

export const DEMO_STORE_ID = "store-ramesh";

function id(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function daysAhead(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Seeds 7 days of realistic WhatsApp chat history between the merchant
 * and AI employees, demonstrating agent handoffs, voice messages,
 * approvals, and natural Hinglish conversations.
 */
async function seedWeekChatHistory(db: CortexDb, storeId: string): Promise<void> {
  const ownerPhone = "+91 9876543210";
  const threadId = ownerPhone;
  const channel = "WHATSAPP";

  async function insertTurn(
    role: "USER" | "AGENT",
    content: string,
    daysAgo: number,
    hoursAgo: number,
    agentId?: string,
    agentName?: string,
  ) {
    const at = new Date();
    at.setDate(at.getDate() - daysAgo);
    at.setHours(at.getHours() - hoursAgo);
    at.setMinutes(Math.floor(Math.random() * 60));

    await db.insert(schema.chatMessages).values({
      id: id("chat"),
      storeId,
      channel,
      threadId,
      role,
      agentId,
      agentName,
      content,
      createdAt: at,
    });
  }

  await insertTurn("USER", "Namaste! Cortex setup kaise karna hai?", 7, 9);
  await insertTurn("AGENT", "Namaste Ramesh ji! 🙏 Cortex back-office is live.\n\nTalk to any AI employee, in English, Hindi or Hinglish:\n• 🛡️ *Aman* — \"Check ₹350 payment\" / \"koi dispute?\"\n• 📒 *Munim* — \"Kitna udhaar baaki hai?\" / \"Send reminders\"\n• 📦 *Vikram* — \"Stock status\" / \"Order paneer\"\n• 🎯 *Priya* — \"Sales report\" / \"Send vouchers\"\n• 👷 *Meera* — \"Staff attendance\" / \"Haazir\" / \"Pay salary\"\n\nYou can also just ask normally — I'll route it to the right employee, and they'll hand off to a colleague if the question belongs to someone else.", 7, 9, "cortex-orchestrator", "Cortex Assistant");

  await insertTurn("USER", "Priya, kal sales kaise the?", 7, 2);
  await insertTurn("AGENT", "🎯 *Priya (Sales & Win-back)*\n\nKal (Monday) total sales: ₹18,420 — baseline se 12% upar. Peak 1-3 PM (₹4,200) aur 7-9 PM (₹3,800). Butter Paneer stockout nahi hua tha kal, toh evening dip avoid hua. 28 regulars me se 22 aaye the.\n\nChaho toh main 10% win-back voucher campaign stage kar dun for the 6 regulars jo miss hue?", 7, 2, "priya-sales", "Priya");

  await insertTurn("USER", "Haan bhejo", 7, 1);
  await insertTurn("AGENT", "🤖 *Cortex Assistant*\n\n✅ Approved and executed: *VOUCHER_CAMPAIGN* (dec-cmp-44).\n• Vouchers sent: 6\n• Projected recovery: ₹1,200\n\n🔊 *Soundbox:* Paytm par 6 regular customers ko recovery offer bhej diya gaya hai!", 7, 1, "cortex-orchestrator", "Cortex Assistant");

  await insertTurn("USER", "Aman, check ₹500 payment", 6, 8);
  await insertTurn("AGENT", "🛡️ *Aman (Support & UPI Disputes)*\n\n✅ *Payment Verified — ₹500*\n• Paytm Txn: TXN-9021-95\n• UTR: UTR-99120345\n• Soundbox: edge override announced at the counter\n\nCustomer ko bhejne ke liye koi dispute slip ki zaroorat nahi hai.", 6, 8, "aman-support", "Aman");

  await insertTurn("USER", "Munim ji, udhaar kitna baaki hai aaj?", 6, 4);
  await insertTurn("AGENT", "📒 *Munim (Accounts & Khata)*\n\nAaj ka khata snapshot:\n• Gupta Caterers: ₹8,400 (22 din purana)\n• Verma Ji: ₹5,600 (17 din purana)\n• Rana Tent House: ₹4,600 (19 din purana)\n• Total outstanding: ₹18,600\n\n3 customers ka udhaar ₹5,000 se zyada aur 15+ din purana hai. Reminder batch with UPI links stage kar dun?", 6, 4, "munim-accounts", "Munim");

  await insertTurn("USER", "Haan bhejo reminders", 6, 3);
  await insertTurn("AGENT", "🤖 *Cortex Assistant*\n\n✅ Approved and executed: *KHATA_REMINDER_BATCH* (dec-khata-12).\n• Reminders sent: 3\n• Outstanding covered: ₹18,600\n\nQuiet hours respected — messages will go after 10:00 AM.", 6, 3, "cortex-orchestrator", "Cortex Assistant");

  await insertTurn("USER", "Vikram, paneer stock kaise hai?", 5, 10);
  await insertTurn("AGENT", "📦 *Vikram (Stock & Procurement)*\n\nButter Paneer: 11 kg haath mein (daily velocity 12 kg/day) — cover ~0.9 din. Reorder level 15 kg cross kiya.\nGhee: 2 tin (velocity 40/day) — CRITICAL, cover 0.05 din.\nKaju Katli: 6 kg (expiry 4 din mein)\nMilk: 40 l (expiry 2 din mein)\n\nPaneer ke liye RFQ bhej dun 3 suppliers ko?", 5, 10, "vikram-procurement", "Vikram");

  await insertTurn("USER", "Haan RFQ bhejo", 5, 9);
  await insertTurn("AGENT", "📦 *Vikram (Stock & Procurement)*\n\nRFQ sent to 3 suppliers for *Butter Paneer* (11 kg left, ~0.9d cover).\nBest quote draft PO stage ho gaya hai.\n\n• Guardrail: PO ≤ ₹10,000 and ≤ last price +8%\n• Reply *\"haan bhejo\"* to place the order, or open the card to compare quotes.", 5, 9, "vikram-procurement", "Vikram");

  await insertTurn("USER", "[Voice note: \"Vikram ji, paneer ka best quote kya aaya?\"]", 5, 2);
  await insertTurn("AGENT", "📦 *Vikram (Stock & Procurement)*\n\n3 quotes aaye hain Butter Paneer (12 kg) ke liye:\n• Sharma Dairy: ₹310/kg — Tomorrow 7 AM — ✅ SELECTED\n• Fresh Farms: ₹325/kg — Tomorrow 9 AM\n• City Wholesale: ₹340/kg — Today 10 PM\n\nTotal: ₹3,720 (last price ₹305 → +1.6%, guardrail PASSED).\n\nReply *\"haan bhejo\"* to confirm PO with Sharma Dairy.", 5, 2, "vikram-procurement", "Vikram");

  await insertTurn("USER", "Haan bhejo PO", 5, 1);
  await insertTurn("AGENT", "🤖 *Cortex Assistant*\n\n✅ Approved and executed: *PURCHASE_ORDER* (dec-po-07).\n• PO: PO-07\n• Supplier: Sharma Dairy\n• Total: ₹3,720\n\n🔊 *Soundbox:* Paytm par Sharma Dairy ko paneer ka order bhej diya gaya hai!", 5, 1, "cortex-orchestrator", "Cortex Assistant");

  await insertTurn("USER", "Meera, staff attendance kaisa hai?", 4, 8);
  await insertTurn("AGENT", "👷 *Meera (Staff & Payroll Desk)*\n\nAaj ka attendance (Thursday):\n• Raju (Helper): ABSENT — no check-in by 9:00 AM\n• Sunita (Cook): PRESENT — 08:52 AM\n• Imran (Counter): LATE — 09:12 AM\n• Priyanka (Helper): PRESENT — 08:45 AM\n• Deepak (Cook): PRESENT — 08:50 AM\n• Anita (Counter): PRESENT — 08:55 AM\n\n5/6 present. Raju ka advance balance ₹2,000 hai.", 4, 8, "meera-staff", "Meera");

  await insertTurn("USER", "Raju kal bhi absent tha. Uska salary kitna katega?", 4, 5);
  await insertTurn("AGENT", "👷 *Meera (Staff & Payroll Desk)*\n\nRaju ka monthly salary: ₹12,000. Advance balance: ₹2,000.\n\nCompany policy: 1 unpaid leave = 1 day salary deduction (₹400/day approx).\nKal + aaj = 2 days absent → ₹800 deduction.\nNet payable this month: ₹12,000 - ₹800 - ₹2,000 (advance) = ₹9,200.\n\nChaho toh main payday payout card stage kar dun sabke liye?", 4, 5, "meera-staff", "Meera");

  await insertTurn("USER", "Priya, weekend ke liye koi offer?", 3, 11);
  await insertTurn("AGENT", "🎯 *Priya (Sales & Win-back)*\n\nWeekend (Fri-Sat) baseline: ₹22,000/day. Aaj Friday hai — ab tak ₹8,500 (11 AM).\n\nLast weekend Butter Paneer stockout se ₹4,800 ka dip aaya tha. Ab stock replenished hai.\n\nRecommendation: \"Weekend Special\" 10% off on Paneer dishes — 28 regulars ko voucher bhej dete hain? Margin 45% - 10% = 35% net (floor 30% se upar).", 3, 11, "priya-sales", "Priya");

  await insertTurn("USER", "Theek hai, weekend voucher bhejo", 3, 10);
  await insertTurn("AGENT", "🤖 *Cortex Assistant*\n\n✅ Approved and executed: *VOUCHER_CAMPAIGN* (dec-cmp-45).\n• Vouchers sent: 28\n• Projected recovery: ₹4,200\n\n🔊 *Soundbox:* Paytm par 28 regular customers ko weekend special offer bhej diya gaya hai!", 3, 10, "cortex-orchestrator", "Cortex Assistant");

  await insertTurn("USER", "Aman, ek customer bola payment nahi aaya ₹1200 ka", 2, 14);
  await insertTurn("AGENT", "🛡️ *Aman (Support & UPI Disputes)*\n\n⚠️ *Payment In-Process — ₹1,200*\n• Ticket: *#PTM-47*\n• Bank PG settlement pending (auto-clears within 2 hours)\n• Customer receipt drafted on WhatsApp\n\nClosest recent: ₹1,150 (TXN-9021-98, UTR-99120388) — confirm if this is the one?", 2, 14, "aman-support", "Aman");

  await insertTurn("USER", "Nahi wo alag tha. Check karo", 2, 13);
  await insertTurn("AGENT", "🛡️ *Aman (Support & UPI Disputes)*\n\nTicket #PTM-47 open hai. Main PG ledger monitor kar raha hoon — jaise hi ₹1,200 ka transaction SUCCESS hota hai, Soundbox pe announce kar dunga aur aapko update dunga.\n\nAbhi tak koi ₹1,200 ka match nahi mila last 5 min mein.", 2, 13, "aman-support", "Aman");

  await insertTurn("USER", "[Voice note: \"Munim ji, Gupta Caterers ne ₹3000 bheja hai, check karo\"]", 2, 10);
  await insertTurn("AGENT", "📒 *Munim (Accounts & Khata)*\n\nGupta Caterers ka udhaar: ₹8,400 tha.\n₹3,000 payment receive hua → Balance ab ₹5,400.\n\nKhata updated. Ab wo ₹5,000 threshold ke neeche aa gaye hain, toh reminder batch se nikal jayenge.\n\nChaho toh main unko \"thank you\" message bhej dun?", 2, 10, "munim-accounts", "Munim");

  await insertTurn("USER", "Vikram, ghee ka stock critical hai. Kya hua order ka?", 1, 9);
  await insertTurn("AGENT", "📦 *Vikram (Stock & Procurement)*\n\nGhee (tin): 2 tin reh gaye, daily velocity 40 tin/day — CRITICAL.\n\nRFQ bheja tha 3 suppliers ko. Quotes:\n• Sharma Dairy: ₹305/tin (last price) — 50 tin — ₹15,250 — EXCEEDS ₹10,000 cap\n• Fresh Farms: ₹315/tin — 50 tin — ₹15,750 — EXCEEDS CAP\n• City Wholesale: ₹320/tin — 50 tin — ₹16,000 — EXCEEDS CAP\n\nGuardrail BLOCKED: PO total ₹10,000 cap. Need manual review for large order.\n\nOption: Split into 2 POs of ₹10,000 each (32 tins each), ya owner approval for exception?", 1, 9, "vikram-procurement", "Vikram");

  await insertTurn("USER", "Split karo 2 PO mein", 1, 8);
  await insertTurn("AGENT", "📦 *Vikram (Stock & Procurement)*\n\nSplit POs staged:\n• PO-08A: Sharma Dairy — 32 tins @ ₹305 = ₹9,760 (Guardrail PASSED)\n• PO-08B: Sharma Dairy — 18 tins @ ₹305 = ₹5,490 (Guardrail PASSED)\n\nReply *\"haan bhejo\"* for both POs.", 1, 8, "vikram-procurement", "Vikram");

  await insertTurn("USER", "Haan dono bhejo", 1, 7);
  await insertTurn("AGENT", "🤖 *Cortex Assistant*\n\n✅ Approved and executed: *PURCHASE_ORDER* (dec-po-08a).\n• PO: PO-08A\n• Supplier: Sharma Dairy\n• Total: ₹9,760\n\n✅ Approved and executed: *PURCHASE_ORDER* (dec-po-08b).\n• PO: PO-08B\n• Supplier: Sharma Dairy\n• Total: ₹5,490\n\n🔊 *Soundbox:* Paytm par Sharma Dairy ko ghee ke 2 purchase orders bhej diye gaye hain!", 1, 7, "cortex-orchestrator", "Cortex Assistant");

  await insertTurn("USER", "Namaste! Aaj ka kya plan hai?", 0, 2);
  await insertTurn("AGENT", "Namaste Ramesh ji! 🙏 Aaj (Sunday) ka snapshot:\n\n• 🎯 Priya: Weekend voucher campaign live — 12 redemptions ab tak (₹3,200 attributed)\n• 🛡️ Aman: PG queue clean — last check 5 min ago\n• 📦 Vikram: Paneer PO delivered (Sharma Dairy 7 AM). Ghee PO-08A/08B placed.\n• 📒 Munim: Khata reminders sent 3 din pehle — ₹3,000 recovered from Gupta Caterers\n• 👷 Meera: 5/6 staff present. Raju absent. Payday 1 Oct — ₹84,500 estimated.\n• 💊 Expiry Sentinel: Kaju Katli (4 din), Milk (2 din) — alerts active\n\nKya specific check karna hai?", 0, 2, "cortex-orchestrator", "Cortex Assistant");

  await insertTurn("USER", "Meera, payday ke liye payout card ready rakho", 0, 1);
  await insertTurn("AGENT", "👷 *Meera (Staff & Payroll Desk)*\n\nPayday (1 Oct) payout staged:\n• 6 staff net payable: ₹84,500\n• Advances deducted: ₹4,000\n• Payout ceiling guardrail: PASSED\n\nRaju: ₹9,200 (2 days absent deduction + advance)\nSunita: ₹18,000\nImran: ₹13,667 (1 late day)\nPriyanka: ₹13,000\nDeepak: ₹14,833 (1 late day)\nAnita: ₹13,500\n\nReply *\"haan bhejo\"* to pay all — each worker gets Hindi voice payslip.", 0, 1, "meera-staff", "Meera");
}

/**
 * Seeds 7 days of sales data with realistic daily patterns:
 * - Weekday baseline ~₹18-22k
 * - Weekend baseline ~₹25-30k
 * - Evening peak 7-9 PM
 * - Historical dip events for Priya's context
 */
async function seedWeekSalesData(db: CortexDb, storeId: string): Promise<void> {
  const baseWeekday = 4210;
  const baseWeekend = 5200;

  for (let day = 6; day >= 0; day--) {
    const date = new Date();
    date.setDate(date.getDate() - day);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const baseline = isWeekend ? baseWeekend : baseWeekday;

    for (let hour = 8; hour <= 23; hour++) {
      const hourDate = new Date(date);
      hourDate.setHours(hour, 0, 0, 0);

      let multiplier = 1.0;
      if (hour >= 8 && hour <= 11) multiplier = 0.8;
      if (hour >= 12 && hour <= 15) multiplier = 1.3;
      if (hour >= 16 && hour <= 17) multiplier = 0.7;
      if (hour >= 18 && hour <= 21) multiplier = 1.5;
      if (hour >= 22 && hour <= 23) multiplier = 0.6;

      if (isWeekend) multiplier *= 1.2;

      if (day === 6 && hour >= 18 && hour <= 20) {
        multiplier *= 0.62;
      }

      if (day === 3 && hour >= 18 && hour <= 20) {
        multiplier *= 0.85;
      }

      const amount = Math.round(baseline * multiplier * (0.9 + Math.random() * 0.2));
      const qty = Math.max(1, Math.round(amount / 280));

      await db.insert(schema.sales).values({
        id: id("sale"),
        storeId,
        sku: "MIXED",
        qty,
        amount,
        hourBucket: hourDate,
      });
    }
  }
}

/**
 * Seeds additional PG transactions for the past 7 days so Aman's
 * "check payment" lookups have realistic history.
 */
async function seedWeekPgTransactions(db: CortexDb, storeId: string): Promise<void> {
  const amounts = [150, 280, 350, 420, 500, 650, 780, 920, 1200, 1500, 2100];
  const payers = ["rahul@paytm", "sunita@paytm", "amit@paytm", "priya@paytm", "vikram@paytm", "neha@paytm", "raj@paytm", "anjali@paytm"];

  for (let day = 6; day >= 0; day--) {
    const date = new Date();
    date.setDate(date.getDate() - day);

    const txnCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < txnCount; i++) {
      const hour = 9 + Math.floor(Math.random() * 12);
      const minute = Math.floor(Math.random() * 60);
      const txnTime = new Date(date);
      txnTime.setHours(hour, minute, 0, 0);

      const amountIdx = Math.floor(Math.random() * amounts.length);
      const payerIdx = Math.floor(Math.random() * payers.length);
      const amount = amounts[amountIdx] ?? 500;
      const payer = payers[payerIdx] ?? "test@paytm";
      const status = Math.random() > 0.1 ? "SUCCESS" : "PENDING";

      paytmPgMock.seed({
        txn_id: `TXN-${date.toISOString().slice(0, 10).replace(/-/g, "")}-${i + 1}`,
        amount,
        timestamp: txnTime,
        status,
        utr: `UTR-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        payer,
        soundboxLag: Math.random() > 0.7,
        soundboxAnnounced: status === "SUCCESS" && Math.random() > 0.3,
      });
    }
  }
}

/**
 * Seeds inventory movements for the week: stock received, sold, expiring batches.
 */
async function seedWeekInventoryMovements(db: CortexDb, storeId: string): Promise<void> {
  await db.insert(schema.inventory).values([
    {
      id: id("inv"),
      storeId,
      sku: "Besan (kg)",
      unit: "kg",
      qtyOnHand: 15,
      dailyVelocity: 3,
      reorderLevel: 10,
      lastPrice: 85,
      grossMarginPct: 35,
      outOfStockAt: null,
      restockedAt: null,
      expiryDate: daysAhead(5),
    },
    {
      id: id("inv"),
      storeId,
      sku: "Sugar (kg)",
      unit: "kg",
      qtyOnHand: 50,
      dailyVelocity: 8,
      reorderLevel: 20,
      lastPrice: 42,
      grossMarginPct: 18,
      outOfStockAt: null,
      restockedAt: null,
      expiryDate: daysAhead(180),
    },
    {
      id: id("inv"),
      storeId,
      sku: "Cardamom (100g)",
      unit: "pkt",
      qtyOnHand: 8,
      dailyVelocity: 1,
      reorderLevel: 5,
      lastPrice: 180,
      grossMarginPct: 45,
      outOfStockAt: null,
      restockedAt: null,
      expiryDate: daysAhead(3),
    },
  ]);
}

/**
 * Seeds 7 days of staff attendance records.
 */
async function seedWeekAttendance(db: CortexDb, storeId: string): Promise<void> {
  const workers = [
    { id: "wkr-01", name: "Raju", checkIn: "08:50 AM", lateProb: 0.3, absentProb: 0.2 },
    { id: "wkr-02", name: "Sunita", checkIn: "08:45 AM", lateProb: 0.05, absentProb: 0.02 },
    { id: "wkr-03", name: "Imran", checkIn: "09:00 AM", lateProb: 0.4, absentProb: 0.05 },
    { id: "wkr-04", name: "Priyanka", checkIn: "08:40 AM", lateProb: 0.02, absentProb: 0.02 },
    { id: "wkr-05", name: "Deepak", checkIn: "08:55 AM", lateProb: 0.3, absentProb: 0.05 },
    { id: "wkr-06", name: "Anita", checkIn: "08:50 AM", lateProb: 0.1, absentProb: 0.02 },
  ];

  for (let day = 6; day >= 0; day--) {
    const dateStr = new Date();
    dateStr.setDate(dateStr.getDate() - day);
    const dateKey = dateStr.toISOString().slice(0, 10);
    const isSunday = dateStr.getDay() === 0;

    for (const w of workers) {
      let status: "PRESENT" | "LATE" | "ABSENT" = "PRESENT";
      let checkIn: string | null = w.checkIn;
      let checkOut: string | null = isSunday ? null : "06:30 PM";

      if (isSunday) {
        if (Math.random() < 0.5) {
          status = "ABSENT";
          checkIn = null;
          checkOut = null;
        }
      } else {
        const r = Math.random();
        if (r < w.absentProb) {
          status = "ABSENT";
          checkIn = null;
          checkOut = null;
        } else if (r < w.absentProb + w.lateProb) {
          status = "LATE";
          const match = w.checkIn.match(/(\d+):(\d+)/);
          const h = match && match[1] ? parseInt(match[1], 10) : 8;
          const m = match && match[2] ? parseInt(match[2], 10) : 50;
          const lateMin = 10 + Math.floor(Math.random() * 20);
          const totalMin = h * 60 + m + lateMin;
          checkIn = `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")} AM`;
        }
      }

      await db.insert(schema.attendance).values({
        id: id("att"),
        storeId,
        workerId: w.id,
        date: dateKey,
        checkIn,
        checkOut,
        status,
      });
    }
  }
}

/**
 * Seeds khata payments received during the week.
 */
async function seedWeekKhataPayments(db: CortexDb, storeId: string): Promise<void> {
  await db.insert(schema.khataEntries).values({
    id: id("khata"),
    storeId,
    customerId: "cus-17",
    type: "PAYMENT",
    amount: 3000,
    note: "Part payment via UPI",
    status: "RECEIVED",
    createdAt: daysAgo(2),
  });

  await db.insert(schema.khataEntries).values({
    id: id("khata"),
    storeId,
    customerId: "cus-09",
    type: "PAYMENT",
    amount: 2000,
    note: "Cash payment",
    status: "RECEIVED",
    createdAt: daysAgo(4),
  });

  await db.insert(schema.khataEntries).values({
    id: id("khata"),
    storeId,
    customerId: "cus-22",
    type: "PAYMENT",
    amount: 1500,
    note: "UPI payment",
    status: "RECEIVED",
    createdAt: daysAgo(5),
  });
}

/** Deletes every row for the demo store — used by POST /api/demo/reset
 * before reseeding, so the wire format never depends on `TRUNCATE`
 * semantics that might differ between real Postgres and PGlite. */
export async function clearDemoStore(db: CortexDb, storeId = DEMO_STORE_ID): Promise<void> {
  const { eq } = await import("drizzle-orm");
  await db.delete(schema.stores).where(eq(schema.stores.id, storeId));

  const tables = [
    schema.agents,
    schema.routines,
    schema.tasks,
    schema.decisions,
    schema.activityEvents,
    schema.costEvents,
    schema.channelBindings,
    schema.chatMessages,
    schema.customers,
    schema.sales,
    schema.inventory,
    schema.suppliers,
    schema.purchaseOrders,
    schema.khataEntries,
    schema.settlements,
    schema.complianceItems,
    schema.staff,
    schema.attendance,
    schema.payroll,
    schema.disputeResolutions,
  ];
  for (const table of tables) {
    await db.delete(table).where(eq(table.storeId, storeId));
  }
  paytmPgMock.reset();
}

export async function seedDemoStore(db: CortexDb, storeId = DEMO_STORE_ID): Promise<void> {
  const whatsappStatus = "SIMULATOR";
  const telegramStatus = process.env.TELEGRAM_BOT_TOKEN ? "CONNECTED" : "SIMULATOR";

  await db.insert(schema.stores).values({
    id: storeId,
    name: "Ramesh Sweets & Restaurant",
    gstin: "07AAAAA0000A1Z5",
    soundboxStatus: "ONLINE",
    soundboxBattery: 88,
    soundboxEdgeOverride: true,
    whatsappStatus,
    telegramStatus,
  });

  await db.insert(schema.agents).values([
    { id: "priya-sales", storeId, name: "Priya", role: "Sales & Win-back", avatar: "🎯", status: "MONITORING", metricLabel: "Recovered Revenue", metricValue: "₹14,800 (Wk)", isCustom: false },
    { id: "aman-support", storeId, name: "Aman", role: "Customer Support & UPI Disputes", avatar: "🛡️", status: "READY", metricLabel: "Disputes Resolved", metricValue: "18 UPI Holds", isCustom: false },
    { id: "vikram-procurement", storeId, name: "Vikram", role: "Stock & Procurement", avatar: "📦", status: "PO_PENDING", metricLabel: "Low Stock SKUs", metricValue: "2 SKUs", isCustom: false },
    { id: "munim-accounts", storeId, name: "Munim", role: "Accounts, Khata & GST", avatar: "📒", status: "RECONCILED", metricLabel: "Udhaar Recovered", metricValue: "₹9,200 (Mo)", isCustom: false },
    { id: "meera-staff", storeId, name: "Meera", role: "Staff & Payroll Desk", avatar: "👷", status: "ACTIVE", metricLabel: "Present Today", metricValue: "5 / 6 Staff", isCustom: false },
    { id: "custom-expiry", storeId, name: "Expiry Sentinel", role: "Batch Shelf-Life Auditor", avatar: "💊", status: "ACTIVE", metricLabel: "Monitored SKUs", metricValue: "420 SKUs", isCustom: true },
  ]);

  const buckets = generateBaselineWithDip({
    baselineHourlyAmount: 4210,
    dipHours: [18, 19, 20],
    dipFactor: 0.62,
    days: 30,
  });
  await db.insert(schema.sales).values(
    buckets.map((b: { hourBucket: Date; qty: number; amount: number }) => ({
      id: id("sale"),
      storeId,
      sku: "MIXED",
      qty: b.qty,
      amount: b.amount,
      hourBucket: b.hourBucket,
    })),
  );

  const stockoutAt = new Date();
  stockoutAt.setUTCDate(stockoutAt.getUTCDate() - 1);
  stockoutAt.setUTCHours(12, 15, 0, 0);
  const restockedAt = new Date();
  restockedAt.setUTCHours(7, 0, 0, 0);

  await db.insert(schema.inventory).values([
    {
      id: id("inv"),
      storeId,
      sku: "Butter Paneer",
      unit: "kg",
      qtyOnHand: 11,
      dailyVelocity: 12,
      reorderLevel: 15,
      lastPrice: 305,
      grossMarginPct: 45,
      outOfStockAt: stockoutAt,
      restockedAt,
      expiryDate: daysAhead(20),
    },
    {
      id: id("inv"),
      storeId,
      sku: "Ghee (tin)",
      unit: "tin",
      qtyOnHand: 2,
      dailyVelocity: 40,
      reorderLevel: 50,
      lastPrice: 305,
      grossMarginPct: 20,
      outOfStockAt: null,
      restockedAt: null,
      expiryDate: daysAhead(8),
    },
    {
      id: id("inv"),
      storeId,
      sku: "Kaju Katli",
      unit: "kg",
      qtyOnHand: 6,
      dailyVelocity: 2,
      reorderLevel: 5,
      lastPrice: 480,
      grossMarginPct: 55,
      outOfStockAt: null,
      restockedAt: null,
      expiryDate: daysAhead(4),
    },
    {
      id: id("inv"),
      storeId,
      sku: "Milk (l)",
      unit: "l",
      qtyOnHand: 40,
      dailyVelocity: 30,
      reorderLevel: 25,
      lastPrice: 52,
      grossMarginPct: 28,
      outOfStockAt: null,
      restockedAt: null,
      expiryDate: daysAhead(2),
    },
  ]);

  const regulars = Array.from({ length: 28 }, (_, i) => ({
    id: id("cus"),
    storeId,
    name: `Regular Customer ${i + 1}`,
    phone: `+91 90000${String(10000 + i).slice(-5)}`,
    isRegular: 1,
  }));

  const khataCustomers = [
    { id: "cus-17", name: "Gupta Caterers", phone: "+91 98xxxxxx21", balance: 8400, oldestDueDays: 22 },
    { id: "cus-09", name: "Verma Ji", phone: "+91 97xxxxxx08", balance: 5600, oldestDueDays: 17 },
    { id: "cus-22", name: "Rana Tent House", phone: "+91 99xxxxxx45", balance: 4600, oldestDueDays: 19 },
  ];

  await db.insert(schema.customers).values([
    ...regulars,
    ...khataCustomers.map((c) => ({ id: c.id, storeId, name: c.name, phone: c.phone, isRegular: 0 })),
  ]);

  await db.insert(schema.khataEntries).values(
    khataCustomers.map((c) => ({
      id: id("khata"),
      storeId,
      customerId: c.id,
      type: "CREDIT",
      amount: c.balance,
      note: "Opening balance",
      status: "REMINDER_DRAFTED",
      createdAt: daysAgo(c.oldestDueDays),
    })),
  );

  await db.insert(schema.suppliers).values([
    { id: "sup-sharma", storeId, name: "Sharma Dairy", phone: "+91 90000-11111" },
    { id: "sup-fresh", storeId, name: "Fresh Farms", phone: "+91 90000-22222" },
    { id: "sup-city", storeId, name: "City Wholesale", phone: "+91 90000-33333" },
  ]);

  await db.insert(schema.settlements).values({
    id: id("settle"),
    storeId,
    date: new Date().toISOString().slice(0, 10),
    posSalesTotal: 21480,
    pgSettledTotal: 20860,
    cashTotal: 3200,
    mismatches: [{ txn_id: "TXN-9021-91", amount: 620, reason: "SETTLEMENT_PENDING", action: "Flagged to Aman" }],
  });

  await db.insert(schema.complianceItems).values([
    { id: "cmp-gstr1-sep", storeId, title: "GSTR-1 (September)", authority: "GST", dueDate: "2026-10-11", status: "DRAFT_READY" },
    { id: "cmp-fssai", storeId, title: "FSSAI Licence Renewal", authority: "FSSAI", dueDate: "2026-11-30", status: "UPCOMING" },
  ]);

  await db.insert(schema.staff).values([
    { id: "wkr-01", storeId, name: "Raju", role: "Helper", phone: "+91 90000-44441", monthlySalary: 12000, advanceBalance: 2000 },
    { id: "wkr-02", storeId, name: "Sunita", role: "Cook", phone: "+91 90000-44442", monthlySalary: 18000, advanceBalance: 0 },
    { id: "wkr-03", storeId, name: "Imran", role: "Counter", phone: "+91 90000-44443", monthlySalary: 14000, advanceBalance: 1500 },
    { id: "wkr-04", storeId, name: "Priyanka", role: "Helper", phone: "+91 90000-44444", monthlySalary: 13000, advanceBalance: 0 },
    { id: "wkr-05", storeId, name: "Deepak", role: "Cook", phone: "+91 90000-44445", monthlySalary: 15000, advanceBalance: 500 },
    { id: "wkr-06", storeId, name: "Anita", role: "Counter", phone: "+91 90000-44446", monthlySalary: 13500, advanceBalance: 0 },
  ]);

  const today = new Date().toISOString().slice(0, 10);
  await db.insert(schema.attendance).values([
    { id: id("att"), storeId, workerId: "wkr-01", date: today, checkIn: null, checkOut: null, status: "ABSENT" },
    { id: id("att"), storeId, workerId: "wkr-02", date: today, checkIn: "08:52 AM", checkOut: null, status: "PRESENT" },
    { id: id("att"), storeId, workerId: "wkr-03", date: today, checkIn: "09:12 AM", checkOut: null, status: "LATE" },
    { id: id("att"), storeId, workerId: "wkr-04", date: today, checkIn: "08:45 AM", checkOut: null, status: "PRESENT" },
    { id: id("att"), storeId, workerId: "wkr-05", date: today, checkIn: "08:50 AM", checkOut: null, status: "PRESENT" },
    { id: id("att"), storeId, workerId: "wkr-06", date: today, checkIn: "08:55 AM", checkOut: null, status: "PRESENT" },
  ]);

  paytmPgMock.seed({
    txn_id: "TXN-9021-88",
    amount: 350,
    timestamp: new Date(),
    status: "SUCCESS",
    utr: mockUtr(),
    payer: "rahul@paytm",
    soundboxLag: true,
    soundboxAnnounced: false,
  });
  await db.insert(schema.disputeResolutions).values(
    Array.from({ length: 18 }, (_, i) => ({
      id: id("disp"),
      storeId,
      txnId: `TXN-HIST-${i}`,
      amount: 200 + i * 25,
      resolvedAt: daysAgo(i + 1),
    })),
  );

  paytmPgMock.seed({
    txn_id: "TXN-9021-90",
    amount: 500,
    timestamp: new Date(),
    status: "PENDING",
    utr: mockUtr(),
    payer: "sunita@paytm",
    soundboxLag: false,
    soundboxAnnounced: false,
  });

  await seedWeekChatHistory(db, storeId);
  await seedWeekSalesData(db, storeId);
  await seedWeekPgTransactions(db, storeId);
  await seedWeekInventoryMovements(db, storeId);
  await seedWeekAttendance(db, storeId);
  await seedWeekKhataPayments(db, storeId);
}