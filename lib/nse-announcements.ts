// NSE India's corporate-announcements endpoint — confirmed (Aug 2026) to
// carry dividend declarations weeks/months before they show up in the
// corporate-actions feed. This correlates a "Record Date" announcement
// (which gives the exact date) with whichever earlier announcement actually
// states the per-share amount — to reconstruct the same kind of entry
// corporate-actions would eventually have.
//
// Two real-world quirks confirmed via direct testing (Aug 2026):
// 1. The amount announcement and the record-date fixation can be MONTHS
//    apart, not days — e.g. RITES announced its ₹2.75 Final Dividend on
//    19-May-2026, but the Record Date wasn't fixed until 25-Aug-2026.
// 2. Companies don't consistently tag the amount announcement with
//    desc:"Dividend" — HBL Engineering's dividend amount was embedded
//    inside a desc:"Outcome of Board Meeting" announcement instead. So
//    this searches ALL announcements for a Rs-per-share pattern, not just
//    ones specifically labeled "Dividend".
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

const AMOUNT_PATTERN = /Rs\.?\s*[\d.]+(?:\s*\([^)]*\))?\s*per\s*(?:equity\s*)?share/i;

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

    let best: { date: Date; label: string } | null = null;

    for (const rd of recordDateEntries) {
      const date = parseNseDate(rd.attchmntText || "");
      if (!date || date < today) continue;

      const rdAnnouncedAt = parseNseDate(rd.an_dt || "");
      const rdType = dividendType(rd.attchmntText || "");

      const candidates = list
        .map((d) => ({ d, declAt: parseNseDate(d.an_dt || "") }))
        .filter((c) => c.declAt && (!rdAnnouncedAt || c.declAt <= rdAnnouncedAt))
        .filter((c) => AMOUNT_PATTERN.test(c.d.attchmntText || ""))
        .filter((c) => rdType === "unknown" || dividendType(c.d.attchmntText || "") === "unknown" || dividendType(c.d.attchmntText || "") === rdType)
        .sort((a, b) => (b.declAt as Date).getTime() - (a.declAt as Date).getTime());

      const matchingDecl = candidates[0]?.d;
      const amountMatch = matchingDecl ? (matchingDecl.attchmntText || "").match(AMOUNT_PATTERN) : null;
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
