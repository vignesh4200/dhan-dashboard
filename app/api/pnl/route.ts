import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret } from "@/lib/crypto";
import { getAllDhanTrades } from "@/lib/dhan-ledger";
import { buildClosedTrades, isEquityTrade, tradeKey, type RawDhanTrade } from "@/lib/pnl-engine";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// Realized P&L for every closed stock trade, built from Dhan's full trade
// history (not just today's trade book — /api/trades, the old same-day
// version, is still used by the Orders page).
//
//   GET /api/pnl            → sync step (if needed) + P&L
//   GET /api/pnl?refresh=1  → top up recent trades now
//   GET /api/pnl?full=1     → wipe the cache and re-download everything
//
// RESUMABLE SYNC: downloading years of trades in one request blew through
// Vercel's 60s limit (Nov 2026). History is now fetched in date windows,
// oldest first, and saved to trade_history_cache after every batch with
// `synced_to` marking how far it got. Each request stops before TIME_BUDGET
// and returns sync.complete=false; the page simply calls again until done.
// Once complete, later visits only re-fetch the last few days.
const HISTORY_START = "2020-01-01";
const WINDOW_DAYS = 120;
const PARALLEL = 2;
const TIME_BUDGET_MS = 38_000;
const MIN_LEFT_FOR_BATCH_MS = 14_000;
const STALE_MS = 6 * 60 * 60 * 1000;
const OVERLAP_DAYS = 5;

const addDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const started = Date.now();
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

    const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";
    const forceFull = req.nextUrl.searchParams.get("full") === "1";

    const [{ data: creds }, { data: cache }, { data: snap }, { data: costRows }] = await Promise.all([
      supabaseAdmin.from("dhan_credentials").select("access_token_encrypted").eq("user_id", user.id).maybeSingle(),
      supabaseAdmin.from("trade_history_cache").select("trades, fetched_at, synced_to").eq("user_id", user.id).maybeSingle(),
      supabaseAdmin.from("portfolio_snapshots").select("holdings").eq("user_id", user.id).order("captured_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("cost_basis_overrides").select("isin, credit_date, price, note").eq("user_id", user.id),
    ]);

    const today = istToday();
    const merged = new Map<string, RawDhanTrade>();
    if (!forceFull && Array.isArray(cache?.trades)) for (const t of cache!.trades as RawDhanTrade[]) merged.set(tradeKey(t), t);
    let syncedTo: string | null = forceFull ? null : (cache?.synced_to ?? null);
    let fetchedAt: string | null = forceFull ? null : (cache?.fetched_at ?? null);
    let syncError: string | null = null;
    let fetchedNow = 0;

    const complete = () => !!syncedTo && syncedTo >= today;
    const stale = !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > STALE_MS;

    // Where to resume: after the last synced day while backfilling; a few
    // days back for a routine top-up once history is complete.
    let cursor: string | null = null;
    if (!syncedTo) cursor = HISTORY_START;
    else if (!complete()) cursor = addDays(syncedTo, 1);
    else if (stale || forceRefresh) cursor = addDays(syncedTo, -OVERLAP_DAYS);
    if (cursor && cursor > today) cursor = today;

    if (cursor && !creds?.access_token_encrypted) {
      syncError = "No Dhan token yet — add credentials in Settings and let the refresh cron run once.";
      cursor = null;
    }

    if (cursor) {
      const token = decryptSecret(creds!.access_token_encrypted);
      const save = async () => {
        const { error } = await supabaseAdmin.from("trade_history_cache").upsert(
          { user_id: user.id, trades: [...merged.values()], fetched_at: fetchedAt, synced_to: syncedTo, history_from: HISTORY_START },
          { onConflict: "user_id" }
        );
        if (error) syncError = `Couldn't save the trade cache: ${error.message}`;
      };

      while (cursor <= today && TIME_BUDGET_MS - (Date.now() - started) > MIN_LEFT_FOR_BATCH_MS) {
        const windows: [string, string][] = [];
        let c: string = cursor;
        for (let i = 0; i < PARALLEL && c <= today; i++) {
          const end = addDays(c, WINDOW_DAYS - 1) > today ? today : addDays(c, WINDOW_DAYS - 1);
          windows.push([c, end]);
          c = addDays(end, 1);
        }
        const results = await Promise.allSettled(windows.map(([f, t]) => getAllDhanTrades(token, f, t)));

        // Advance only through the windows that succeeded in order, so a
        // failed window is retried on the next call instead of skipped.
        let advanced = false;
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status !== "fulfilled") {
            syncError = `Dhan returned an error for ${windows[i][0]} → ${windows[i][1]}: ${String((r.reason as any)?.message || r.reason).slice(0, 200)}`;
            break;
          }
          for (const t of (r.value as RawDhanTrade[])) if (isEquityTrade(t)) { merged.set(tradeKey(t), slim(t)); fetchedNow++; }
          syncedTo = windows[i][1];
          advanced = true;
        }
        if (!advanced) break;
        fetchedAt = new Date().toISOString();
        await save();
        if (syncError) break;
        cursor = addDays(syncedTo!, 1);
      }
    }

    const raw = [...merged.values()];
    const sync = {
      complete: complete(),
      syncedTo,
      historyFrom: HISTORY_START,
      fetchedNow,
      progress: syncedTo
        ? Math.min(1, (Date.parse(syncedTo) - Date.parse(HISTORY_START)) / Math.max(1, Date.parse(today) - Date.parse(HISTORY_START)))
        : 0,
    };

    // Until the backfill finishes, return progress only — partial history
    // would show a misleading P&L.
    if (!sync.complete) {
      return NextResponse.json({ sync, trades: [], unmatched: [], actions: [], mismatches: [], totals: { rawTrades: raw.length, equityTrades: raw.length, firstTrade: null, lastTrade: null }, fetchedAt, syncError });
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

    // Costs you've saved for ₹0 credits (IPO allotments, transfers in) —
    // see /api/pnl/cost-basis and lib/pnl-engine.ts buildClosedTrades.
    const costOverrides: Record<string, number> = {};
    for (const r of costRows || []) costOverrides[`${r.isin}|${String(r.credit_date).slice(0, 10)}`] = Number(r.price);

    const result = buildClosedTrades(raw, isinToSymbol, costOverrides);
    const notes: Record<string, string> = {};
    for (const r of costRows || []) if (r.note) notes[`${r.isin}|${String(r.credit_date).slice(0, 10)}`] = r.note;
    const actions = result.actions.map((a) => ({ ...a, note: notes[`${a.isin}|${a.date}`] || null }));

    // Reconcile what FIFO thinks you still hold against Dhan's actual
    // holdings. A gap usually means a split, bonus, or shares from before
    // the history window — the P&L for that stock may be off.
    const heldQty: Record<string, number> = {};
    for (const h of holdings) if (h.isin) heldQty[h.isin] = (heldQty[h.isin] || 0) + Number(h.qty || 0);
    const lotQty: Record<string, number> = {};
    for (const l of result.openLots) lotQty[l.isin] = l.qty;
    const mismatches = holdings.length === 0 ? [] : [...new Set([...Object.keys(heldQty), ...Object.keys(lotQty)])]
      .map((isin) => ({
        isin,
        symbol: isinToSymbol[isin] || result.openLots.find((l) => l.isin === isin)?.symbol || isin,
        held: heldQty[isin] || 0,
        fromHistory: lotQty[isin] || 0,
      }))
      .filter((m) => Math.abs(m.held - m.fromHistory) > 0.0001);

    return NextResponse.json({
      sync,
      trades: result.trades,
      unmatched: result.unmatched,
      actions,
      mismatches,
      totals: result.totals,
      fetchedAt,
      syncError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: `P&L failed: ${e?.message || String(e)}` }, { status: 500 });
  }
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
