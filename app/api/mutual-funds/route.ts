import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getLatestNav } from "@/lib/mfapi";

// Returns your saved mutual fund holdings with a freshly-fetched current NAV
// per fund, so current value/returns are always up to date without needing
// a background cron (MF NAVs only change once a day anyway).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: holdings } = await supabaseAdmin
    .from("mf_holdings")
    .select("*")
    .eq("user_id", user.id);

  if (!holdings || holdings.length === 0) return NextResponse.json({ holdings: [] });

  const enriched = await Promise.all(
    holdings.map(async (h) => {
      const nav = h.scheme_code ? await getLatestNav(h.scheme_code) : null;
      const currentNav = nav ?? h.avg_nav;
      const currentValue = h.units * currentNav;
      const pnl = currentValue - h.invested_amount;
      const pnlPct = h.invested_amount > 0 ? (pnl / h.invested_amount) * 100 : 0;
      return {
        schemeCode: h.scheme_code,
        schemeName: h.scheme_name,
        units: h.units,
        invested: h.invested_amount,
        avgNav: h.avg_nav,
        currentNav,
        currentValue,
        pnl,
        pnlPct,
      };
    })
  );

  return NextResponse.json({ holdings: enriched });
}
