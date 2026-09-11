// Reconstructs how many shares of a stock you actually held on a specific
// past date, using the complete trade history. This is the accurate
// alternative to guessing from today's holdings — if you've bought or sold
// since a dividend's record date, today's quantity would be wrong.
export type DhanTrade = {
  transactionType: "BUY" | "SELL";
  customSymbol: string;
  isin: string;
  tradedQuantity: number;
  exchangeTime: string;
};

// Returns the share count held immediately as of (end of) a given date,
// for one ISIN, based on chronological BUY/SELL trades up to that point.
export function shareCountAsOf(trades: DhanTrade[], isin: string, asOfDate: string): number {
  const cutoff = new Date(asOfDate);
  cutoff.setHours(23, 59, 59, 999);

  const relevant = trades
    .filter((t) => t.isin === isin && new Date(t.exchangeTime) <= cutoff)
    .sort((a, b) => new Date(a.exchangeTime).getTime() - new Date(b.exchangeTime).getTime());

  let qty = 0;
  for (const t of relevant) {
    qty += t.transactionType === "BUY" ? t.tradedQuantity : -t.tradedQuantity;
  }
  return Math.max(0, qty);
}

// Builds an ISIN -> current trading symbol map from current holdings, so
// trade records (which only carry ISIN + company name) can be matched
// against NSE's dividend data (which is keyed by trading symbol). Only
// covers symbols still currently held — a fully-exited historical
// position won't resolve through this map.
export function buildIsinSymbolMap(holdings: { tradingSymbol: string; isin?: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of holdings) {
    if (h.isin) map[h.isin] = h.tradingSymbol;
  }
  return map;
}