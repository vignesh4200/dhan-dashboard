import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ingestAnalystDeskRows } from "@/lib/ingestAnalystDesk";

// Write-only ingest for the daily Indian Market Intelligence Desk run (a
// Claude scheduled task — same pattern as /api/signals/ingest for the Smart
// Money scan) to push each stock's composite score + report into this
// dashboard once a day, pre-market.
//
// POST https://your-app.vercel.app/api/analyst-desk/ingest?secret=YOUR_ANALYST_DESK_INGEST_SECRET
// Body: { "rows": [ ...see lib/ingestAnalystDesk.ts for the row shape... ] }
//
// Set ANALYST_DESK_INGEST_SECRET in Vercel's Environment Variables the same
// way as CRON_SECRET / SIGNAL_INGEST_SECRET (README section 5) — a
// distinct secret, scoped to this one write endpoint only.
//
// Each row is upserted on (runDate, symbol), so re-posting the same day's
// run is safe — it just refreshes the existing rows.
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

// GET https://your-app.vercel.app/api/analyst-desk/ingest?secret=...&test=1
//   — browser-friendly smoke test. Paste into any browser tab once the
//   secret is set in Vercel — inserts one dummy ASTRAL row (runDate = today,
//   so hitting it again just re-upserts the same row rather than piling up
//   duplicates). Confirms the secret, the Supabase write, and the page's
//   read path all work end to end, before the real scheduled task is wired
//   up. Requires ?test=1 so it can never fire by accident with a bare
//   secret in the URL.
//
// GET .../ingest?secret=...&list=1[&limit=50]
//   — read-only audit view of recent rows, for checking what's actually in
//   the table without opening Supabase.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.ANALYST_DESK_INGEST_SECRET || secret !== process.env.ANALYST_DESK_INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // GET .../ingest?secret=...&row=<base64-encoded JSON of ONE row object>
  //   — the real daily scheduled-task run uses THIS, not the POST endpoint
  //   above. Scheduled-task sandboxes can't reach this app via curl/Bash
  //   (their shell's egress proxy blocks it — confirmed 403), only via the
  //   WebFetch-style tool, which is GET-only. So instead of one POST with a
  //   `rows` array, the agent calls this once per stock with that stock's
  //   row JSON, base64-encoded, in a single `row` query param. Same
  //   ingestAnalystDeskRows() upsert logic underneath either way.
  if (req.nextUrl.searchParams.get("row")) {
    let row: any;
    try {
      row = JSON.parse(Buffer.from(req.nextUrl.searchParams.get("row")!, "base64").toString("utf-8"));
    } catch {
      return NextResponse.json({ error: "row must be base64-encoded JSON of one row object" }, { status: 400 });
    }
    const result = await ingestAnalystDeskRows([row]);
    return NextResponse.json(result.body, { status: result.status });
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
