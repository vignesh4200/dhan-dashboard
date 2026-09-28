import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { DECISIONS, deskSecretOk } from "@/lib/deskReports";

// Receive a finished report from the Analyst Desk routine.
//
// POST https://your-app.vercel.app/api/analyst-desk/reports/ingest
// Header: x-desk-secret: ANALYST_DESK_INGEST_SECRET
// Body (JSON):
//   { "id": 12, "status": "done", "company": "...", "decision": "BUY",
//     "conviction": 72, "currentPrice": 1510, "fairValueLow": 1650,
//     "fairValueHigh": 1850, "horizon": "12-18 months", "summary": "...",
//     "reportMarkdown": "# ...", "sources": ["https://..."] }
//   or { "id": 12, "status": "error", "error": "why it failed" }
export const dynamic = "force-dynamic";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function POST(req: NextRequest) {
  if (!deskSecretOk(req.headers.get("x-desk-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const b = await req.json().catch(() => null);
  const id = Number(b?.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "missing id" }, { status: 400 });

  let update: Record<string, any>;
  if (b?.status === "error") {
    update = { status: "error", error: str(b.error, 500) || "report failed", completed_at: new Date().toISOString() };
  } else {
    const reportMarkdown = str(b?.reportMarkdown, 200_000);
    if (!reportMarkdown) return NextResponse.json({ error: "missing reportMarkdown" }, { status: 400 });
    const decision = String(b?.decision || "").toUpperCase();
    update = {
      status: "done",
      company: str(b.company, 200),
      decision: (DECISIONS as readonly string[]).includes(decision) ? decision : null,
      conviction: num(b.conviction),
      current_price: num(b.currentPrice),
      fair_value_low: num(b.fairValueLow),
      fair_value_high: num(b.fairValueHigh),
      horizon: str(b.horizon, 100),
      summary: str(b.summary, 1000),
      report_markdown: reportMarkdown,
      sources: Array.isArray(b.sources) ? b.sources.filter((s: any) => typeof s === "string").slice(0, 40) : null,
      error: null,
      completed_at: new Date().toISOString(),
    };
  }

  const { data, error } = await supabaseAdmin
    .from("analyst_desk_reports")
    .update(update)
    .eq("id", id)
    .select("id, symbol, status");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: `no report with id ${id}` }, { status: 404 });

  return NextResponse.json({ ingested: 1, id, symbol: data[0].symbol, status: data[0].status });
}
