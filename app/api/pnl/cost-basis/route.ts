import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Saved cost for shares Dhan credits at ₹0 (IPO allotments, transfers in).
// Keyed by ISIN + credit date, exactly as the ₹0 BUY appears in trade
// history. Read by /api/pnl and applied in lib/pnl-engine.ts.
//
//   POST   { isin, date: "YYYY-MM-DD", price, note? }  → save / update
//   DELETE { isin, date }                               → remove
const ISIN_RE = /^IN[A-Z0-9]{10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const isin = String(body?.isin || "");
  const date = String(body?.date || "");
  const price = Number(body?.price);
  if (!ISIN_RE.test(isin) || !DATE_RE.test(date)) return NextResponse.json({ error: "Invalid ISIN or date" }, { status: 400 });
  if (!Number.isFinite(price) || price < 0 || price > 1e7) return NextResponse.json({ error: "Enter a price per share" }, { status: 400 });
  const note = body?.note ? String(body.note).slice(0, 200) : null;

  const { error } = await supabaseAdmin.from("cost_basis_overrides").upsert(
    { user_id: user.id, isin, credit_date: date, price, note, updated_at: new Date().toISOString() },
    { onConflict: "user_id,isin,credit_date" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const isin = String(body?.isin || "");
  const date = String(body?.date || "");
  if (!ISIN_RE.test(isin) || !DATE_RE.test(date)) return NextResponse.json({ error: "Invalid ISIN or date" }, { status: 400 });

  const { error } = await supabaseAdmin.from("cost_basis_overrides").delete()
    .eq("user_id", user.id).eq("isin", isin).eq("credit_date", date);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
