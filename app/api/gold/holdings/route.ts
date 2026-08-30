import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchIbjaRates, rateForPurity } from "@/lib/gold-price";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { weightGrams, purity, amountPaid, purchaseDate, note } = await req.json();
  if (!weightGrams || !purity || !amountPaid) {
    return NextResponse.json({ error: "Weight, purity, and amount paid are required" }, { status: 400 });
  }

  // Seed the current value immediately with today's rate, so it doesn't
  // show blank until the next daily cron run.
  const { rates } = await fetchIbjaRates();
  const rate = rates ? rateForPurity(rates, purity) : null;

  const { error } = await supabaseAdmin.from("gold_holdings").insert({
    user_id: user.id,
    weight_grams: weightGrams,
    purity,
    amount_paid: amountPaid,
    purchase_date: purchaseDate || null,
    note: note || null,
    current_rate_per_gram: rate,
    current_value: rate ? weightGrams * rate : amountPaid,
    rate_updated_at: rate ? new Date().toISOString() : null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("gold_holdings")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
