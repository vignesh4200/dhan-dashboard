import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getFundPortfolio, getNavHistory } from "@/lib/mf-portfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Per-fund extras for the Mutual Funds page: full NAV history (for the
// range-selectable chart and returns) and the fund's latest disclosed
// portfolio (for the "what your MF money owns" look-through).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: rows } = await supabaseAdmin
    .from("mf_holdings")
    .select("scheme_code, scheme_name")
    .eq("user_id", user.id)
    .not("scheme_code", "is", null);

  const schemes = new Map<string, string>();
  (rows || []).forEach((r: any) => schemes.set(String(r.scheme_code), r.scheme_name));

  const entries = await Promise.all(
    [...schemes.entries()].map(async ([code, name]) => {
      const [navHistory, portfolio] = await Promise.all([getNavHistory(code), getFundPortfolio(code, name)]);
      return [code, { navHistory, portfolio }] as const;
    })
  );

  return NextResponse.json({ funds: Object.fromEntries(entries) });
}
