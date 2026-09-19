import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Write-only ingest for the daily Smart Money scan (a Claude scheduled task)
// to push newly found bulk/block deals and insider disclosures straight into
// this dashboard, instead of (or in addition to) the standalone Smart Money
// Desk artifact.
//
// POST https://your-app.vercel.app/api/signals/ingest?secret=YOUR_SIGNAL_INGEST_SECRET
// Body: { "rows": [ { ...see shape below... } ] }
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

  const upsertRows = rows
    .filter((r) => r?.externalId && r?.company && r?.disclosedDate)
    .map((r) => ({
      external_id: String(r.externalId),
      signal_type: r.signalType || "bulk_deal",
      symbol: r.symbol ? String(r.symbol).trim().toUpperCase() : null,
      company: String(r.company),
      side: r.side || null,
      qty: r.qty ?? null,
      price: r.price ?? null,
      value_cr: r.valueCr ?? null,
      disclosed_date: r.disclosedDate,
      source: r.source || null,
      mf_buy_count: r.mfBuyCount ?? 0,
      screen_passed: !!r.screenPassed,
      current_price: r.currentPrice ?? null,
      stop_loss: r.stopLoss ?? null,
      target: r.target ?? null,
      raw: r.raw ?? null,
      updated_at: new Date().toISOString(),
    }));

  if (upsertRows.length === 0) {
    return NextResponse.json({ error: "no valid rows (each needs externalId, company, disclosedDate)" }, { status: 400 });
  }

  const { error, data } = await supabaseAdmin
    .from("smart_money_signals")
    .upsert(upsertRows, { onConflict: "external_id" })
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ingested: data?.length ?? 0, receivedAt: new Date().toISOString() });
}

// GET https://your-app.vercel.app/api/signals/ingest?secret=YOUR_SIGNAL_INGEST_SECRET&test=1
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
  if (req.nextUrl.searchParams.get("test") !== "1") {
    return NextResponse.json({ error: "add &test=1 to the URL to run the smoke test" }, { status: 400 });
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