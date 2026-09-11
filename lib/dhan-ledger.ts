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

// Dhan's dated Trade History API — a single page. ~20 trades per page,
// sorted newest-first. Use getAllDhanTrades below for the full history —
// this is the low-level single-page fetch it builds on.
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

// Confirmed (Sept 2026) via direct testing: page=0 alone stops at a recent
// date, but page=1 reveals genuinely older trades — this is pagination,
// not a hard API ceiling. This helper loops through every page until
// exhausted, returning the complete trade history for the given date
// range so past holdings can be reconstructed accurately.
export async function getAllDhanTrades(accessToken: string, fromDate: string, toDate: string) {
  const all: any[] = [];
  let page = 0;
  const maxPages = 200; // safety cap against an infinite loop, not a real limit

  while (page < maxPages) {
    const batch = await getDhanTradeHistory(accessToken, fromDate, toDate, page);
    const batchArray = Array.isArray(batch) ? batch : [];
    if (batchArray.length === 0) break;
    all.push(...batchArray);
    page++;
    // A page smaller than the standard size means it was the last one.
    if (batchArray.length < 20) break;
  }

  return all;
}