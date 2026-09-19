import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// "Mark as bought" / "watching" / "skipped" / "sold" for a signal. This is
// the "tracks it as well" half of the feature — it does NOT place a real
// order (this app has no execution capability); it logs that you acted on a
// signal (here, or manually with your broker) so the Signals page can show
// live P&L against your entry, separately from your actual Dhan holdings.

async function getLtp(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.signalId || !body?.status) {
    return NextResponse.json({ error: "signalId and status are required" }, { status: 400 });
  }
  if (!["watching", "bought", "skipped", "sold"].includes(body.status)) {
    return NextResponse.json({ error: "status must be watching | bought | skipped | sold" }, { status: 400 });
  }

  const { data: signal } = await supabaseAdmin
    .from("smart_money_signals")
    .select("symbol, stop_loss, target")
    .eq("id", body.signalId)
    .maybeSingle();

  if (!signal?.symbol) {
    return NextResponse.json({ error: "signal not found or has no confirmed symbol yet" }, { status: 404 });
  }

  const payload: any = {
    user_id: user.id,
    signal_id: body.signalId,
    symbol: signal.symbol,
    status: body.status,
  };
  if (body.status === "bought") {
    payload.entry_price = body.entryPrice ?? null;
    payload.qty = body.qty ?? null;
    payload.stop_loss = body.stopLoss ?? signal.stop_loss ?? null;
    payload.target = body.target ?? signal.target ?? null;
    payload.taken_at = new Date().toISOString();
  }
  if (body.status === "sold") {
    payload.exit_price = body.exitPrice ?? null;
    payload.closed_at = new Date().toISOString();
  }
  if (body.notes) payload.notes = body.notes;

  const { data, error } = await supabaseAdmin
    .from("signal_tracks")
    .upsert(payload, { onConflict: "user_id,signal_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ track: data });
}

// List this user's tracked signals with live LTP + P&L for anything marked "bought".
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: tracks, error } = await supabaseAdmin
    .from("signal_tracks")
    .select("*, smart_money_signals(company, disclosed_date, source)")
    .eq("user_id", user.id)
    .order("taken_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const bought = (tracks || []).filter((t: any) => t.status === "bought");
  const ltpMap: Record<string, number | null> = {};
  await Promise.all(
    bought.map(async (t: any) => {
      ltpMap[t.symbol] = await getLtp(t.symbol);
    })
  );

  const rows = (tracks || []).map((t: any) => {
    const ltp = t.status === "bought" ? ltpMap[t.symbol] ?? null : null;
    const pnlPct = ltp && t.entry_price ? ((ltp - t.entry_price) / t.entry_price) * 100 : null;
    const pnl = ltp && t.entry_price && t.qty ? (ltp - t.entry_price) * t.qty : null;
    return {
      id: t.id,
      signalId: t.signal_id,
      symbol: t.symbol,
      company: t.smart_money_signals?.company,
      status: t.status,
      entryPrice: t.entry_price,
      qty: t.qty,
      stopLoss: t.stop_loss,
      target: t.target,
      takenAt: t.taken_at,
      exitPrice: t.exit_price,
      closedAt: t.closed_at,
      ltp,
      pnlPct,
      pnl,
    };
  });

  return NextResponse.json({ tracks: rows });
}