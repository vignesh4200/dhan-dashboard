import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getHistoricalDividendsForSymbol, HistoricalDividend } from "@/lib/nse-historical-dividends";

// Shared logic behind /api/cron/dividend-auto-log. For each CURRENTLY HELD
// stock, checks whether any dividend's record date has recently passed
// (last 14 days) and hasn't already been logged, then logs it using your
// CURRENT holding quantity — the same quantity already shown on the
// "Upcoming" list before the date passed.
//
// Tradeoff: uses quantity as of whenever this runs, not necessarily the
// exact quantity on the record date itself. In practice these are almost
// always the same (you rarely trade a stock in the narrow window right
// around its own record date), but this is intentionally simpler and less
// rigorous than the full reconstruction cron, which is still the better
// choice for genuinely old/exited positions.
//
// Pulled out into its own function so it can be called both from its own
// standalone cron route (for manual/backup triggering) and from inside the
// /api/cron/refresh pinger, which is the only job actually scheduled via
// cron-job.org (see README step 6) — the standalone route alone was never
// wired to a schedule, so dividends were never flipping from "Upcoming" to
// "Received" no matter how long past their record date.
export async function runDividendAutoLog() {
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

      // Fetch every holding's dividend history CONCURRENTLY instead of one
      // await at a time — with ~38 holdings, each a separate NSE round trip,
      // the old sequential loop alone took 30-80s and was the reason this
      // cron kept timing out (cron-job.org caps at 30s). The per-holding
      // results are then processed in order below; DB writes stay small and
      // fast so there's no need to parallelize those too.
      const perHolding = await Promise.all(
        holdings.map((h: any) => getHistoricalDividendsForSymbol(h.symbol))
      );

      for (let i = 0; i < holdings.length; i++) {
        const h = holdings[i];
        const { dividends }: { dividends: HistoricalDividend[] } = perHolding[i];

        const recentlyPassed = dividends.filter((d: HistoricalDividend) => {
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

      // Fallback: NSE often refuses Vercel's servers, and getHistoricalDividendsForSymbol
      // then returns an empty list silently, so nothing gets logged. The dashboard
      // already keeps the last good NSE response in upcoming_dividends_cache — use any
      // cached dividend whose date has now passed. The existing-row check keeps this
      // from double-logging anything NSE did return above.
      const qtyBySymbol: Record<string, number> = {};
      for (const h of holdings) qtyBySymbol[h.symbol] = Number(h.qty);
      const isoDay = (d: Date) => d.toISOString().slice(0, 10);
      const { data: cached } = await supabaseAdmin
        .from("upcoming_dividends_cache")
        .select("symbol, label, event_date")
        .eq("user_id", user.id)
        .gte("event_date", isoDay(cutoff))
        .lte("event_date", isoDay(new Date()));

      for (const c of cached || []) {
        const qty = qtyBySymbol[c.symbol];
        if (!qty || !/dividend/i.test(c.label || "")) continue;
        const m = (c.label || "").match(/R[se]\.?\s*([\d.]+)/i);
        const perShare = m ? parseFloat(m[1]) : NaN;
        if (!perShare) continue;

        const { data: existing } = await supabaseAdmin
          .from("dividend_received")
          .select("id")
          .eq("user_id", user.id)
          .eq("symbol", c.symbol)
          .eq("record_date", c.event_date)
          .maybeSingle();
        if (existing) { skipped++; continue; }

        const { error } = await supabaseAdmin.from("dividend_received").insert({
          user_id: user.id,
          symbol: c.symbol,
          amount: perShare * qty,
          per_share_amount: perShare,
          quantity_at_record_date: qty,
          record_date: c.event_date,
          source: "auto_current_holdings",
          note: c.label,
        });
        if (!error) logged++;
      }

      results.push({ user: user.id, ok: true, holdingsChecked: holdings.length, logged, skipped });
    } catch (e: any) {
      results.push({ user: user.id, ok: false, error: e.message });
    }
  }

  return results;
}