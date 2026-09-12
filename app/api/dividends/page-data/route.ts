import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: received } = await supabaseAdmin
    .from("dividend_received")
    .select("*")
    .eq("user_id", user.id)
    .order("record_date", { ascending: false });

  const receivedList = received || [];

  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = new Date(fyStartYear, 3, 1);

  const receivedThisFY = receivedList
    .filter((r) => new Date(r.record_date) >= fyStart)
    .reduce((sum, r) => sum + Number(r.amount), 0);

  const bySymbol: Record<string, number> = {};
  for (const r of receivedList) {
    bySymbol[r.symbol] = (bySymbol[r.symbol] || 0) + Number(r.amount);
  }

  const { data: latestSnap } = await supabaseAdmin
    .from("portfolio_snapshots")
    .select("holdings")
    .eq("user_id", user.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .single();

  const holdings = latestSnap?.holdings || [];
  const investedBySymbol: Record<string, number> = {};
  for (const h of holdings) investedBySymbol[h.symbol] = h.invested;

  const yieldRanking = Object.entries(bySymbol)
    .map(([symbol, totalReceived]) => {
      const invested = investedBySymbol[symbol];
      const yieldPct = invested ? (totalReceived / invested) * 100 : null;
      return { symbol, totalReceived, yieldPct };
    })
    .filter((r) => r.yieldPct !== null)
    .sort((a, b) => (b.yieldPct ?? 0) - (a.yieldPct ?? 0));

  return NextResponse.json({
    received: receivedList,
    receivedThisFY,
    fyLabel: `Apr ${fyStartYear} – Mar ${fyStartYear + 1}`,
    yieldRanking,
  });
}