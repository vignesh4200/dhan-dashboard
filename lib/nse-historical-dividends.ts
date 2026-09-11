// Fetches ALL dividend records (past and future) from NSE's
// corporate-actions feed for one symbol — unlike lib/nse-dividends.ts,
// which deliberately filters to upcoming-only for the "next dividend"
// display. This is used to pair historical record dates with a
// reconstructed share count, to compute what you actually would have
// received.
import { fetchNseAuthed } from "./nse-session";

export type HistoricalDividend = {
  symbol: string;
  recordDate: string; // ISO date
  perShareAmount: number | null;
  rawLabel: string;
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseNseDate(raw: string): Date | null {
  const match = raw.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!match) return null;
  const [, day, monAbbr, year] = match;
  const month = MONTHS[monAbbr.toLowerCase()];
  if (month === undefined) return null;
  return new Date(parseInt(year), month, parseInt(day));
}

export async function getHistoricalDividendsForSymbol(symbol: string): Promise<HistoricalDividend[]> {
  try {
    const res = await fetchNseAuthed(
      `https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}`
    );
    if (!res || !res.ok) return [];
    const data = await res.json();
    const list: any[] = Array.isArray(data) ? data : data?.data || [];

    const results: HistoricalDividend[] = [];
    for (const item of list) {
      const subject = (item.subject || "").toLowerCase();
      if (!subject.includes("dividend")) continue;

      const date = parseNseDate(item.exDate || "");
      if (!date) continue;

      const amountMatch = (item.subject || "").match(/R[se]\.?\s*([\d.]+)/i);
      const perShareAmount = amountMatch ? parseFloat(amountMatch[1]) : null;

      results.push({
        symbol,
        recordDate: date.toISOString().slice(0, 10),
        perShareAmount,
        rawLabel: item.subject || "",
      });
    }
    return results;
  } catch {
    return [];
  }
}