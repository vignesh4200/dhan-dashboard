import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidNseSymbol } from "@/lib/ingestAnalystDesk";
import { generateDeskReport } from "@/lib/generateDeskReport";

// On-demand Analyst Desk reports. You pick the stocks on /dashboard/analyst-desk;
// each POST researches one stock with Claude + web search and stores an
// investment-committee memo in analyst_desk_reports (sql/analyst_desk_reports.sql).
//
// Needs ANTHROPIC_API_KEY in Vercel's Environment Variables. A report takes a
// few minutes, so this route asks for Vercel's 300s function limit.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const toReport = (r: any) => ({
  id: r.id,
  symbol: r.symbol,
  company: r.company,
  status: r.status,
  decision: r.decision,
  conviction: r.conviction,
  currentPrice: r.current_price,
  fairValueLow: r.fair_value_low,
  fairValueHigh: r.fair_value_high,
  horizon: r.horizon,
  summary: r.summary,
  reportMarkdown: r.report_markdown,
  sources: r.sources || [],
  model: r.model,
  error: r.error,
  createdAt: r.created_at,
  completedAt: r.completed_at,
});

async function latestHoldings(userId: string): Promise<any[]> {
  const { data: snap } = await supabaseAdmin
    .from("portfolio_snapshots")
    .select("holdings")
    .eq("user_id", userId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return snap?.holdings || [];
}

// GET — your past reports plus symbol suggestions (holdings + Smart Signals).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [{ data: reports, error }, holdings, { data: signals }, { data: calls }] = await Promise.all([
    supabaseAdmin
      .from("analyst_desk_reports")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    latestHoldings(user.id),
    supabaseAdmin.from("smart_money_signals").select("symbol").order("disclosed_date", { ascending: false }).limit(200),
    supabaseAdmin.from("broker_calls").select("symbol").eq("user_id", user.id),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clean = (rows: any[] | null) =>
    Array.from(new Set((rows || []).map((r) => String(r?.symbol || "").trim().toUpperCase()).filter(Boolean))).sort();
  const holdingSymbols = clean(holdings);
  const watchlistSymbols = clean([...(signals || []), ...(calls || [])]).filter((s) => !holdingSymbols.includes(s));

  return NextResponse.json({
    reports: (reports || []).map(toReport),
    suggestions: { holdings: holdingSymbols, watchlist: watchlistSymbols },
    configured: !!process.env.ANTHROPIC_API_KEY,
  });
}

// POST { symbol } — research one stock and store the memo.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set in the environment" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const symbol = String(body?.symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9&\-]{1,20}$/.test(symbol)) {
    return NextResponse.json({ error: "enter a valid NSE symbol" }, { status: 400 });
  }
  if (!(await isValidNseSymbol(symbol))) {
    return NextResponse.json({ error: `${symbol} did not resolve to a listed NSE stock` }, { status: 400 });
  }

  const [holdings, { data: call }] = await Promise.all([
    latestHoldings(user.id),
    supabaseAdmin
      .from("broker_calls")
      .select("broker_name, call_type")
      .eq("user_id", user.id)
      .eq("symbol", symbol)
      .limit(1)
      .maybeSingle(),
  ]);
  const holding = holdings.find((h: any) => String(h.symbol).toUpperCase() === symbol);

  const { data: row, error: insertErr } = await supabaseAdmin
    .from("analyst_desk_reports")
    .insert({ user_id: user.id, symbol, status: "running" })
    .select("*")
    .single();
  if (insertErr || !row) {
    return NextResponse.json({ error: insertErr?.message || "could not create report" }, { status: 500 });
  }

  let update: Record<string, any>;
  try {
    const r = await generateDeskReport({
      symbol,
      inHoldings: !!holding,
      holdingQty: holding?.qty ?? null,
      avgCost: holding?.avg ?? null,
      brokerRec: call ? { brokerName: call.broker_name, callType: call.call_type } : null,
    });
    update = {
      status: "done",
      company: r.company,
      decision: r.decision,
      conviction: r.conviction,
      current_price: r.currentPrice,
      fair_value_low: r.fairValueLow,
      fair_value_high: r.fairValueHigh,
      horizon: r.horizon,
      summary: r.summary,
      report_markdown: r.reportMarkdown,
      sources: r.sources,
      model: r.model,
      completed_at: new Date().toISOString(),
    };
  } catch (e: any) {
    update = { status: "error", error: String(e?.message || e).slice(0, 500), completed_at: new Date().toISOString() };
  }

  const { data: saved } = await supabaseAdmin
    .from("analyst_desk_reports")
    .update(update)
    .eq("id", row.id)
    .select("*")
    .single();

  const report = toReport(saved || { ...row, ...update });
  return NextResponse.json({ report }, { status: report.status === "error" ? 502 : 200 });
}

// DELETE ?id= — remove one of your reports.
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabaseAdmin.from("analyst_desk_reports").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: id });
}
