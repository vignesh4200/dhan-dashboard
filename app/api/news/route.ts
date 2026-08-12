import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getNewsForSymbols } from "@/lib/news";

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

  if (!snap) return NextResponse.json({ news: [] });

  const symbols = (snap.holdings || []).map((h: any) => h.symbol);
  const news = await getNewsForSymbols(symbols);
  return NextResponse.json({ news });
}
