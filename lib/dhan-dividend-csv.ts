// Parses Dhan's "Dividend Payout Report" CSV export — confirmed format
// (Sept 2026, verified against 3 real exports): a few header/preamble
// lines, then a table with columns Date, Scrip Name, Dividend Per Share,
// Quantity, Dividend Paid, then a "Total Stocks Count..." footer line.
// This is REAL, ground-truth data direct from Dhan — Dhan does track
// dividend payouts even though the actual cash settles to the bank
// account, not the trading ledger (confirmed: this report exists,
// contradicting an earlier assumption that no such data was available).
export type DhanDividendRow = {
  date: string; // ISO date
  scripName: string;
  perShare: number;
  quantity: number;
  amount: number;
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDhanDate(raw: string): string | null {
  // Format: "21 Mar 2025"
  const match = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!match) return null;
  const [, day, monAbbr, year] = match;
  const month = MONTHS[monAbbr.toLowerCase()];
  if (month === undefined) return null;
  const d = new Date(parseInt(year), month, parseInt(day));
  return d.toISOString().slice(0, 10);
}

export function parseDhanDividendCsv(csvText: string): DhanDividendRow[] {
  const lines = csvText.split(/\r?\n/);
  const rows: DhanDividendRow[] = [];

  for (const line of lines) {
    // Data rows are quoted CSV: "21 Mar 2025","NMDC","2.30","615","1414.50"
    const match = line.match(/^"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"$/);
    if (!match) continue;

    const [, dateRaw, scripName, perShareRaw, qtyRaw, amountRaw] = match;
    const date = parseDhanDate(dateRaw);
    if (!date) continue;

    const perShare = parseFloat(perShareRaw);
    const quantity = parseFloat(qtyRaw);
    const amount = parseFloat(amountRaw);
    if (isNaN(perShare) || isNaN(quantity) || isNaN(amount)) continue;

    rows.push({ date, scripName, perShare, quantity, amount });
  }

  return rows;
}