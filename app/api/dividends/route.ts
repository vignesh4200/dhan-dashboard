import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCalendarEventsWithSavedDividends } from "@/lib/dividend-cache";

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

  if (!snap) return NextResponse.json({ events: [] });

  const symbols = (snap.holdings || []).map((h: any) => h.symbol);
  // Live NSE/Yahoo data, with dividends NSE failed to return (it blocks
  // cloud IPs now and then) filled in from the last saved copy.
  const { events, dividendSource } = await getCalendarEventsWithSavedDividends(user.id, symbols);
  return NextResponse.json({ events, dividendSource });
}
