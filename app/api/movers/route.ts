import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Volume/momentum data via Yahoo Finance's free public endpoint (same source
// as the price feed) — scoped to your current holdings.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: snap } = await supabaseAdmin
    .from("portfolio_snapshots")
    .select("holdings")
    .eq("user_id", user.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .single();

  if (!snap) return NextResponse.json({ movers: [] });

  const holdings: any[] = snap.holdings || [];
  const movers: any[] = [];

  await Promise.all(
    holdings.map(async (h) => {
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(h.symbol)}.NS?interval=1d&range=15d`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (!res.ok) return;
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        const volumes: number[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.volume || [];
        const todayVol = volumes[volumes.length - 1];
        const avgVol = volumes.filter((v) => typeof v === "number").reduce((s, v, _, arr) => s + v / arr.length, 0);
        const volX = avgVol > 0 ? todayVol / avgVol : null;
        const dayChgPct = meta?.regularMarketPrice && meta?.previousClose
          ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100
          : null;

        let signal = "Steady";
        if (volX && volX > 2 && dayChgPct && dayChgPct > 1) signal = "Breaking out on volume";
        else if (volX && volX > 2 && dayChgPct && dayChgPct < -1) signal = "Breaking down on volume";
        else if (dayChgPct && Math.abs(dayChgPct) > 3) signal = "Big move today";

        movers.push({
          symbol: h.symbol,
          ltp: meta?.regularMarketPrice ?? h.ltp,
          dayChgPct: dayChgPct ?? 0,
          volX: volX ?? 0,
          signal,
        });
      } catch {}
    })
  );

  movers.sort((a, b) => (b.volX || 0) - (a.volX || 0));
  return NextResponse.json({ movers: movers.slice(0, 8) });
}
