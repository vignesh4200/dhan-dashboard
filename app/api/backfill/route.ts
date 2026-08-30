import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchGoldBeesHistory } from "@/lib/goldbees-history";

// ONE-TIME backfill — run this once (not on a schedule) to populate ~19
// years of real INR gold price history from GOLDBEES (NSE-traded, tracks
// domestic gold price directly, not an international approximation).
// After this runs once, the twice-daily IBJA refresh (a separate cron)
// keeps building on top of it with more precise recent data.
//   GET https://your-app.vercel.app/api/gold/backfill?secret=YOUR_CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const points = await fetchGoldBeesHistory();
  if (points.length === 0) {
    return NextResponse.json({ ok: false, message: "Could not fetch GOLDBEES history — check network/endpoint." });
  }

  // Insert in batches to keep each request reasonably sized.
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize).map((p) => ({
      rate_22k: p.rate22kPerGram,
      rate_999: null,
      rate_20k: null,
      rate_18k: null,
      rate_14k: null,
      ibja_date: null,
      captured_at: p.date,
      source: "goldbees_backfill",
    }));
    const { error } = await supabaseAdmin.from("gold_rate_history").insert(batch);
    if (!error) inserted += batch.length;
  }

  return NextResponse.json({
    ok: true,
    totalPointsFetched: points.length,
    inserted,
    earliestDate: points[0]?.date,
    latestDate: points[points.length - 1]?.date,
  });
}
