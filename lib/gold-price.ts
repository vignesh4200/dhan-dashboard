// IBJA (India Bullion and Jewellers Association) publishes daily jewellery
// gold rates directly on their homepage — no login or session cookie
// needed, unlike NSE. Confirmed via direct fetch (Aug 2026): the homepage
// shows "IBJA's indicative Retail selling Rates for Gold Jewellery" with a
// 999 (24K/fine) per-gram rate. Only the 999 rate is scraped and trusted —
// IBJA's own displayed 22K/20K/18K/14K figures on that same page were
// cross-checked against an independent bullion report and found
// inconsistent (22K in particular was priced too close to 999, not
// reflecting the real ~8% purity gap). So the other purities are computed
// here from the trusted 999 rate using standard karat ratios instead.
//
// Important: these rates explicitly exclude 3% GST and making charges —
// they represent the base market value of the gold content, not what
// you'd pay a jeweller or necessarily get on resale.
//
// The parser strips HTML tags first, then searches the cleaned text —
// this makes it resilient to exactly how IBJA's markup wraps the label,
// since we can't see their raw HTML structure directly. If this parsing
// misses on the real page, that's a useful, fixable signal rather than a
// dead end (same debugging pattern as the NSE/AMFI integrations).
export type GoldRates = {
  rate999: number | null;
  rate22k: number | null;
  rate20k: number | null;
  rate18k: number | null;
  rate14k: number | null;
  ibjaDate: string | null;
};

export type GoldFetchDiagnostics = {
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

export async function fetchIbjaRates(): Promise<{ rates: GoldRates | null; diag: GoldFetchDiagnostics }> {
  const diag: GoldFetchDiagnostics = {
    fetchOk: false, httpStatus: null, pageLength: 0, cleanedTextSample: "", error: null,
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
      rates: { rate999, rate22k, rate20k, rate18k, rate14k, ibjaDate },
      diag,
    };
  } catch (e: any) {
    diag.error = e?.message || "fetch threw";
    return { rates: null, diag };
  }
}

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
