import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Read-only symbol export, same pattern as /api/public/holdings — but for
// watchlist stocks (broker calls logged with status "watching", i.e. not
// yet bought). Accepts either the original holdings-export secret or a
// separate one scoped just to the Analyst Desk's daily read.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.HOLDINGS_EXPORT_SECRET && secret !== process.env.ANALYST_DESK_READ_SECRET) {
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
