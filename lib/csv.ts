// Minimal RFC4180-ish CSV parser — handles quoted fields (including embedded
// commas/newlines) without adding a new npm dependency. Groww's exact export
// format isn't publicly documented, so this is deliberately forgiving:
// it just gives you back rows of cells, and a separate heuristic below
// guesses which column is which. You'll get a chance to review the parsed
// result before anything is saved, in case the guess is wrong.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else {
      if (char === '"') inQuotes = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\r") { /* skip */ }
      else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += char;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type MfTransaction = {
  fundName: string;
  type: string; // raw text, e.g. "Purchase", "SIP", "Redemption"
  units: number;
  amount: number;
  nav: number;
};

// Heuristic column matching — looks for header names containing these
// keywords (case-insensitive). Groww's actual export headers weren't
// confirmed at build time, so if this misses, the review step will make
// that obvious (empty/zero values) rather than silently saving garbage.
function findColumn(headers: string[], keywords: string[]): number {
  const lower = headers.map((h) => h.toLowerCase());
  for (const kw of keywords) {
    const idx = lower.findIndex((h) => h.includes(kw));
    if (idx !== -1) return idx;
  }
  return -1;
}

export function extractTransactions(rows: string[][]): MfTransaction[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const nameCol = findColumn(headers, ["fund", "scheme"]);
  const typeCol = findColumn(headers, ["type", "transaction"]);
  const unitsCol = findColumn(headers, ["unit"]);
  const amountCol = findColumn(headers, ["amount", "value"]);
  const navCol = findColumn(headers, ["nav", "price"]);

  if (nameCol === -1 || unitsCol === -1) return [];

  const out: MfTransaction[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const fundName = r[nameCol]?.trim();
    const units = parseFloat((r[unitsCol] || "0").replace(/,/g, ""));
    if (!fundName || !units || isNaN(units)) continue;
    out.push({
      fundName,
      type: typeCol !== -1 ? (r[typeCol] || "").trim() : "Purchase",
      units,
      amount: amountCol !== -1 ? parseFloat((r[amountCol] || "0").replace(/,/g, "")) : 0,
      nav: navCol !== -1 ? parseFloat((r[navCol] || "0").replace(/,/g, "")) : 0,
    });
  }
  return out;
}

// Nets purchases against redemptions per fund. This is a simplification —
// it doesn't do precise lot-level average-cost accounting after partial
// redemptions, just a net units / net invested figure, which is good enough
// for a personal current-value tracker.
export function aggregateByFund(transactions: MfTransaction[]) {
  const byFund: Record<string, { units: number; invested: number }> = {};
  for (const t of transactions) {
    const isRedemption = /redeem|sell|switch.?out/i.test(t.type);
    byFund[t.fundName] = byFund[t.fundName] || { units: 0, invested: 0 };
    const sign = isRedemption ? -1 : 1;
    byFund[t.fundName].units += sign * t.units;
    byFund[t.fundName].invested += sign * (t.amount || t.units * t.nav);
  }
  return Object.entries(byFund)
    .filter(([, v]) => v.units > 0.001)
    .map(([fundName, v]) => ({
      fundName,
      units: Math.round(v.units * 1000) / 1000,
      invested: Math.round(v.invested * 100) / 100,
      avgNav: v.units > 0 ? v.invested / v.units : 0,
    }));
}
