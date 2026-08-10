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
  if (!res.ok) return null; // token already expired, or renewal failed — needs manual regeneration
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
// The holdings endpoint returns quantity and average cost, but NOT the current
// market price. Dhan's Market Quote API supplies that (ticker/quote/full modes).
//
// IMPORTANT: verify the exact request shape against the current docs before relying
// on this in production — Dhan's market-quote payload format has changed across
// versions and wasn't fully confirmed at build time:
// https://dhanhq.co/docs/v2/market-quote/
//
// Below is a best-effort implementation using the documented pattern (POST a list
// of exchange-segment/security-id pairs, get back LTP per instrument). Test it with
// one holding first and adjust field names if Dhan's response differs.
export async function getLtpForHoldings(
  clientId: string,
  accessToken: string,
  holdings: DhanHolding[]
): Promise<Record<string, number>> {
  const body: Record<string, string[]> = {};
  for (const h of holdings) {
    const segment = h.exchange === "BSE" ? "BSE_EQ" : "NSE_EQ";
    body[segment] = body[segment] || [];
    body[segment].push(h.securityId);
  }

  const res = await fetch(`${BASE_URL}/marketfeed/ltp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "access-token": accessToken,
      "client-id": clientId,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Dhan LTP request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();

  // Map back to { securityId: ltp }. Adjust this parsing to match the actual
  // response shape you see when you test it — see the doc link above.
  const out: Record<string, number> = {};
  for (const segment of Object.keys(data?.data || {})) {
    for (const secId of Object.keys(data.data[segment] || {})) {
      out[secId] = data.data[segment][secId]?.last_price ?? data.data[segment][secId]?.ltp;
    }
  }
  return out;
}
