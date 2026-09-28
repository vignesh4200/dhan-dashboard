// Shared helpers for on-demand Analyst Desk reports (analyst_desk_reports).
//
// Flow: the Analyst Desk page queues rows → fireDeskRoutine() pokes the
// "Analyst Desk — on-demand reports" Claude Code routine (runs on your
// claude.ai subscription, no API billing) → the routine claims rows via
// /api/analyst-desk/reports/queue, researches each stock, and posts the memo
// to /api/analyst-desk/reports/ingest.

export const DECISIONS = ["BUY", "ACCUMULATE", "HOLD", "AVOID", "SELL"] as const;

export const toReport = (r: any) => ({
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
  error: r.error,
  createdAt: r.created_at,
  claimedAt: r.claimed_at,
  completedAt: r.completed_at,
});

// Routine API trigger. DESK_ROUTINE_FIRE_URL is the routine's /fire URL and
// DESK_ROUTINE_TOKEN the bearer token, both from claude.ai/code/routines →
// the routine → Edit → Add another trigger → API.
export const routineConfigured = () => !!(process.env.DESK_ROUTINE_FIRE_URL && process.env.DESK_ROUTINE_TOKEN);

export async function fireDeskRoutine(symbols: string[]): Promise<{ fired: boolean; error?: string }> {
  if (!routineConfigured()) return { fired: false, error: "routine trigger not configured" };
  try {
    const res = await fetch(process.env.DESK_ROUTINE_FIRE_URL!, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DESK_ROUTINE_TOKEN}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: `New report requests queued: ${symbols.join(", ")}` }),
    });
    if (!res.ok) return { fired: false, error: `routine fire returned ${res.status}` };
    return { fired: true };
  } catch (e: any) {
    return { fired: false, error: String(e?.message || e) };
  }
}

export const deskSecretOk = (secret: string | null) =>
  !!process.env.ANALYST_DESK_INGEST_SECRET && secret === process.env.ANALYST_DESK_INGEST_SECRET;
