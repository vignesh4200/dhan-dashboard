// NSE India's corporate-announcements endpoint — confirmed (Aug 2026) to
// carry dividend declarations weeks/months before they show up in the
// corporate-actions feed. This correlates a "Record Date" announcement
// (which gives the exact date) with a "Dividend" announcement (which gives
// the amount) to reconstruct the same kind of entry corporate-actions would
// eventually have.
//
// Important: the amount announcement and the record-date fixation can be
// MONTHS apart, not days — e.g. RITES announced its ₹2.75 Final Dividend on
// 19-May-2026, but the Record Date wasn't fixed until 25-Aug-2026. So this
// matches by dividend TYPE (Final vs Interim, parsed from the record date
// text) and takes the most recent matching declaration before the record
// date announcement, rather than assuming they're close in time.
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
  const abbrevMatch = raw.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (abbrevMatch) {
    const [, day, monAbbr, year] = abbrevMatch;
    const month = MONTHS[monAbbr.toLowerCase()];
    if (month !== undefined) return new Date(parseInt(year), month, parseInt(day));
  }

  const proseMatch = raw.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (proseMatch) {
    const [, monName, day, year] = proseMatch;
    const month = MONTHS[monName.toLowerCase().slice(0, 3)];
    if (month !== undefined) return new Date(parseInt(year), month, parseInt(day));
  }

  return null;
}

function dividendType(text: string): "final" | "interim" | "special" | "unknown" {
  const t = text.toLowerCase();
  if (t.includes("final")) return "final";
  if (t.includes("interim")) return "interim";
  if (t.includes("special")) return "special";
  return "unknown";
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
      const date = parseNseDate(rd.attchmntText || "");
      if (!date || date < today) continue;

      const rdAnnouncedAt = parseNseDate(rd.an_dt || "");
      const rdType = dividendType(rd.attchmntText || "");

      const candidates = dividendDeclEntries
        .map((d) => ({ d, declAt: parseNseDate(d.an_dt || "") }))
        .filter((c) => c.declAt && (!rdAnnouncedAt || c.declAt <= rdAnnouncedAt))
        .filter((c) => rdType === "unknown" || dividendType(c.d.attchmntText || "") === rdType)
        .sort((a, b) => (b.declAt as Date).getTime() - (a.declAt as Date).getTime());

      const matchingDecl = candidates[0]?.d;

      const amountMatch = matchingDecl
        ? (matchingDecl.attchmntText || "").match(/Rs\.?\s*[\d.]+(?:\s*\([^)]*\))?\s*per\s*(?:equity\s*)?share/i)
        : null;
      const label = amountMatch ? amountMatch[0] : "Dividend (amount pending approval)";

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
