import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Saves the confirmed holdings. Units and Invested Value come from your real
// Groww Holdings Report (accurate, stable until you upload again). Current
// value starts as Groww's own snapshot, then gets refreshed daily by the
// mf-refresh cron using the confirmed scheme_code, so it stays live between
// uploads instead of going stale.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { holdings, reportDate } = await req.json();
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return NextResponse.json({ error: "No holdings to save" }, { status: 400 });
  }

  await supabaseAdmin.from("mf_holdings").delete().eq("user_id", user.id);

  const rows = holdings.map((h: any) => ({
    user_id: user.id,
    scheme_code: h.selectedSchemeCode ? String(h.selectedSchemeCode) : null,
    scheme_name: h.selectedSchemeName || h.schemeName,
    amc: h.amc,
    category: h.category,
    sub_category: h.subCategory,
    folio_no: h.folioNo,
    units: h.units,
    invested_amount: h.investedValue,
    current_value: h.currentValue,
    returns: h.returns,
    xirr: h.xirr,
    report_date: reportDate || null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin.from("mf_holdings").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, saved: rows.length });
}
