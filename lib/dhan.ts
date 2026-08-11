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

// --- Live price (LTP) lookup ---
// Dhan's own live-price API requires a paid "Data API" subscription (₹499+/month).
// This uses Yahoo Finance's public quote endpoint instead — free, no key needed.
// It's an unofficial/undocumented endpoint, so it could change or get rate-limited
// without notice, but it's reliable enough for a personal 15-minute refresh of a
// handful of holdings. Prices may lag your broker's tick by a few seconds and won't
// always match Dhan's feed to the paisa.
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
      } catch {
        // Skip this one — the caller falls back to avg cost price if a symbol is missing.
      }
    })
  );

  return out;
}