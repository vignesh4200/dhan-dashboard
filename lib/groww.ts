// Parser specifically for Groww's "Holdings Report" export — confirmed
// against a real file (Aug 2026). Structure: a "Personal Details" preamble,
// a "HOLDING SUMMARY" block, then a "HOLDINGS AS ON <date>" section with the
// actual table. This report already has Groww's own computed Invested Value,
// Current Value, Returns, and XIRR per holding as a starting snapshot — the
// daily cron then keeps current value live using mfapi.in. The same fund can
// appear more than once (different folio numbers = different lots) — these
// are kept as separate rows.
export type GrowwHolding = {
  schemeName: string;
  amc: string;
  category: string;
  subCategory: string;
  folioNo: string;
  units: number;
  investedValue: number;
  currentValue: number;
  returns: number;
  xirr: string;
};

function toNumber(cell: any): number {
  if (typeof cell === "number") return cell;
  if (!cell) return 0;
  const cleaned = String(cell).replace(/,/g, "").replace(/%/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function toText(cell: any): string {
  return cell === null || cell === undefined ? "" : String(cell).trim();
}

export function parseHoldingsReport(rows: any[][]): { holdings: GrowwHolding[]; reportDate: string | null } {
  let headerRowIndex = -1;
  let reportDate: string | null = null;

  for (let i = 0; i < rows.length; i++) {
    const rowText = rows[i].map((c) => toText(c).toLowerCase());
    if (rowText.some((c) => c.startsWith("holdings as on"))) {
      const raw = toText(rows[i][0]);
      const match = raw.match(/holdings as on\s+(.+)/i);
      if (match) reportDate = match[1].trim();
    }
    if (rowText.includes("scheme name") && rowText.includes("units") && rowText.includes("current value")) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) return { holdings: [], reportDate: null };

  const headers = rows[headerRowIndex].map((c) => toText(c).toLowerCase());
  const col = (name: string) => headers.indexOf(name);

  const schemeCol = col("scheme name");
  const amcCol = col("amc");
  const categoryCol = col("category");
  const subCategoryCol = col("sub-category");
  const folioCol = col("folio no.");
  const unitsCol = col("units");
  const investedCol = col("invested value");
  const currentCol = col("current value");
  const returnsCol = col("returns");
  const xirrCol = col("xirr");

  const holdings: GrowwHolding[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const schemeName = toText(r[schemeCol]);
    const units = toNumber(r[unitsCol]);
    if (!schemeName || !units) continue;

    holdings.push({
      schemeName,
      amc: toText(r[amcCol]),
      category: toText(r[categoryCol]),
      subCategory: toText(r[subCategoryCol]),
      folioNo: toText(r[folioCol]),
      units,
      investedValue: toNumber(r[investedCol]),
      currentValue: toNumber(r[currentCol]),
      returns: toNumber(r[returnsCol]),
      xirr: toText(r[xirrCol]),
    });
  }

  return { holdings, reportDate };
}
