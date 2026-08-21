import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAmfiNavsBySchemeCode } from "@/lib/amfi-check";

// Diagnostic: compares our stored NAV against AMFI's own official published
// file directly, side-stepping any comparison against a third-party app
// (like Groww) that may have its own separate caching/refresh lag.
// Visit /api/mutual-funds/verify-nav directly to see the raw comparison.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: holdings } = await supabaseAdmin
    .from("mf_holdings")
    .select("scheme_code, scheme_name, current_nav, nav_updated_at")
    .eq("user_id", user.id)
    .not("scheme_code", "is", null);

  if (!holdings || holdings.length === 0) {
    return NextResponse.json({ comparisons: [], message: "No holdings with a scheme code to check." });
  }

  const codes = [...new Set(holdings.map((h) => h.scheme_code as string))];
  const { navs: amfiNavs, diag } = await getAmfiNavsBySchemeCode(codes);

  const comparisons = holdings.map((h) => {
    const amfi = amfiNavs[h.scheme_code as string];
    const ourNav = h.current_nav;
    const diffPct = amfi && ourNav ? ((ourNav - amfi.nav) / amfi.nav) * 100 : null;
    return {
      schemeName: h.scheme_name,
      schemeCode: h.scheme_code,
      ourNav,
      ourUpdatedAt: h.nav_updated_at,
      amfiNav: amfi?.nav ?? null,
      amfiDate: amfi?.date ?? null,
      diffPct: diffPct !== null ? Math.round(diffPct * 1000) / 1000 : null,
    };
  });

  return NextResponse.json({ comparisons, diagnostics: diag, requestedCodes: codes });
}
