// Estimates the finance charge HDFC (and most Indian issuers) levy when a bill
// is not paid in full by the due date. Method, as HDFC's grievance cell
// explained it (June 2026): once you revolve, interest runs at the monthly
// rate on
//   1. every purchase on the statement, from its transaction date until the
//      payment date, and
//   2. whatever is still unpaid, from the payment date to the next statement,
// plus 18% GST on the interest. Paying in full by the due date costs nothing.
// It's an estimate for decisions, not a reproduction of the bank's ledger.

export type CycleTxn = { date: string; amount: number }; // ISO date, positive = spend

const DAY = 86_400_000;
const days = (a: string | Date, b: string | Date) => Math.max(0, Math.round((+new Date(b) - +new Date(a)) / DAY));

export function estimateFinanceCharge(p: {
  totalDue: number;
  payAmount: number;
  statementDate: string | null;
  dueDate: string;
  txns: CycleTxn[];
  monthlyRatePct?: number;
}): { shortfall: number; interest: number; gst: number; total: number } {
  const shortfall = Math.max(0, p.totalDue - p.payAmount);
  if (shortfall < 1) return { shortfall: 0, interest: 0, gst: 0, total: 0 };

  const r = (p.monthlyRatePct ?? 3.75) / 100 / 30; // per day
  const payDate = p.dueDate;
  const stmt = p.statementDate || new Date(+new Date(p.dueDate) - 20 * DAY).toISOString().slice(0, 10);
  const nextStmt = new Date(+new Date(stmt) + 30 * DAY).toISOString();

  // Part 1: on the full billed amount from each purchase date to the payment.
  let part1 = 0;
  const spend = p.txns.filter((t) => t.amount > 0);
  const spendSum = spend.reduce((s, t) => s + t.amount, 0);
  if (spend.length && spendSum > 0) {
    // Scale to the billed total so carried balances and fees are covered too.
    const scale = p.totalDue / spendSum;
    for (const t of spend) part1 += t.amount * scale * r * days(t.date, payDate);
  } else {
    // No itemised purchases: assume they sat, on average, 15 days before the statement.
    part1 = p.totalDue * r * (days(stmt, payDate) + 15);
  }

  // Part 2: on what's left unpaid until the next statement.
  const part2 = shortfall * r * days(payDate, nextStmt);

  const interest = Math.round(part1 + part2);
  const gst = Math.round(interest * 0.18);
  return { shortfall, interest, gst, total: interest + gst };
}
