import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret } from "@/lib/crypto";
import { getAllDhanTrades } from "@/lib/dhan-ledger";
import { shareCountAsOf } from "@/lib/dividend-reconstruct";
import { getHistoricalDividendsForSymbol } from "@/lib/nse-historical-dividends";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// Reconstructs actual dividend income received per stock, using real trade
// history to compute the exact share count held on each dividend's record
// date — not an estimate from today's holdings.
//
//   GET https://your-app.vercel.app/api/cron/dividend-reconstruct?secret=YOUR_CRON_SECRET&offset=0&limit=20
//
// PAGINATED: processes a small batch of symbols per call, since fetching
// full trade history plus checking 200+ symbols against NSE in one
// request was hitting Vercel's hard platform timeout (ERR_CONNECTION_
// ABORTED, confirmed Sept 2026 — the platform kills the connection
// outright rather than returning a graceful timeout error). Call this
// repeatedly with increasing offset until "hasMore" is false.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");

  const { data: users } = await supabaseAdmin
    .from("users")
    .select("id, dhan_credentials(access_token_encrypted)");

  const results: any[] = [];

  for (const user of users || []) {
    const creds = (user as any).dhan_credentials;
    if (!creds?.access_token_encrypted) continue;

    try {
      const accessToken = decryptSecret(creds.access_token_encrypted);

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

      const resolvedIsins = uniqueIsins.filter((isin) => isinToSymbol[isin]);
      const pageIsins = resolvedIsins.slice(offset, offset + limit);

      let logged = 0;
      let skippedNoAmount = 0;
      let skippedZeroQty = 0;
      let firstDiag: any = null;
      let sampleSkippedNoAmount: any = null;
      let sampleSkippedZeroQty: any = null;

      const batchResults = await Promise.all(
        pageIsins.map(async (isin) => {
          const symbol = isinToSymbol[isin];
          const { dividends, diag } = await getHistoricalDividendsForSymbol(symbol);
          return { isin, symbol, dividends, diag };
        })
      );

      for (const { isin, symbol, dividends, diag } of batchResults) {
        if (!firstDiag) firstDiag = { symbol, ...diag };

        for (const div of dividends) {
          if (!div.perShareAmount) {
            skippedNoAmount++;
            if (!sampleSkippedNoAmount) sampleSkippedNoAmount = { symbol, ...div };
            continue;
          }

          const qty = shareCountAsOf(allTrades, isin, div.recordDate);
          if (qty <= 0) {
            skippedZeroQty++;
            if (!sampleSkippedZeroQty) sampleSkippedZeroQty = { symbol, isin, recordDate: div.recordDate, qty };
            continue;
          }

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
        totalResolvedIsins: resolvedIsins.length,
        offset,
        limit,
        processedThisPage: pageIsins.length,
        hasMore: offset + limit < resolvedIsins.length,
        nextOffset: offset + limit < resolvedIsins.length ? offset + limit : null,
        logged,
        skippedNoAmount,
        skippedZeroQty,
        sampleSkippedNoAmount,
        sampleSkippedZeroQty,
        firstSymbolDiag: firstDiag,
      });
    } catch (e: any) {
      results.push({ user: user.id, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}