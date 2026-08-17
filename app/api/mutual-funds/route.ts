import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Returns your saved mutual fund holdings. Units and Invested Value are
// fixed from your last uploaded report; current_value (and therefore
// returns) is kept fresh by the daily NAV-refresh cron for any holding with
// a confirmed scheme code — recomputed here from the latest stored NAV
// rather than trusting a possibly-stale saved "returns" number.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: holdings } = await supabaseAdmin
    .from("mf_holdings")
    .select("*")
    .eq("user_id", user.id)
    .order("current_value", { ascending: false });

  return NextResponse.json({
    holdings: (holdings || []).map((h) => {
      const pnl = h.current_value - h.invested_amount;
      const pnlPct = h.invested_amount > 0 ? (pnl / h.invested_amount) * 100 : 0;
      return {
        schemeName: h.scheme_name,
        schemeCode: h.scheme_code,
        amc: h.amc,
        category: h.category,
        subCategory: h.sub_category,
        folioNo: h.folio_no,
        units: h.units,
        invested: h.invested_amount,
        currentValue: h.current_value,
        currentNav: h.current_nav,
        returns: pnl,
        returnsPct: pnlPct,
        xirr: h.xirr,
        reportDate: h.report_date,
        navUpdatedAt: h.nav_updated_at,
      };
    }),
  });
}
