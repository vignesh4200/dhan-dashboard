import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret } from "@/lib/crypto";
import { getDhanTrades } from "@/lib/dhan";

// IMPORTANT CAVEAT: Dhan's confirmed /v2/trades endpoint returns TODAY's
// executed trades only. Computing true "closed trades" (a buy fully matched
// with a later sell, possibly days/weeks apart) needs a longer trade-history
// window, which Dhan's docs reference but the exact date-range request shape
// wasn't confirmed at build time — see https://dhanhq.co/docs/v2/orders/.
// For now, this does simple same-day FIFO matching.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: creds } = await supabaseAdmin
    .from("dhan_credentials")
    .select("dhan_client_id, access_token_encrypted")
    .eq("user_id", user.id)
    .single();

  if (!creds) return NextResponse.json({ closedTrades: [] });

  try {
    const accessToken = decryptSecret(creds.access_token_encrypted);
    const trades = await getDhanTrades(creds.dhan_client_id, accessToken);

    const bySymbol: Record<string, { buys: any[]; sells: any[] }> = {};
    for (const t of trades) {
      bySymbol[t.tradingSymbol] = bySymbol[t.tradingSymbol] || { buys: [], sells: [] };
      if (t.transactionType === "BUY") bySymbol[t.tradingSymbol].buys.push({ ...t });
      else bySymbol[t.tradingSymbol].sells.push({ ...t });
    }

    const closedTrades: any[] = [];
    for (const [symbol, { buys, sells }] of Object.entries(bySymbol)) {
      for (const sell of sells) {
        let remaining = sell.tradedQuantity;
        while (remaining > 0 && buys.length > 0) {
          const buy = buys[0];
          const matchQty = Math.min(remaining, buy.tradedQuantity);
          closedTrades.push({
            symbol,
            qty: matchQty,
            entry: buy.tradedPrice,
            exit: sell.tradedPrice,
            pnl: (sell.tradedPrice - buy.tradedPrice) * matchQty,
          });
          buy.tradedQuantity -= matchQty;
          remaining -= matchQty;
          if (buy.tradedQuantity <= 0) buys.shift();
        }
      }
    }

    return NextResponse.json({ closedTrades, note: "Same-day matches only." });
  } catch (e: any) {
    return NextResponse.json({ closedTrades: [], error: e.message });
  }
}
