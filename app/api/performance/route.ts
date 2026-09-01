import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Returns performance history for the Portfolio Performance chart.
// ?type=all (default) | stocks | mf | gold
//
// "stocks" uses portfolio_snapshots directly — this table already has
// genuine longer-running history from before combined tracking existed.
// "all" / "mf" / "gold" use combined_snapshots, which only starts
// building from whenever that cron began running (same honest
// starts-empty-grows-over-time pattern used for gold/MF history elsewhere).
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const type = req.nextUrl.searchParams.get("type") || "all";

  if (type === "stocks") {
    const { data } = await supabaseAdmin
      .from("portfolio_snapshots")
      .select("captured_at, total_current, total_invested")
      .order("captured_at", { ascending: true });

    const points = (data || []).map((r) => ({
      captured_at: r.captured_at,
      current: r.total_current,
      invested: r.total_invested,
    }));
    return NextResponse.json({ points });
  }

  const { data } = await supabaseAdmin
    .from("combined_snapshots")
    .select("*")
    .order("captured_at", { ascending: true });

  const points = (data || []).map((r) => {
    if (type === "mf") return { captured_at: r.captured_at, current: r.mf_current, invested: r.mf_invested };
    if (type === "gold") return { captured_at: r.captured_at, current: r.gold_current, invested: r.gold_invested };
    // "all" — combined across whichever asset types have data at that snapshot
    return {
      captured_at: r.captured_at,
      current: (r.stocks_current ?? 0) + (r.mf_current ?? 0) + (r.gold_current ?? 0),
      invested: (r.stocks_invested ?? 0) + (r.mf_invested ?? 0) + (r.gold_invested ?? 0),
    };
  });

  return NextResponse.json({ points });
}