import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Shared upsert logic for the /api/signals/ingest endpoints (both the POST
// body-based one and the GET data-param one). Keeping this in one place
// means the two transports can never drift out of sync on field shape — and,
// as of 2026-09-19, that neither transport can bypass symbol validation
// below (a caller-side bug during testing wrote fake rows like symbol
// "WEBFETCHFIX" straight into production — see isValidNseSymbol).
//
// Row shape (camelCase in, snake_case out to Supabase):
// {
//   externalId: string
//   signalType: "bulk_deal" | "block_deal" | "insider" | "broker_call" | ...
//   symbol: string | null
//   company: string
//   side: "BUY" | "SELL" | null
//   qty?: number
//   price?: number
//   valueCr?: number
//   disclosedDate: string   // "YYYY-MM-DD"
//   source?: string
//   mfBuyCount?: number
//   screenPassed?: boolean
//   currentPrice?: number
//   stopLoss?: number
//   target?: number
//   raw?: object
// }

// Same dedupe-key convention the scheduled broker-call scan already uses:
// brokercall-{YYYY-MM-DD}-{firm lowercased, spaces to hyphens}-{symbol lowercased}
export function defaultBrokerCallExternalId(disclosedDate: string, source: string, symbol: string) {
  const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");
  return `brokercall-${disclosedDate}-${slug(source)}-${slug(symbol)}`;
}

// Confirms a symbol is an actual NSE-listed security before it's allowed
// into the table — same technique /api/broker-calls already uses (a live
// Yahoo Finance quote lookup, since that's free and needs no API key). This
// exists because every write path here is driven by an LLM agent summarizing
// news or testing the endpoint, and a hallucinated, misspelled, or leftover
// test symbol (e.g. "WEBFETCHFIX", "CHECKV4") would otherwise land in the
// table looking exactly like a real stock. A symbol of null is allowed
// through untouched — some callers intentionally leave it unconfirmed rather
// than guess.
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
    // Network hiccup or Yahoo rate limit — fail closed. A real symbol will
    // just get picked up again on the next scan run (upsert is idempotent);
    // that's a better failure mode than letting an unverified row through.
    return false;
  }
}

export async function ingestSignalRows(rows: any[]) {
  const candidateRows = (Array.isArray(rows) ? rows : []).filter(
    (r) => r?.externalId && r?.company && r?.disclosedDate
  );

  // Validate every non-null symbol concurrently rather than one at a time.
  const validations = await Promise.all(
    candidateRows.map((r) => (r.symbol ? isValidNseSymbol(String(r.symbol).trim()) : Promise.resolve(true)))
  );

  const skipped: { externalId: string; symbol: string }[] = [];
  const upsertRows = candidateRows
    .filter((r, i) => {
      if (validations[i]) return true;
      skipped.push({ externalId: String(r.externalId), symbol: String(r.symbol) });
      return false;
    })
    .map((r) => ({
      external_id: String(r.externalId),
      signal_type: r.signalType || "bulk_deal",
      symbol: r.symbol ? String(r.symbol).trim().toUpperCase() : null,
      company: String(r.company),
      side: r.side ? String(r.side).trim().toUpperCase() : null,
      qty: r.qty ?? null,
      price: r.price ?? null,
      value_cr: r.valueCr ?? null,
      disclosed_date: r.disclosedDate,
      source: r.source || null,
      mf_buy_count: r.mfBuyCount ?? 0,
      screen_passed: !!r.screenPassed,
      current_price: r.currentPrice ?? null,
      stop_loss: r.stopLoss ?? null,
      target: r.target ?? null,
      raw: r.raw ?? null,
      updated_at: new Date().toISOString(),
    }));

  if (upsertRows.length === 0) {
    return {
      ok: false as const,
      status: 400,
      body:
        skipped.length > 0
          ? { error: "no valid rows — every symbol failed NSE validation", skipped }
          : { error: "no valid rows (each needs externalId, company, disclosedDate)" },
    };
  }

  const { error, data } = await supabaseAdmin
    .from("smart_money_signals")
    .upsert(upsertRows, { onConflict: "external_id" })
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
