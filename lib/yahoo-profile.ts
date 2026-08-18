// Real sector/industry classification and company names via Yahoo Finance's
// quoteSummary "assetProfile"/"price" modules. These need the cookie+crumb
// session handled in lib/yahoo-session.ts — Yahoo blocks these specific
// modules without it (confirmed via "Invalid Crumb" error), unlike the
// chart/price endpoint used for LTP, which doesn't need auth.
import { fetchYahooAuthed } from "./yahoo-session";

export async function getSectorFromYahoo(tradingSymbol: string): Promise<string> {
  try {
    const res = await fetchYahooAuthed(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(tradingSymbol)}.NS?modules=assetProfile`
    );
    if (!res || !res.ok) return "Other";
    const data = await res.json();
    const sector = data?.quoteSummary?.result?.[0]?.assetProfile?.sector;
    return sector || "Other";
  } catch {
    return "Other";
  }
}

export async function getSectorsForHoldings(symbols: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(symbols)];
  const results = await Promise.all(unique.map((s) => getSectorFromYahoo(s)));
  const out: Record<string, string> = {};
  unique.forEach((s, i) => { out[s] = results[i]; });
  return out;
}

export async function getCompanyName(tradingSymbol: string): Promise<string> {
  try {
    const res = await fetchYahooAuthed(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(tradingSymbol)}.NS?modules=price`
    );
    if (!res || !res.ok) return tradingSymbol;
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
