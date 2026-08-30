import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchIbjaRates, rateForPurity } from "@/lib/gold-price";

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

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    ok: true,
    rates,
    updated,
    skipped,
    diag,
  });
}
