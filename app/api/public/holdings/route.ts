import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
 
// Read-only symbol export for external integrations (e.g. the Smart Money
// Desk disclosure scanner) to cross-reference public bulk-deal / insider
// filings against what you actually hold — without handing out Supabase
// credentials or any financial figures (qty, P&L, invested value).
//
// GET https://your-app.vercel.app/api/public/holdings?secret=YOUR_HOLDINGS_EXPORT_SECRET
//
// Set HOLDINGS_EXPORT_SECRET in Vercel's Environment Variables (generate one
// the same way as CRON_SECRET — see README section 5). This is a DIFFERENT
// value from CRON_SECRET: this one gets shared with an external caller, so
// keep it scoped to this one read-only route rather than reusing the secret
// that can also trigger your refresh/cron jobs.
//
// Only ever returns ticker symbols — never qty, avg cost, LTP, P&L, or which
// user they belong to. If that's ever not true, this route has a bug.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.HOLDINGS_EXPORT_SECRET || secret !== process.env.HOLDINGS_EXPORT_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
 
  // Personal app, but the schema is multi-user — pull the latest snapshot
  // per user and merge, rather than assuming a single row exists.
  const { data: users } = await supabaseAdmin.from("users").select("id");
 
  const symbolSet = new Set<string>();
  let latestCapturedAt: string | null = null;
 
  for (const user of users || []) {
    const { data: snap } = await supabaseAdmin
      .from("portfolio_snapshots")
      .select("holdings, captured_at")
      .eq("user_id", user.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
 
    if (!snap) continue;
 
    const holdings: any[] = snap.holdings || [];
    for (const h of holdings) {
      if (h?.symbol) symbolSet.add(String(h.symbol).trim().toUpperCase());
    }
 
    if (!latestCapturedAt || snap.captured_at > latestCapturedAt) {
      latestCapturedAt = snap.captured_at;
    }
  }
 
  return NextResponse.json({
    symbols: Array.from(symbolSet).sort(),
    asOf: latestCapturedAt,
  });
}
