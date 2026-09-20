import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function isValidNseSymbol(symbol: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return false;
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number";
  } catch {
    return false;
  }
}

const CONVICTION_LABELS = new Set(["Strong", "Moderate", "Neutral", "Weak", "Concern"]);

export async function ingestAnalystDeskRows(rows: any[]) {
  const candidateRows = (Array.isArray(rows) ? rows : []).filter(
    (r) => r?.runDate && r?.symbol && r?.reportMarkdown && typeof r?.compositeScore === "number"
  );

  const validations = await Promise.all(
    candidateRows.map((r) => isValidNseSymbol(String(r.symbol).trim()))
  );

  const skipped: { runDate: string; symbol: string; reason: string }[] = [];
  const upsertRows = candidateRows
    .filter((r, i) => {
      if (validations[i]) return true;
      skipped.push({ runDate: r.runDate, symbol: String(r.symbol), reason: "failed NSE symbol validation" });
      return false;
    })
    .map((r) => ({
      run_date: r.runDate,
      symbol: String(r.symbol).trim().toUpperCase(),
      company: r.company ?? null,
      composite_score: r.compositeScore,
      conviction_label: CONVICTION_LABELS.has(r.convictionLabel) ? r.convictionLabel : null,
      equity_score: r.equityScore ?? null,
      macro_score: r.macroScore ?? null,
      validation_score: r.validationScore ?? null,
      flow_read: r.flowRead ?? null,
      sentiment_read: r.sentimentRead ?? null,
      flagged: !!r.flagged,
      flag_reason: r.flagReason ?? null,
      findings: Array.isArray(r.findings) ? r.findings : null,
      report_markdown: String(r.reportMarkdown),
      sources: Array.isArray(r.sources) ? r.sources : null,
      updated_at: new Date().toISOString(),
    }));

  if (upsertRows.length === 0) {
    return {
      ok: false as const,
      status: 400,
      body:
        skipped.length > 0
          ? { error: "no valid rows — every symbol failed NSE validation", skipped }
          : { error: "no valid rows (each needs runDate, symbol, compositeScore, reportMarkdown)" },
    };
  }

  const { error, data } = await supabaseAdmin
    .from("analyst_desk_scores")
    .upsert(upsertRows, { onConflict: "run_date,symbol" })
    .select("id");

  if (error) {
    return { ok: false as const, status: 500, body: { error: error.message } };
  }

  return {
    ok: true as const,
    status: 200,
    body: {
      ingested: data?.length ?? 0,
      receivedAt: new Date().toISOString(),
      ...(skipped.length > 0 ? { skipped } : {}),
    },
  };
}
