// NSE India's corporate-actions endpoint — the authoritative source for
// Indian stock dividends. Field names below are based on the commonly
// documented structure of this endpoint, not independently confirmed for
// this exact build — if dividends still don't show up after deploying,
// the next debugging step is checking the raw response shape directly,
// same as we did for the Yahoo crumb issue.
import { fetchNseAuthed } from "./nse-session";

export type NseDividend = {
  symbol: string;
  label: string;
  date: string;
};

async function getDividendForOneSymbol(symbol: string): Promise<NseDividend | null> {
  try {
    const res = await fetchNseAuthed(
      `https://www.nseindia.com/api/corporate-actions?index=equities&symbol=${encodeURIComponent(symbol)}`
    );
    if (!res || !res.ok) return null;
    const data = await res.json();
    const list: any[] = Array.isArray(data) ? data : data?.data || [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dividendEntries = list.filter((item) => {
      const subject = (item.subject || item.purpose || "").toLowerCase();
      return subject.includes("dividend");
    });

    let best: { date: Date; label: string } | null = null;
    for (const item of dividendEntries) {
      const rawDate = item.exDate || item.exdate || item.exDate1;
      if (!rawDate) continue;
      const d = new Date(rawDate);
      if (isNaN(d.getTime()) || d < today) continue;
      if (!best || d < best.date) {
        best = { date: d, label: item.subject || item.purpose || "Dividend" };
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
