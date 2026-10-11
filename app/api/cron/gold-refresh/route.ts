import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchIbjaRates, rateForPurity } from "@/lib/gold-price";
import { sendTelegramMessage, isTelegramConfigured } from "@/lib/telegram";

// Run this TWICE A DAY (matching IBJA's AM/PM publish schedule):
//   GET https://your-app.vercel.app/api/cron/gold-refresh?secret=YOUR_CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { rates, diag } = await fetchIbjaRates();
  if (!rates) {
    return NextResponse.json({ ranAt: new Date().toISOString(), ok: false, diag });
  }

  await supabaseAdmin.from("gold_rate_history").insert({
    rate_999: rates.rate999,
    rate_22k: rates.rate22k,
    rate_20k: rates.rate20k,
    rate_18k: rates.rate18k,
    rate_14k: rates.rate14k,
    ibja_date: rates.ibjaDate,
  });

  const { data: holdings } = await supabaseAdmin.from("gold_holdings").select("id, weight_grams, purity");

  let updated = 0;
  let skipped = 0;

  for (const h of holdings || []) {
    const rate = rateForPurity(rates, h.purity);
    if (rate === null) { skipped++; continue; }

    await supabaseAdmin
      .from("gold_holdings")
      .update({
        current_rate_per_gram: rate,
        current_value: h.weight_grams * rate,
        rate_updated_at: new Date().toISOString(),
      })
      .eq("id", h.id);
    updated++;
  }

  // Gold rate threshold alerts: each user can set a target 999 rate per
  // gram in Settings. We track which "side" of the target the rate was on
  // last time (gold_alert_last_side: "above"/"below") and fire a Telegram
  // alert only when it actually CROSSES — not on every run it happens to
  // stay on the same side, and not repeatedly once past it.
  let goldAlertsSent = 0;
  if (isTelegramConfigured() && rates.rate999 != null) {
    const { data: usersWithTarget } = await supabaseAdmin
      .from("users")
      .select("id, telegram_chat_id, gold_alert_target, gold_alert_last_side")
      .not("gold_alert_target", "is", null)
      .not("telegram_chat_id", "is", null);

    for (const u of usersWithTarget || []) {
      const target = Number(u.gold_alert_target);
      const side: "above" | "below" = rates.rate999 >= target ? "above" : "below";
      const crossed = u.gold_alert_last_side && u.gold_alert_last_side !== side;

      if (crossed && u.telegram_chat_id) {
        const arrow = side === "above" ? "📈" : "📉";
        const verb = side === "above" ? "risen above" : "dropped below";
        try {
          await sendTelegramMessage({
            chatId: u.telegram_chat_id,
            text: `${arrow} <b>Gold Alert</b>\nIBJA 999 rate has ${verb} your target of ₹${target.toLocaleString("en-IN")}/g — now ₹${rates.rate999.toLocaleString("en-IN")}/g.`,
          });
          goldAlertsSent++;
        } catch {}
      }

      if (side !== u.gold_alert_last_side) {
        await supabaseAdmin.from("users").update({ gold_alert_last_side: side }).eq("id", u.id);
      }
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    ok: true,
    rates,
    updated,
    skipped,
    goldAlertsSent,
    diag,
  });
}
