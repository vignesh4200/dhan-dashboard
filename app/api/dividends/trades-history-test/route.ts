import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret } from "@/lib/crypto";
import { getDhanTradeHistory } from "@/lib/dhan-ledger";

// Diagnostic only — tests whether Dhan's dated trade-history endpoint
// actually returns historical trades (not just today's), which would let
// us reconstruct exactly how many shares were held on any past dividend's
// record date. Visit /api/dividends/trades-history-test directly while
// logged in.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: creds } = await supabaseAdmin
    .from("dhan_credentials")
    .select("access_token_encrypted")
    .eq("user_id", user.id)
    .single();

  if (!creds?.access_token_encrypted) {
    return NextResponse.json({ error: "No cached Dhan token yet — trigger the stock refresh cron first, then retry this." });
  }

  try {
    const accessToken = decryptSecret(creds.access_token_encrypted);

    // Try a wide range — one year back through today — to see how far
    // back this endpoint actually returns real data.
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const fromDate = oneYearAgo.toISOString().slice(0, 10);
    const toDate = now.toISOString().slice(0, 10);

    const trades = await getDhanTradeHistory(accessToken, fromDate, toDate, 0);
    return NextResponse.json({ fromDate, toDate, tradeCount: Array.isArray(trades) ? trades.length : "not an array", trades });
  } catch (e: any) {
    return NextResponse.json({ error: e.message });
  }
}