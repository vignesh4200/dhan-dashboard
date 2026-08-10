import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret } from "@/lib/crypto";
import { getDhanHoldings, getLtpForHoldings } from "@/lib/dhan";
import { computeHolding, tierFor, alertMessage } from "@/lib/alerts";
import { sendWhatsAppAlert, isWhatsAppConfigured } from "@/lib/whatsapp";

// Called every 15 minutes by an external cron pinger (e.g. cron-job.org) hitting:
//   GET https://your-app.vercel.app/api/cron/refresh?secret=YOUR_CRON_SECRET
// during market hours. Protect it with CRON_SECRET so nobody else can trigger it.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: users } = await supabaseAdmin
    .from("users")
    .select("id, phone, whatsapp_number, dhan_credentials(dhan_client_id, access_token_encrypted)");

  const results: any[] = [];

  for (const user of users || []) {
    const creds = (user as any).dhan_credentials;
    if (!creds) continue;

    try {
      const accessToken = decryptSecret(creds.access_token_encrypted);
      const rawHoldings = await getDhanHoldings(creds.dhan_client_id, accessToken);
      if (rawHoldings.length === 0) continue;

      const ltpMap = await getLtpForHoldings(creds.dhan_client_id, accessToken, rawHoldings);

      const computed = rawHoldings.map((h) =>
        computeHolding(h.tradingSymbol, h.totalQty, h.avgCostPrice, ltpMap[h.securityId] ?? h.avgCostPrice)
      );

      const totalInvested = computed.reduce((s, h) => s + h.invested, 0);
      const totalCurrent = computed.reduce((s, h) => s + h.current, 0);
      const totalPnl = totalCurrent - totalInvested;

      // Compare against the previous snapshot to get day P&L (approximation:
      // change since the last stored snapshot, refined by seeding a proper
      // "previous close" value if you want exact day P&L instead).
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

      // Profit-booking alerts — only attempted if WhatsApp is configured.
      // Until then, the dashboard still shows these alerts, they just aren't
      // pushed to your phone.
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
          if (already) continue; // already alerted today for this stock/tier

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
