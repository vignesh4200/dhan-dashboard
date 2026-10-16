import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Extra per-stock data for the Holdings page:
//  - series: one closing LTP per IST day for the last ~30 days (trend lines)
//  - prevClose: each stock's LTP at the end of the previous snapshot day,
//    used for "Today" change per stock
//  - scores: latest Analyst Desk composite score per symbol
// Daily points come from the holdings_daily() SQL function (last snapshot
// of each IST day), so this never pulls thousands of 15-minute rows.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [{ data: days, error: daysErr }, { data: scoreRows }] = await Promise.all([
    supabaseAdmin.rpc("holdings_daily", { p_user: user.id, p_days: 31 }),
    supabaseAdmin
      .from("analyst_desk_scores")
      .select("symbol, composite_score, conviction_label, run_date")
      .order("run_date", { ascending: false })
      .limit(1000),
  ]);

  if (daysErr) return NextResponse.json({ error: daysErr.message }, { status: 500 });

  const sorted = [...(days || [])].sort((a: any, b: any) => String(a.day).localeCompare(String(b.day)));

  const series: Record<string, { d: string; ltp: number }[]> = {};
  for (const row of sorted) {
    for (const h of (row.holdings || []) as any[]) {
      if (typeof h?.ltp !== "number") continue;
      (series[h.symbol] ||= []).push({ d: row.day, ltp: h.ltp });
    }
  }

  // Previous day = the last snapshot day before the latest snapshot's day.
  const prevClose: Record<string, number> = {};
  let prevDate: string | null = null;
  if (sorted.length >= 2) {
    const prev = sorted[sorted.length - 2];
    prevDate = prev.day;
    for (const h of (prev.holdings || []) as any[]) {
      if (typeof h?.ltp === "number") prevClose[h.symbol] = h.ltp;
    }
  }

  const scores: Record<string, { score: number; label: string | null; runDate: string }> = {};
  for (const r of scoreRows || []) {
    const sym = String(r.symbol || "").toUpperCase();
    if (!sym || scores[sym]) continue;
    scores[sym] = { score: Number(r.composite_score), label: r.conviction_label, runDate: r.run_date };
  }

  return NextResponse.json({ series, prevClose, prevDate, scores });
}
