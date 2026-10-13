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
  fireNote: r.fire_note,
  createdAt: r.created_at,
  claimedAt: r.claimed_at,
  completedAt: r.completed_at,
});

// Routine API trigger. DESK_ROUTINE_TOKEN is the bearer token from
// claude.ai/code/routines → the routine → Edit → API trigger. The Fire URL
// isn't secret, so it defaults to the "Analyst Desk — on-demand reports"
// routine; set DESK_ROUTINE_FIRE_URL only to point at a different routine.
// Values are trimmed and stripped of surrounding quotes, which a copy-paste
// into Vercel often adds.
const DEFAULT_FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_01Xtoz8TLH7Z36bXokM8jX1j/fire";

const envValue = (name: string) => (process.env[name] || "").trim().replace(/^["']|["']$/g, "").trim();

export const routineMissing = () => ["DESK_ROUTINE_TOKEN"].filter((name) => !envValue(name));

export const routineConfigured = () => routineMissing().length === 0;

export async function fireDeskRoutine(symbols: string[]): Promise<{ fired: boolean; error?: string }> {
  const missing = routineMissing();
  if (missing.length > 0) return { fired: false, error: `not set on this deployment: ${missing.join(", ")}` };
  const url = envValue("DESK_ROUTINE_FIRE_URL") || DEFAULT_FIRE_URL;
  if (!/^https:\/\/api\.anthropic\.com\/.+\/fire$/.test(url)) {
    return { fired: false, error: "DESK_ROUTINE_FIRE_URL should be the routine's Fire URL, ending in /fire" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${envValue("DESK_ROUTINE_TOKEN")}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: `New report requests queued: ${symbols.join(", ")}` }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      return { fired: false, error: `routine fire returned ${res.status}${detail ? `: ${detail}` : ""}` };
    }
    return { fired: true };
  } catch (e: any) {
    return { fired: false, error: String(e?.message || e).slice(0, 200) };
  }
}

// Live price for a desk request. The research routine runs in a sandbox that
// can't reach quote endpoints, and web search returns prices weeks old, so the
// dashboard (which can reach Yahoo, same source as the holdings refresh cron)
// looks the price up and hands it over with the request.
export type DeskQuote = { price: number; asOf: string; source: string; previousClose: number | null };

export async function getLiveQuote(symbol: string): Promise<DeskQuote | null> {
  for (const suffix of [".NS", ".BO"]) {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol + suffix)}?interval=1d&range=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
      );
      if (!res.ok) continue;
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
      const t = typeof meta?.regularMarketTime === "number" ? new Date(meta.regularMarketTime * 1000) : new Date();
      const prev = meta?.chartPreviousClose ?? meta?.previousClose;
      return {
        price: Math.round(price * 100) / 100,
        asOf: t.toISOString(),
        source: suffix === ".NS" ? "Yahoo Finance (NSE)" : "Yahoo Finance (BSE)",
        previousClose: typeof prev === "number" ? prev : null,
      };
    } catch {}
  }
  return null;
}

export const deskSecretOk = (secret: string | null) =>
  !!process.env.ANALYST_DESK_INGEST_SECRET && secret === process.env.ANALYST_DESK_INGEST_SECRET;
