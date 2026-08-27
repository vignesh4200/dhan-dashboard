// NSE India's corporate-announcements endpoint — confirmed (Aug 2026) to
// carry dividend declarations weeks/months before they show up in the
// corporate-actions feed. This correlates a "Record Date" announcement
// (which gives the exact date) with whichever earlier announcement actually
// states the per-share amount — to reconstruct the same kind of entry
// corporate-actions would eventually have.
//
// Real-world quirks confirmed via direct testing (Aug 2026):
// 1. The amount announcement and the record-date fixation can be MONTHS
//    apart, not days — e.g. RITES announced its ₹2.75 Final Dividend on
//    19-May-2026, but the Record Date wasn't fixed until 25-Aug-2026.
// 2. Companies don't consistently tag the amount announcement with
//    desc:"Dividend" — HBL Engineering's dividend was inside a
//    desc:"Outcome of Board Meeting" announcement instead. So this searches
//    ALL announcements for a Rs-per-share pattern, not just ones labeled
//    "Dividend".
// 3. Sometimes the amount isn't in NSE's short auto-generated summary text
//    at all — only inside the attached PDF. When that happens, this falls
//    back to downloading and reading the single most likely PDF (the
//    nearest type-matching announcement before the record date).
import { fetchNseAuthed } from "./nse-session";
import { extractPdfText } from "./pdf-text";

export type NseDividend = {
  symbol: string;
  label: string;
  date: string;
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// NSE filings write dates in more than one format — usually "18-May-2026",
// but sometimes in prose like "September 20, 2026" (seen in RITES' record
// date filing). This tries both rather than assuming one.
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

// Handles "Rs." and "Re." (both used in Indian financial filings) and the
// common "/-" suffix (e.g. "Rs. 1/- per equity share").
const AMOUNT_PATTERN = /R[se]\.?\s*[\d.]+\s*\/?-?(?:\s*\([^)]*\))?\s*per\s*(?:equity\s*)?share/i;

// Requires "dividend" to appear near the amount (either side, within ~80
// characters), since a Rs-per-share pattern alone can also match unrelated
// figures like EPS in the same document (confirmed: a looser match once
// grabbed an unrelated figure instead of the real dividend amount).
function findDividendAmount(text: string): string | null {
  const nearDividendAfter = text.match(new RegExp(`dividend[\\s\\S]{0,80}?${AMOUNT_PATTERN.source}`, "i"));
  if (nearDividendAfter) {
    const amountOnly = nearDividendAfter[0].match(AMOUNT_PATTERN);
    if (amountOnly) return amountOnly[0];
  }
  const nearDividendBefore = text.match(new RegExp(`${AMOUNT_PATTERN.source}[\\s\\S]{0,80}?dividend`, "i"));
  if (nearDividendBefore) {
    const amountOnly = nearDividendBefore[0].match(AMOUNT_PATTERN);
    if (amountOnly) return amountOnly[0];
  }
  return null;
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

    let best: { date: Date; label: string } | null = null;

    for (const rd of recordDateEntries) {
      const date = parseNseDate(rd.attchmntText || "");
      if (!date || date < today) continue;

      const rdAnnouncedAt = parseNseDate(rd.an_dt || "");
      const rdType = dividendType(rd.attchmntText || "");

      // Step 1: text-only search across all announcements — fast.
      const textCandidates = list
        .map((d) => ({ d, declAt: parseNseDate(d.an_dt || "") }))
        .filter((c) => c.declAt && (!rdAnnouncedAt || c.declAt <= rdAnnouncedAt))
        .filter((c) => findDividendAmount(c.d.attchmntText || "") !== null)
        .filter((c) => rdType === "unknown" || dividendType(c.d.attchmntText || "") === rdType)
        .sort((a, b) => (b.declAt as Date).getTime() - (a.declAt as Date).getTime());

      let label: string | null = null;
      const textMatch = textCandidates[0]?.d;
      if (textMatch) {
        label = findDividendAmount(textMatch.attchmntText || "");
      }

      // Step 2: if the text search found nothing, fall back to reading the
      // single most likely PDF (an "Outcome of Board Meeting" announcement
      // close to and before the record date, matching type where known).
      if (!label) {
        const pdfCandidates = list
          .map((d) => ({ d, declAt: parseNseDate(d.an_dt || "") }))
          .filter((c) => c.declAt && (!rdAnnouncedAt || c.declAt <= rdAnnouncedAt))
          .filter((c) => (c.d.desc || "").toLowerCase().includes("board meeting"))
          .filter((c) => rdType === "unknown" || dividendType(c.d.attchmntText || "") === "unknown" || dividendType(c.d.attchmntText || "") === rdType)
          .sort((a, b) => (b.declAt as Date).getTime() - (a.declAt as Date).getTime());

        const pdfCandidate = pdfCandidates[0]?.d;
        if (pdfCandidate?.attchmntFile) {
          const pdfText = await extractPdfText(pdfCandidate.attchmntFile);
          if (pdfText) label = findDividendAmount(pdfText);
        }
      }

      if (!label) label = "Dividend (amount pending approval)";

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
