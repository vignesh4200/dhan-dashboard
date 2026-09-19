import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Session-authed read: the signal feed, cross-referenced against this user's
// current Dhan holdings (isHolding) and whatever they've already marked in
// signal_tracks (trackStatus / track fields), for the Smart Signals page.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [{ data: signals, error: sigErr }, { data: snap }, { data: tracks }] = await Promise.all([
    supabaseAdmin
      .from("smart_money_signals")
      .select("*")
      .order("disclosed_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("portfolio_snapshots")
      .select("holdings")
      .eq("user_id", user.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.from("signal_tracks").select("*").eq("user_id", user.id),
  ]);

  if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 });

  const holdingSymbols = new Set<string>((snap?.holdings || []).map((h: any) => String(h.symbol).toUpperCase()));
  const trackBySignal = new Map((tracks || []).map((t: any) => [t.signal_id, t]));

  const rows = (signals || []).map((s: any) => ({
    id: s.id,
    signalType: s.signal_type,
    symbol: s.symbol,
    company: s.company,
    side: s.side,
    qty: s.qty,
    price: s.price,
    valueCr: s.value_cr,
    disclosedDate: s.disclosed_date,
    source: s.source,
    mfBuyCount: s.mf_buy_count,
    screenPassed: s.screen_passed,
    currentPrice: s.current_price,
    stopLoss: s.stop_loss,
    target: s.target,
    isHolding: s.symbol ? holdingSymbols.has(s.symbol.toUpperCase()) : false,
    track: trackBySignal.get(s.id) || null,
  }));

  return NextResponse.json({ signals: rows, portfolioMatches: rows.filter((r) => r.isHolding).length });
}