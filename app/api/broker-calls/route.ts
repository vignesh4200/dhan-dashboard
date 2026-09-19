import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function lookupSymbol(symbol: string): Promise<{ valid: boolean; name?: string; price?: number }> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return { valid: false };
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const price = result?.meta?.regularMarketPrice;
    if (typeof price !== "number") return { valid: false };
    const name = result?.meta?.longName || result?.meta?.shortName || result?.meta?.symbol || symbol;
    return { valid: true, name, price };
  } catch {
    return { valid: false };
  }
}

async function getLtp(symbol: string): Promise<number | null> {
  const r = await lookupSymbol(symbol);
  return r.valid ? r.price! : null;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Live symbol check for the "Check" button in the add-call form —
  // doesn't touch the table, just confirms the ticker resolves.
  const checkSymbol = req.nextUrl.searchParams.get("checkSymbol");
  if (checkSymbol) {
    const r = await lookupSymbol(checkSymbol);
    if (!r.valid) {
      return NextResponse.json({ valid: false, error: `"${checkSymbol.toUpperCase()}" isn't a recognized NSE symbol.` });
    }
    return NextResponse.json({ valid: true, symbol: checkSymbol.toUpperCase(), name: r.name, price: r.price });
  }

  const { data: calls, error } = await supabaseAdmin
    .from("broker_calls")
    .select("*")
    .eq("user_id", user.id)
    .order("taken_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const bought = (calls || []).filter((c) => c.status === "bought");
  const ltpMap: Record<string, number | null> = {};
  await Promise.all(
    Array.from(new Set(bought.map((c) => c.symbol))).map(async (sym) => {
      ltpMap[sym] = await getLtp(sym);
    })
  );

  const rows = (calls || []).map((c: any) => {
    const ltp = c.status === "bought" ? ltpMap[c.symbol] ?? null : null;
    const pnl = ltp != null && c.entry_price != null && c.qty != null ? (ltp - c.entry_price) * c.qty : null;
    const pnlPct = ltp != null && c.entry_price ? ((ltp - c.entry_price) / c.entry_price) * 100 : null;

    return {
      id: c.id,
      symbol: c.symbol,
      company: c.company,
      brokerName: c.broker_name,
      callType: c.call_type,
      entryPrice: c.entry_price,
      stopLoss: c.stop_loss,
      target: c.target,
      qty: c.qty,
      status: c.status,
      notes: c.notes,
      callDate: c.call_date,
      takenAt: c.taken_at,
      closedAt: c.closed_at,
      exitPrice: c.exit_price,
      ltp,
      pnl,
      pnlPct,
    };
  });

  return NextResponse.json({ calls: rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  const { id, symbol, company, brokerName, callType, entryPrice, stopLoss, target, qty, status, notes, callDate, exitPrice } = body;

  // Updating an existing call (status change, close-out, edits) — symbol is
  // already validated from when it was created, so no re-check needed.
  if (id) {
    const patch: any = {};
    if (status !== undefined) patch.status = status;
    if (entryPrice !== undefined) patch.entry_price = entryPrice;
    if (stopLoss !== undefined) patch.stop_loss = stopLoss;
    if (target !== undefined) patch.target = target;
    if (qty !== undefined) patch.qty = qty;
    if (notes !== undefined) patch.notes = notes;
    if (exitPrice !== undefined) patch.exit_price = exitPrice;
    if (status === "sold" || status === "closed") patch.closed_at = new Date().toISOString();

    const { error } = await supabaseAdmin.from("broker_calls").update(patch).eq("id", id).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // New call — reject unresolvable symbols server-side too, even if someone
  // bypasses the UI's "Check" button (direct API call, bug, etc).
  if (!symbol || !String(symbol).trim()) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  const cleanSymbol = String(symbol).trim().toUpperCase();
  const lookup = await lookupSymbol(cleanSymbol);
  if (!lookup.valid) {
    return NextResponse.json(
      { error: `"${cleanSymbol}" isn't a recognized NSE trading symbol. Double-check it (e.g. RELIANCE, TCS, INFY) and try again.` },
      { status: 400 }
    );
  }

  const { error, data } = await supabaseAdmin
    .from("broker_calls")
    .insert({
      user_id: user.id,
      symbol: cleanSymbol,
      company: company || lookup.name || null,
      broker_name: brokerName || null,
      call_type: callType || "buy",
      entry_price: entryPrice ?? null,
      stop_loss: stopLoss ?? null,
      target: target ?? null,
      qty: qty ?? null,
      status: status || "watching",
      notes: notes || null,
      call_date: callDate || new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}