// NSE India's corporate-actions endpoint — the authoritative source for
// Indian stock dividends. Confirmed against a real response (Aug 2026):
// fields are exDate ("DD-MMM-YYYY"), subject (free text), symbol, comp.
// The endpoint returns full history (years of past entries), not just
// upcoming ones, so filtering for future dates happens here.
import { fetchNseAuthed } from "./nse-session";

export type NseDividend = {
  symbol: string;
  label: string;
  date: string;
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// NSE dates come as "DD-MMM-YYYY" (e.g. "19-Aug-2026") — not a format
// JavaScript's generic Date parser reliably handles, so this parses it
// explicitly rather than risking silent failures.
function parseNseDate(raw: string): Date | null {
  const match = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return null;
  const [, day, monAbbr, year] = match;
  const month = MONTHS[monAbbr.toLowerCase()];
  if (month === undefined) return null;
  return new Date(parseInt(year), month, parseInt(day));
}

async function getDividendForOneSymbol(symbol: string): Promise<NseDividend | null> {
  try {
    const res = await fetchNseAuthed(
      `https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}`
    );
    if (!res || !res.ok) return null;
    const data = await res.json();
    const list: any[] = Array.isArray(data) ? data : data?.data || [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dividendEntries = list.filter((item) => {
      const subject = (item.subject || "").toLowerCase();
      return subject.includes("dividend");
    });

    let best: { date: Date; label: string } | null = null;
    for (const item of dividendEntries) {
      const d = parseNseDate(item.exDate);
      if (!d || d < today) continue;
      if (!best || d < best.date) {
        best = { date: d, label: (item.subject || "Dividend").trim() };
      }
    }
    if (!best) return null;

    return {
      symbol,
      label: best.label,
      date: best.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
    };
  } catch {
    return null;
  }
}

export async function getDividendsForSymbols(symbols: string[]): Promise<NseDividend[]> {
  const unique = [...new Set(symbols)];
  const results = await Promise.all(unique.map(getDividendForOneSymbol));
  return results.filter((r): r is NseDividend => r !== null);
}
