import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Step 2 of 2: saves the funds you confirmed in the review step. Replaces
// your entire mutual fund holdings list with this set, since a fresh order
// history export represents the full current picture.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { funds } = await req.json();
  if (!Array.isArray(funds) || funds.length === 0) {
    return NextResponse.json({ error: "No funds to save" }, { status: 400 });
  }

  await supabaseAdmin.from("mf_holdings").delete().eq("user_id", user.id);

  const rows = funds.map((f: any) => ({
    user_id: user.id,
    scheme_code: f.schemeCode ? String(f.schemeCode) : null,
    scheme_name: f.schemeName || f.fundName,
    units: f.units,
    invested_amount: f.invested,
    avg_nav: f.avgNav,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin.from("mf_holdings").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, saved: rows.length });
}
