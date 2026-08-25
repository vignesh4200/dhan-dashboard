import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { openbbConfigured, getQuotes, getCompanySentiment } from "@/lib/openbb";

// Research panel, powered by a self-hosted OpenBB ODP REST server (see
// lib/openbb.ts for setup notes). Scoped to your current Dhan holdings.
export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!openbbConfigured()) {
        return NextResponse.json({ configured: false, quotes: [], sentiment: [] });
  }

  const { data: snap } = await supabaseAdmin
      .from("portfolio_snapshots")
      .select("holdings")
      .eq("user_id", user.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .single();

  const holdings: any[] = snap?.holdings || [];
    const symbols = holdings.map((h) => h.symbol);

  const [quotes, sentimentEntries] = await Promise.all([
        getQuotes(symbols),
        Promise.all(
                symbols.slice(0, 5).map(async (symbol) => ({
                          symbol,
                          items: await getCompanySentiment(symbol),
                }))
              ),
      ]);

  return NextResponse.json({
        configured: true,
        quotes,
        sentiment: sentimentEntries.filter((e) => e.items.length > 0),
  });
}
