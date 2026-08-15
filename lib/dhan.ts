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

export async function getDhanTrades(clientId: string, accessToken: string): Promise<DhanTrade[]> {
  const res = await fetch(`${BASE_URL}/trades`, {
    headers: { "access-token": accessToken, "client-id": clientId },
  });
  if (!res.ok) {
    throw new Error(`Dhan trades request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Generates a fresh access token on demand using Client ID + PIN + a live
// TOTP code. Returns Dhan's actual error text on failure instead of hiding it,
// so we can see exactly what's wrong (wrong PIN, bad TOTP, etc).
export async function generateAccessTokenViaTotp(
  clientId: string,
  pin: string,
  totpCode: string
): Promise<{ accessToken: string } | { error: string }> {
  const url = `https://auth.dhan.co/app/generateAccessToken?dhanClientId=${encodeURIComponent(clientId)}&pin=${encodeURIComponent(pin)}&totp=${encodeURIComponent(totpCode)}`;
  const res = await fetch(url, { method: "POST" });
  const bodyText = await res.text();
  if (!res.ok) return { error: `${res.status} ${bodyText}` };
  try {
    const data = JSON.parse(bodyText);
    return data.accessToken ? { accessToken: data.accessToken } : { error: `No accessToken in response: ${bodyText}` };
  } catch {
    return { error: `Non-JSON response: ${bodyText}` };
  }
}

export async function validateDhanToken(clientId: string, accessToken: string) {
  const res = await fetch(`${BASE_URL}/profile`, {
    headers: { "access-token": accessToken, "client-id": clientId },
  });
  return res.ok;
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
