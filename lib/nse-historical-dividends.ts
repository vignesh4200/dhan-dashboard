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

export type HistoricalDivDiagnostics = {
  fetchOk: boolean;
  httpStatus: number | null;
  rawItemCount: number;
  sampleRawItem: any;
  error: string | null;
};

export async function getHistoricalDividendsForSymbol(
  symbol: string
): Promise<{ dividends: HistoricalDividend[]; diag: HistoricalDivDiagnostics }> {
  const diag: HistoricalDivDiagnostics = {
    fetchOk: false, httpStatus: null, rawItemCount: 0, sampleRawItem: null, error: null,
  };

  try {
    const res = await fetchNseAuthed(
      `https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}`
    );
    if (!res) {
      diag.error = "fetchNseAuthed returned null (session/cookie setup likely failed)";
      return { dividends: [], diag };
    }
    diag.httpStatus = res.status;
    if (!res.ok) {
      diag.error = `HTTP ${res.status}`;
      return { dividends: [], diag };
    }

    const data = await res.json();
    const list: any[] = Array.isArray(data) ? data : data?.data || [];
    diag.fetchOk = true;
    diag.rawItemCount = list.length;
    diag.sampleRawItem = list[0] || null;

    const results: HistoricalDividend[] = [];
    for (const item of list) {
      const subject = (item.subject || "").toLowerCase();
      if (!subject.includes("dividend")) continue;

      const date = parseNseDate(item.exDate || "");
      if (!date) continue;

      // Two dividend declaration formats seen in real NSE data:
      // 1. "Dividend - Rs 5.5 Per Share" — direct rupee amount.
      // 2. "Dividend - 100%" — percentage of face value (confirmed
      //    Sept 2026, e.g. GMDCLTD's "Dividend - 100%" on a face value of
      //    Rs 2 means Rs 2 per share). faceVal is available on the same
      //    raw item, so this is computed rather than left unparsed.
      let perShareAmount: number | null = null;
      const rsMatch = (item.subject || "").match(/R[se]\.?\s*([\d.]+)/i);
      if (rsMatch) {
        perShareAmount = parseFloat(rsMatch[1]);
      } else {
        const pctMatch = (item.subject || "").match(/([\d.]+)\s*%/);
        const faceVal = parseFloat(item.faceVal);
        if (pctMatch && !isNaN(faceVal) && faceVal > 0) {
          perShareAmount = (parseFloat(pctMatch[1]) / 100) * faceVal;
        }
      }

      results.push({
        symbol,
        recordDate: date.toISOString().slice(0, 10),
        perShareAmount,
        rawLabel: item.subject || "",
      });
    }
    return { dividends: results, diag };
  } catch (e: any) {
    diag.error = e?.message || "fetch threw";
    return { dividends: [], diag };
  }
}