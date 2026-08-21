// AMFI's own official daily NAV file — the actual source of truth that
// mfapi.in, Groww, and every other aggregator ultimately re-publish from.
// Format per line: SchemeCode;ISIN Div Payout/ISIN Growth;ISIN Div
// Reinvestment;Scheme Name;Net Asset Value;Date
// Public, no auth needed: https://www.amfiindia.com/spages/NAVAll.txt
export type AmfiNavEntry = {
  schemeCode: string;
  schemeName: string;
  nav: number;
  date: string; // as published by AMFI, e.g. "21-Aug-2026"
};

let cachedFile: { text: string; fetchedAt: number } | null = null;
const CACHE_MS = 30 * 60 * 1000; // the file itself only updates once a day — no need to refetch constantly

async function getAmfiFileText(): Promise<string | null> {
  if (cachedFile && Date.now() - cachedFile.fetchedAt < CACHE_MS) return cachedFile.text;
  try {
    const res = await fetch("https://www.amfiindia.com/spages/NAVAll.txt", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    cachedFile = { text, fetchedAt: Date.now() };
    return text;
  } catch {
    return null;
  }
}

export async function getAmfiNavsBySchemeCode(schemeCodes: string[]): Promise<Record<string, AmfiNavEntry>> {
  const text = await getAmfiFileText();
  if (!text) return {};

  const wanted = new Set(schemeCodes);
  const out: Record<string, AmfiNavEntry> = {};

  const lines = text.split("\n");
  for (const line of lines) {
    const parts = line.split(";");
    if (parts.length < 6) continue;
    const schemeCode = parts[0].trim();
    if (!wanted.has(schemeCode)) continue;
    const schemeName = parts[3].trim();
    const nav = parseFloat(parts[4].trim());
    const date = parts[5].trim();
    if (isNaN(nav)) continue;
    out[schemeCode] = { schemeCode, schemeName, nav, date };
  }

  return out;
}
