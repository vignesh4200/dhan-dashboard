export type ComputedHolding = {
  symbol: string;
  qty: number;
  avg: number;
  ltp: number;
  invested: number;
  current: number;
  pnl: number;
  pnlPct: number;
};

export function computeHolding(symbol: string, qty: number, avg: number, ltp: number): ComputedHolding {
  const invested = qty * avg;
  const current = qty * ltp;
  const pnl = current - invested;
  const pnlPct = invested === 0 ? 0 : (pnl / invested) * 100;
  return { symbol, qty, avg, ltp, invested, current, pnl, pnlPct };
}

export type AlertTier = "approach" | "sell";

export function tierFor(pnlPct: number): AlertTier | null {
  if (pnlPct >= 8) return "sell";
  if (pnlPct >= 7) return "approach";
  return null;
}

export function alertMessage(tier: AlertTier, pnlPct: number): string {
  return tier === "sell"
    ? `up ${pnlPct.toFixed(1)}%, past your 8% booking target — consider trimming or exiting`
    : `up ${pnlPct.toFixed(1)}%, closing in on your 8% target — watch for a good exit level`;
}
