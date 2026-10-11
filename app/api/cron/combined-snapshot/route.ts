import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTelegramMessage, isTelegramConfigured } from "@/lib/telegram";

// Portfolio value milestone step — notified once each time the TOTAL
// portfolio (stocks + MF + gold) crosses a new multiple of this amount.
const MILESTONE_STEP = 100000; // ₹1,00,000 (1 lakh)

// Run this every 15-30 min. Reads the latest already-computed totals from
// each asset type (doesn't re-fetch live prices itself — that's the job of
// the existing stock/MF/gold refresh crons) and writes one combined row,
// so the dashboard's Portfolio Performance chart can show Current vs
// Invested over time, filterable by asset type.
//   GET https://your-app.vercel.app/api/cron/combined-snapshot?secret=YOUR_CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: latestStockSnap } = await supabaseAdmin
    .from("portfolio_snapshots")
    .select("total_current, total_invested")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: mfHoldings } = await supabaseAdmin
    .from("mf_holdings")
    .select("current_value, invested_amount");

  const { data: goldHoldings } = await supabaseAdmin
    .from("gold_holdings")
    .select("current_value, amount_paid");

  const mfCurrent = (mfHoldings || []).reduce((s, h) => s + (h.current_value ?? h.invested_amount ?? 0), 0);
  const mfInvested = (mfHoldings || []).reduce((s, h) => s + (h.invested_amount ?? 0), 0);
  const goldCurrent = (goldHoldings || []).reduce((s, h) => s + (h.current_value ?? h.amount_paid ?? 0), 0);
  const goldInvested = (goldHoldings || []).reduce((s, h) => s + (h.amount_paid ?? 0), 0);

  const { error } = await supabaseAdmin.from("combined_snapshots").insert({
    stocks_current: latestStockSnap?.total_current ?? 0,
    stocks_invested: latestStockSnap?.total_invested ?? 0,
    mf_current: mfCurrent,
    mf_invested: mfInvested,
    gold_current: goldCurrent,
    gold_invested: goldInvested,
  });

  if (error) {
    return NextResponse.json({ ranAt: new Date().toISOString(), ok: false, error: error.message });
  }

  const totalPortfolio = (latestStockSnap?.total_current ?? 0) + mfCurrent + goldCurrent;

  // Milestone alerts: fire once each time the total crosses UP into a new
  // ₹1L band — tracked per user via last_milestone_notified so it never
  // repeats for the same level and never fires on the way back down.
  let milestoneAlertsSent = 0;
  if (isTelegramConfigured() && totalPortfolio > 0) {
    const currentMilestone = Math.floor(totalPortfolio / MILESTONE_STEP) * MILESTONE_STEP;

    const { data: usersToNotify } = await supabaseAdmin
      .from("users")
      .select("id, telegram_chat_id, last_milestone_notified")
      .not("telegram_chat_id", "is", null);

    for (const u of usersToNotify || []) {
      const lastNotified = Number(u.last_milestone_notified ?? 0);
      if (currentMilestone <= lastNotified || currentMilestone < MILESTONE_STEP) continue;

      try {
        await sendTelegramMessage({
          chatId: u.telegram_chat_id,
          text: `🎉 <b>Portfolio Milestone!</b>\nYour total portfolio (stocks + mutual funds + gold) has crossed ₹${currentMilestone.toLocaleString("en-IN")} — currently ₹${Math.round(totalPortfolio).toLocaleString("en-IN")}.`,
        });
        milestoneAlertsSent++;
      } catch {}

      await supabaseAdmin.from("users").update({ last_milestone_notified: currentMilestone }).eq("id", u.id);
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    ok: true,
    stocksCurrent: latestStockSnap?.total_current ?? 0,
    mfCurrent,
    goldCurrent,
    totalPortfolio,
    milestoneAlertsSent,
  });
}