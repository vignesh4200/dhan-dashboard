"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import s from "./holdings.module.css";

const inr = (n: number, d = 0) =>
  "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n >= 0 ? "+" : "−");
const pct = (n: number, d = 1) => `${sign(n)}${Math.abs(n).toFixed(d)}%`;

// Same thresholds as the profit-booking alerts (lib/alerts.ts tierFor).
const APPROACH_PCT = 7;
const SELL_PCT = 8;

type View = "table" | "sector" | "heat";
type SortKey = "pnlPct" | "pnl" | "current" | "day" | "weight" | "symbol";

type Row = {
  symbol: string;
  sector: string;
  qty: number;
  avg: number;
  ltp: number;
  invested: number;
  current: number;
  pnl: number;
  pnlPct: number;
  weight: number;
  dayPct: number | null;
  dayAmt: number | null;
  trend: number[];
};

type Insights = {
  series: Record<string, { d: string; ltp: number }[]>;
  prevClose: Record<string, number>;
  prevDate: string | null;
  scores: Record<string, { score: number; label: string | null; runDate: string }>;
};

function Spark({ values, className, w = 84, h = 24 }: { values: number[]; className: string; w?: number; h?: number }) {
  if (values.length < 2) return <svg className={className} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" />;
  const mn = Math.min(...values), mx = Math.max(...values), span = mx - mn || 1;
  const pts = values.map((v, i) => [(i * w) / (values.length - 1), h - 2 - ((v - mn) / span) * (h - 4)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const col = values[values.length - 1] >= values[0] ? "var(--gain)" : "var(--loss)";
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${w} ${h} L0 ${h}Z`} fill={col} opacity="0.12" />
      <path d={d} fill="none" stroke={col} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function DayPill({ v }: { v: number | null }) {
  if (v === null) return <span className={`${s.pill} ${s.pillNa}`}>—</span>;
  return <span className={`${s.pill} ${v >= 0 ? s.pillUp : s.pillDn}`}>{pct(v)}</span>;
}

// Squarified treemap: tiles sized by value, laid out in rows that keep tiles close to square.
type Tile = { row: Row; x: number; y: number; w: number; h: number };
function squarify(items: { row: Row; v: number }[], x: number, y: number, w: number, h: number, out: Tile[]) {
  if (!items.length || w <= 0 || h <= 0) return;
  if (items.length === 1) { out.push({ row: items[0].row, x, y, w, h }); return; }
  const total = items.reduce((a, i) => a + i.v, 0);
  const side = Math.min(w, h);
  const area = (v: number) => (v / total) * w * h;
  const worst = (r: { v: number }[]) => {
    const sum = r.reduce((a, b) => a + area(b.v), 0);
    const mx = Math.max(...r.map((z) => area(z.v))), mn = Math.min(...r.map((z) => area(z.v)));
    return Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn));
  };
  let row: { row: Row; v: number }[] = [];
  let best = Infinity, i = 0;
  while (i < items.length) {
    const t = [...row, items[i]], wr = worst(t);
    if (wr <= best) { row = t; best = wr; i++; } else break;
  }
  const rs = row.reduce((a, b) => a + b.v, 0);
  const frac = rs / total;
  if (w >= h) {
    const rw = w * frac; let yy = y;
    row.forEach((it) => { const hh = (h * it.v) / rs; out.push({ row: it.row, x, y: yy, w: rw, h: hh }); yy += hh; });
    squarify(items.slice(row.length), x + rw, y, w - rw, h, out);
  } else {
    const rh = h * frac; let xx = x;
    row.forEach((it) => { const ww = (w * it.v) / rs; out.push({ row: it.row, x: xx, y, w: ww, h: rh }); xx += ww; });
    squarify(items.slice(row.length), x, y + rh, w, h - rh, out);
  }
}
function heatColor(p: number) {
  const t = Math.max(-1, Math.min(1, p / 30));
  const neg = [178, 58, 58], mid = [42, 46, 55], pos = [33, 160, 106];
  const a = t < 0 ? neg : pos, k = Math.abs(t);
  return `rgb(${mid.map((m, i) => Math.round(m + (a[i] - m) * k)).join(",")})`;
}

function Heatmap({ rows, selected, onPick }: { rows: Row[]; selected: string | null; onPick: (s: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tiles: Tile[] = [];
  if (size.w > 0) {
    squarify(
      [...rows].filter((r) => r.current > 0).sort((a, b) => b.current - a.current).map((r) => ({ row: r, v: r.current })),
      0, 0, size.w, size.h, tiles
    );
  }
  return (
    <div className={s.heat} ref={ref}>
      {tiles.map((t) => {
        const small = t.w < 70 || t.h < 46;
        return (
          <div
            key={t.row.symbol}
            role="button"
            tabIndex={0}
            className={`${s.cell} ${selected === t.row.symbol ? s.cellSel : ""}`}
            style={{ left: t.x, top: t.y, width: t.w, height: t.h, background: heatColor(t.row.pnlPct) }}
            title={`${t.row.symbol} ${pct(t.row.pnlPct)} · ${inr(t.row.current)}`}
            onClick={() => onPick(t.row.symbol)}
            onKeyDown={(e) => e.key === "Enter" && onPick(t.row.symbol)}
          >
            {small ? <b style={{ fontSize: 11 }}>{t.row.symbol}</b> : (
              <>
                <b>{t.row.symbol}</b>
                {pct(t.row.pnlPct)}
                <br />
                {inr(t.row.current)}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Ring({ score }: { score: number }) {
  const c = 2 * Math.PI * 19;
  const col = score >= 70 ? "var(--gain)" : score >= 55 ? "var(--gold)" : "var(--loss)";
  return (
    <svg className={s.ring} viewBox="0 0 46 46" aria-hidden="true">
      <circle cx="23" cy="23" r="19" fill="none" stroke="var(--panel-2)" strokeWidth="5" />
      <circle cx="23" cy="23" r="19" fill="none" stroke={col} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${(c * Math.max(0, Math.min(100, score))) / 100} ${c}`} transform="rotate(-90 23 23)" />
      <text x="23" y="27.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text)">{Math.round(score)}</text>
    </svg>
  );
}

export default function HoldingsPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [received, setReceived] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<any[] | null>(null);

  const [view, setView] = useState<View>("table");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("pnlPct");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portfolio").then((r) => {
      if (r.status === 401) return router.push("/login");
      return r.json();
    }).then((d) => d && setData(d));
    fetch("/api/holdings/insights").then((r) => (r.ok ? r.json() : null)).then((d) => d && setInsights(d)).catch(() => {});
    fetch("/api/dividends/page-data").then((r) => (r.ok ? r.json() : null)).then((d) => d && setReceived(d.received || [])).catch(() => {});
    // Upcoming dividends come from NSE live and can take a few seconds.
    fetch("/api/dividends").then((r) => (r.ok ? r.json() : null))
      .then((d) => setUpcoming(((d?.events) || []).filter((e: any) => e.type === "dividend")))
      .catch(() => setUpcoming([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows: Row[] = useMemo(() => {
    if (!data?.holdings) return [];
    const total = data.holdings.reduce((a: number, h: any) => a + (h.current ?? 0), 0) || 1;
    return data.holdings.map((h: any) => {
      const prev = insights?.prevClose?.[h.symbol];
      const dayPct = prev ? (h.ltp / prev - 1) * 100 : null;
      const dayAmt = prev ? h.qty * (h.ltp - prev) : null;
      const trend = (insights?.series?.[h.symbol] || []).map((p) => p.ltp);
      return {
        symbol: h.symbol, sector: h.sector || "Other", qty: h.qty, avg: h.avg, ltp: h.ltp,
        invested: h.invested, current: h.current, pnl: h.pnl, pnlPct: h.pnlPct,
        weight: (h.current / total) * 100, dayPct, dayAmt, trend,
      };
    });
  }, [data, insights]);

  if (!data) return <div style={{ padding: "40px 0" }}>Loading…</div>;
  if (data.empty) return <div className="list-card"><p>{data.message}</p></div>;

  const totalCurrent = rows.reduce((a, r) => a + r.current, 0);
  const totalInvested = rows.reduce((a, r) => a + r.invested, 0);
  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  const haveDay = rows.some((r) => r.dayAmt !== null);
  const dayTotal = rows.reduce((a, r) => a + (r.dayAmt ?? 0), 0);
  const dayBase = totalCurrent - dayTotal;
  const winners = rows.filter((r) => r.pnl >= 0).length;
  const losers = rows.length - winners;
  const byWeight = [...rows].sort((a, b) => b.weight - a.weight);
  const maxWeight = byWeight[0]?.weight || 1;
  const top3 = byWeight.slice(0, 3).reduce((a, r) => a + r.weight, 0);

  const sectorTotals: Record<string, number> = {};
  rows.forEach((r) => { sectorTotals[r.sector] = (sectorTotals[r.sector] || 0) + r.current; });
  const sectors = Object.keys(sectorTotals).sort((a, b) => sectorTotals[b] - sectorTotals[a]);

  const chips: [string, string, number][] = [
    ["all", "All", rows.length],
    ["gain", "Gainers", winners],
    ["loss", "Losers", losers],
    ...(haveDay ? ([
      ["today-up", "Up today", rows.filter((r) => (r.dayPct ?? 0) > 0).length],
      ["today-dn", "Down today", rows.filter((r) => (r.dayPct ?? 0) < 0).length],
    ] as [string, string, number][]) : []),
    ...sectors.map((sec) => [`s:${sec}`, sec, rows.filter((r) => r.sector === sec).length] as [string, string, number]),
  ];

  let visible = rows.filter((r) => !query || r.symbol.toLowerCase().includes(query.toLowerCase()));
  if (filter === "gain") visible = visible.filter((r) => r.pnl >= 0);
  else if (filter === "loss") visible = visible.filter((r) => r.pnl < 0);
  else if (filter === "today-up") visible = visible.filter((r) => (r.dayPct ?? 0) > 0);
  else if (filter === "today-dn") visible = visible.filter((r) => (r.dayPct ?? 0) < 0);
  else if (filter.startsWith("s:")) visible = visible.filter((r) => r.sector === filter.slice(2));
  visible.sort((a, b) => {
    if (sortKey === "symbol") return a.symbol.localeCompare(b.symbol);
    if (sortKey === "day") return (b.dayPct ?? -Infinity) - (a.dayPct ?? -Infinity);
    return (b[sortKey] as number) - (a[sortKey] as number);
  });

  const open = (sym: string) => setSelected(sym);

  const tableHead = (
    <thead>
      <tr><th>Stock</th><th>Qty</th><th>Avg</th><th>LTP</th><th>Today</th><th>Value</th><th>Weight</th><th>P&amp;L</th><th>30 days</th></tr>
    </thead>
  );
  const tableRow = (r: Row) => (
    <tr key={r.symbol} tabIndex={0} className={`${s.row} ${selected === r.symbol ? s.sel : ""}`}
      onClick={() => open(r.symbol)} onKeyDown={(e) => e.key === "Enter" && open(r.symbol)}>
      <td className={s.sym}>{r.symbol}<small>{r.sector}</small></td>
      <td>{r.qty}</td>
      <td>{r.avg.toFixed(2)}</td>
      <td>{r.ltp.toFixed(2)}</td>
      <td><DayPill v={r.dayPct} /></td>
      <td>{inr(r.current)}</td>
      <td><span className={s.wt}>{r.weight.toFixed(1)}%<span className={s.bar}><i style={{ width: `${(r.weight / maxWeight) * 100}%` }} /></span></span></td>
      <td className={r.pnl >= 0 ? s.up : s.dn}>{sign(r.pnl)}{inr(r.pnl)} <span style={{ opacity: 0.8 }}>({pct(r.pnlPct)})</span></td>
      <td><Spark values={r.trend} className={s.spark} /></td>
    </tr>
  );

  // ---- detail panel ----
  const sel = selected ? rows.find((r) => r.symbol === selected) || null : null;
  let panel: React.ReactNode = null;
  if (sel) {
    const rec = received.filter((d) => d.symbol === sel.symbol);
    const recTotal = rec.reduce((a, d) => a + Number(d.amount), 0);
    const upc = (upcoming || []).filter((e) => e.symbol === sel.symbol).map((e) => {
      const m = (e.label || "").match(/R[se]\.?\s*([\d.]+)/i);
      return { ...e, amount: m ? parseFloat(m[1]) * sel.qty : null };
    });
    const score = insights?.scores?.[sel.symbol.toUpperCase()];
    const breakEven = sel.pnl < 0 ? (sel.avg / sel.ltp - 1) * 100 : 0;
    const approachAt = sel.avg * (1 + APPROACH_PCT / 100);
    const sellAt = sel.avg * (1 + SELL_PCT / 100);

    panel = (
      <>
        <div className={s.ph}>
          <div>
            <h2>{sel.symbol}</h2>
            <div className={s.phM}>{sel.sector} · {sel.qty} shares · {sel.weight.toFixed(1)}% of portfolio</div>
          </div>
          <button className={s.close} onClick={() => setSelected(null)} aria-label="Close details" autoFocus>✕</button>
        </div>
        <div className={s.price}>
          <span className={s.priceV}>{sel.ltp.toFixed(2)}</span>
          <DayPill v={sel.dayPct} />
          {sel.dayPct !== null && <span className={s.note}>today</span>}
        </div>
        <Spark values={sel.trend} className={s.bigTrend} w={360} h={90} />
        <div className={s.note}>
          {sel.trend.length >= 2 ? `Last ${sel.trend.length} days, one closing price per day from your snapshots` : "Trend builds up as daily snapshots accumulate."}
        </div>

        <div className={s.sect}>
          <h3>Position</h3>
          <div className={s.kv}>
            <div><span>Avg cost</span><b>{sel.avg.toFixed(2)}</b></div>
            <div><span>Invested</span><b>{inr(sel.invested)}</b></div>
            <div><span>Value</span><b>{inr(sel.current)}</b></div>
            <div><span>P&amp;L</span><b className={sel.pnl >= 0 ? s.up : s.dn}>{sign(sel.pnl)}{inr(sel.pnl)} ({pct(sel.pnlPct)})</b></div>
          </div>
        </div>

        <div className={s.sect}>
          <h3>{sel.pnl < 0 ? "Break-even" : "Profit alerts"}</h3>
          {sel.pnl < 0 ? (
            <div className={s.box}>
              Needs <b className={s.up}>+{breakEven.toFixed(1)}%</b> (LTP {sel.ltp.toFixed(2)} → {sel.avg.toFixed(2)}) to get back to your average cost.
              <div className={s.track}><em style={{ width: `${Math.min(100, (sel.ltp / sel.avg) * 100)}%` }} /><i /></div>
            </div>
          ) : (
            <div className={s.box}>
              <span className={s.mut}>Approach alert at</span> <b>{approachAt.toFixed(2)}</b> <span className={s.mut}>(+{APPROACH_PCT}%) · Sell alert at</span> <b>{sellAt.toFixed(2)}</b> <span className={s.mut}>(+{SELL_PCT}%)</span>
              <br />
              {sel.ltp >= sellAt ? <b className={s.up}>Already past the sell threshold.</b>
                : sel.ltp >= approachAt ? <b style={{ color: "var(--gold)" }}>In the approach zone.</b>
                : <span className={s.mut}>{((sellAt / sel.ltp - 1) * 100).toFixed(1)}% away from the sell alert.</span>}
            </div>
          )}
        </div>

        <div className={s.sect}>
          <h3>Dividends</h3>
          {upcoming === null && <div className={s.line}><span className={s.mut}>Checking NSE for upcoming dividends…</span></div>}
          {upc.map((e, i) => (
            <div key={`u${i}`} className={s.line}>
              <span>{e.label}<br /><span className={s.note}>record {e.date}</span></span>
              <span className={`${s.pill} ${s.pillUp}`} style={{ alignSelf: "center" }}>{e.amount !== null ? `${inr(e.amount)} expected` : "amount pending"}</span>
            </div>
          ))}
          {rec.length > 0 ? (
            <>
              <div className={s.line}><span className={s.mut}>Received (all time)</span><b>{inr(recTotal)}</b></div>
              <div className={s.line}><span className={s.mut}>Yield on cost</span><b>{sel.invested > 0 ? ((recTotal / sel.invested) * 100).toFixed(2) : "0.00"}%</b></div>
              {rec.slice(0, 6).map((d) => (
                <div key={d.id} className={s.line}><span>{d.record_date}</span><span className={s.up}>{inr(Number(d.amount))}</span></div>
              ))}
            </>
          ) : (upcoming !== null && upc.length === 0 && <div className={s.line}><span className={s.mut}>No dividends recorded for this stock.</span></div>)}
        </div>

        <div className={s.sect}>
          <h3>Analyst Desk</h3>
          {score ? (
            <Link href="/dashboard/analyst-desk" className={s.score}>
              <Ring score={score.score} />
              <div>
                <b>{score.label || "Scored"}</b>
                <div className={s.note} style={{ marginTop: 2 }}>Composite score · run {score.runDate} · open report →</div>
              </div>
            </Link>
          ) : (
            <div className={s.box}><span className={s.mut}>No Analyst Desk report yet for {sel.symbol}.</span></div>
          )}
        </div>
      </>
    );
  }

  return (
    <div>
      <div className={s.title}>Holdings</div>
      <div className={s.sub}>
        {rows.length} positions · {sectors.length} sectors · last synced {new Date(data.captured_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
      </div>

      <section className={s.kpis} aria-label="Summary">
        <div className={s.kpi}>
          <div className={s.kpiL}>Current value</div>
          <div className={s.kpiV} style={{ color: "var(--gold-bright)" }}>{inr(totalCurrent)}</div>
          <div className={s.kpiS}>invested {inr(totalInvested)}</div>
        </div>
        <div className={s.kpi}>
          <div className={s.kpiL}>Total P&amp;L</div>
          <div className={`${s.kpiV} ${totalPnl >= 0 ? s.up : s.dn}`}>{sign(totalPnl)}{inr(totalPnl)}</div>
          <div className={`${s.kpiS} ${totalPnl >= 0 ? s.up : s.dn}`}>{pct(totalPnlPct)}</div>
        </div>
        <div className={s.kpi}>
          <div className={s.kpiL}>Today</div>
          {haveDay ? (
            <>
              <div className={`${s.kpiV} ${dayTotal >= 0 ? s.up : s.dn}`}>{sign(dayTotal)}{inr(dayTotal)}</div>
              <div className={s.kpiS}>{dayBase > 0 ? pct((dayTotal / dayBase) * 100, 2) : ""} vs previous close</div>
            </>
          ) : (
            <><div className={s.kpiV}>—</div><div className={s.kpiS}>{insights ? "needs one more day of snapshots" : "loading…"}</div></>
          )}
        </div>
        <div className={s.kpi}>
          <div className={s.kpiL}>Winners vs losers</div>
          <div className={s.kpiV}><span className={s.up}>{winners}</span> <span className={s.mut} style={{ fontWeight: 400 }}>/</span> <span className={s.dn}>{losers}</span></div>
          <div className={s.wl}>
            <i style={{ width: `${rows.length ? (winners / rows.length) * 100 : 0}%`, background: "var(--gain)" }} />
            <i style={{ width: `${rows.length ? (losers / rows.length) * 100 : 0}%`, background: "var(--loss)" }} />
          </div>
        </div>
        <div className={s.kpi}>
          <div className={s.kpiL}>Largest position</div>
          <div className={s.kpiV}>{byWeight[0]?.symbol ?? "—"}</div>
          <div className={s.kpiS}>top 3 = {top3.toFixed(0)}% of value</div>
        </div>
      </section>

      <div className={s.controls}>
        <div className={s.seg} role="group" aria-label="View">
          <button aria-pressed={view === "table"} onClick={() => setView("table")}>Table</button>
          <button aria-pressed={view === "sector"} onClick={() => setView("sector")}>By sector</button>
          <button aria-pressed={view === "heat"} onClick={() => setView("heat")}>Heatmap</button>
        </div>
        <span className={s.spacer} />
        <input id="holdings-search" className={s.search} placeholder="Search symbol…" aria-label="Search symbol" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select id="holdings-sort" className={s.sort} aria-label="Sort" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="pnlPct">Sort: P&amp;L %</option>
          <option value="pnl">Sort: P&amp;L ₹</option>
          <option value="current">Sort: Value</option>
          <option value="day">Sort: Today</option>
          <option value="weight">Sort: Weight</option>
          <option value="symbol">Sort: Symbol</option>
        </select>
      </div>

      <div className={s.chips} role="group" aria-label="Filter">
        {chips.map(([k, label, n]) => (
          <button key={k} className={s.chip} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}<span>{n}</span></button>
        ))}
      </div>

      {view === "table" && (
        <div className={s.tableView}>
          <div className={s.card}>
            <div className={s.tw}>
              <table className={s.table}>
                {tableHead}
                <tbody>
                  {visible.length ? visible.map(tableRow) : <tr><td colSpan={9} className={s.empty}>No stocks match this filter.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className={s.cards}>
            {visible.map((r) => (
              <div key={r.symbol} className={s.mc} role="button" tabIndex={0} onClick={() => open(r.symbol)} onKeyDown={(e) => e.key === "Enter" && open(r.symbol)}>
                <div className={s.sym}>{r.symbol}<small>{r.qty} × {r.avg.toFixed(2)} · {r.weight.toFixed(1)}%</small></div>
                <div className={s.r}>
                  <div>{inr(r.current)}</div>
                  <div className={s.mcM}>{r.dayPct === null ? "—" : <span className={r.dayPct >= 0 ? s.up : s.dn}>{pct(r.dayPct)} today</span>}</div>
                </div>
                <div className={s.mcM}>LTP {r.ltp.toFixed(2)}</div>
                <div className={`${s.r} ${r.pnl >= 0 ? s.up : s.dn}`} style={{ fontSize: 12.5 }}>{sign(r.pnl)}{inr(r.pnl)} ({pct(r.pnlPct)})</div>
                <Spark values={r.trend} className={s.mcSpark} w={300} h={26} />
              </div>
            ))}
            {!visible.length && <div className={s.empty}>No stocks match this filter.</div>}
          </div>
        </div>
      )}

      {view === "sector" && (
        <div className={s.card}>
          <div className={s.tw}>
            <table className={s.table}>
              {tableHead}
              <tbody>
                {sectors.map((sec) => {
                  const g = visible.filter((r) => r.sector === sec);
                  if (!g.length) return null;
                  const cur = g.reduce((a, r) => a + r.current, 0);
                  const inv = g.reduce((a, r) => a + r.invested, 0);
                  const p = cur - inv;
                  return [
                    <tr key={`g-${sec}`} className={s.grp}>
                      <td colSpan={9}>
                        <b>{sec}</b>{g.length} stock{g.length > 1 ? "s" : ""} · {inr(cur)} · {((cur / (totalCurrent || 1)) * 100).toFixed(1)}% of portfolio ·{" "}
                        <span className={p >= 0 ? s.up : s.dn}>{sign(p)}{inr(p)} ({pct(inv > 0 ? (p / inv) * 100 : 0)})</span>
                      </td>
                    </tr>,
                    ...g.map(tableRow),
                  ];
                })}
                {!visible.length && <tr><td colSpan={9} className={s.empty}>No stocks match this filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "heat" && (
        <div className={s.card}>
          <div className={s.heatLegend}>
            Size = value · colour = total P&amp;L %
            <span>−30%</span><span className={s.ramp} /><span>+30%</span>
            <span style={{ marginLeft: "auto" }}>Click a tile for details</span>
          </div>
          {visible.length ? <Heatmap rows={visible} selected={selected} onPick={open} /> : <div className={s.empty}>No stocks match this filter.</div>}
        </div>
      )}

      <div className={`${s.scrim} ${sel ? s.scrimOn : ""}`} onClick={() => setSelected(null)} />
      <aside className={`${s.panel} ${sel ? s.panelOn : ""}`} aria-label="Stock details" aria-hidden={!sel}>
        {panel}
      </aside>
    </div>
  );
}
