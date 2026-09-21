import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Public read (secret-protected, same dual-secret pattern as
// /api/public/holdings) for the Analyst Desk's daily scheduled task to pull
// its non-holdings coverage list. Deliberately matches EXACTLY what shows up
// on the Smart Signals dashboard page (/dashboard/signals), which pulls:
//   - every smart_money_signals row (bulk deals, block deals, insider/SAST
//     filings) — ALL of them, not just ones that passed the strategy screen
//     (that's a stricter filter the dashboard applies client-side, not a cut
//     on what's shown at all)
//   - every broker_calls row, any status (watching/bought/sold/closed), not
//     just "watching" — every logged call is visible on that page
// So: any symbol you can see on the Smart Signals page gets picked up here.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.HOLDINGS_EXPORT_SECRET && secret !== process.env.ANALYST_DESK_READ_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [{ data: signals }, { data: calls }] = await Promise.all([
    supabaseAdmin.from("smart_money_signals").select("symbol").order("disclosed_date", { ascending: false }).limit(200),
    supabaseAdmin.from("broker_calls").select("symbol"),
  ]);

  const symbols = Array.from(
    new Set(
      [...(signals || []), ...(calls || [])]
        .map((r: any) => (r?.symbol ? String(r.symbol).trim().toUpperCase() : null))
        .filter((s): s is string => !!s)
    )
  ).sort();

  return NextResponse.json({ symbols });
}