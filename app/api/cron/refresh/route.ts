import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDhanHoldings, getLtpFromYahoo, generateAccessTokenViaTotp } from "@/lib/dhan";
import { getSectorsForHoldings } from "@/lib/yahoo-profile";
import { generateTotpCode } from "@/lib/totp";
import { computeHolding, tierFor, alertMessage } from "@/lib/alerts";
import { sendWhatsAppAlert, isWhatsAppConfigured } from "@/lib/whatsapp";
import { runDividendAutoLog } from "@/lib/dividend-auto-log";

// Called every 15 minutes by an external cron pinger (e.g. cron-job.org) hitting:
//   GET https://your-app.vercel.app/api/cron/refresh?secret=YOUR_CRON_SECRET
//
// Mints a completely FRESH Dhan access token on every single run using
// Client ID + PIN + a live TOTP code — so the token is always brand new and
// never has a chance to expire. Also fetches each holding's real sector via
// Yahoo's assetProfile module and stores it on the snapshot, so the sidebar
// doesn't need a separate slow live fetch on every page load.
//
// ISIN is now also passed through onto each stored holding (confirmed
// Sept 2026: it was missing before, which silently broke the dividend
// reconstruction cron's ISIN-to-symbol mapping — every run reported "No
// ISINs on holdings yet" since there was nothing to map from).
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: users } = await supabaseAdmin
    .from("users")
    .select("id, phone, whatsapp_number, dhan_credentials(dhan_client_id, dhan_pin_encrypted, totp_secret_encrypted)");

  const results: any[] = [];

  for (const user of users || []) {
    const creds = (user as any).dhan_credentials;
    if (!creds || !creds.dhan_pin_encrypted || !creds.totp_secret_encrypted) continue;

    try {
      const pin = decryptSecret(creds.dhan_pin_encrypted);
      const totpSecret = decryptSecret(creds.totp_secret_encrypted);
      const code = generateTotpCode(totpSecret);

      const minted = await generateAccessTokenViaTotp(creds.dhan_client_id, pin, code);
      if ("error" in minted) {
        results.push({ user: user.id, ok: false, reason: "TOTP token generation failed: " + minted.error });
        continue;
      }
      const accessToken = minted.accessToken;

      // Cache it for on-demand routes (orders/trades) to reuse.
      await supabaseAdmin
        .from("dhan_credentials")
        .update({ access_token_encrypted: encryptSecret(accessToken), updated_at: new Date().toISOString() })
        .eq("user_id", user.id);

      const rawHoldings = await getDhanHoldings(creds.dhan_client_id, accessToken);
      if (rawHoldings.length === 0) continue;

      const ltpMap = await getLtpFromYahoo(rawHoldings);
      const sectorMap = await getSectorsForHoldings(rawHoldings.map((h) => h.tradingSymbol));

      const computed = rawHoldings.map((h) => ({
        ...computeHolding(h.tradingSymbol, h.totalQty, h.avgCostPrice, ltpMap[h.tradingSymbol] ?? h.avgCostPrice),
        sector: sectorMap[h.tradingSymbol] || "Other",
        isin: h.isin,
      }));

      const totalInvested = computed.reduce((s, h) => s + h.invested, 0);
      const totalCurrent = computed.reduce((s, h) => s + h.current, 0);
      const totalPnl = totalCurrent - totalInvested;

      const { data: prevSnap } = await supabaseAdmin
        .from("portfolio_snapshots")
        .select("total_current")
        .eq("user_id", user.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .single();

      const dayPnl = prevSnap ? totalCurrent - prevSnap.total_current : 0;

      const { error: snapInsertError } = await supabaseAdmin.from("portfolio_snapshots").insert({
        user_id: user.id,
        holdings: computed,
        total_invested: totalInvested,
        total_current: totalCurrent,
        total_pnl: totalPnl,
        day_pnl: dayPnl,
      });

      if (snapInsertError) {
        results.push({ user: user.id, ok: false, reason: "Snapshot insert failed: " + snapInsertError.message });
        continue;
      }

      const whatsappReady = isWhatsAppConfigured();
      const toNumber = user.whatsapp_number || user.phone;
      let alertsSent = 0;

      if (whatsappReady) {
        for (const h of computed) {
          const tier = tierFor(h.pnlPct);
          if (!tier || !toNumber) continue;

          const { data: already } = await supabaseAdmin
            .from("alert_log")
            .select("id")
            .eq("user_id", user.id)
            .eq("symbol", h.symbol)
            .eq("tier", tier)
            .eq("alert_date", new Date().toISOString().slice(0, 10))
            .maybeSingle();

          if (already) continue;

          await sendWhatsAppAlert({
            toPhoneE164: toNumber,
            symbol: h.symbol,
            pnlPct: h.pnlPct,
            message: alertMessage(tier, h.pnlPct),
          });

          await supabaseAdmin.from("alert_log").insert({
            user_id: user.id,
            symbol: h.symbol,
            tier,
            pnl_pct: h.pnlPct,
          });

          alertsSent++;
        }
      }

      results.push({
        user: user.id,
        holdings: computed.length,
        whatsappConfigured: whatsappReady,
        alertsSent,
        ok: true,
      });
    } catch (e: any) {
      results.push({ user: user.id, ok: false, error: e.message });
    }
  }

  // Refresh Smart Signals' current prices too, reusing this same 15-minute
  // pinger instead of setting up a separate schedule. Prices are the same
  // for every user, so this runs once per invocation (not once per user
  // like the loop above).
  let signalsRefreshed = 0;
  try {
    const { data: signalRows } = await supabaseAdmin
      .from("smart_money_signals")
      .select("id, symbol")
      .not("symbol", "is", null);

    const symbols = Array.from(new Set((signalRows || []).map((r) => r.symbol as string)));
    const priceMap: Record<string, number> = {};

    await Promise.all(
      symbols.map(async (sym) => {
        try {
          const res = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1d`,
            { headers: { "User-Agent": "Mozilla/5.0" } }
          );
          if (!res.ok) return;
          const data = await res.json();
          const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (typeof price === "number") priceMap[sym] = price;
        } catch {}
      })
    );

    for (const row of signalRows || []) {
      const price = row.symbol ? priceMap[row.symbol] : undefined;
      if (price == null) continue;
      await supabaseAdmin
        .from("smart_money_signals")
        .update({ current_price: price, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      signalsRefreshed++;
    }
  } catch (e: any) {
    results.push({ signalsRefresh: false, error: e.message });
  }

  // Flip dividends from "Upcoming" to "Received" once their record date has
  // passed. This used to live only behind the separate /api/cron/dividend-
  // auto-log route, which nothing was ever scheduled to call — so
  // dividends never got logged no matter how long past their record date.
  // Reusing this 15-minute pinger (rather than a fourth cron-job.org job)
  // keeps it running automatically.
  let dividendAutoLogResults: any[] = [];
  try {
    dividendAutoLogResults = await runDividendAutoLog();
  } catch (e: any) {
    results.push({ dividendAutoLog: false, error: e.message });
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results, signalsRefreshed, dividendAutoLogResults });
}