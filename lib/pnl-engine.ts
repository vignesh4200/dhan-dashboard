// Realized P&L engine for closed stock trades.
//
// Pure TypeScript with no server imports, so the API route uses it to build
// closed trades from Dhan's full trade history, and the P&L page uses
// computeAnalytics() to recompute every stat instantly when filters change.
//
// Matching rules (the same way Indian brokers build a tax P&L):
//   1. Per ISIN, per trading day, buys and sells on the same day are matched
//      against each other first. That quantity is INTRADAY (speculative
//      income), whatever product type the order used.
//   2. Remaining sells consume older delivery lots first-in-first-out.
//      Held more than 12 months → LTCG, otherwise STCG.
//   3. A sell with no lot left to match (shares bought before the history
//      window, IPO allotment, bonus/split credits, demat transfers) is kept
//      as an "unmatched" record with unknown cost, never guessed.
// Charges (STT, brokerage, exchange, SEBI, stamp duty, GST) come from each
// Dhan trade record and are spread per share, so a partly matched order
// carries only its share of the costs.

export type RawDhanTrade = {
  orderId?: string;
  exchangeTradeId?: string;
  transactionType: "BUY" | "SELL" | string;
  exchangeSegment?: string;
  productType?: string;
  tradingSymbol?: string | null;
  customSymbol?: string | null;
  securityId?: string;
  tradedQuantity: number | string;
  tradedPrice: number | string;
  isin?: string;
  instrument?: string;
  sebiTax?: number | string;
  stt?: number | string;
  brokerageCharges?: number | string;
  serviceTax?: number | string;
  exchangeTransactionCharges?: number | string;
  stampDuty?: number | string;
  exchangeTime?: string;
  createTime?: string;
};

export type TradeType = "INTRADAY" | "STCG" | "LTCG";

export type ChargeBreakup = {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  stamp: number;
  gst: number;
};

// One FIFO match: a slice of a sell order against a slice of one buy lot.
export type Leg = {
  buyDate: string; // YYYY-MM-DD (IST)
  buyPrice: number;
  qty: number;
  holdingDays: number;
};

// One closed trade = one sell order (split by tax type if it spans both).
export type ClosedTrade = {
  id: string;
  isin: string;
  symbol: string;
  name: string;
  type: TradeType;
  qty: number;
  firstBuyDate: string;
  lastBuyDate: string;
  sellDate: string;
  sellTime: string;
  avgBuy: number;
  avgSell: number;
  buyValue: number;
  sellValue: number;
  gross: number;
  charges: number;
  chargeBreakup: ChargeBreakup;
  net: number;
  netPct: number; // net / buyValue
  holdingDays: number; // qty-weighted
  fy: string; // e.g. "FY 2025-26"
  month: string; // YYYY-MM
  legs: Leg[];
};

export type UnmatchedSell = {
  isin: string;
  symbol: string;
  name: string;
  qty: number;
  sellDate: string;
  sellPrice: number;
  sellValue: number;
  reason: string;
};

export type OpenLot = { isin: string; symbol: string; qty: number; avgCost: number };

export type EngineResult = {
  trades: ClosedTrade[];
  unmatched: UnmatchedSell[];
  openLots: OpenLot[];
  totals: { rawTrades: number; equityTrades: number; firstTrade: string | null; lastTrade: string | null };
};

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// Dhan exchangeTime is IST wall-clock ("2026-03-12 10:15:22"). Keep it as a
// plain string so dates never drift a day through UTC conversion.
export function istDate(t: RawDhanTrade): string {
  const s = String(t.exchangeTime || t.createTime || "");
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return "1970-01-01";
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
function istTime(t: RawDhanTrade): string {
  const s = String(t.exchangeTime || t.createTime || "");
  const m = s.match(/(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : "";
}

export function fyOf(date: string): string {
  const y = parseInt(date.slice(0, 4));
  const mo = parseInt(date.slice(5, 7));
  const start = mo >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

// "More than 12 months": bought 2025-01-01 → long-term from 2026-01-02.
function isLongTerm(buy: string, sell: string) {
  const [y, m, d] = buy.split("-").map(Number);
  const anniv = `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return sell > anniv;
}

function chargesOf(t: RawDhanTrade): ChargeBreakup {
  return {
    brokerage: num(t.brokerageCharges),
    stt: num(t.stt),
    exchange: num(t.exchangeTransactionCharges),
    sebi: num(t.sebiTax),
    stamp: num(t.stampDuty),
    gst: num(t.serviceTax),
  };
}
const zeroCharges = (): ChargeBreakup => ({ brokerage: 0, stt: 0, exchange: 0, sebi: 0, stamp: 0, gst: 0 });
function addScaled(into: ChargeBreakup, from: ChargeBreakup, k: number) {
  (Object.keys(into) as (keyof ChargeBreakup)[]).forEach((key) => (into[key] += from[key] * k));
}
const sumCharges = (c: ChargeBreakup) => c.brokerage + c.stt + c.exchange + c.sebi + c.stamp + c.gst;

export function isEquityTrade(t: RawDhanTrade) {
  const seg = String(t.exchangeSegment || "").toUpperCase();
  const inst = String(t.instrument || "").toUpperCase();
  if (seg && !seg.endsWith("_EQ")) return false;
  if (inst && inst !== "EQUITY") return false;
  return !!(t.isin || t.securityId);
}

// Trades from the history API can repeat across overlapping fetches.
export function tradeKey(t: RawDhanTrade) {
  return [t.exchangeTradeId, t.orderId, t.transactionType, t.tradedQuantity, t.tradedPrice, t.exchangeTime].join("|");
}

type Lot = { date: string; qty: number; price: number; chargesPerShare: ChargeBreakup };
type Fill = { t: RawDhanTrade; date: string; time: string; qty: number; price: number; cps: ChargeBreakup };

export function buildClosedTrades(
  raw: RawDhanTrade[],
  isinToSymbol: Record<string, string> = {}
): EngineResult {
  const eq = raw.filter(isEquityTrade);
  const byIsin = new Map<string, Fill[]>();
  const names: Record<string, string> = {};

  for (const t of eq) {
    const key = t.isin || `SEC:${t.securityId}`;
    const qty = num(t.tradedQuantity);
    if (qty <= 0) continue;
    const c = chargesOf(t);
    const cps = zeroCharges();
    addScaled(cps, c, 1 / qty);
    const fill: Fill = { t, date: istDate(t), time: istTime(t), qty, price: num(t.tradedPrice), cps };
    if (!byIsin.has(key)) byIsin.set(key, []);
    byIsin.get(key)!.push(fill);
    names[key] = names[key] || String(t.customSymbol || t.tradingSymbol || key);
  }

  const trades: ClosedTrade[] = [];
  const unmatched: UnmatchedSell[] = [];
  const openLots: OpenLot[] = [];

  for (const [isin, fills] of byIsin) {
    const name = names[isin];
    const symbol = isinToSymbol[isin] || fills.find((f) => f.t.tradingSymbol)?.t.tradingSymbol || name;
    fills.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    const lots: Lot[] = [];
    const days = new Map<string, Fill[]>();
    for (const f of fills) {
      if (!days.has(f.date)) days.set(f.date, []);
      days.get(f.date)!.push(f);
    }

    for (const [date, dayFills] of days) {
      const buys = dayFills.filter((f) => f.t.transactionType === "BUY").map((f) => ({ ...f }));
      const sells = dayFills.filter((f) => f.t.transactionType !== "BUY").map((f) => ({ ...f }));

      // Step 1: same-day buy vs sell → intraday.
      let intradayQty = Math.min(
        buys.reduce((s, f) => s + f.qty, 0),
        sells.reduce((s, f) => s + f.qty, 0)
      );
      const sellLegs = new Map<Fill, { intraday: Leg[]; intraBuyCost: number; intraBuyCharges: ChargeBreakup; delivery: { lot: Lot; qty: number }[]; unmatched: number }>();
      for (const s of sells) sellLegs.set(s, { intraday: [], intraBuyCost: 0, intraBuyCharges: zeroCharges(), delivery: [], unmatched: 0 });

      let bi = 0;
      for (const s of sells) {
        if (intradayQty <= 0) break;
        const rec = sellLegs.get(s)!;
        let need = Math.min(s.qty, intradayQty);
        while (need > 0 && bi < buys.length) {
          const b = buys[bi];
          const q = Math.min(need, b.qty);
          rec.intraday.push({ buyDate: date, buyPrice: b.price, qty: q, holdingDays: 0 });
          rec.intraBuyCost += q * b.price;
          addScaled(rec.intraBuyCharges, b.cps, q);
          b.qty -= q; s.qty -= q; need -= q; intradayQty -= q;
          if (b.qty <= 0) bi++;
        }
      }

      // Step 2: leftover buys become delivery lots (before leftover sells of
      // the same day? No: if both remained, step 1 would have matched them).
      for (const b of buys) if (b.qty > 0) lots.push({ date, qty: b.qty, price: b.price, chargesPerShare: b.cps });

      // Step 3: leftover sells consume older lots FIFO.
      for (const s of sells) {
        const rec = sellLegs.get(s)!;
        let need = s.qty;
        while (need > 0 && lots.length > 0) {
          const lot = lots[0];
          const q = Math.min(need, lot.qty);
          rec.delivery.push({ lot: { ...lot }, qty: q });
          lot.qty -= q; need -= q;
          if (lot.qty <= 1e-9) lots.shift();
        }
        rec.unmatched = need;
      }

      // Emit closed trades for each sell fill.
      for (const [s, rec] of sellLegs) {
        const sellPrice = s.price;
        const sellCps = s.cps;
        const base = { isin, symbol, name, sellDate: date, sellTime: s.time, fy: fyOf(date), month: date.slice(0, 7) };
        const idBase = `${isin}|${s.t.orderId || ""}|${s.t.exchangeTradeId || ""}|${date}${s.time}`;

        if (rec.intraday.length) {
          const qty = rec.intraday.reduce((a, l) => a + l.qty, 0);
          const cb = zeroCharges();
          addScaled(cb, rec.intraBuyCharges, 1);
          addScaled(cb, sellCps, qty);
          trades.push(finish({ ...base, id: idBase + "|I", type: "INTRADAY", qty, legs: rec.intraday, buyValue: rec.intraBuyCost, sellValue: qty * sellPrice, chargeBreakup: cb }));
        }

        if (rec.delivery.length) {
          const groups: Record<"STCG" | "LTCG", { lot: Lot; qty: number }[]> = { STCG: [], LTCG: [] };
          for (const d of rec.delivery) groups[isLongTerm(d.lot.date, date) ? "LTCG" : "STCG"].push(d);
          for (const type of ["STCG", "LTCG"] as const) {
            const g = groups[type];
            if (!g.length) continue;
            const qty = g.reduce((a, d) => a + d.qty, 0);
            const cb = zeroCharges();
            let buyValue = 0;
            const legs: Leg[] = g.map((d) => {
              buyValue += d.qty * d.lot.price;
              addScaled(cb, d.lot.chargesPerShare, d.qty);
              return { buyDate: d.lot.date, buyPrice: d.lot.price, qty: d.qty, holdingDays: daysBetween(d.lot.date, date) };
            });
            addScaled(cb, sellCps, qty);
            trades.push(finish({ ...base, id: idBase + "|" + type[0], type, qty, legs, buyValue, sellValue: qty * sellPrice, chargeBreakup: cb }));
          }
        }

        if (rec.unmatched > 0) {
          unmatched.push({
            isin, symbol, name, qty: rec.unmatched, sellDate: date, sellPrice,
            sellValue: r2(rec.unmatched * sellPrice),
            reason: "No buy found in trade history — bought before the history window, IPO/bonus/split credit, or transferred in",
          });
        }
      }
    }

    const openQty = lots.reduce((a, l) => a + l.qty, 0);
    if (openQty > 0) {
      openLots.push({ isin, symbol, qty: openQty, avgCost: r2(lots.reduce((a, l) => a + l.qty * l.price, 0) / openQty) });
    }
  }

  trades.sort((a, b) => (b.sellDate + b.sellTime).localeCompare(a.sellDate + a.sellTime));
  const dates = eq.map(istDate).sort();
  return {
    trades,
    unmatched: unmatched.sort((a, b) => b.sellDate.localeCompare(a.sellDate)),
    openLots,
    totals: { rawTrades: raw.length, equityTrades: eq.length, firstTrade: dates[0] || null, lastTrade: dates[dates.length - 1] || null },
  };
}

function finish(p: {
  id: string; isin: string; symbol: string; name: string; type: TradeType; qty: number; legs: Leg[];
  buyValue: number; sellValue: number; chargeBreakup: ChargeBreakup; sellDate: string; sellTime: string; fy: string; month: string;
}): ClosedTrade {
  const charges = sumCharges(p.chargeBreakup);
  const gross = p.sellValue - p.buyValue;
  const net = gross - charges;
  const buyDates = p.legs.map((l) => l.buyDate).sort();
  const cb = { ...p.chargeBreakup };
  (Object.keys(cb) as (keyof ChargeBreakup)[]).forEach((k) => (cb[k] = r2(cb[k])));
  return {
    ...p,
    chargeBreakup: cb,
    firstBuyDate: buyDates[0],
    lastBuyDate: buyDates[buyDates.length - 1],
    avgBuy: p.buyValue / p.qty,
    avgSell: p.sellValue / p.qty,
    buyValue: r2(p.buyValue),
    sellValue: r2(p.sellValue),
    gross: r2(gross),
    charges: r2(charges),
    net: r2(net),
    netPct: p.buyValue > 0 ? (net / p.buyValue) * 100 : 0,
    holdingDays: p.legs.reduce((a, l) => a + l.holdingDays * l.qty, 0) / p.qty,
  };
}

/* ------------------------------------------------------------------ */
/* Analytics — recomputed on the client for whatever filter is active. */
/* ------------------------------------------------------------------ */

export type Bucket = { key: string; label: string; trades: number; wins: number; net: number; gross: number; charges: number; buyValue: number };

export type Analytics = {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  gross: number;
  charges: number;
  chargeBreakup: ChargeBreakup;
  net: number;
  buyValue: number;
  sellValue: number;
  returnPct: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  payoff: number | null; // avg win / avg loss
  expectancy: number; // per trade
  best: ClosedTrade | null;
  worst: ClosedTrade | null;
  avgHoldDays: number;
  avgHoldWin: number;
  avgHoldLoss: number;
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: { kind: "W" | "L" | null; n: number };
  maxDrawdown: number;
  maxDrawdownFrom: string | null;
  maxDrawdownTo: string | null;
  curve: { date: string; cum: number; peak: number; dd: number }[];
  byMonth: Bucket[];
  byFy: Bucket[];
  byType: Bucket[];
  byHold: Bucket[];
  byWeekday: Bucket[];
  bySymbol: (Bucket & { symbol: string; name: string; qty: number; bestNet: number; worstNet: number; lastSell: string })[];
};

const HOLD_BUCKETS: { key: string; label: string; test: (t: ClosedTrade) => boolean }[] = [
  { key: "intraday", label: "Intraday", test: (t) => t.type === "INTRADAY" },
  { key: "btst", label: "1–7 days", test: (t) => t.type !== "INTRADAY" && t.holdingDays <= 7 },
  { key: "swing", label: "8–30 days", test: (t) => t.type !== "INTRADAY" && t.holdingDays > 7 && t.holdingDays <= 30 },
  { key: "position", label: "1–3 months", test: (t) => t.type !== "INTRADAY" && t.holdingDays > 30 && t.holdingDays <= 90 },
  { key: "medium", label: "3–12 months", test: (t) => t.type !== "INTRADAY" && t.holdingDays > 90 && t.type === "STCG" },
  { key: "long", label: "Over 1 year", test: (t) => t.type === "LTCG" },
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function bucket(key: string, label: string): Bucket {
  return { key, label, trades: 0, wins: 0, net: 0, gross: 0, charges: 0, buyValue: 0 };
}
function add(b: Bucket, t: ClosedTrade) {
  b.trades++; if (t.net > 0) b.wins++;
  b.net += t.net; b.gross += t.gross; b.charges += t.charges; b.buyValue += t.buyValue;
}

export function computeAnalytics(trades: ClosedTrade[]): Analytics {
  const chrono = [...trades].sort((a, b) => (a.sellDate + a.sellTime).localeCompare(b.sellDate + b.sellTime));
  const wins = chrono.filter((t) => t.net > 0);
  const losses = chrono.filter((t) => t.net <= 0);
  const sum = (arr: ClosedTrade[], f: (t: ClosedTrade) => number) => arr.reduce((a, t) => a + f(t), 0);

  const grossProfit = sum(wins, (t) => t.net);
  const grossLoss = -sum(losses, (t) => t.net);
  const net = sum(chrono, (t) => t.net);
  const buyValue = sum(chrono, (t) => t.buyValue);
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const cb = zeroCharges();
  chrono.forEach((t) => addScaled(cb, t.chargeBreakup, 1));

  // Streaks.
  let maxW = 0, maxL = 0, run = 0, kind: "W" | "L" | null = null;
  for (const t of chrono) {
    const k = t.net > 0 ? "W" : "L";
    run = k === kind ? run + 1 : 1; kind = k;
    if (k === "W") maxW = Math.max(maxW, run); else maxL = Math.max(maxL, run);
  }

  // Equity curve (one point per sell date) and drawdown.
  const daily = new Map<string, number>();
  chrono.forEach((t) => daily.set(t.sellDate, (daily.get(t.sellDate) || 0) + t.net));
  let cum = 0, peak = 0, peakDate: string | null = null, mdd = 0, mddFrom: string | null = null, mddTo: string | null = null;
  const curve: Analytics["curve"] = [];
  for (const [date, v] of [...daily.entries()].sort()) {
    cum += v;
    if (cum >= peak) { peak = cum; peakDate = date; }
    const dd = cum - peak;
    if (dd < mdd) { mdd = dd; mddFrom = peakDate; mddTo = date; }
    curve.push({ date, cum: r2(cum), peak: r2(peak), dd: r2(dd) });
  }

  const byMonth = new Map<string, Bucket>();
  const byFy = new Map<string, Bucket>();
  const byType = new Map<string, Bucket>([["INTRADAY", bucket("INTRADAY", "Intraday")], ["STCG", bucket("STCG", "Short-term")], ["LTCG", bucket("LTCG", "Long-term")]]);
  const byHold = HOLD_BUCKETS.map((h) => bucket(h.key, h.label));
  const byWeekday = WEEKDAYS.map((d, i) => bucket(String(i), d));
  const bySymbol = new Map<string, Analytics["bySymbol"][number]>();

  for (const t of chrono) {
    if (!byMonth.has(t.month)) byMonth.set(t.month, bucket(t.month, t.month));
    add(byMonth.get(t.month)!, t);
    if (!byFy.has(t.fy)) byFy.set(t.fy, bucket(t.fy, t.fy));
    add(byFy.get(t.fy)!, t);
    add(byType.get(t.type)!, t);
    const hi = HOLD_BUCKETS.findIndex((h) => h.test(t));
    if (hi >= 0) add(byHold[hi], t);
    add(byWeekday[new Date(t.sellDate + "T00:00:00Z").getUTCDay()], t);
    if (!bySymbol.has(t.isin)) bySymbol.set(t.isin, { ...bucket(t.isin, t.symbol), symbol: t.symbol, name: t.name, qty: 0, bestNet: -Infinity, worstNet: Infinity, lastSell: "" });
    const s = bySymbol.get(t.isin)!;
    add(s, t);
    s.qty += t.qty;
    s.bestNet = Math.max(s.bestNet, t.net);
    s.worstNet = Math.min(s.worstNet, t.net);
    if (t.sellDate > s.lastSell) s.lastSell = t.sellDate;
  }

  const wHold = (arr: ClosedTrade[]) => {
    const q = sum(arr, (t) => t.qty);
    return q ? sum(arr, (t) => t.holdingDays * t.qty) / q : 0;
  };
  const best = chrono.length ? chrono.reduce((a, t) => (t.net > a.net ? t : a)) : null;
  const worst = chrono.length ? chrono.reduce((a, t) => (t.net < a.net ? t : a)) : null;

  return {
    count: chrono.length,
    wins: wins.length,
    losses: losses.length,
    winRate: chrono.length ? (wins.length / chrono.length) * 100 : 0,
    gross: r2(sum(chrono, (t) => t.gross)),
    charges: r2(sum(chrono, (t) => t.charges)),
    chargeBreakup: cb,
    net: r2(net),
    buyValue: r2(buyValue),
    sellValue: r2(sum(chrono, (t) => t.sellValue)),
    returnPct: buyValue ? (net / buyValue) * 100 : 0,
    grossProfit: r2(grossProfit),
    grossLoss: r2(grossLoss),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    avgWin, avgLoss,
    payoff: avgLoss > 0 ? avgWin / avgLoss : null,
    expectancy: chrono.length ? net / chrono.length : 0,
    best, worst,
    avgHoldDays: wHold(chrono),
    avgHoldWin: wHold(wins),
    avgHoldLoss: wHold(losses),
    maxWinStreak: maxW,
    maxLossStreak: maxL,
    currentStreak: { kind, n: kind ? run : 0 },
    maxDrawdown: r2(mdd),
    maxDrawdownFrom: mddFrom,
    maxDrawdownTo: mddTo,
    curve,
    byMonth: [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byFy: [...byFy.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byType: [...byType.values()],
    byHold,
    byWeekday: byWeekday.filter((d) => d.key !== "0" && d.key !== "6" || d.trades > 0),
    bySymbol: [...bySymbol.values()].sort((a, b) => b.net - a.net),
  };
}

/* ------------------------------------------------------------------ */
/* Capital-gains tax estimate per financial year.                      */
/* ------------------------------------------------------------------ */
// Listed equity, STT paid. Rates changed on 23 Jul 2024 (Finance (No. 2)
// Act 2024) and were left unchanged by Budget 2026:
//   before: STCG 15%, LTCG 10% above ₹1L
//   from 23 Jul 2024: STCG 20%, LTCG 12.5% above ₹1.25L (FY 2024-25 onward)
// Set-off: short-term losses reduce STCG then LTCG; long-term losses reduce
// LTCG only. Intraday is speculative business income taxed at your slab,
// so it's reported separately and not included in the estimate.
// 4% health & education cess applied. No surcharge, no 87A rebate — an
// estimate to plan with, not a filing.

export type FyTax = {
  fy: string;
  intradayNet: number;
  stcgOld: number; // sells before 23 Jul 2024
  stcgNew: number;
  ltcgOld: number;
  ltcgNew: number;
  stcgNet: number;
  ltcgNet: number;
  exemption: number;
  exemptionUsed: number;
  taxableStcg: number;
  taxableLtcg: number;
  estTax: number;
  carryForwardLoss: number; // unabsorbed capital loss this FY
};

const CUTOVER = "2024-07-23";

export function taxByFy(trades: ClosedTrade[]): FyTax[] {
  const out = new Map<string, FyTax>();
  for (const t of trades) {
    if (!out.has(t.fy)) out.set(t.fy, { fy: t.fy, intradayNet: 0, stcgOld: 0, stcgNew: 0, ltcgOld: 0, ltcgNew: 0, stcgNet: 0, ltcgNet: 0, exemption: 0, exemptionUsed: 0, taxableStcg: 0, taxableLtcg: 0, estTax: 0, carryForwardLoss: 0 });
    const f = out.get(t.fy)!;
    const isNew = t.sellDate >= CUTOVER;
    if (t.type === "INTRADAY") f.intradayNet += t.net;
    else if (t.type === "STCG") isNew ? (f.stcgNew += t.net) : (f.stcgOld += t.net);
    else isNew ? (f.ltcgNew += t.net) : (f.ltcgOld += t.net);
  }

  for (const f of out.values()) {
    const startYear = parseInt(f.fy.slice(3, 7));
    f.exemption = startYear >= 2024 ? 125000 : 100000;
    f.stcgNet = f.stcgOld + f.stcgNew;
    f.ltcgNet = f.ltcgOld + f.ltcgNew;

    // Bucket-wise set-off keeping old/new rate segments.
    let st = [f.stcgOld, f.stcgNew];
    let lt = [f.ltcgOld, f.ltcgNew];
    const pos = (a: number[]) => a.map((x) => Math.max(0, x));
    let stLoss = -[...st].filter((x) => x < 0).reduce((a, x) => a + x, 0);
    let ltLoss = -[...lt].filter((x) => x < 0).reduce((a, x) => a + x, 0);
    st = pos(st); lt = pos(lt);

    // Short-term loss: first against STCG (higher-rate segment first), then LTCG.
    const absorb = (arr: number[], order: number[], loss: number) => {
      for (const i of order) { const k = Math.min(arr[i], loss); arr[i] -= k; loss -= k; }
      return loss;
    };
    stLoss = absorb(st, [1, 0], stLoss);
    stLoss = absorb(lt, [1, 0], stLoss);
    ltLoss = absorb(lt, [1, 0], ltLoss);
    f.carryForwardLoss = r2(stLoss + ltLoss);

    // Exemption applies to LTCG — use it on the higher-rate segment first.
    let ex = f.exemption;
    const ltTaxable = [...lt];
    for (const i of [1, 0]) { const k = Math.min(ltTaxable[i], ex); ltTaxable[i] -= k; ex -= k; }
    f.exemptionUsed = r2(f.exemption - ex);

    f.taxableStcg = r2(st[0] + st[1]);
    f.taxableLtcg = r2(ltTaxable[0] + ltTaxable[1]);
    const base = st[0] * 0.15 + st[1] * 0.2 + ltTaxable[0] * 0.1 + ltTaxable[1] * 0.125;
    f.estTax = r2(base * 1.04);
    (["intradayNet", "stcgOld", "stcgNew", "ltcgOld", "ltcgNew", "stcgNet", "ltcgNet"] as const).forEach((k) => (f[k] = r2(f[k])));
  }
  return [...out.values()].sort((a, b) => b.fy.localeCompare(a.fy));
}

/* CSV export of the filtered trade list (tax-statement style columns). */
export function tradesToCsv(trades: ClosedTrade[]): string {
  const head = ["Symbol", "Name", "ISIN", "Type", "Qty", "Buy date (first)", "Buy date (last)", "Sell date", "Avg buy", "Avg sell", "Buy value", "Sell value", "Gross P&L", "Brokerage", "STT", "Exchange", "SEBI", "Stamp", "GST", "Total charges", "Net P&L", "Net %", "Holding days", "FY"];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = trades.map((t) => [
    t.symbol, t.name, t.isin, t.type, t.qty, t.firstBuyDate, t.lastBuyDate, t.sellDate,
    t.avgBuy.toFixed(2), t.avgSell.toFixed(2), t.buyValue.toFixed(2), t.sellValue.toFixed(2), t.gross.toFixed(2),
    t.chargeBreakup.brokerage.toFixed(2), t.chargeBreakup.stt.toFixed(2), t.chargeBreakup.exchange.toFixed(2), t.chargeBreakup.sebi.toFixed(2), t.chargeBreakup.stamp.toFixed(2), t.chargeBreakup.gst.toFixed(2),
    t.charges.toFixed(2), t.net.toFixed(2), t.netPct.toFixed(2), Math.round(t.holdingDays), t.fy,
  ]);
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}
