import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Public read (secret-protected, same dual-secret pattern as
// /api/public/holdings) for the Analyst Desk's daily scheduled task to pull
// its non-holdings coverage list. Union of three sources, so a stock doesn't
// need to be a manually-flagged "watching" call to get picked up:
//   1. broker_calls where status = 'watching' — stocks you've explicitly
//      flagged to watch.
//   2. broker_calls where call_type = 'buy' — any broker BUY recommendation
//      you've logged, regardless of status (bought/watching/closed etc.),
//      since a BUY call is itself worth a desk score.
//   3. smart_money_signals where screen_passed = true — bulk/block deals or
//      insider filings that passed the Smart Signals strategy screen.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.HOLDINGS_EXPORT_SECRET && secret !== process.env.ANALYST_DESK_READ_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [{ data: watching }, { data: buyCalls }, { data: signals }] = await Promise.all([
    supabaseAdmin.from("broker_calls").select("symbol").eq("status", "watching"),
    supabaseAdmin.from("broker_calls").select("symbol").eq("call_type", "buy"),
    supabaseAdmin.from("smart_money_signals").select("symbol").eq("screen_passed", true),
  ]);

  const symbols = Array.from(
    new Set(
      [...(watching || []), ...(buyCalls || []), ...(signals || [])]
        .map((r: any) => (r?.symbol ? String(r.symbol).trim().toUpperCase() : null))
        .filter((s): s is string => !!s)
    )
  ).sort();

  return NextResponse.json({ symbols });
}