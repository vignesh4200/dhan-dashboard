import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAmfiNavsBySchemeCode } from "@/lib/amfi-check";

// Run this ONCE A DAY. Switched from mfapi.in to AMFI's own official NAV
// file directly (confirmed Aug 2026: mfapi.in was serving stale data for
// several days straight for some schemes — verified by re-fetching minutes
// apart and getting identical values both times. AMFI's own file is the
// actual origin of this data and proved reliable in direct testing).
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: holdings } = await supabaseAdmin
    .from("mf_holdings")
    .select("id, scheme_code, units")
    .not("scheme_code", "is", null);

  if (!holdings || holdings.length === 0) {
    return NextResponse.json({ ranAt: new Date().toISOString(), updated: 0, message: "No holdings with a scheme code yet." });
  }

  const uniqueCodes = [...new Set(holdings.map((h) => h.scheme_code as string))];
  const { navs, diag } = await getAmfiNavsBySchemeCode(uniqueCodes);

  let updated = 0;
  let skipped = 0;

  for (const h of holdings) {
    const entry = navs[h.scheme_code as string];
    if (!entry) { skipped++; continue; }

    await supabaseAdmin
      .from("mf_holdings")
      .update({
        current_nav: entry.nav,
        current_value: h.units * entry.nav,
        nav_updated_at: new Date().toISOString(),
      })
      .eq("id", h.id);
    updated++;
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    uniqueSchemes: uniqueCodes.length,
    updated,
    skipped,
    amfiDiagnostics: diag,
  });
}
