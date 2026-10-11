import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: holdings } = await supabaseAdmin
    .from("gold_holdings")
    .select("*")
    .eq("user_id", user.id)
    .order("purchase_date", { ascending: false });

  // With ~19 years of backfilled history plus hourly IBJA refreshes this is
  // now well past Supabase/PostgREST's default 1000-row cap. An unlimited
  // ascending query silently truncates to the OLDEST 1000 rows, which was
  // cutting off the most recent data (same bug class as the Portfolio
  // Performance chart). Fetch the most recent rows descending instead, then
  // reverse to chronological order. The client handles time-range filtering
  // (1M/1Y/5Y/20Y/All) itself.
  const { data: historyDesc } = await supabaseAdmin
    .from("gold_rate_history")
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(5000);
  const history = (historyDesc || []).slice().reverse();

  const enrichedHoldings = (holdings || []).map((h) => {
    const currentValue = h.current_value ?? h.amount_paid;
    const pnl = currentValue - h.amount_paid;
    const pnlPct = h.amount_paid > 0 ? (pnl / h.amount_paid) * 100 : 0;
    return {
      id: h.id,
      weightGrams: h.weight_grams,
      purity: h.purity,
      amountPaid: h.amount_paid,
      purchaseDate: h.purchase_date,
      note: h.note,
      currentRatePerGram: h.current_rate_per_gram,
      currentValue,
      pnl,
      pnlPct,
      rateUpdatedAt: h.rate_updated_at,
    };
  });

  return NextResponse.json({
    holdings: enrichedHoldings,
    history: history || [],
  });
}
