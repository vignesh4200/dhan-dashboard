// IBJA (India Bullion and Jewellers Association) publishes daily jewellery
// gold rates directly on their homepage — no login or session cookie
// needed, unlike NSE. Confirmed via direct fetch (Aug 2026): the homepage
// shows "IBJA's indicative Retail selling Rates for Gold Jewellery" with
// per-gram rates for 999 (24K/fine), 22K, 20K, 18K, and 14K purities.
//
// Important: these rates explicitly exclude 3% GST and making charges —
// they represent the base market value of the gold content, not what
// you'd pay a jeweller or necessarily get on resale.
//
// The parser strips HTML tags first, then searches the cleaned text —
// this makes it resilient to exactly how IBJA's markup wraps each label,
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
    const rate22k = extractRate(searchText, "22\\s*KT");
    const rate20k = extractRate(searchText, "20\\s*KT");
    const rate18k = extractRate(searchText, "18\\s*KT");
    const rate14k = extractRate(searchText, "14\\s*KT");

    const dateMatch = searchText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const ibjaDate = dateMatch ? dateMatch[1] : null;

    if (!rate999 && !rate22k && !rate18k) {
      diag.error = "No rates found in cleaned text — page structure may have changed";
      return { rates: null, diag };
    }

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
