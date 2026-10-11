import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTelegramMessage, isTelegramConfigured } from "@/lib/telegram";
import { getDividendsForSymbols } from "@/lib/nse-dividends";

// Run this ONCE A DAY (e.g. 8pm IST, after market close):
//   GET https://your-app.vercel.app/api/cron/daily-alerts?secret=YOUR_CRON_SECRET
//
// Two things:
//   1. Dividend-declared alerts — checks currently-held symbols against NSE
//      for newly-declared dividends (not yet seen before), via the same
//      lookup the Dividends page already uses.
//   2. A single end-of-day portfolio summary message — value, day's P&L,
//      overall P&L, stocks/MF/gold split, best & worst performer, and
//      dividends received this month.
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
    .select("id, telegram_chat_id")
    .not("telegram_chat_id", "is", null);

  const results: any[] = [];

  for (const user of users || []) {
    const chatId = user.telegram_chat_id as string;
    const userResult: any = { user: user.id };

    try {
      const { data: latestSnap } = await supabaseAdmin
        .from("portfolio_snapshots")
        .select("holdings, total_invested, total_current, total_pnl, day_pnl, captured_at")
        .eq("user_id", user.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestSnap) {
        userResult.ok = true;
        userResult.note = "No portfolio snapshot yet";
        results.push(userResult);
        continue;
      }

      const holdings: any[] = latestSnap.holdings || [];

      // --- 1. Dividend-declared alerts ---
      let dividendAlertsSent = 0;
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

          try {
            await sendTelegramMessage({
              chatId,
              text: `💰 <b>Dividend Declared — ${d.symbol}</b>\n${d.label}\nRecord date: ${d.date}`,
            });
            dividendAlertsSent++;
          } catch {}

          await supabaseAdmin.from("alert_log").insert({
            user_id: user.id,
            symbol: d.symbol,
            tier,
          });
        }
      }

      // --- 2. Daily portfolio summary ---
      const { data: combined } = await supabaseAdmin
        .from("combined_snapshots")
        .select("stocks_current, mf_current, gold_current, captured_at")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const totalInvested = Number(latestSnap.total_invested ?? 0);
      const totalCurrent = Number(latestSnap.total_current ?? 0);
      const totalPnl = Number(latestSnap.total_pnl ?? 0);
      const dayPnl = Number(latestSnap.day_pnl ?? 0);
      const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

      const sorted = [...holdings].filter((h) => typeof h.pnlPct === "number").sort((a, b) => b.pnlPct - a.pnlPct);
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
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
        `📦 Stocks: ${inr(combined?.stocks_current ?? totalCurrent)}`,
        `🏦 Mutual Funds: ${inr(combined?.mf_current ?? 0)}`,
        `🪙 Gold: ${inr(combined?.gold_current ?? 0)}`,
      ];

      if (best) lines.push(``, `🏆 Best: <b>${best.symbol}</b> ${sign(best.pnlPct)}${Math.abs(best.pnlPct).toFixed(1)}%`);
      if (worst && worst !== best) lines.push(`📉 Worst: <b>${worst.symbol}</b> ${sign(worst.pnlPct)}${Math.abs(worst.pnlPct).toFixed(1)}%`);
      if (dividendsThisMonth > 0) lines.push(``, `💵 Dividends this month: ${inr(dividendsThisMonth)}`);

      await sendTelegramMessage({ chatId, text: lines.join("\n") });

      userResult.ok = true;
      userResult.dividendAlertsSent = dividendAlertsSent;
      userResult.summarySent = true;
      results.push(userResult);
    } catch (e: any) {
      userResult.ok = false;
      userResult.error = e.message;
      results.push(userResult);
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
