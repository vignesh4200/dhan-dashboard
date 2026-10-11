import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTelegramMessage, sendTelegramPhoto, isTelegramConfigured } from "@/lib/telegram";
import { tierFor, alertMessage } from "@/lib/alerts";
import { getDividendsForSymbols } from "@/lib/nse-dividends";
import { renderStatCard, renderSummaryCard, inrImg, signImg } from "@/lib/alert-card";
import { runDividendAutoLog } from "@/lib/dividend-auto-log";

// ONE cron job covers every alert type. Run this every 15 min (same cadence
// as the stock refresh) — it only READS data the other crons have already
// written (portfolio_snapshots, gold_rate_history, combined_snapshots), it
// never re-fetches Dhan/IBJA/NSE itself for the fast checks, so running it
// often is cheap. The slow/once-a-day pieces (dividend-declared, daily
// summary) are internally throttled via last_daily_alert_date so they still
// only fire once per day no matter how often this is pinged.
//
// Every alert sends as a rendered PNG card (branded, matches the dashboard's
// own dark theme) with a short caption, uploaded directly to Telegram as
// bytes — not fetched by Telegram from our own domain, which sits behind
// Vercel's SSO protection. If card rendering or the photo upload fails for
// any reason, falls back to the plain HTML text message so an alert is
// never silently dropped.
//   GET https://your-app.vercel.app/api/cron/alerts?secret=YOUR_CRON_SECRET
const MILESTONE_STEP = 100000; // ₹1,00,000 (1 lakh)
const DAILY_ALERT_HOUR_IST = 20; // only run the once-a-day block at/after 8pm IST

async function sendCard(params: { chatId: string; render: () => Promise<Buffer>; caption: string; fallbackText: string }) {
  try {
    const buf = await params.render();
    await sendTelegramPhoto({ chatId: params.chatId, buffer: buf, caption: params.caption });
    return "image";
  } catch (e) {
    await sendTelegramMessage({ chatId: params.chatId, text: params.fallbackText });
    return "text_fallback";
  }
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Manual test hook: ?test=1 forces the once-a-day block (dividend
  // auto-log, daily gold rate, daily summary) to run right now regardless
  // of the 8pm IST gate, WITHOUT marking today as already sent — so
  // tonight's real scheduled run still fires normally. Dividend-declared
  // and profit-booking/gold/milestone alerts are already deduped by their
  // own log tables, so re-running this is always safe to repeat.
  const isTest = req.nextUrl.searchParams.get("test") === "1";

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
  const runDailyBlock = isTest || istHour >= DAILY_ALERT_HOUR_IST;
  const needsDailyRun = isTest || (runDailyBlock && (users || []).some((u) => u.last_daily_alert_date !== todayIst));

  // Dividend auto-log (flips "Upcoming" to "Received" once a record date
  // has passed) used to run inside /api/cron/refresh on every 15-min tick —
  // sequential per-holding NSE fetches there took 30-80s and kept timing
  // out cron-job.org's 30s cap. It only needs daily granularity (14-day
  // lookback window), so it runs here instead, once, alongside the other
  // once-a-day alerts. It loops over all users internally, so it's called
  // once per invocation rather than once per user.
  let dividendAutoLogResults: any[] = [];
  if (needsDailyRun) {
    try {
      dividendAutoLogResults = await runDividendAutoLog();
    } catch (e: any) {
      dividendAutoLogResults = [{ ok: false, error: e.message }];
    }
  }

  const results: any[] = [];

  for (const user of users || []) {
    const chatId = user.telegram_chat_id as string;
    const userResult: any = { user: user.id };

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

        const tierLabel = tier === "sell" ? "Target reached" : "Approaching target";
        await sendCard({
          chatId,
          render: () =>
            renderStatCard({
              eyebrow: "Profit Booking",
              accent: tier === "sell" ? "#34D399" : "#F0B94F",
              icon: tier === "sell" ? "\u{1F3AF}" : "\u{1F440}",
              headline: `${h.symbol} ${tier === "sell" ? "has hit" : "is nearing"} your ${tier === "sell" ? "8%" : "7%"} booking target`,
              bigValue: `${signImg(h.pnlPct)}${Math.abs(h.pnlPct).toFixed(1)}%`,
              bigValueColor: tier === "sell" ? "#34D399" : "#F0B94F",
              rows: [
                { label: "Invested", value: inrImg(h.invested) },
                { label: "Current", value: inrImg(h.current), color: tier === "sell" ? "#34D399" : "#F0B94F" },
              ],
            }),
          caption: `${tier === "sell" ? "🎯" : "👀"} <b>${h.symbol}</b> ${tierLabel}`,
          fallbackText: `${tier === "sell" ? "🎯" : "👀"} <b>${h.symbol}</b> ${alertMessage(tier, h.pnlPct)}`,
        });

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
          const verb = side === "above" ? "risen above" : "dropped below";
          await sendCard({
            chatId,
            render: () =>
              renderStatCard({
                eyebrow: "Gold Alert",
                accent: "#F0B94F",
                icon: side === "above" ? "\u{1F4C8}" : "\u{1F4C9}",
                headline: `IBJA 999 rate has ${verb} your target of ${inrImg(target)}/g`,
                bigValue: `${inrImg(latestGold.rate_999!)}/g`,
                bigValueColor: "#F0B94F",
              }),
            caption: `${side === "above" ? "📈" : "📉"} <b>Gold Alert</b> — ${verb} ₹${target.toLocaleString("en-IN")}/g`,
            fallbackText: `${side === "above" ? "📈" : "📉"} <b>Gold Alert</b>\nIBJA 999 rate has ${verb} your target of ₹${target.toLocaleString("en-IN")}/g — now ₹${latestGold.rate_999.toLocaleString("en-IN")}/g.`,
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
          await sendCard({
            chatId,
            render: () =>
              renderStatCard({
                eyebrow: "Milestone",
                accent: "#6B5CE6",
                icon: "\u{1F389}",
                headline: "Your portfolio has crossed a new milestone",
                bigValue: inrImg(currentMilestone),
                bigValueColor: "#EDEEF5",
                subtext: `Currently ${inrImg(totalPortfolio)}`,
              }),
            caption: `🎉 <b>Portfolio Milestone!</b> Crossed ₹${currentMilestone.toLocaleString("en-IN")}`,
            fallbackText: `🎉 <b>Portfolio Milestone!</b>\nYour total portfolio (stocks + mutual funds + gold) has crossed ₹${currentMilestone.toLocaleString("en-IN")} — currently ₹${Math.round(totalPortfolio).toLocaleString("en-IN")}.`,
          });
          await supabaseAdmin.from("users").update({ last_milestone_notified: currentMilestone }).eq("id", user.id);
          milestoneAlertSent = true;
        }
      }

      // --- 4, 5 & 6. Dividend-declared + daily gold rate + daily summary (once/day, after 8pm IST) ---
      let dividendAlertsSent = 0;
      let goldDailySent = false;
      let summarySent = false;

      if (runDailyBlock && (isTest || user.last_daily_alert_date !== todayIst)) {
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

            await sendCard({
              chatId,
              render: () =>
                renderStatCard({
                  eyebrow: "Dividend Declared",
                  accent: "#34D399",
                  icon: "\u{1F4B0}",
                  headline: `${d.symbol} declared a dividend`,
                  bigValue: d.label,
                  bigValueColor: "#34D399",
                  subtext: `Record date: ${d.date}`,
                }),
              caption: `💰 <b>Dividend Declared — ${d.symbol}</b>`,
              fallbackText: `💰 <b>Dividend Declared — ${d.symbol}</b>\n${d.label}\nRecord date: ${d.date}`,
            });

            await supabaseAdmin.from("alert_log").insert({ user_id: user.id, symbol: d.symbol, tier });
            dividendAlertsSent++;
          }
        }

        // Daily gold rate — independent of the threshold alert, sent every
        // day regardless of whether the user set a target, so they always
        // know where IBJA 999 stands.
        if (latestGold?.rate_999 != null) {
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: dayAgoRow } = await supabaseAdmin
            .from("gold_rate_history")
            .select("rate_999")
            .lte("captured_at", cutoff)
            .order("captured_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const rate = latestGold.rate_999;
          const prevRate = dayAgoRow?.rate_999 ?? null;
          const change = prevRate != null ? rate - prevRate : null;
          const changePct = prevRate != null && prevRate > 0 ? (change! / prevRate) * 100 : null;

          const changeLine =
            change != null
              ? `${signImg(change)}${inrImg(Math.abs(change))}/g (${signImg(changePct!)}${Math.abs(changePct!).toFixed(2)}%) vs yesterday`
              : undefined;
          const changeLineText =
            change != null
              ? `${change >= 0 ? "+" : "−"}₹${Math.abs(change).toLocaleString("en-IN")}/g (${changePct! >= 0 ? "+" : "−"}${Math.abs(changePct!).toFixed(2)}%) vs yesterday`
              : "";

          await sendCard({
            chatId,
            render: () =>
              renderStatCard({
                eyebrow: "Gold Rate",
                accent: "#F0B94F",
                icon: "\u{1FA99}",
                headline: "Today's IBJA 999 gold rate",
                bigValue: `${inrImg(rate)}/g`,
                bigValueColor: "#F0B94F",
                subtext: changeLine,
              }),
            caption: `🪙 <b>Daily Gold Rate</b> — ₹${rate.toLocaleString("en-IN")}/g`,
            fallbackText: `🪙 <b>Daily Gold Rate</b>\nIBJA 999: ₹${rate.toLocaleString("en-IN")}/g${changeLineText ? `\n${changeLineText}` : ""}`,
          });
          goldDailySent = true;
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

          const stocksCurrent = latestCombined?.stocks_current ?? totalCurrent;
          const mfCurrent = latestCombined?.mf_current ?? 0;
          const goldCurrent = latestCombined?.gold_current ?? 0;

          const sign = (n: number) => (n >= 0 ? "+" : "−");
          const inr = (n: number) => "₹" + Math.round(Math.abs(n)).toLocaleString("en-IN");
          const dayEmoji = dayPnl >= 0 ? "🟢" : "🔴";

          const fallbackLines = [
            `📊 <b>Daily Portfolio Summary</b>`,
            ``,
            `Total Value: <b>${inr(totalCurrent)}</b>`,
            `${dayEmoji} Today: ${sign(dayPnl)}${inr(dayPnl)}`,
            `Overall P&amp;L: ${sign(totalPnl)}${inr(totalPnl)} (${sign(totalPnlPct)}${Math.abs(totalPnlPct).toFixed(1)}%)`,
            ``,
            `📦 Stocks: ${inr(stocksCurrent)}`,
            `🏦 Mutual Funds: ${inr(mfCurrent)}`,
            `🪙 Gold: ${inr(goldCurrent)}`,
          ];
          if (best) fallbackLines.push(``, `🏆 Best: <b>${best.symbol}</b> ${sign(best.pnlPct)}${Math.abs(best.pnlPct).toFixed(1)}%`);
          if (worst && worst !== best) fallbackLines.push(`📉 Worst: <b>${worst.symbol}</b> ${sign(worst.pnlPct)}${Math.abs(worst.pnlPct).toFixed(1)}%`);
          if (dividendsThisMonth > 0) fallbackLines.push(``, `💵 Dividends this month: ${inr(dividendsThisMonth)}`);

          await sendCard({
            chatId,
            render: () =>
              renderSummaryCard({
                totalCurrent,
                dayPnl,
                totalPnl,
                totalPnlPct,
                stocksCurrent,
                mfCurrent,
                goldCurrent,
                best: best ? { symbol: best.symbol, pnlPct: best.pnlPct } : undefined,
                worst: worst ? { symbol: worst.symbol, pnlPct: worst.pnlPct } : undefined,
                dividendsThisMonth,
              }),
            caption: `📊 <b>Daily Portfolio Summary</b> — ${inr(totalCurrent)}`,
            fallbackText: fallbackLines.join("\n"),
          });
          summarySent = true;
        }

        if (!isTest) {
          await supabaseAdmin.from("users").update({ last_daily_alert_date: todayIst }).eq("id", user.id);
        }
      }

      userResult.ok = true;
      userResult.profitAlertsSent = profitAlertsSent;
      userResult.goldAlertSent = goldAlertSent;
      userResult.milestoneAlertSent = milestoneAlertSent;
      userResult.dividendAlertsSent = dividendAlertsSent;
      userResult.goldDailySent = goldDailySent;
      userResult.summarySent = summarySent;
      results.push(userResult);
    } catch (e: any) {
      results.push({ user: user.id, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), istHour, runDailyBlock, totalPortfolio, dividendAutoLogResults, results });
}
