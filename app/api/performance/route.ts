import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Returns performance history for the Portfolio Performance chart.
// ?type=all (default) | stocks | mf | gold
//
// IMPORTANT: Supabase/PostgREST caps query results at 1000 rows by default.
// With a 15-minute stock refresh cron, that's exceeded within ~10 days —
// so ordering ascending with no limit was silently returning only the
// OLDEST 1000 rows and cutting off everything newer, which is why the
// chart appeared frozen at a fixed date regardless of new data being
// written. Fixed by fetching the most recent N rows (descending + limit),
// then reversing to chronological order before returning.
const MAX_POINTS = 2000;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const type = req.nextUrl.searchParams.get("type") || "all";

  if (type === "stocks") {
    const { data } = await supabaseAdmin
      .from("portfolio_snapshots")
      .select("captured_at, total_current, total_invested")
      .order("captured_at", { ascending: false })
      .limit(MAX_POINTS);

    const points = (data || [])
      .reverse()
      .map((r) => ({
        captured_at: r.captured_at,
        current: r.total_current,
        invested: r.total_invested,
      }));
    return NextResponse.json({ points });
  }

  const { data } = await supabaseAdmin
    .from("combined_snapshots")
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(MAX_POINTS);

  const points = (data || [])
    .reverse()
    .map((r) => {
      if (type === "mf") return { captured_at: r.captured_at, current: r.mf_current, invested: r.mf_invested };
      if (type === "gold") return { captured_at: r.captured_at, current: r.gold_current, invested: r.gold_invested };
      return {
        captured_at: r.captured_at,
        current: (r.stocks_current ?? 0) + (r.mf_current ?? 0) + (r.gold_current ?? 0),
        invested: (r.stocks_invested ?? 0) + (r.mf_invested ?? 0) + (r.gold_invested ?? 0),
      };
    });

  return NextResponse.json({ points });
}