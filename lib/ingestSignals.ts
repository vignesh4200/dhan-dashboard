import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Shared upsert logic for the /api/signals/ingest endpoints (both the POST
// body-based one and the GET data-param one). Keeping this in one place
// means the two transports can never drift out of sync on field shape.
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

export async function ingestSignalRows(rows: any[]) {
  const upsertRows = (Array.isArray(rows) ? rows : [])
    .filter((r) => r?.externalId && r?.company && r?.disclosedDate)
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
      body: { error: "no valid rows (each needs externalId, company, disclosedDate)" },
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
    body: { ingested: data?.length ?? 0, receivedAt: new Date().toISOString() },
  };
}