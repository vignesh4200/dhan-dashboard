// GOLDBEES (Nippon India ETF Gold BeES) tracks the domestic Indian gold
// price directly — 1 unit = 0.01g of ~995 purity gold, traded in INR on
// NSE since March 2007. Confirmed (Aug 2026): "GOLDBEES follows the MCX
// Gold (INR/10g)" and "seeks to track the return of domestic price of
// gold" — a real, INR-denominated Indian market instrument, not an
// international-price approximation. Used here to backfill ~19 years of
// genuinely accurate history, since IBJA doesn't publish a bulk archive.
// Same Yahoo Finance chart endpoint family already used for stock prices.
export type GoldBeesPoint = {
  date: string; // ISO timestamp
  rate995PerGram: number;
  rate22kPerGram: number; // 995 purity converted to 22K (91.6%) equivalent
};

const GOLDBEES_PURITY = 0.995;
const PURITY_22K = 0.916;

export async function fetchGoldBeesHistory(): Promise<GoldBeesPoint[]> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/GOLDBEES.NS?range=max&interval=1d",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps: number[] = result.timestamp || [];
    const closes: number[] = result.indicators?.quote?.[0]?.close || [];

    const points: GoldBeesPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close === null || close === undefined) continue;
      // 1 GOLDBEES unit = 0.01g, so price-per-unit × 100 = price per gram.
      const rate995PerGram = close * 100;
      const rate22kPerGram = rate995PerGram * (PURITY_22K / GOLDBEES_PURITY);
      points.push({
        date: new Date(timestamps[i] * 1000).toISOString(),
        rate995PerGram,
        rate22kPerGram,
      });
    }
    return points;
  } catch {
    return [];
  }
}
