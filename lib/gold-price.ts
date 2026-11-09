// Gold rate sources.
//
// PRIMARY: GoodReturns — Bangalore city rate (switched Nov 2026).
//   https://www.goodreturns.in/gold-rates/bangalore.html
//   Updated every day, including bullion-market holidays when IBJA doesn't
//   publish (e.g. IBJA stayed on 06/11/2026 through 9 Nov post-Diwali while
//   GoodReturns kept moving). The rates are server-rendered in the intro
//   paragraph ("...stands at ₹14,460 per gram for 24 karat gold ... ₹13,255
//   per gram for 22 karat gold ... ₹10,845 per gram for 18 karat gold"),
//   and the date is in the <title> ("... Gold Price on 9 November 2026").
//   GoodReturns runs ~1.5% above IBJA (city retail vs national benchmark);
//   both exclude 3% GST and making charges.
//
// FALLBACK: IBJA homepage — used only if GoodReturns fails (blocked, page
//   structure change), so the dashboard never goes blank. Only IBJA's 999
//   rate is trusted; sub-purities are computed with karat ratios because
//   IBJA's own 22K figure was found inconsistent (Aug 2026).
//
// 20K and 14K aren't published by GoodReturns, so they're computed from
// the 24K rate with karat ratios (same as before).
export type GoldRates = {
  rate999: number | null;
  rate22k: number | null;
  rate20k: number | null;
  rate18k: number | null;
  rate14k: number | null;
  // dd/mm/yyyy — stored in gold_rate_history.ibja_date (column name kept
  // for compatibility; it now holds the rate date from whichever source).
  ibjaDate: string | null;
  source: "goodreturns" | "ibja";
};

export type GoldFetchDiagnostics = {
  source?: string;
  fallbackReason?: string | null;
  fetchOk: boolean;
  httpStatus: number | null;
  pageLength: number;
  cleanedTextSample: string;
  error: string | null;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x20b9;/gi, "₹")
    .replace(/&percnt;/g, "%")
    .replace(/₹/g, "₹")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRate(text: string, labelPattern: string): number | null {
  const re = new RegExp(`${labelPattern}[^₹\\d]{0,20}₹?\\s*([\\d,]+(?:\\.\\d+)?)`, "i");
  const match = text.match(re);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ""));
  return isNaN(num) ? null : num;
}

async function fetchFromIbja(): Promise<{ rates: GoldRates | null; diag: GoldFetchDiagnostics }> {
  const diag: GoldFetchDiagnostics = {
    source: "ibja", fetchOk: false, httpStatus: null, pageLength: 0, cleanedTextSample: "", error: null,
  };

  try {
    const res = await fetch("https://www.ibja.co/", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    diag.httpStatus = res.status;
    if (!res.ok) {
      diag.error = `HTTP ${res.status}`;
      return { rates: null, diag };
    }

    const html = await res.text();
    diag.fetchOk = true;
    diag.pageLength = html.length;

    const text = stripHtml(html);
    // IBJA's page contains this section header text twice — an old stale
    // cached block first, then the real current one later. Confirmed via
    // direct inspection (Aug 2026): the stale block showed "07/01/2020"
    // with wrong rates, while the real one further down showed today's
    // actual date and correct rates. Use the LAST occurrence, not the first.
    const rateSectionIndex = text.lastIndexOf("indicative Retail selling Rates");
    const searchText = rateSectionIndex !== -1 ? text.slice(rateSectionIndex, rateSectionIndex + 800) : text;
    diag.cleanedTextSample = searchText.slice(0, 400);

    const rate999 = extractRate(searchText, "Fine\\s*Gold\\s*\\(?999\\)?");

    const dateMatch = searchText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const ibjaDate = dateMatch ? dateMatch[1] : null;

    if (!rate999) {
      diag.error = "Could not find the 999 rate in cleaned text — page structure may have changed";
      return { rates: null, diag };
    }

    // 22K/20K/18K/14K are computed from the trusted 999 rate using standard
    // karat purity ratios (karat/24), rather than trusting IBJA's own
    // displayed sub-purity figures on the same page. Confirmed via
    // cross-check against an independent bullion report (Aug 2026): IBJA's
    // own "22 KT" figure was inconsistent with standard purity scaling
    // (too close to their 999 price), while computing from 999 matched the
    // independent report's 916/750/585 figures within ~1%.
    const rate22k = Math.round(rate999 * (22 / 24));
    const rate20k = Math.round(rate999 * (20 / 24));
    const rate18k = Math.round(rate999 * (18 / 24));
    const rate14k = Math.round(rate999 * (14 / 24));

    return {
      rates: { rate999, rate22k, rate20k, rate18k, rate14k, ibjaDate, source: "ibja" },
      diag,
    };
  } catch (e: any) {
    diag.error = e?.message || "fetch threw";
    return { rates: null, diag };
  }
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function karatRate(text: string, karat: 24 | 22 | 18): number | null {
  // Matches "₹14,460 per gram for 24 karat" (strong tags already stripped).
  const re = new RegExp(`₹\\s*([\\d,]+(?:\\.\\d+)?)\\s*per\\s*gram\\s*for\\s*${karat}\\s*(?:karat|carat|k)`, "i");
  const m = text.match(re);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

async function fetchFromGoodReturns(): Promise<{ rates: GoldRates | null; diag: GoldFetchDiagnostics }> {
  const diag: GoldFetchDiagnostics = {
    source: "goodreturns", fetchOk: false, httpStatus: null, pageLength: 0, cleanedTextSample: "", error: null,
  };
  try {
    const res = await fetch("https://www.goodreturns.in/gold-rates/bangalore.html", {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      cache: "no-store",
    });
    diag.httpStatus = res.status;
    if (!res.ok) {
      diag.error = `HTTP ${res.status}`;
      return { rates: null, diag };
    }
    const html = await res.text();
    diag.fetchOk = true;
    diag.pageLength = html.length;

    // Date from <title>: "... Gold Price on 9 November 2026 - Goodreturns"
    let ibjaDate: string | null = null;
    const titleMatch = html.match(/<title>[^<]*?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})[^<]*<\/title>/i);
    if (titleMatch) {
      const mm = MONTHS[titleMatch[2].toLowerCase()];
      if (mm) ibjaDate = `${titleMatch[1].padStart(2, "0")}/${mm}/${titleMatch[3]}`;
    }

    const text = stripHtml(html);
    const idx = text.indexOf("stands at");
    const searchText = idx !== -1 ? text.slice(idx, idx + 600) : text;
    diag.cleanedTextSample = searchText.slice(0, 400);

    const rate999 = karatRate(searchText, 24);
    const gr22k = karatRate(searchText, 22);
    const gr18k = karatRate(searchText, 18);

    // Sanity check: 24K must be present and in a plausible range, and 22K
    // must sit below it — guards against matching some unrelated number.
    if (!rate999 || rate999 < 1000 || rate999 > 100000) {
      diag.error = "Could not find a valid 24K rate in GoodReturns intro text — page structure may have changed";
      return { rates: null, diag };
    }

    const rate22k = gr22k && gr22k < rate999 ? gr22k : Math.round(rate999 * (22 / 24));
    const rate18k = gr18k && gr18k < rate22k ? gr18k : Math.round(rate999 * (18 / 24));
    const rate20k = Math.round(rate999 * (20 / 24));
    const rate14k = Math.round(rate999 * (14 / 24));

    return {
      rates: { rate999, rate22k, rate20k, rate18k, rate14k, ibjaDate, source: "goodreturns" },
      diag,
    };
  } catch (e: any) {
    diag.error = e?.message || "fetch threw";
    return { rates: null, diag };
  }
}

// Main entry point: GoodReturns first, IBJA as a safety net.
export async function fetchGoldRates(): Promise<{ rates: GoldRates | null; diag: GoldFetchDiagnostics }> {
  const primary = await fetchFromGoodReturns();
  if (primary.rates) return primary;

  const fallback = await fetchFromIbja();
  fallback.diag.fallbackReason = `GoodReturns failed: ${primary.diag.error}`;
  return fallback;
}

// Kept so any older import keeps working; now uses the same source order.
export const fetchIbjaRates = fetchGoldRates;

// Returns the per-gram rate matching a stored purity string.
export function rateForPurity(rates: GoldRates, purity: string): number | null {
  const p = purity.toLowerCase().replace(/\s/g, "");
  if (p === "999" || p === "24k" || p === "fine") return rates.rate999;
  if (p === "22k") return rates.rate22k;
  if (p === "20k") return rates.rate20k;
  if (p === "18k") return rates.rate18k;
  if (p === "14k") return rates.rate14k;
  return null;
}
