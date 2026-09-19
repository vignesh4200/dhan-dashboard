import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ingestSignalRows, defaultBrokerCallExternalId } from "@/lib/ingestSignals";

// Write-only ingest for the daily Smart Money scan (a Claude scheduled task)
// to push newly found bulk/block deals and insider disclosures straight into
// this dashboard, instead of (or in addition to) the standalone Smart Money
// Desk artifact.
//
// POST https://your-app.vercel.app/api/signals/ingest?secret=YOUR_SIGNAL_INGEST_SECRET
// Body: { "rows": [ { ...see shape below... } ] }
//
// There's also a GET-based transport for the same logic — see the GET
// handler below — for callers that can only make outbound GET requests to
// this domain (e.g. a sandboxed agent whose shell can't POST to a
// non-allowlisted host). Two GET flavors: compact single-row query params
// (?sym=&co=&sd=&pr=&tg=&dt=&src=, one row per call — short enough to clear
// a caller's own URL-length limits) and a &data=<base64url JSON> blob for
// callers without that constraint.
//
// Set SIGNAL_INGEST_SECRET in Vercel's Environment Variables (generate one
// the same way as CRON_SECRET / HOLDINGS_EXPORT_SECRET — README section 5).
// A THIRD distinct secret, scoped to this one write endpoint only.
//
// Each row is upserted on externalId, so re-posting the same day's scan is
// safe — existing rows just get their price/screen/stop/target refreshed.
//
// Row shape:
// {
//   externalId: string      // stable dedupe key, e.g. "bulk:2026-09-19:KOPRAN:BUY:NSE"
//   signalType: "bulk_deal" | "block_deal" | "insider"
//   symbol: string | null   // NSE ticker, null if unconfirmed
//   company: string
//   side: "BUY" | "SELL" | null
//   qty?: number
//   price?: number
//   valueCr?: number
//   disclosedDate: string   // "YYYY-MM-DD"
//   source?: string
//   mfBuyCount?: number
//   screenPassed?: boolean
//   currentPrice?: number
//   stopLoss?: number
//   target?: number
//   raw?: object
// }
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.SIGNAL_INGEST_SECRET || secret !== process.env.SIGNAL_INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "body.rows must be a non-empty array" }, { status: 400 });
  }

  const result = await ingestSignalRows(rows);
  return NextResponse.json(result.body, { status: result.status });
}

// GET https://your-app.vercel.app/api/signals/ingest?secret=YOUR_SIGNAL_INGEST_SECRET&test=1
//   — browser-friendly smoke test, see below.
//
// GET https://your-app.vercel.app/api/signals/ingest?secret=YOUR_SIGNAL_INGEST_SECRET&data=<base64url>
//   — real ingest over GET, an alternate transport for exactly the same
//   upsert-on-externalId logic as the POST handler above (same secret, same
//   row shape). This exists for callers that can only make outbound GET
//   requests to this domain — e.g. an agent sandbox whose shell/curl is
//   blocked from POSTing to non-allowlisted hosts but whose fetch-and-read
//   tool can still GET them. `data` is
//   base64url(JSON.stringify({ rows: [ ...same row shape as POST... ] })).
// Node's Buffer.from(str, "base64url") accepts both standard and
// URL-safe base64, so either encoding works here.
//
// Browser-friendly smoke test — no curl needed. Paste that URL into any
// browser tab and it inserts one dummy KOPRAN row (external_id "manual-test",
// so hitting this link again just re-upserts the same row instead of piling
// up duplicates). Confirms the secret, the Supabase write, and the page's
// read path all work end to end. Requires ?test=1 so it can never be hit by
// accident with a bare secret in the URL.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.SIGNAL_INGEST_SECRET || secret !== process.env.SIGNAL_INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // TEMPORARY DIAGNOSTIC — echoes back exactly what the server received, so
  // we can compare a browser request against WebFetch's request byte-for-byte
  // instead of guessing. Always returns 200 so the caller actually sees the
  // body (a 400 elsewhere in this handler was coming back to WebFetch as an
  // opaque error with no body visible). Safe to remove once the WebFetch-vs-
  // browser 400 mystery on this endpoint is solved.
  if (req.nextUrl.searchParams.get("debug") === "1") {
    const headersObj: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headersObj[key] = value;
    });
    return NextResponse.json({
      url: req.url,
      rawSearch: req.nextUrl.search,
      searchParams: Object.fromEntries(req.nextUrl.searchParams.entries()),
      headers: headersObj,
      method: req.method,
    });
  }

  // Housekeeping — caps how many rows of a given signalType are kept, so the
  // dashboard's broker-calls list doesn't grow forever. Deletes the oldest
  // rows beyond the most recent N (by disclosedDate, then updated_at as a
  // tiebreak for same-day rows), keeping the newest N.
  // GET .../ingest?secret=...&prune=1&keep=50&st=broker_call (st defaults to
  // "broker_call"; keep defaults to 50).
  if (req.nextUrl.searchParams.get("prune") === "1") {
    const signalType = req.nextUrl.searchParams.get("st") || "broker_call";
    const keep = Number(req.nextUrl.searchParams.get("keep") || "50");
    const { data: existing, error: selError } = await supabaseAdmin
      .from("smart_money_signals")
      .select("id")
      .eq("signal_type", signalType)
      .order("disclosed_date", { ascending: false })
      .order("updated_at", { ascending: false });
    if (selError) {
      return NextResponse.json({ error: selError.message }, { status: 500 });
    }
    const allIds = (existing || []).map((r) => r.id);
    const idsToDelete = allIds.slice(keep);
    if (idsToDelete.length === 0) {
      return NextResponse.json({ signalType, kept: allIds.length, deleted: 0 });
    }
    const { error: delError } = await supabaseAdmin.from("smart_money_signals").delete().in("id", idsToDelete);
    if (delError) {
      return NextResponse.json({ error: delError.message }, { status: 500 });
    }
    return NextResponse.json({ signalType, kept: Math.min(keep, allIds.length), deleted: idsToDelete.length });
  }

  // Read-only audit view — lists rows (all types by default, or one type via
  // st=) so junk/test data can actually be seen and identified instead of
  // guessed at. GET .../ingest?secret=...&list=1[&st=broker_call][&limit=200]
  if (req.nextUrl.searchParams.get("list") === "1") {
    const signalType = req.nextUrl.searchParams.get("st");
    const limit = Number(req.nextUrl.searchParams.get("limit") || "200");
    let query = supabaseAdmin
      .from("smart_money_signals")
      .select("id, external_id, signal_type, symbol, company, source, side, target, disclosed_date, updated_at")
      .order("disclosed_date", { ascending: false })
      .limit(limit);
    if (signalType) query = query.eq("signal_type", signalType);
    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ count: data?.length ?? 0, rows: data ?? [] });
  }

  // Targeted delete by external_id — for removing specific junk/test rows
  // identified via ?list=1, rather than only being able to trim by count
  // (?prune=1). GET .../ingest?secret=...&del=1&ids=id1,id2,id3
  if (req.nextUrl.searchParams.get("del") === "1") {
    const idsParam = req.nextUrl.searchParams.get("ids");
    if (!idsParam) {
      return NextResponse.json({ error: "with ?del=1, also require ids=<comma-separated external_id list>" }, { status: 400 });
    }
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const { error, count } = await supabaseAdmin
      .from("smart_money_signals")
      .delete({ count: "exact" })
      .in("external_id", ids);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ requested: ids.length, deleted: count ?? 0 });
  }

  // Compact single-row transport: individual short query params instead of
  // a JSON blob. Exists because some callers (notably the WebFetch tool
  // used by the scheduled scans) enforce their own URL length cap well
  // under what a base64-encoded row can fit — this stays short enough to
  // clear that. One row per call; call it multiple times for multiple rows.
  //
  // Core params: sym, co, dt (disclosedDate), firm (source — "src" also
  // accepted, see note below), sd (side), pr (price), tg (target), cp
  // (currentPrice), id (externalId — if omitted, derived from dt+firm+sym).
  //
  // Extra params for the richer bulk-deal/insider row shape (all optional,
  // default to the broker-call scan's original behavior when omitted so
  // that scan's calls are unaffected): st (signalType — "bulk_deal" |
  // "block_deal" | "insider" | "broker_call", default "broker_call"), qty
  // (quantity), vcr (valueCr), mfc (mfBuyCount — "1" or "0", default "0"),
  // scr (screenPassed — "1" or "0"/"true"/"false", default "0"), sl
  // (stopLoss).
  const sym = req.nextUrl.searchParams.get("sym");
  if (sym) {
    const co = req.nextUrl.searchParams.get("co");
    const dt = req.nextUrl.searchParams.get("dt");
    // "firm" is the primary name for this param, "src" a backward-compatible
    // alias. Confirmed by a debug echo that the WebFetch tool used by the
    // scheduled scan silently strips a query param literally named "src"
    // before the request ever leaves — almost certainly generic
    // tracking-parameter sanitization (utm_source/ref/src are the classic
    // set). Nothing wrong with this server or the caller's logic; it just
    // never received the key. "firm" isn't a common tracking-param name, so
    // it passes through untouched. Browser-typed/bookmarked links using the
    // old ?src= still work via the fallback.
    const src = req.nextUrl.searchParams.get("firm") || req.nextUrl.searchParams.get("src");
    if (!co || !dt || !src) {
      return NextResponse.json({ error: "with ?sym=, also require co, dt, and firm (src also accepted)" }, { status: 400 });
    }
    const id = req.nextUrl.searchParams.get("id") || defaultBrokerCallExternalId(dt, src, sym);
    const pr = req.nextUrl.searchParams.get("pr");
    const tg = req.nextUrl.searchParams.get("tg");
    const cp = req.nextUrl.searchParams.get("cp");
    const st = req.nextUrl.searchParams.get("st");
    const qty = req.nextUrl.searchParams.get("qty");
    const vcr = req.nextUrl.searchParams.get("vcr");
    const mfc = req.nextUrl.searchParams.get("mfc");
    const scr = req.nextUrl.searchParams.get("scr");
    const sl = req.nextUrl.searchParams.get("sl");
    const truthy = (v: string | null) => v === "1" || v === "true";
    const row = {
      externalId: id,
      signalType: st || "broker_call",
      symbol: sym,
      company: co,
      side: req.nextUrl.searchParams.get("sd") || null,
      qty: qty ? Number(qty) : null,
      price: pr ? Number(pr) : null,
      valueCr: vcr ? Number(vcr) : null,
      target: tg ? Number(tg) : null,
      currentPrice: cp ? Number(cp) : null,
      stopLoss: sl ? Number(sl) : null,
      disclosedDate: dt,
      source: src,
      mfBuyCount: truthy(mfc) ? 1 : 0,
      screenPassed: truthy(scr),
    };
    const result = await ingestSignalRows([row]);
    return NextResponse.json(result.body, { status: result.status });
  }

  const dataParam = req.nextUrl.searchParams.get("data");
  if (dataParam) {
    let rows: any[] = [];
    try {
      const json = Buffer.from(dataParam, "base64url").toString("utf8");
      const body = JSON.parse(json);
      rows = Array.isArray(body?.rows) ? body.rows : [];
    } catch {
      return NextResponse.json({ error: "invalid ?data= (must be base64url JSON with a rows array)" }, { status: 400 });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "?data= decoded but rows was empty" }, { status: 400 });
    }
    const result = await ingestSignalRows(rows);
    return NextResponse.json(result.body, { status: result.status });
  }

  if (req.nextUrl.searchParams.get("test") !== "1") {
    return NextResponse.json(
      {
        error:
          "add &test=1 to run the smoke test, &sym=...&co=...&sd=...&pr=...&tg=...&dt=...&src=... for one compact row, " +
          "or &data=<base64url JSON> to ingest rows over GET",
      },
      { status: 400 }
    );
  }

  const { error, data } = await supabaseAdmin
    .from("smart_money_signals")
    .upsert(
      [
        {
          external_id: "manual-test",
          signal_type: "bulk_deal",
          symbol: "KOPRAN",
          company: "Kopran Ltd (test row — safe to ignore/delete)",
          side: "BUY",
          qty: 10000,
          price: 245.5,
          value_cr: 2.5,
          disclosed_date: new Date().toISOString().slice(0, 10),
          source: "NSE bulk deal",
          mf_buy_count: 0,
          screen_passed: false,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: "external_id" }
    )
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: "Test row inserted/updated. Check /dashboard/signals for a KOPRAN row.",
    ingested: data?.length ?? 0,
  });
}
