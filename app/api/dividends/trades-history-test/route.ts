import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret } from "@/lib/crypto";
import { getDhanTradeHistory } from "@/lib/dhan-ledger";

// Diagnostic only — tests whether Dhan's dated trade-history endpoint
// actually returns historical trades (not just today's), which would let
// us reconstruct exactly how many shares were held on any past dividend's
// record date.
//
// IMPORTANT: this endpoint is paginated. page=0 alone stopping at a recent
// date does NOT confirm older data doesn't exist — it may just mean older
// trades are on page 1, 2, 3, etc. (if results are sorted newest-first).
// Pass ?page=1, ?page=2, etc. to check further back.
// Visit /api/dividends/trades-history-test?page=1 while logged in.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const page = parseInt(req.nextUrl.searchParams.get("page") || "0");

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

    // Wide range — over 3 years back through today — since we're now
    // testing whether pagination reveals older data, not just the range.
    const fromDate = "2023-04-01";
    const now = new Date();
    const toDate = now.toISOString().slice(0, 10);

    const trades = await getDhanTradeHistory(accessToken, fromDate, toDate, page);
    const tradesArray = Array.isArray(trades) ? trades : [];
    const earliestTime = tradesArray.length > 0 ? tradesArray[tradesArray.length - 1]?.exchangeTime : null;
    const latestTime = tradesArray.length > 0 ? tradesArray[0]?.exchangeTime : null;

    return NextResponse.json({
      page,
      fromDate,
      toDate,
      tradeCount: tradesArray.length,
      latestTradeTime: latestTime,
      earliestTradeTimeOnThisPage: earliestTime,
      trades,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message });
  }
}