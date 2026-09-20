import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Read-only symbol export, same pattern and secret as /api/public/holdings —
// but for watchlist stocks (broker calls logged with status "watching",
// i.e. not yet bought) rather than actual holdings. The daily Analyst Desk
// run uses this + /api/public/holdings together to know the full set of
// stocks to score each day.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.HOLDINGS_EXPORT_SECRET || secret !== process.env.HOLDINGS_EXPORT_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: calls } = await supabaseAdmin
    .from("broker_calls")
    .select("symbol, status")
    .eq("status", "watching");

  const symbols = Array.from(
    new Set((calls || []).map((c: any) => String(c.symbol).trim().toUpperCase()))
  ).sort();

  return NextResponse.json({ symbols });
}
