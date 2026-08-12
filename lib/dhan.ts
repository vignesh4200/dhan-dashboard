// Thin client for the DhanHQ v2 API.
// Official docs: https://dhanhq.co/docs/v2/
//
// Confirmed against current docs (Aug 2026):
//   GET https://api.dhan.co/v2/holdings   headers: access-token, client-id
//   GET https://api.dhan.co/v2/profile    -> use this to validate a token from Settings

const BASE_URL = "https://api.dhan.co/v2";

export type DhanHolding = {
  exchange: string;
  tradingSymbol: string;
  securityId: string;
  isin: string;
  totalQty: number;
  avgCostPrice: number;
};

export type DhanOrder = {
  orderId: string;
  transactionType: string;
  tradingSymbol: string;
  quantity: number;
  price: number;
  orderStatus: string;
  createTime: string;
};

export async function getDhanOrders(clientId: string, accessToken: string): Promise<DhanOrder[]> {
  const res = await fetch(`${BASE_URL}/orders`, {
    headers: { "access-token": accessToken, "client-id": clientId },
  });
  if (!res.ok) {
    throw new Error(`Dhan orders request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export type DhanTrade = {
  orderId: string;
  transactionType: string;
  tradingSymbol: string;
  tradedQuantity: number;
  tradedPrice: number;
  exchangeTradeTime: string;
};

// Today's executed trades. Dhan's v2 trade-history-by-date-range endpoint
// wasn't fully confirmed at build time — this uses the documented "trade book"
// endpoint, which covers same-day trades. Verify against
// https://dhanhq.co/docs/v2/orders/ if you need a longer history window.
export async function getDhanTrades(clientId: string, accessToken: string): Promise<DhanTrade[]> {
  const res = await fetch(`${BASE_URL}/trades`, {
    headers: { "access-token": accessToken, "client-id": clientId },
  });
  if (!res.ok) {
    throw new Error(`Dhan trades request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function validateDhanToken(clientId: string, accessToken: string) {
  const res = await fetch(`${BASE_URL}/profile`, {
    headers: { "access-token": accessToken, "client-id": clientId },
  });
  return res.ok;
}

// Dhan's personal access tokens (from the "Access Token" tab in Profile, no
// redirect URL) are short-lived — roughly 24 hours — but can be extended by
// another 24 hours via this endpoint, as long as it's called BEFORE the token
// fully expires. Call this at least once a day, every day (weekends included),
// and the token effectively never expires without you touching anything.
// Docs: https://dhanhq.co/docs/v2/authentication/
export async function renewDhanToken(
  clientId: string,
  accessToken: string
): Promise<{ accessToken: string } | null> {
  const res = await fetch(`${BASE_URL}/RenewToken`, {
    method: "PUT",
    headers: { "access-token": accessToken, "dhanClientId": clientId },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { accessToken: data.accessToken };
}

export async function getDhanHoldings(
  clientId: string,
  accessToken: string
): Promise<DhanHolding[]> {
  const res = await fetch(`${BASE_URL}/holdings`, {
    headers: {
      "Content-Type": "application/json",
      "access-token": accessToken,
      "client-id": clientId,
    },
  });
  if (!res.ok) {
    throw new Error(`Dhan holdings request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// --- Live price (LTP) lookup ---
// Dhan's own live-price API requires a paid "Data API" subscription (₹499+/month).
// This uses Yahoo Finance's public quote endpoint instead — free, no key needed.
export async function getLtpFromYahoo(
  holdings: DhanHolding[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  await Promise.all(
    holdings.map(async (h) => {
      const suffix = h.exchange === "BSE" ? ".BO" : ".NS";
      const yahooSymbol = `${h.tradingSymbol}${suffix}`;
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (!res.ok) return;
        const data = await res.json();
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (typeof price === "number") {
          out[h.tradingSymbol] = price;
        }
      } catch {}
    })
  );

  return out;
}
