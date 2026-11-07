import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret } from "@/lib/crypto";
import { getAllDhanTrades } from "@/lib/dhan-ledger";
import { buildClosedTrades, isEquityTrade, istDate, tradeKey, type RawDhanTrade } from "@/lib/pnl-engine";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// Realized P&L for every closed stock trade, built from Dhan's full trade
// history (not just today's trade book — see /api/trades for the old
// same-day version, still used by the Orders page).
//
//   GET /api/pnl            → cached history, topped up if older than 6h
//   GET /api/pnl?refresh=1  → top up from Dhan now
//   GET /api/pnl?full=1     → re-download the whole history (slow)
//
// Raw trades are cached in trade_history_cache (sql/pnl.sql). The first load
// pulls everything from HISTORY_START; later loads fetch only the last few
// days and merge, which keeps each request well inside Vercel's timeout.
const HISTORY_START = "2020-01-01";
const STALE_MS = 6 * 60 * 60 * 1000;
const OVERLAP_DAYS = 5;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";
  const forceFull = req.nextUrl.searchParams.get("full") === "1";

  const [{ data: creds }, { data: cache }, { data: snap }] = await Promise.all([
    supabaseAdmin.from("dhan_credentials").select("access_token_encrypted").eq("user_id", user.id).maybeSingle(),
    supabaseAdmin.from("trade_history_cache").select("trades, fetched_at, history_from").eq("user_id", user.id).maybeSingle(),
    supabaseAdmin.from("portfolio_snapshots").select("holdings").eq("user_id", user.id).order("captured_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  let raw: RawDhanTrade[] = Array.isArray(cache?.trades) ? (cache!.trades as RawDhanTrade[]) : [];
  let fetchedAt: string | null = cache?.fetched_at ?? null;
  let syncNote: string | null = null;
  let syncError: string | null = null;

  const stale = !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > STALE_MS;
  const needsFull = forceFull || raw.length === 0;

  if ((stale || forceRefresh || needsFull) && creds?.access_token_encrypted) {
    try {
      const token = decryptSecret(creds.access_token_encrypted);
      const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      let from = HISTORY_START;
      if (!needsFull) {
        const last = raw.map(istDate).sort().pop() || HISTORY_START;
        const d = new Date(last + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - OVERLAP_DAYS);
        from = d.toISOString().slice(0, 10);
      }
      const fresh = (await getAllDhanTrades(token, from, today)) as RawDhanTrade[];

      // Keep only equity trades in the cache; merge and de-duplicate.
      const merged = new Map<string, RawDhanTrade>();
      for (const t of needsFull ? [] : raw) merged.set(tradeKey(t), t);
      for (const t of fresh) if (isEquityTrade(t)) merged.set(tradeKey(t), slim(t));
      raw = [...merged.values()];
      fetchedAt = new Date().toISOString();

      const { error } = await supabaseAdmin.from("trade_history_cache").upsert(
        { user_id: user.id, trades: raw, fetched_at: fetchedAt, history_from: HISTORY_START },
        { onConflict: "user_id" }
      );
      if (error) syncError = `Couldn't save the trade cache: ${error.message}`;
      syncNote = needsFull ? `Downloaded full history (${fresh.length} trades)` : `Synced ${fresh.length} trades since ${from}`;
    } catch (e: any) {
      syncError = raw.length
        ? `Dhan sync failed, showing cached trades: ${e.message}`
        : `Dhan sync failed: ${e.message}`;
    }
  } else if (!creds?.access_token_encrypted && raw.length === 0) {
    syncError = "No Dhan token yet — add credentials in Settings and let the refresh cron run once.";
  }

  // Resolve ISIN → NSE symbol (trade history carries only company names).
  const isins = [...new Set(raw.map((t) => t.isin).filter(Boolean))] as string[];
  const isinToSymbol: Record<string, string> = {};
  for (let i = 0; i < isins.length; i += 500) {
    const { data } = await supabaseAdmin.from("isin_symbol_map").select("isin, symbol").in("isin", isins.slice(i, i + 500));
    for (const row of data || []) isinToSymbol[row.isin] = row.symbol;
  }
  const holdings: any[] = Array.isArray(snap?.holdings) ? snap!.holdings : [];
  for (const h of holdings) if (h.isin && h.symbol && !isinToSymbol[h.isin]) isinToSymbol[h.isin] = h.symbol;

  const result = buildClosedTrades(raw, isinToSymbol);

  // Reconcile what FIFO thinks you still hold against Dhan's actual
  // holdings. A gap usually means a split, bonus, or shares from before
  // the history window — the P&L for that stock may be off.
  const heldQty: Record<string, number> = {};
  for (const h of holdings) if (h.isin) heldQty[h.isin] = (heldQty[h.isin] || 0) + Number(h.qty || 0);
  const lotQty: Record<string, number> = {};
  for (const l of result.openLots) lotQty[l.isin] = l.qty;
  const mismatches = [...new Set([...Object.keys(heldQty), ...Object.keys(lotQty)])]
    .map((isin) => ({
      isin,
      symbol: isinToSymbol[isin] || result.openLots.find((l) => l.isin === isin)?.symbol || isin,
      held: heldQty[isin] || 0,
      fromHistory: lotQty[isin] || 0,
    }))
    .filter((m) => Math.abs(m.held - m.fromHistory) > 0.0001 && holdings.length > 0);

  return NextResponse.json({
    trades: result.trades,
    unmatched: result.unmatched,
    mismatches,
    totals: result.totals,
    fetchedAt,
    syncNote,
    syncError,
  });
}

// Drop fields the P&L never reads, to keep the cached JSON small.
function slim(t: RawDhanTrade): RawDhanTrade {
  const { orderId, exchangeTradeId, transactionType, exchangeSegment, productType, tradingSymbol, customSymbol, securityId,
    tradedQuantity, tradedPrice, isin, instrument, sebiTax, stt, brokerageCharges, serviceTax, exchangeTransactionCharges,
    stampDuty, exchangeTime, createTime } = t;
  return { orderId, exchangeTradeId, transactionType, exchangeSegment, productType, tradingSymbol, customSymbol, securityId,
    tradedQuantity, tradedPrice, isin, instrument, sebiTax, stt, brokerageCharges, serviceTax, exchangeTransactionCharges,
    stampDuty, exchangeTime, createTime };
}
