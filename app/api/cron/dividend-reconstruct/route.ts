import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret } from "@/lib/crypto";
import { getAllDhanTrades } from "@/lib/dhan-ledger";
import { shareCountAsOf } from "@/lib/dividend-reconstruct";
import { getHistoricalDividendsForSymbol } from "@/lib/nse-historical-dividends";

// Run this once a day (or manually). Reconstructs actual dividend income
// received per stock, using real trade history to compute the exact share
// count held on each dividend's record date — not an estimate from
// today's holdings, which would be wrong for any stock you've since
// bought or sold more of.
//
// Now resolves symbols from the COMPLETE isin_symbol_map table (built
// from Dhan's ScanX bulk data, covering ~3,139 NSE equities) instead of
// only current holdings — so this correctly covers stocks you've fully
// bought and sold too, not just ones still in your portfolio today.
//   GET https://your-app.vercel.app/api/cron/dividend-reconstruct?secret=YOUR_CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: users } = await supabaseAdmin
    .from("users")
    .select("id, dhan_credentials(access_token_encrypted)");

  const results: any[] = [];

  for (const user of users || []) {
    const creds = (user as any).dhan_credentials;
    if (!creds?.access_token_encrypted) continue;

    try {
      const accessToken = decryptSecret(creds.access_token_encrypted);

      // Pull full trade history — as far back as Dhan's API will go —
      // FIRST, since ISINs to check now come from actual trades ever
      // made, not just current holdings.
      const fromDate = "2020-01-01";
      const toDate = new Date().toISOString().slice(0, 10);
      const allTrades = await getAllDhanTrades(accessToken, fromDate, toDate);

      const uniqueIsins = [...new Set(allTrades.map((t: any) => t.isin).filter(Boolean))];
      if (uniqueIsins.length === 0) { results.push({ user: user.id, ok: true, note: "No ISINs found in trade history" }); continue; }

      const { data: isinRows } = await supabaseAdmin
        .from("isin_symbol_map")
        .select("isin, symbol")
        .in("isin", uniqueIsins);

      const isinToSymbol: Record<string, string> = {};
      for (const row of isinRows || []) isinToSymbol[row.isin] = row.symbol;

      let logged = 0;
      let skipped = 0;
      let unresolvedIsins = 0;
      let firstDiag: any = null;

      for (const isin of uniqueIsins) {
        const symbol = isinToSymbol[isin];
        if (!symbol) { unresolvedIsins++; continue; }

        const { dividends, diag } = await getHistoricalDividendsForSymbol(symbol);
        if (!firstDiag) firstDiag = { symbol, ...diag };

        for (const div of dividends) {
          if (!div.perShareAmount) { skipped++; continue; }

          const qty = shareCountAsOf(allTrades, isin, div.recordDate);
          if (qty <= 0) { skipped++; continue; }

          const amount = div.perShareAmount * qty;

          const { error } = await supabaseAdmin.from("dividend_received").upsert(
            {
              user_id: user.id,
              symbol,
              amount,
              per_share_amount: div.perShareAmount,
              quantity_at_record_date: qty,
              record_date: div.recordDate,
              source: "reconstructed",
              note: div.rawLabel,
            },
            { onConflict: "user_id,symbol,record_date", ignoreDuplicates: true }
          );

          if (!error) logged++;
        }
      }

      results.push({
        user: user.id,
        ok: true,
        isinsFromTrades: uniqueIsins.length,
        unresolvedIsins,
        logged,
        skipped,
        firstSymbolDiag: firstDiag,
      });
    } catch (e: any) {
      results.push({ user: user.id, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}