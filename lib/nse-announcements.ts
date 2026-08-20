// NSE India's corporate-announcements endpoint — confirmed (Aug 2026) to
// carry dividend declarations weeks/months before they show up in the
// corporate-actions feed (e.g. Triveni Turbine's ₹2/share dividend was
// announced 18-May-2026 with record date 02-Sep-2026, but corporate-actions
// still hadn't been updated with it as of August). This correlates a
// "Record Date" announcement (which gives the exact date) with a nearby
// "Dividend" announcement (which gives the amount) to reconstruct the same
// kind of entry corporate-actions would eventually have.
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

function parseNseDate(raw: string): Date | null {
  const match = raw.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!match) return null;
  const [, day, monAbbr, year] = match;
  const month = MONTHS[monAbbr.toLowerCase()];
  if (month === undefined) return null;
  return new Date(parseInt(year), month, parseInt(day));
}

// an_dt looks like "18-May-2026 18:58:56"
function parseAnDt(raw: string): Date | null {
  return parseNseDate(raw);
}

async function getAnnouncementsForOneSymbol(symbol: string): Promise<NseDividend | null> {
  try {
    const res = await fetchNseAuthed(
      `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`
    );
    if (!res || !res.ok) return null;
    const data = await res.json();
    const list: any[] = Array.isArray(data) ? data : data?.data || [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const recordDateEntries = list.filter((item) => {
      const desc = (item.desc || "").toLowerCase();
      const text = (item.attchmntText || "").toLowerCase();
      return desc === "record date" && text.includes("dividend");
    });

    const dividendDeclEntries = list.filter((item) => (item.desc || "").toLowerCase() === "dividend");

    let best: { date: Date; label: string } | null = null;

    for (const rd of recordDateEntries) {
      const dateMatch = (rd.attchmntText || "").match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/);
      if (!dateMatch) continue;
      const date = parseNseDate(dateMatch[1]);
      if (!date || date < today) continue;

      const rdAnnouncedAt = parseAnDt(rd.an_dt || "");
      const matchingDecl = dividendDeclEntries.find((d) => {
        const declAt = parseAnDt(d.an_dt || "");
        if (!declAt || !rdAnnouncedAt) return false;
        return Math.abs(declAt.getTime() - rdAnnouncedAt.getTime()) < 3 * 24 * 60 * 60 * 1000;
      });

      const amountMatch = matchingDecl
        ? (matchingDecl.attchmntText || "").match(/Rs\.?\s*[\d.]+(?:\s*\([^)]*\))?\s*per\s*(?:equity\s*)?share/i)
        : null;
      const label = amountMatch ? amountMatch[0] : "Dividend";

      if (!best || date < best.date) {
        best = { date, label };
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

export async function getDividendsFromAnnouncements(symbols: string[]): Promise<NseDividend[]> {
  const unique = [...new Set(symbols)];
  const results = await Promise.all(unique.map(getAnnouncementsForOneSymbol));
  return results.filter((r): r is NseDividend => r !== null);
}
