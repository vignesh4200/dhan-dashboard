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
  //   — LEGACY / NOT RELIABLE. This was the first attempt at a GET-only
  //   ingest path, but real-world testing (2026-09-21) showed the WebFetch
  //   proxy this app's scheduled-task agents use does NOT reliably handle
  //   long URLs: short ones work, but past some length it can silently
  //   no-op (return stale/cached content instead of erroring) rather than
  //   cleanly failing. That makes it unsafe for anything with real prose in
  //   it. Kept only for backward compat — use &sym=... below instead.
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

  // GET .../ingest?secret=...&sym=RELIANCE&dt=2026-09-21&cs=61.4&cl=M
  //     &es=65&ms=58&vs=60[&fl=1&fr=...][&co=...][&fw=...][&se=...]
  //     [&f1=...][&f2=...][&f3=...]
  //   — THE REAL PATH, one short GET call per stock. Confirmed short GETs
  //   (well under ~170 chars total) reach this app reliably; long ones
  //   don't, so this mode never asks the agent to send prose. Required:
  //   sym, dt (YYYY-MM-DD), cs (compositeScore), cl (S|M|N|W|C for
  //   Strong|Moderate|Neutral|Weak|Concern), es, ms, vs (0-100 scores).
  //   Optional, keep each SHORT (under ~60 chars, URL-encoded): co
  //   (company name), fw (flow/derivatives one-liner), se (sentiment
  //   one-liner), fr (flag reason, implies flagged=true), f1/f2/f3 (up to
  //   3 short "Analyst: finding" one-liners). The full reportMarkdown the
  //   dashboard shows is generated HERE, server-side, from these fields —
  //   the agent never has to transmit long text at all.
  const sym = req.nextUrl.searchParams.get("sym");
  if (sym) {
    const dt = req.nextUrl.searchParams.get("dt");
    const cs = req.nextUrl.searchParams.get("cs");
    const cl = req.nextUrl.searchParams.get("cl");
    const es = req.nextUrl.searchParams.get("es");
    const ms = req.nextUrl.searchParams.get("ms");
    const vs = req.nextUrl.searchParams.get("vs");
    if (!dt || !cs || !cl || !es || !ms || !vs) {
      return NextResponse.json(
        { error: "compact mode requires sym, dt, cs, cl, es, ms, vs" },
        { status: 400 }
      );
    }
    const CL_MAP: Record<string, string> = { S: "Strong", M: "Moderate", N: "Neutral", W: "Weak", C: "Concern" };
    const convictionLabel = CL_MAP[cl.toUpperCase()] || null;
    const co = req.nextUrl.searchParams.get("co");
    const fw = req.nextUrl.searchParams.get("fw");
    const se = req.nextUrl.searchParams.get("se");
    const fr = req.nextUrl.searchParams.get("fr");
    const findings = ["f1", "f2", "f3"]
      .map((k) => req.nextUrl.searchParams.get(k))
      .filter((v): v is string => !!v)
      .map((v) => {
        const [head, ...rest] = v.split(":");
        return rest.length > 0
          ? { lead: "", analyst: head.trim(), finding: rest.join(":").trim() }
          : { lead: "", analyst: "", finding: v };
      });

    const compositeScore = Number(cs);
    const reportMarkdown =
      `# ${co || sym} (${sym.toUpperCase()})\n\n` +
      `**Composite: ${compositeScore.toFixed(1)} — ${convictionLabel || cl}**\n\n` +
      `**Equity Research score:** ${es}/100\n` +
      `**Industry & Macro score:** ${ms}/100\n` +
      `**Independent Validation score:** ${vs}/100\n` +
      (fw ? `\n**Flow/Derivatives:** ${fw}\n` : "") +
      (se ? `**News/Sentiment:** ${se}\n` : "") +
      (fr ? `\n**Flag:** ${fr}\n` : "") +
      (findings.length > 0
        ? `\n**Findings:**\n` + findings.map((f) => `- ${f.analyst ? f.analyst + ": " : ""}${f.finding}`).join("\n")
        : "");

    const row = {
      runDate: dt,
      symbol: sym,
      company: co || null,
      compositeScore,
      convictionLabel,
      equityScore: Number(es),
      macroScore: Number(ms),
      validationScore: Number(vs),
      flowRead: fw || null,
      sentimentRead: se || null,
      flagged: !!fr,
      flagReason: fr || null,
      findings,
      reportMarkdown,
      sources: [],
    };
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