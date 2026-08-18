import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDhanHoldings, getLtpFromYahoo, generateAccessTokenViaTotp } from "@/lib/dhan";
import { getSectorsForHoldings } from "@/lib/yahoo-profile";
import { generateTotpCode } from "@/lib/totp";
import { computeHolding, tierFor, alertMessage } from "@/lib/alerts";
import { sendWhatsAppAlert, isWhatsAppConfigured } from "@/lib/whatsapp";

// Called every 15 minutes by an external cron pinger (e.g. cron-job.org) hitting:
//   GET https://your-app.vercel.app/api/cron/refresh?secret=YOUR_CRON_SECRET
//
// Mints a completely FRESH Dhan access token on every single run using
// Client ID + PIN + a live TOTP code — so the token is always brand new and
// never has a chance to expire. Also fetches each holding's real sector via
// Yahoo's assetProfile module and stores it on the snapshot, so the sidebar
// doesn't need a separate slow live fetch on every page load.
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

      await supabaseAdmin.from("portfolio_snapshots").insert({
        user_id: user.id,
        holdings: computed,
        total_invested: totalInvested,
        total_current: totalCurrent,
        total_pnl: totalPnl,
        day_pnl: dayPnl,
      });

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

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
