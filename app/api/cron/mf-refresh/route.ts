import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getLatestNav } from "@/lib/mfapi";

// Run this ONCE A DAY (MF NAVs only update once a day anyway, usually
// updated by AMCs late evening IST — running this in the morning after
// that update has landed makes sense, e.g. 8:00 AM IST).
//
//   GET https://your-app.vercel.app/api/cron/mf-refresh?secret=YOUR_CRON_SECRET
//
// Fetches the latest NAV per unique scheme code (deduped, so if you hold the
// same fund across multiple folios it's only fetched once) and recomputes
// current_value = units * latest_nav for every holding row.
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

  const uniqueCodes = [...new Set(holdings.map((h) => h.scheme_code))];
  const navByCode: Record<string, number | null> = {};

  for (const code of uniqueCodes) {
    navByCode[code as string] = await getLatestNav(code as string);
  }

  let updated = 0;
  let skipped = 0;

  for (const h of holdings) {
    const nav = navByCode[h.scheme_code as string];
    if (nav === null || nav === undefined) { skipped++; continue; }

    await supabaseAdmin
      .from("mf_holdings")
      .update({
        current_nav: nav,
        current_value: h.units * nav,
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
  });
}
