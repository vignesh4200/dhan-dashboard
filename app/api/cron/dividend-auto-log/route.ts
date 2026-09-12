import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getHistoricalDividendsForSymbol } from "@/lib/nse-historical-dividends";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Much simpler than the full trade-history reconstruction cron. For each
// CURRENTLY HELD stock, checks whether any dividend's record date has
// recently passed (last 14 days) and hasn't already been logged, then
// logs it using your CURRENT holding quantity — the same quantity already
// shown on the "Upcoming" list before the date passed.
//
// Tradeoff: uses quantity as of whenever this cron runs, not necessarily
// the exact quantity on the record date itself. In practice these are
// almost always the same (you rarely trade a stock in the narrow window
// right around its own record date), but this is intentionally simpler
// and less rigorous than the full reconstruction cron, which is still the
// better choice for genuinely old/exited positions.
//
//   GET https://your-app.vercel.app/api/cron/dividend-auto-log?secret=YOUR_CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: users } = await supabaseAdmin.from("users").select("id");
  const results: any[] = [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  for (const user of users || []) {
    try {
      const { data: latestSnap } = await supabaseAdmin
        .from("portfolio_snapshots")
        .select("holdings")
        .eq("user_id", user.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .single();

      const holdings = latestSnap?.holdings || [];
      if (holdings.length === 0) { results.push({ user: user.id, ok: true, note: "No holdings" }); continue; }

      let logged = 0;
      let skipped = 0;

      for (const h of holdings) {
        const { dividends } = await getHistoricalDividendsForSymbol(h.symbol);

        const recentlyPassed = dividends.filter((d) => {
          const recordDate = new Date(d.recordDate);
          return recordDate >= cutoff && recordDate <= today && d.perShareAmount;
        });

        for (const div of recentlyPassed) {
          const { data: existing } = await supabaseAdmin
            .from("dividend_received")
            .select("id")
            .eq("user_id", user.id)
            .eq("symbol", h.symbol)
            .eq("record_date", div.recordDate)
            .maybeSingle();

          if (existing) { skipped++; continue; }

          const amount = (div.perShareAmount as number) * h.qty;

          const { error } = await supabaseAdmin.from("dividend_received").insert({
            user_id: user.id,
            symbol: h.symbol,
            amount,
            per_share_amount: div.perShareAmount,
            quantity_at_record_date: h.qty,
            record_date: div.recordDate,
            source: "auto_current_holdings",
            note: div.rawLabel,
          });

          if (!error) logged++;
        }
      }

      results.push({ user: user.id, ok: true, holdingsChecked: holdings.length, logged, skipped });
    } catch (e: any) {
      results.push({ user: user.id, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}