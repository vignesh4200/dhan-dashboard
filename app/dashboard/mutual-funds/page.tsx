"use client";
import { useEffect, useMemo, useState, MouseEvent as ReactMouseEvent } from "react";
import s from "./mf.module.css";

const inr = (n: number, d = 0) =>
  "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n >= 0 ? "+" : "−");
const pct = (n: number, d = 1) => `${sign(n)}${Math.abs(n).toFixed(d)}%`;
const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

type FundHolding = { name: string; sector: string; pct: number; nature: string; instrument: string };
type FundInsight = {
  navHistory: [string, number][];
  portfolio: { portfolioDate: string | null; holdings: FundHolding[]; expenseRatio: number | null; aumCr: number | null; stale: boolean };
};

type Folio = { folioNo: string; units: number; invested: number; currentValue: number; xirr: string | null };
type Fund = {
  key: string;
  schemeCode: string | null;
  name: string;
  amc: string;
  category: string;
  subCategory: string;
  nav: number | null;
  units: number;
  invested: number;
  current: number;
  gain: number;
  gainPct: number;
  avgNav: number;
  isElss: boolean;
  folios: Folio[];
};

const CAT_COLOR: Record<string, string> = { Equity: "var(--c-mf)", Hybrid: "var(--c-stocks)", Debt: "var(--gain)" };
const NATURE_LABEL: Record<string, string> = { EQUITY: "Stocks", DEBT: "Bonds & money market", CASH: "Cash & receivables" };

const RANGES = [
  { k: "1M", days: 30 }, { k: "3M", days: 91 }, { k: "6M", days: 182 }, { k: "1Y", days: 365 },
  { k: "3Y", days: 1095 }, { k: "5Y", days: 1826 }, { k: "All", days: null as number | null },
];

function shortFundName(name: string) {
  return name
    .replace(/\s*-\s*(Direct|Regular).*$/i, "")
    .replace(/\s+(Direct|Regular)\s+Plan.*$/i, "")
    .replace(/ELSS-\s*/i, "ELSS ")
    .trim();
}
function normCompany(n: string) {
  return n.toLowerCase().replace(/\b(ltd|limited|the|equity)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function navAtOrBefore(hist: [string, number][], iso: string): [string, number] | null {
  let lo = 0, hi = hist.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (hist[m][0] <= iso) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? hist[ans] : null;
}
function isoDaysAgo(fromIso: string, days: number) {
  const d = new Date(fromIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function NavChart({ fund, hist }: { fund: Fund; hist: [string, number][] }) {
  const [range, setRange] = useState("1Y");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [hover, setHover] = useState<number | null>(null);

  if (hist.length < 2) return <div className={s.rangeInfo}>NAV history isn&apos;t available for this fund right now.</div>;

  const first = hist[0][0], last = hist[hist.length - 1][0];
  const custom = range === "Custom" && from && to && from < to;
  let pts = hist;
  if (custom) pts = hist.filter((p) => p[0] >= from && p[0] <= to);
  else {
    const r = RANGES.find((x) => x.k === range);
    if (r?.days) { const start = isoDaysAgo(last, r.days); pts = hist.filter((p) => p[0] >= start); }
  }
  if (pts.length < 2) pts = hist.slice(-2);
  const step = Math.max(1, Math.ceil(pts.length / 400));
  const view = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);

  const startNav = view[0][1], endNav = view[view.length - 1][1];
  const rangeRet = (endNav / startNav - 1) * 100;
  const years = (new Date(view[view.length - 1][0]).getTime() - new Date(view[0][0]).getTime()) / (365.25 * 86400000);
  const cagr = years >= 1 ? (Math.pow(endNav / startNav, 1 / years) - 1) * 100 : null;

  const W = 640, H = 170, L = 50, R = 10, T = 12, B = 24;
  const vals = view.map((p) => p[1]);
  const showAvg = fund.avgNav > 0;
  const lo = Math.min(...vals, ...(showAvg ? [fund.avgNav] : [])), hi = Math.max(...vals, ...(showAvg ? [fund.avgNav] : []));
  const pad = (hi - lo) * 0.06 || 1, mn = lo - pad, mx = hi + pad;
  const x = (i: number) => L + (i * (W - L - R)) / (view.length - 1);
  const y = (v: number) => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
  const d = view.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ");
  const ticks = [0, 1, 2, 3].map((k) => mn + ((mx - mn) * k) / 3);
  const labelIdx = [0, Math.round((view.length - 1) / 3), Math.round((2 * (view.length - 1)) / 3), view.length - 1];
  const longSpan = years > 0.9;
  const lbl = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", longSpan ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });

  function onMove(e: ReactMouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mxp = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((mxp - L) / (W - L - R)) * (view.length - 1));
    setHover(Math.max(0, Math.min(view.length - 1, i)));
  }
  const hv = hover !== null ? view[hover] : null;

  return (
    <div>
      <div className={s.rangeBar} role="group" aria-label="Chart range">
        {[...RANGES.map((r) => r.k), "Custom"].map((k) => (
          <button key={k} type="button" className={s.rangeBtn} aria-pressed={range === k} onClick={() => { setRange(k); setHover(null); }}>{k}</button>
        ))}
        {range === "Custom" && (
          <>
            <input type="date" className={s.dateIn} aria-label="From date" min={first} max={last} value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className={s.mut} style={{ fontSize: 11.5 }}>to</span>
            <input type="date" className={s.dateIn} aria-label="To date" min={first} max={last} value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
      </div>
      <div className={s.rangeInfo}>
        {range === "Custom" && !custom ? "Pick a from and to date. " : ""}
        {fmtDate(view[0][0])} → {fmtDate(view[view.length - 1][0])}: NAV {startNav.toFixed(2)} → {endNav.toFixed(2)}{" "}
        <b className={rangeRet >= 0 ? s.up : s.dn}>{pct(rangeRet)}</b>
        {cagr !== null && <> · <b className={cagr >= 0 ? s.up : s.dn}>{pct(cagr)}</b> a year</>}
      </div>
      <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${fund.name} NAV chart`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((v, k) => (
          <g key={k}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text x={L - 6} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="var(--text-muted)">{v >= 1000 ? v.toFixed(0) : v.toFixed(v >= 100 ? 0 : 1)}</text>
          </g>
        ))}
        {labelIdx.map((i, k) => (
          <text key={k} x={x(i)} y={H - 7} fontSize="10" fill="var(--text-muted)" textAnchor={k === 0 ? "start" : k === 3 ? "end" : "middle"}>{lbl(view[i][0])}</text>
        ))}
        <path d={`${d} L${x(view.length - 1)} ${H - B} L${L} ${H - B}Z`} fill="var(--gold)" opacity="0.08" />
        {showAvg && (
          <>
            <line x1={L} x2={W - R} y1={y(fund.avgNav)} y2={y(fund.avgNav)} stroke="var(--text-muted)" strokeDasharray="5 4" />
            <text x={L + 6} y={y(fund.avgNav) - 5} fontSize="10.5" fill="var(--text-muted)">your avg {fund.avgNav.toFixed(2)}</text>
          </>
        )}
        <path d={d} fill="none" stroke="var(--gold)" strokeWidth="2" />
        <circle cx={x(view.length - 1)} cy={y(endNav)} r="3.5" fill="var(--gold)" />
        {hv && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--text-muted)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(hv[1])} r="4" fill="#fff" stroke="var(--gold)" strokeWidth="2" />
            <g transform={`translate(${x(hover) > W / 2 ? x(hover) - 158 : x(hover) + 8}, ${T + 2})`}>
              <rect width="150" height="40" rx="7" fill="var(--panel)" stroke="var(--border-strong)" />
              <text x="10" y="16" fontSize="10.5" fill="var(--text-muted)">{fmtDate(hv[0])}</text>
              <text x="10" y="32" fontSize="12" fontWeight="600" fill="var(--text)">
                NAV {hv[1].toFixed(2)}{" "}
                <tspan fill={hv[1] >= startNav ? "var(--gain)" : "var(--loss)"}>{pct((hv[1] / startNav - 1) * 100)}</tspan>
              </text>
            </g>
          </g>
        )}
      </svg>
      <div className={s.legend}>
        <span><i />NAV</span>
        {showAvg && <span><i className={s.d} />your average cost</span>}
      </div>
    </div>
  );
}

function FundCard({ fund, insight, totalCurrent }: { fund: Fund; insight?: FundInsight; totalCurrent: number }) {
  const [open, setOpen] = useState(false);
  const hist = insight?.navHistory || [];
  const lastPt = hist[hist.length - 1];
  const prevPt = hist[hist.length - 2];
  const nav = lastPt ? lastPt[1] : fund.nav;
  const dayPct = lastPt && prevPt ? (lastPt[1] / prevPt[1] - 1) * 100 : null;
  const navVsAvg = nav && fund.avgNav > 0 ? (nav / fund.avgNav - 1) * 100 : null;
  const std = lastPt
    ? [["1M", 30], ["6M", 182], ["1Y", 365], ["3Y", 1095], ["5Y", 1826]].map(([k, days]) => {
        const base = navAtOrBefore(hist, isoDaysAgo(lastPt[0], days as number));
        if (!base || base[0] < hist[0][0] || hist[0][0] > isoDaysAgo(lastPt[0], days as number)) return null;
        const yrs = (days as number) / 365;
        const v = yrs >= 3 ? (Math.pow(lastPt[1] / base[1], 1 / yrs) - 1) * 100 : (lastPt[1] / base[1] - 1) * 100;
        return { k: yrs >= 3 ? `${k} CAGR` : (k as string), v };
      }).filter(Boolean) as { k: string; v: number }[]
    : [];
  const er = insight?.portfolio?.expenseRatio;
  const catTag = fund.category === "Equity" ? s.tagEq : fund.category === "Debt" ? s.tagDebt : s.tagHy;

  return (
    <article className={s.card}>
      <div className={s.fundHead}>
        <div>
          <div className={s.fundName}>{shortFundName(fund.name)}</div>
          <div className={s.fundMeta}>
            <span className={`${s.tag} ${catTag}`}>{fund.subCategory || fund.category}</span>
            {fund.isElss && <span className={`${s.tag} ${s.tagLock}`}>3-yr lock-in</span>}
            {fund.amc} · {((fund.current / (totalCurrent || 1)) * 100).toFixed(1)}% of MF
            {er != null && <> · expense ratio {er.toFixed(2)}%</>}
          </div>
        </div>
        <div className={s.fundVal}>
          <div className="v" style={{ fontSize: 19, fontWeight: 600 }}>{inr(fund.current)}</div>
          <div className={fund.gain >= 0 ? s.up : s.dn} style={{ fontSize: 12.5, marginTop: 2 }}>{sign(fund.gain)}{inr(fund.gain)} ({pct(fund.gainPct)})</div>
        </div>
      </div>

      <div className={s.navRow}>
        <div><span>NAV{lastPt ? ` · ${fmtDate(lastPt[0])}` : ""}</span><b>{nav ? nav.toFixed(2) : "—"}</b></div>
        <div><span>Last change</span><b className={dayPct === null ? "" : dayPct >= 0 ? s.up : s.dn}>{dayPct === null ? "—" : pct(dayPct, 2)}</b></div>
        <div><span>Your avg NAV</span><b>{fund.avgNav > 0 ? fund.avgNav.toFixed(2) : "—"}</b></div>
        <div><span>NAV vs your avg</span><b className={navVsAvg === null ? "" : navVsAvg >= 0 ? s.up : s.dn}>{navVsAvg === null ? "—" : pct(navVsAvg)}</b></div>
      </div>

      {std.length > 0 && (
        <div className={s.rets}>
          {std.map((r) => <span key={r.k} className={s.ret}>{r.k}<b className={r.v >= 0 ? s.up : s.dn}>{pct(r.v)}</b></span>)}
        </div>
      )}

      {insight ? <NavChart fund={fund} hist={hist} /> : <div className={s.rangeInfo}>Loading NAV history…</div>}

      <button type="button" className={s.folBtn} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {fund.folios.length} folio{fund.folios.length > 1 ? "s" : ""} · {fund.units.toFixed(2)} units · invested {inr(fund.invested)}
      </button>
      {open && (
        <div className={s.tw}>
          <table className={s.folios}>
            <thead><tr><th>Folio</th><th>Units</th><th>Invested</th><th>Value</th><th>Gain</th><th>XIRR</th></tr></thead>
            <tbody>
              {fund.folios.map((f, i) => {
                const g = f.currentValue - f.invested;
                return (
                  <tr key={i}>
                    <td>{f.folioNo || `Folio ${i + 1}`}</td>
                    <td>{f.units.toFixed(2)}</td>
                    <td>{inr(f.invested)}</td>
                    <td>{inr(f.currentValue)}</td>
                    <td className={g >= 0 ? s.up : s.dn}>{sign(g)}{inr(g)}</td>
                    <td>{f.xirr || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

export default function MutualFundsPage() {
  const [holdings, setHoldings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ holdings: any[]; reportDate: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [insights, setInsights] = useState<Record<string, FundInsight> | null>(null);
  const [insightsFailed, setInsightsFailed] = useState(false);
  const [showAllCos, setShowAllCos] = useState(false);

  function loadHoldings() {
    setLoading(true);
    fetch("/api/mutual-funds").then((r) => r.json()).then((d) => {
      setHoldings(d.holdings || []);
      setLoading(false);
    });
  }
  function loadInsights() {
    fetch("/api/mutual-funds/insights")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setInsights(d.funds || {}))
      .catch(() => setInsightsFailed(true));
  }

  useEffect(() => { loadHoldings(); loadInsights(); }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(""); setStatus(""); setBusy(true);
    try {
      const isExcel = /\.xlsx?$/i.test(file.name);
      let body: any;

      if (isExcel) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        body = { xlsxBase64: btoa(binary) };
      } else {
        body = { csv: await file.text() };
      }

      const res = await fetch("/api/mutual-funds/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't parse this file");
      setPreview({
        reportDate: data.reportDate,
        holdings: data.holdings.map((h: any) => ({
          ...h,
          selectedSchemeCode: h.candidates[0]?.schemeCode || "",
          selectedSchemeName: h.candidates[0]?.schemeName || h.schemeName,
        })),
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function updateSelection(index: number, schemeCode: string, schemeName: string) {
    setPreview((prev) => prev ? {
      ...prev,
      holdings: prev.holdings.map((h, i) => (i === index ? { ...h, selectedSchemeCode: schemeCode, selectedSchemeName: schemeName } : h)),
    } : prev);
  }

  async function confirmSave() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/mutual-funds/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings: preview!.holdings, reportDate: preview!.reportDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setStatus(`Saved ${data.saved} holdings. Live NAVs will start updating with tomorrow's daily refresh (or trigger it manually now).`);
      setPreview(null);
      setShowUpload(false);
      loadHoldings();
      loadInsights();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Merge folios of the same scheme into one fund.
  const funds: Fund[] = useMemo(() => {
    const map = new Map<string, Fund>();
    for (const h of holdings) {
      const key = h.schemeCode || h.schemeName;
      let f = map.get(key);
      if (!f) {
        f = {
          key, schemeCode: h.schemeCode || null, name: h.schemeName, amc: h.amc, category: h.category || "Other",
          subCategory: h.subCategory || "", nav: h.currentNav ?? null, units: 0, invested: 0, current: 0,
          gain: 0, gainPct: 0, avgNav: 0, isElss: /elss/i.test(`${h.subCategory} ${h.schemeName}`), folios: [],
        };
        map.set(key, f);
      }
      f.units += h.units;
      f.invested += h.invested;
      f.current += h.currentValue;
      f.folios.push({ folioNo: h.folioNo, units: h.units, invested: h.invested, currentValue: h.currentValue, xirr: h.xirr });
    }
    return [...map.values()]
      .map((f) => ({ ...f, gain: f.current - f.invested, gainPct: f.invested > 0 ? ((f.current - f.invested) / f.invested) * 100 : 0, avgNav: f.units > 0 ? f.invested / f.units : 0 }))
      .sort((a, b) => b.current - a.current);
  }, [holdings]);

  const totalCurrent = funds.reduce((a, f) => a + f.current, 0);
  const totalInvested = funds.reduce((a, f) => a + f.invested, 0);
  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  const reportDate = holdings[0]?.reportDate;
  const mostRecentNavUpdate = holdings.reduce((latest: string | null, h) => {
    if (!h.navUpdatedAt) return latest;
    return !latest || h.navUpdatedAt > latest ? h.navUpdatedAt : latest;
  }, null);

  // Change since the previous NAV, from each fund's NAV history.
  let dayChange: number | null = null;
  if (insights) {
    let sum = 0, any = false;
    for (const f of funds) {
      const h = f.schemeCode ? insights[f.schemeCode]?.navHistory : undefined;
      if (h && h.length >= 2) { sum += f.units * (h[h.length - 1][1] - h[h.length - 2][1]); any = true; }
    }
    dayChange = any ? sum : null;
  }

  const byCat: Record<string, number> = {};
  const bySub: Record<string, number> = {};
  const byAmc: Record<string, number> = {};
  funds.forEach((f) => {
    byCat[f.category] = (byCat[f.category] || 0) + f.current;
    const sub = f.subCategory || f.category;
    bySub[sub] = (bySub[sub] || 0) + f.current;
    const amc = (f.amc || "Other").replace(/\s+Mutual Fund$/i, "");
    byAmc[amc] = (byAmc[amc] || 0) + f.current;
  });
  const elssValue = funds.filter((f) => f.isElss).reduce((a, f) => a + f.current, 0);
  const elssCount = funds.filter((f) => f.isElss).length;

  // ---- look-through: what the MF money owns ----
  const look = useMemo(() => {
    if (!insights) return null;
    const cos = new Map<string, { name: string; sector: string; amount: number; via: Set<string> }>();
    const sectors: Record<string, number> = {};
    const natures: Record<string, number> = {};
    let covered = 0, valueWithData = 0;
    const dates = new Set<string>();
    let anyStale = false;
    for (const f of funds) {
      const p = f.schemeCode ? insights[f.schemeCode]?.portfolio : undefined;
      if (!p || !p.holdings.length) continue;
      valueWithData += f.current;
      if (p.portfolioDate) dates.add(p.portfolioDate);
      if (p.stale) anyStale = true;
      for (const h of p.holdings) {
        const amt = (f.current * h.pct) / 100;
        covered += amt;
        const nature = NATURE_LABEL[h.nature] ? h.nature : "OTHER";
        natures[nature] = (natures[nature] || 0) + amt;
        const sec = h.nature === "EQUITY" ? h.sector : NATURE_LABEL[h.nature] || "Other";
        sectors[sec] = (sectors[sec] || 0) + amt;
        const key = normCompany(h.name);
        const c = cos.get(key) || { name: h.name, sector: h.nature === "EQUITY" ? h.sector : NATURE_LABEL[h.nature] || h.instrument, amount: 0, via: new Set<string>() };
        c.amount += amt;
        c.via.add(shortFundName(f.name).replace(/\s+(Tax Saver )?Fund$/i, ""));
        cos.set(key, c);
      }
    }
    if (!cos.size) return null;
    const list = [...cos.values()].sort((a, b) => b.amount - a.amount);
    return { list, sectors, natures, covered, valueWithData, dates: [...dates].sort(), anyStale };
  }, [insights, funds]);

  const NAT_COLOR: Record<string, string> = { EQUITY: "var(--c-mf)", DEBT: "var(--gain)", CASH: "var(--c-stocks)", OTHER: "var(--text-muted)" };
  const bars = (title: string, map: Record<string, number>, color: (k: string) => string, total?: number) => {
    const tot = total ?? Object.values(map).reduce((a, b) => a + b, 0);
    return (
      <div className={s.group}>
        <h3 className={s.groupH}>{title}</h3>
        {Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
          <div key={k} className={s.arow}>
            <span>{k}</span>
            <span className={s.mut}>{tot > 0 ? ((v / tot) * 100).toFixed(0) : 0}% · {inr(v)}</span>
            <div className={s.bar}><i style={{ width: `${tot > 0 ? (v / tot) * 100 : 0}%`, background: color(k) }} /></div>
          </div>
        ))}
      </div>
    );
  };

  const uploadCard = (
    <div className="list-card" style={{ marginTop: 18 }}>
      <div className="list-head"><div className="list-title">Upload Holdings Report</div></div>
      <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} disabled={busy} className="field-input" />
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10 }}>
        From Groww: Mutual Funds → Reports → Holdings Report. You only need to re-upload this when your holdings
        change (new purchase/redemption) — current value stays live from the daily NAV refresh in between.
      </div>
      {error && <div style={{ color: "var(--loss)", fontSize: 12.5, marginTop: 10 }}>{error}</div>}
    </div>
  );

  const shownCos = look ? (showAllCos ? look.list : look.list.slice(0, 15)) : [];
  const topAmt = look?.list[0]?.amount || 1;

  return (
    <div>
      <div className={s.top}>
        <div>
          <div className={s.title}>Mutual Funds</div>
          <div className={s.sub}>
            {funds.length > 0
              ? `${funds.length} fund${funds.length > 1 ? "s" : ""} · ${holdings.length} folio${holdings.length > 1 ? "s" : ""} · units from your Groww report, value from daily NAVs`
              : "Units and invested amount come from your uploaded Groww report. Current value updates automatically every day using live NAVs."}
          </div>
        </div>
        {holdings.length > 0 && !preview && (
          <div className={s.btnRow}>
            <button type="button" className={`btn ${s.btnInline}`} onClick={() => setShowUpload((v) => !v)}>
              {showUpload ? "Close upload" : "Update from Groww report"}
            </button>
          </div>
        )}
      </div>

      {status && <div style={{ color: "var(--gain)", fontSize: 12.5, marginTop: 12 }}>{status}</div>}
      {!preview && (showUpload || (!loading && holdings.length === 0)) && uploadCard}

      {preview && (
        <div className="list-card" style={{ marginTop: 18 }}>
          <div className="list-head">
            <div className="list-title">Review before saving {preview.reportDate && <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 12 }}>· as of {preview.reportDate}</span>}</div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 14 }}>
            Confirm each fund matched the right scheme — this determines which NAV gets tracked daily. Pick a different one from the dropdown if it&apos;s wrong.
          </div>
          {preview.holdings.map((h, i) => (
            <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{h.schemeName}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                {h.category} · Folio {h.folioNo} · {h.units.toFixed(2)} units · invested {inr(h.investedValue)}
              </div>
              {h.candidates.length > 0 ? (
                <select
                  className="field-input"
                  style={{ marginTop: 8, marginBottom: 0 }}
                  value={h.selectedSchemeCode}
                  onChange={(e) => {
                    const chosen = h.candidates.find((c: any) => String(c.schemeCode) === e.target.value);
                    updateSelection(i, e.target.value, chosen?.schemeName || h.schemeName);
                  }}
                >
                  {h.candidates.map((c: any) => (
                    <option key={c.schemeCode} value={c.schemeCode}>{c.schemeName}</option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 11.5, color: "var(--loss)", marginTop: 6 }}>No scheme match found — this fund won&apos;t get daily NAV updates, current value stays fixed at the report&apos;s snapshot.</div>
              )}
            </div>
          ))}
          {error && <div style={{ color: "var(--loss)", fontSize: 12.5, marginTop: 10 }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button className="btn" disabled={busy} onClick={confirmSave}>{busy ? "Saving…" : "Confirm & save"}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}

      {loading && <div style={{ padding: "30px 0", color: "var(--text-muted)" }}>Loading…</div>}

      {!loading && funds.length > 0 && (
        <>
          <section className={s.kpis} aria-label="Summary">
            <div className={s.kpi}>
              <div className={s.kpiL}>Current value</div>
              <div className={s.kpiV} style={{ color: "var(--gold-bright)" }}>{inr(totalCurrent)}</div>
              <div className={s.kpiS}>invested {inr(totalInvested)}</div>
            </div>
            <div className={s.kpi}>
              <div className={s.kpiL}>Total gain</div>
              <div className={`${s.kpiV} ${totalPnl >= 0 ? s.up : s.dn}`}>{sign(totalPnl)}{inr(totalPnl)}</div>
              <div className={`${s.kpiS} ${totalPnl >= 0 ? s.up : s.dn}`}>{pct(totalPnlPct)} absolute return</div>
            </div>
            <div className={s.kpi}>
              <div className={s.kpiL}>Last NAV change</div>
              {dayChange !== null ? (
                <>
                  <div className={`${s.kpiV} ${dayChange >= 0 ? s.up : s.dn}`}>{sign(dayChange)}{inr(dayChange)}</div>
                  <div className={s.kpiS}>{pct((dayChange / (totalCurrent - dayChange || 1)) * 100, 2)} vs previous NAV</div>
                </>
              ) : (
                <><div className={s.kpiV}>—</div><div className={s.kpiS}>{insightsFailed ? "NAV history unavailable" : "loading…"}</div></>
              )}
            </div>
            <div className={s.kpi}>
              <div className={s.kpiL}>Asset mix</div>
              <div className={s.mix}>
                {Object.entries(byCat).map(([c, v]) => <i key={c} style={{ width: `${(v / (totalCurrent || 1)) * 100}%`, background: CAT_COLOR[c] || "var(--gold)" }} />)}
              </div>
              <div className={s.mixL}>
                {Object.entries(byCat).map(([c, v]) => <span key={c}><b style={{ background: CAT_COLOR[c] || "var(--gold)" }} />{c} {((v / (totalCurrent || 1)) * 100).toFixed(0)}%</span>)}
              </div>
            </div>
          </section>
          <div className={s.foot}>
            {reportDate && <>Report as of {reportDate}</>}
            {mostRecentNavUpdate && <> · NAVs last refreshed {new Date(mostRecentNavUpdate).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</>}
            {!mostRecentNavUpdate && <> · Live NAV refresh hasn&apos;t run yet — values shown are from the report</>}
          </div>

          <section className={`${s.card} ${s.lt}`} aria-label="What your mutual funds own">
            <div className={s.cardHead}>
              <h2>What your MF money owns</h2>
              {look && (
                <span className={s.mut} style={{ fontSize: 12 }}>
                  Your {inr(totalCurrent)} spread across the funds&apos; disclosed portfolios
                  {look.dates.length > 0 && <> · as of {look.dates.map(fmtDate).join(", ")}</>}
                  {look.anyStale && " · using last saved copy"}
                </span>
              )}
            </div>
            {!insights && !insightsFailed && <div className={s.mut} style={{ fontSize: 13 }}>Loading fund portfolios…</div>}
            {(insightsFailed || (insights && !look)) && (
              <div className={s.mut} style={{ fontSize: 13 }}>Couldn&apos;t load the funds&apos; portfolios right now. Try again later.</div>
            )}
            {look && (
              <div className={s.ltGrid}>
                <div>
                  <table className={s.ltTable}>
                    <thead><tr><th>Company</th><th>Your money</th><th>% of MF</th><th className={s.barCell}></th></tr></thead>
                    <tbody>
                      {shownCos.map((c) => (
                        <tr key={c.name}>
                          <td>
                            <div className={s.co}>{c.name}<small>{c.sector}</small></div>
                            {c.via.size > 0 && <div className={s.via}>{[...c.via].map((v) => <span key={v}>{v}</span>)}</div>}
                          </td>
                          <td>{inr(c.amount)}</td>
                          <td>{((c.amount / (totalCurrent || 1)) * 100).toFixed(2)}%</td>
                          <td className={s.barCell}><div className={s.miniBar}><i style={{ width: `${(c.amount / topAmt) * 100}%` }} /></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {look.list.length > 15 && (
                    <button type="button" className={s.more} onClick={() => setShowAllCos((v) => !v)}>
                      {showAllCos ? "Show top 15" : `Show all ${look.list.length} holdings`}
                    </button>
                  )}
                </div>
                <div>
                  {bars("What it is", Object.fromEntries(Object.entries(look.natures).map(([k, v]) => [NATURE_LABEL[k] || "Other", v])),
                    (k) => NAT_COLOR[Object.keys(NATURE_LABEL).find((n) => NATURE_LABEL[n] === k) || "OTHER"])}
                  {bars("By sector", look.sectors, () => "var(--gold)")}
                  {look.valueWithData + 1 < totalCurrent && (
                    <div className={s.note} style={{ marginTop: 10 }}>Portfolio data was missing for {inr(totalCurrent - look.valueWithData)} of your funds, so it isn&apos;t split here.</div>
                  )}
                </div>
              </div>
            )}
          </section>

          <div className={s.cols}>
            <div className={s.stack}>
              {funds.map((f) => (
                <FundCard key={f.key} fund={f} insight={f.schemeCode ? insights?.[f.schemeCode] : undefined} totalCurrent={totalCurrent} />
              ))}
            </div>
            <div className={s.stack}>
              <section className={s.card}>
                <div className={s.cardHead}><h2>Allocation</h2></div>
                {bars("Asset class", byCat, (k) => CAT_COLOR[k] || "var(--gold)")}
                {bars("Fund type", bySub, () => "var(--c-stocks)")}
                {bars("Fund house", byAmc, () => "var(--gold)")}
              </section>
              {elssCount > 0 && (
                <section className={s.card}>
                  <div className={s.cardHead}><h2>ELSS lock-in &amp; tax</h2></div>
                  <div className={s.note}>
                    <p><b>{elssCount} of your {funds.length} funds {elssCount === 1 ? "is" : "are"} ELSS</b> (about <b>{((elssValue / (totalCurrent || 1)) * 100).toFixed(0)}%</b> of your MF money). Each purchase is locked for <b>3 years</b> from its own date, so SIP units unlock month by month.</p>
                    <p>Groww&apos;s holdings report doesn&apos;t include purchase dates, so this page can&apos;t show which units are free yet.</p>
                    <p>ELSS investments count toward the Section 80C limit (old tax regime only).</p>
                  </div>
                </section>
              )}
            </div>
          </div>
        </>
      )}

      {!loading && holdings.length === 0 && !preview && (
        <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 12 }}>No mutual fund holdings saved yet — upload a Holdings Report above to get started.</div>
      )}
    </div>
  );
}
