import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: latestRun } = await supabaseAdmin
    .from("analyst_desk_scores")
    .select("run_date")
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRun) {
    return NextResponse.json({ runDate: null, stocks: [] });
  }

  const [{ data: scores, error: scoresErr }, { data: snap }, { data: calls }] = await Promise.all([
    supabaseAdmin
      .from("analyst_desk_scores")
      .select("*")
      .eq("run_date", latestRun.run_date)
      .order("composite_score", { ascending: false }),
    supabaseAdmin
      .from("portfolio_snapshots")
      .select("holdings")
      .eq("user_id", user.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.from("broker_calls").select("symbol, broker_name, call_type").eq("user_id", user.id),
  ]);

  if (scoresErr) return NextResponse.json({ error: scoresErr.message }, { status: 500 });

  const holdingsBySymbol = new Map<string, any>(
    (snap?.holdings || []).map((h: any) => [String(h.symbol).toUpperCase(), h])
  );
  const callsBySymbol = new Map<string, { brokerName: string | null; callType: string }>();
  (calls || []).forEach((c: any) => {
    callsBySymbol.set(String(c.symbol).toUpperCase(), { brokerName: c.broker_name, callType: c.call_type });
  });

  const stocks = (scores || []).map((s: any) => {
    const holding = holdingsBySymbol.get(s.symbol);
    const call = callsBySymbol.get(s.symbol);
    return {
      id: s.id,
      symbol: s.symbol,
      company: s.company,
      compositeScore: s.composite_score,
      convictionLabel: s.conviction_label,
      equityScore: s.equity_score,
      macroScore: s.macro_score,
      validationScore: s.validation_score,
      flowRead: s.flow_read,
      sentimentRead: s.sentiment_read,
      flagged: s.flagged,
      flagReason: s.flag_reason,
      findings: s.findings || [],
      reportMarkdown: s.report_markdown,
      sources: s.sources || [],
      updatedAt: s.updated_at,
      inHoldings: !!holding,
      holdingQty: holding?.qty ?? null,
      brokerRec: call ? { brokerName: call.brokerName, callType: call.callType } : null,
    };
  });

  return NextResponse.json({
    runDate: latestRun.run_date,
    stocks,
    avgScore: stocks.length > 0 ? stocks.reduce((sum, s) => sum + (s.compositeScore ?? 0), 0) / stocks.length : null,
    flaggedCount: stocks.filter((s) => s.flagged).length,
    holdingsCount: stocks.filter((s) => s.inHoldings).length,
  });
}
