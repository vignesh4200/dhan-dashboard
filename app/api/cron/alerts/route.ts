import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTelegramMessage, sendTelegramAlert, isTelegramConfigured } from "@/lib/telegram";
import { tierFor, alertMessage } from "@/lib/alerts";
import { getDividendsForSymbols } from "@/lib/nse-dividends";

// ONE cron job covers every alert type. Run this every 15 min (same cadence
// as the stock refresh) — it only READS data the other crons have already
// written (portfolio_snapshots, gold_rate_history, combined_snapshots), it
// never re-fetches Dhan/IBJA/NSE itself for the fast checks, so running it
// often is cheap. The slow/once-a-day pieces (dividend-declared, daily
// summary) are internally throttled via last_daily_alert_date so they still
// only fire once per day no matter how often this is pinged.
//   GET https://your-app.vercel.app/api/cron/alerts?secret=YOUR_CRON_SECRET
const MILESTONE_STEP = 100000; // ₹1,00,000 (1 lakh)
const DAILY_ALERT_HOUR_IST = 20; // only run the once-a-day block at/after 8pm IST

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isTelegramConfigured()) {
    return NextResponse.json({ ranAt: new Date().toISOString(), ok: false, reason: "Telegram not configured" });
  }

  const { data: users } = await supabaseAdmin
    .from("users")
    .select("id, telegram_chat_id, gold_alert_target, gold_alert_last_side, last_milestone_notified, last_daily_alert_date")
    .not("telegram_chat_id", "is", null);

  const { data: latestGold } = await supabaseAdmin
    .from("gold_rate_history")
    .select("rate_999")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: latestCombined } = await supabaseAdmin
    .from("combined_snapshots")
    .select("stocks_current, mf_current, gold_current, captured_at")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const totalPortfolio =
    (latestCombined?.stocks_current ?? 0) + (latestCombined?.mf_current ?? 0) + (latestCombined?.gold_current ?? 0);

  const istHour = Number(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false })
  );
  const todayIst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
  const runDailyBlock = istHour >= DAILY_ALERT_HOUR_IST;

  const results: any[] = [];

  for (const user of users || []) {
    const chatId = user.telegram_chat_id as string;
    const userResult: any = { user: user.id, chatId: true };

    try {
      // --- 1. Profit-booking alerts (7% / 8%) ---
      const { data: latestSnap } = await supabaseAdmin
        .from("portfolio_snapshots")
        .select("holdings, total_invested, total_current, total_pnl, day_pnl")
        .eq("user_id", user.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const holdings: any[] = latestSnap?.holdings || [];
      let profitAlertsSent = 0;

      for (const h of holdings) {
        const tier = tierFor(h.pnlPct);
        if (!tier) continue;

        const { data: already } = await supabaseAdmin
          .from("alert_log")
          .select("id")
          .eq("user_id", user.id)
          .eq("symbol", h.symbol)
          .eq("tier", tier)
          .eq("alert_date", todayIst)
          .maybeSingle();
        if (already) continue;

        await sendTelegramAlert({ chatId, symbol: h.symbol, pnlPct: h.pnlPct, message: alertMessage(tier, h.pnlPct) });
        await supabaseAdmin.from("alert_log").insert({ user_id: user.id, symbol: h.symbol, tier, pnl_pct: h.pnlPct });
        profitAlertsSent++;
      }

      // --- 2. Gold rate threshold ---
      let goldAlertSent = false;
      if (user.gold_alert_target != null && latestGold?.rate_999 != null) {
        const target = Number(user.gold_alert_target);
        const side: "above" | "below" = latestGold.rate_999 >= target ? "above" : "below";
        const crossed = user.gold_alert_last_side && user.gold_alert_last_side !== side;

        if (crossed) {
          const arrow = side === "above" ? "📈" : "📉";
          const verb = side === "above" ? "risen above" : "dropped below";
          await sendTelegramMessage({
            chatId,
            text: `${arrow} <b>Gold Alert</b>\nIBJA 999 rate has ${verb} your target of ₹${target.toLocaleString("en-IN")}/g — now ₹${latestGold.rate_999.toLocaleString("en-IN")}/g.`,
          });
          goldAlertSent = true;
        }
        if (side !== user.gold_alert_last_side) {
          await supabaseAdmin.from("users").update({ gold_alert_last_side: side }).eq("id", user.id);
        }
      }

      // --- 3. Portfolio milestone ---
      let milestoneAlertSent = false;
      if (totalPortfolio >= MILESTONE_STEP) {
        const currentMilestone = Math.floor(totalPortfolio / MILESTONE_STEP) * MILESTONE_STEP;
        const lastNotified = Number(user.last_milestone_notified ?? 0);
        if (currentMilestone > lastNotified) {
          await sendTelegramMessage({
            chatId,
            text: `🎉 <b>Portfolio Milestone!</b>\nYour total portfolio (stocks + mutual funds + gold) has crossed ₹${currentMilestone.toLocaleString("en-IN")} — currently ₹${Math.round(totalPortfolio).toLocaleString("en-IN")}.`,
          });
          await supabaseAdmin.from("users").update({ last_milestone_notified: currentMilestone }).eq("id", user.id);
          milestoneAlertSent = true;
        }
      }

      // --- 4 & 5. Dividend-declared + daily summary (once/day, after 8pm IST) ---
      let dividendAlertsSent = 0;
      let summarySent = false;

      if (runDailyBlock && user.last_daily_alert_date !== todayIst) {
        if (holdings.length > 0) {
          const symbols = Array.from(new Set(holdings.map((h) => h.symbol)));
          const dividends = await getDividendsForSymbols(symbols);

          for (const d of dividends) {
            const tier = `div|${d.date}|${d.label}`.slice(0, 120);
            const { data: already } = await supabaseAdmin
              .from("alert_log")
              .select("id")
              .eq("user_id", user.id)
              .eq("symbol", d.symbol)
              .eq("tier", tier)
              .maybeSingle();
            if (already) continue;

            await sendTelegramMessage({
              chatId,
              text: `💰 <b>Dividend Declared — ${d.symbol}</b>\n${d.label}\nRecord date: ${d.date}`,
            });
            await supabaseAdmin.from("alert_log").insert({ user_id: user.id, symbol: d.symbol, tier });
            dividendAlertsSent++;
          }
        }

        if (latestSnap) {
          const totalInvested = Number(latestSnap.total_invested ?? 0);
          const totalCurrent = Number(latestSnap.total_current ?? 0);
          const totalPnl = Number(latestSnap.total_pnl ?? 0);
          const dayPnl = Number(latestSnap.day_pnl ?? 0);
          const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

          const sorted = [...holdings].filter((h) => typeof h.pnlPct === "number").sort((a, b) => b.pnlPct - a.pnlPct);
          const best = sorted[0];
          const worst = sorted[sorted.length - 1];

          const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
          const { data: divThisMonth } = await supabaseAdmin
            .from("dividend_received")
            .select("amount")
            .eq("user_id", user.id)
            .gte("record_date", monthStart);
          const dividendsThisMonth = (divThisMonth || []).reduce((s, r) => s + Number(r.amount), 0);

          const sign = (n: number) => (n >= 0 ? "+" : "−");
          const inr = (n: number) => "₹" + Math.round(Math.abs(n)).toLocaleString("en-IN");
          const dayEmoji = dayPnl >= 0 ? "🟢" : "🔴";

          const lines = [
            `📊 <b>Daily Portfolio Summary</b>`,
            ``,
            `Total Value: <b>${inr(totalCurrent)}</b>`,
            `${dayEmoji} Today: ${sign(dayPnl)}${inr(dayPnl)}`,
            `Overall P&amp;L: ${sign(totalPnl)}${inr(totalPnl)} (${sign(totalPnlPct)}${Math.abs(totalPnlPct).toFixed(1)}%)`,
            ``,
            `📦 Stocks: ${inr(latestCombined?.stocks_current ?? totalCurrent)}`,
            `🏦 Mutual Funds: ${inr(latestCombined?.mf_current ?? 0)}`,
            `🪙 Gold: ${inr(latestCombined?.gold_current ?? 0)}`,
          ];
          if (best) lines.push(``, `🏆 Best: <b>${best.symbol}</b> ${sign(best.pnlPct)}${Math.abs(best.pnlPct).toFixed(1)}%`);
          if (worst && worst !== best) lines.push(`📉 Worst: <b>${worst.symbol}</b> ${sign(worst.pnlPct)}${Math.abs(worst.pnlPct).toFixed(1)}%`);
          if (dividendsThisMonth > 0) lines.push(``, `💵 Dividends this month: ${inr(dividendsThisMonth)}`);

          await sendTelegramMessage({ chatId, text: lines.join("\n") });
          summarySent = true;
        }

        await supabaseAdmin.from("users").update({ last_daily_alert_date: todayIst }).eq("id", user.id);
      }

      results.push({
        user: user.id,
        ok: true,
        profitAlertsSent,
        goldAlertSent,
        milestoneAlertSent,
        dividendAlertsSent,
        summarySent,
      });
    } catch (e: any) {
      results.push({ user: user.id, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), istHour, runDailyBlock, totalPortfolio, results });
}
