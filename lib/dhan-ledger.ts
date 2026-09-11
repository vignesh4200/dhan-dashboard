// Dhan's Ledger Report API — returns all Credit/Debit transactions for a
// given date range. Used to find dividend credits as real, settled cash
// amounts, rather than estimating from current holding quantity (which
// would be wrong for any stock whose quantity has changed since a past
// dividend's record date).
export async function getDhanLedger(accessToken: string, fromDate: string, toDate: string) {
  const res = await fetch(
    `https://api.dhan.co/v2/ledger?from-date=${fromDate}&to-date=${toDate}`,
    { headers: { "access-token": accessToken, "Accept": "application/json" } }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dhan ledger fetch failed: ${res.status} ${text}`);
  }
  return res.json();
}

// Dhan's dated Trade History API — supposedly returns full historical
// trades for a date range (unlike the plain /v2/trades/ endpoint, which
// only returns today's trades). Paginated — page starts at 0. Untested
// against the real account at time of writing; this is a diagnostic call.
export async function getDhanTradeHistory(accessToken: string, fromDate: string, toDate: string, page: number = 0) {
  const res = await fetch(
    `https://api.dhan.co/v2/trades/${fromDate}/${toDate}/${page}`,
    { headers: { "access-token": accessToken, "Accept": "application/json" } }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dhan trade history fetch failed: ${res.status} ${text}`);
  }
  return res.json();
}