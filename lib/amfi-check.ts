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

export type AmfiFetchDiagnostics = {
  fetchOk: boolean;
  httpStatus: number | null;
  fileLength: number;
  totalLinesParsed: number;
  totalDataLinesWithSemicolons: number;
  sampleSchemeCodes: string[];
  error: string | null;
};

let cachedFile: { text: string; fetchedAt: number } | null = null;
const CACHE_MS = 30 * 60 * 1000;

async function getAmfiFileText(): Promise<{ text: string | null; diag: AmfiFetchDiagnostics }> {
  const diag: AmfiFetchDiagnostics = {
    fetchOk: false, httpStatus: null, fileLength: 0,
    totalLinesParsed: 0, totalDataLinesWithSemicolons: 0, sampleSchemeCodes: [], error: null,
  };

  if (cachedFile && Date.now() - cachedFile.fetchedAt < CACHE_MS) {
    diag.fetchOk = true;
    diag.fileLength = cachedFile.text.length;
    return { text: cachedFile.text, diag };
  }

  try {
    const res = await fetch("https://www.amfiindia.com/spages/NAVAll.txt", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    diag.httpStatus = res.status;
    if (!res.ok) {
      diag.error = `HTTP ${res.status}`;
      return { text: null, diag };
    }
    const text = await res.text();
    diag.fetchOk = true;
    diag.fileLength = text.length;
    cachedFile = { text, fetchedAt: Date.now() };
    return { text, diag };
  } catch (e: any) {
    diag.error = e?.message || "fetch threw";
    return { text: null, diag };
  }
}

export async function getAmfiNavsBySchemeCode(
  schemeCodes: string[]
): Promise<{ navs: Record<string, AmfiNavEntry>; diag: AmfiFetchDiagnostics }> {
  const { text, diag } = await getAmfiFileText();
  if (!text) return { navs: {}, diag };

  const wanted = new Set(schemeCodes);
  const out: Record<string, AmfiNavEntry> = {};

  const lines = text.split(/\r?\n/);
  diag.totalLinesParsed = lines.length;

  for (const line of lines) {
    const parts = line.split(";");
    if (parts.length < 4) continue;
    diag.totalDataLinesWithSemicolons++;
    const schemeCode = parts[0].trim();
    if (diag.sampleSchemeCodes.length < 5) diag.sampleSchemeCodes.push(schemeCode);
    if (!wanted.has(schemeCode)) continue;

    // AMFI splits "Scheme Name", "Plan", and "Option" across separate
    // semicolon fields rather than one combined name field — so the field
    // count varies. NAV and Date are always the last two fields regardless,
    // so read from the end rather than assuming a fixed position.
    const date = parts[parts.length - 1].trim();
    const nav = parseFloat(parts[parts.length - 2].trim());
    const schemeName = parts.slice(3, parts.length - 2).join(" ").trim();
    if (isNaN(nav)) continue;
    out[schemeCode] = { schemeCode, schemeName, nav, date };
  }

  return { navs: out, diag };
}
