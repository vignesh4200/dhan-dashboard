// Real sector/industry classification via Yahoo Finance's quoteSummary
// "assetProfile" module — confirmed field names (sector, industry) via
// multiple independent sources. Same free/unofficial endpoint family as the
// price feed, so no new integration risk. This replaces the earlier static
// hand-written sector map, which only covered a handful of symbols and
// defaulted everything else to "Other" — a real accuracy problem for any
// portfolio with more than a few well-known names.
export async function getSectorFromYahoo(tradingSymbol: string): Promise<string> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(tradingSymbol)}.NS?modules=assetProfile`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return "Other";
    const data = await res.json();
    const sector = data?.quoteSummary?.result?.[0]?.assetProfile?.sector;
    return sector || "Other";
  } catch {
    return "Other";
  }
}

// Fetches sectors for many symbols in parallel, deduped, with a small
// concurrency-friendly Promise.all — fine for a personal portfolio's worth
// of unique symbols (tens, not hundreds).
export async function getSectorsForHoldings(symbols: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(symbols)];
  const results = await Promise.all(unique.map((s) => getSectorFromYahoo(s)));
  const out: Record<string, string> = {};
  unique.forEach((s, i) => { out[s] = results[i]; });
  return out;
}

// Resolves a ticker symbol to its real company name (e.g. "TEJASNET" ->
// "Tejas Networks Limited"). News articles use company names, not ticker
// symbols, so searching news by raw symbol alone produces loosely-matched,
// sometimes wrong results — this fixes that at the source.
export async function getCompanyName(tradingSymbol: string): Promise<string> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(tradingSymbol)}.NS?modules=price`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return tradingSymbol;
    const data = await res.json();
    const price = data?.quoteSummary?.result?.[0]?.price;
    return price?.longName || price?.shortName || tradingSymbol;
  } catch {
    return tradingSymbol;
  }
}

export async function getCompanyNames(symbols: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(symbols)];
  const results = await Promise.all(unique.map((s) => getCompanyName(s)));
  const out: Record<string, string> = {};
  unique.forEach((s, i) => { out[s] = results[i]; });
  return out;
}
