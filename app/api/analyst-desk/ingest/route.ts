import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ingestAnalystDeskRows } from "@/lib/ingestAnalystDesk";

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.ANALYST_DESK_INGEST_SECRET || secret !== process.env.ANALYST_DESK_INGEST_SECRET) {
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

  const result = await ingestAnalystDeskRows(rows);
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.ANALYST_DESK_INGEST_SECRET || secret !== process.env.ANALYST_DESK_INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (req.nextUrl.searchParams.get("list") === "1") {
    const limit = Number(req.nextUrl.searchParams.get("limit") || "50");
    const { data, error } = await supabaseAdmin
      .from("analyst_desk_scores")
      .select("id, run_date, symbol, composite_score, conviction_label, flagged, updated_at")
      .order("run_date", { ascending: false })
      .order("symbol", { ascending: true })
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ count: data?.length ?? 0, rows: data ?? [] });
  }

  if (req.nextUrl.searchParams.get("test") !== "1") {
    return NextResponse.json(
      { error: "add &test=1 for a smoke test, or &list=1 to audit recent rows" },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const result = await ingestAnalystDeskRows([
    {
      runDate: today,
      symbol: "ASTRAL",
      company: "Astral Limited (test row — safe to ignore/delete)",
      compositeScore: 67.6,
      convictionLabel: "Moderate",
      equityScore: 72,
      macroScore: 78,
      validationScore: 61,
      flowRead: "Muted — no institutional conviction either way",
      sentimentRead: "Quiet — no material news this week",
      flagged: false,
      findings: [
        { lead: "Equity Research", analyst: "Fundamental Research", finding: "Revenue/EBITDA in line with trend; margin stable." },
        { lead: "Independent Validation", analyst: "Peer & Valuation", finding: "Trades at a modest premium to Supreme Industries and Finolex." },
      ],
      reportMarkdown: "# Astral Limited (ASTRAL)\n\nTest row — see the real daily run for an actual report.",
      sources: ["NSE quarterly filing", "Latest concall transcript"],
    },
  ]);

  return NextResponse.json({
    ok: true,
    message: "Test row inserted/updated. Check /dashboard/analyst-desk for an ASTRAL row.",
    result: result.body,
  });
}
