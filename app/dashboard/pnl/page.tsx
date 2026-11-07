"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import s from "./pnl.module.css";
import {
  computeAnalytics, taxByFy, tradesToCsv,
  type Analytics, type ClosedTrade, type UnmatchedSell,
} from "@/lib/pnl-engine";

/* Realized P&L — every closed stock trade, FIFO-matched from full Dhan
   trade history (/api/pnl). Overview and Trades tabs follow the filter bar;
   the Tax statement tab works one financial year at a time. */

type Mismatch = { isin: string; symbol: string; held: number; fromHistory: number };
type Payload = {
  trades: ClosedTrade[];
  unmatched: UnmatchedSell[];
  mismatches: Mismatch[];
  totals: { rawTrades: number; equityTrades: number; firstTrade: string | null; lastTrade: string | null };
  fetchedAt: string | null;
  syncNote: string | null;
  syncError: string | null;
};
type Tab = "overview" | "trades" | "tax";
type TypeF = "ALL" | "DELIVERY" | "INTRADAY" | "LTCG";
type Outcome = "ALL" | "WIN" | "LOSS";
type SortKey = "sellDate" | "net" | "netPct" | "holdingDays" | "buyValue" | "symbol";

const PAGE = 25;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FY_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

const inr = (n: number, d = 0) => "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n >= 0 ? "+" : "−");
const sinr = (n: number, d = 0) => sign(n) + inr(n, d);
const pct = (n: number, d = 1) => `${sign(n)}${Math.abs(n).toFixed(d)}%`;
const kfmt = (n: number) => `${sign(n)}${Math.abs(n) >= 100000 ? (Math.abs(n) / 100000).toFixed(2) + "L" : (Math.abs(n) / 1000).toFixed(1) + "k"}`;
const cls = (n: number) => (n >= 0 ? s.up : s.dn);
const dshort = (d: string | null | undefined) => (d ? `${d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(2, 4)}` : "—");
const shortFy = (fy: string) => fy.replace("FY 20", "FY ");
const held = (t: ClosedTrade) => (t.type === "INTRADAY" ? "Same day" : `${Math.round(t.holdingDays)} d`);

function TypeTag({ t }: { t: ClosedTrade["type"] }) {
  const m = { INTRADAY: [s.tagI, "Intraday"], STCG: [s.tagS, "Short-term"], LTCG: [s.tagL, "Long-term"] }[t];
  return <span className={`${s.tag} ${m[0]}`}>{m[1]}</span>;
}
function Pill({ v }: { v: number }) {
  return <span className={`${s.pill} ${v >= 0 ? s.pillUp : s.pillDn}`}>{pct(v)}</span>;
}
function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className={s.kpi}>
      <div className={s.kpiL}>{label}</div>
      <div className={`${s.kpiV} ${tone || ""}`} title={value}>{value}</div>
      {sub && <div className={s.kpiS}>{sub}</div>}
    </div>
  );
}
function Card({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <h2 className={s.cardTitle}>{title}</h2>
        {right ?? (sub && <span className={s.cardSub}>{sub}</span>)}
      </div>
      {children}
    </section>
  );
}

/* ---------- Charts ---------- */

function Curve({ a }: { a: Analytics }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = a.curve;
  if (pts.length < 2) return <div className={s.empty}>Need at least two sell dates to draw the curve.</div>;
  const W = 1000, H = 220;
  const vals = pts.flatMap((p) => [p.cum, p.peak]);
  const mn = Math.min(0, ...vals), mx = Math.max(0, ...vals), span = mx - mn || 1;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => 10 + (1 - (v - mn) / span) * (H - 20);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(" ");
  const peak = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.peak).toFixed(1)}`).join(" ");
  const band = `${peak} ${[...pts].reverse().map((p, j) => `L${x(pts.length - 1 - j).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(" ")}Z`;
  const zero = y(0);
  const last = pts[pts.length - 1];
  const lineCol = last.cum >= 0 ? "var(--gain)" : "var(--loss)";
  const hp = hover !== null ? pts[hover] : null;

  return (
    <>
      <div
        className={s.curveWrap}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1));
          setHover(Math.max(0, Math.min(pts.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <svg className={s.curve} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Cumulative realized net P&L, now ${sinr(last.cum)}`}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const yy = y(mn + span * f);
            return <line key={f} x1="0" x2={W} y1={yy} y2={yy} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
          })}
          <line x1="0" x2={W} y1={zero} y2={zero} stroke="var(--border-strong)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          <path d={`${line} L${W} ${zero} L0 ${zero}Z`} fill={lineCol} opacity="0.1" />
          <path d={band} fill="var(--loss)" opacity="0.28" />
          <path d={line} fill="none" stroke={lineCol} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="var(--gold)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>
        {[0, 0.5, 1].map((f) => (
          <div key={f} className={s.axisL} style={{ top: `${(y(mn + span * f) / H) * 100}%` }}>{kfmt(mn + span * f)}</div>
        ))}
        {hp && (
          <div className={s.hoverTip} style={{ left: `${Math.min(88, Math.max(12, (hover! / (pts.length - 1)) * 100))}%` }}>
            {dshort(hp.date)} · <b className={cls(hp.cum)}>{sinr(hp.cum)}</b>
            {hp.dd < 0 && <span className={s.dn}> · {sinr(hp.dd)} from peak</span>}
          </div>
        )}
      </div>
      <div className={s.axisX}>
        <span>{dshort(pts[0].date)}</span>
        <span>{dshort(pts[Math.floor(pts.length / 2)].date)}</span>
        <span>{dshort(last.date)}</span>
      </div>
    </>
  );
}

function Heatmap({ a }: { a: Analytics }) {
  const months = new Map(a.byMonth.map((b) => [b.key, b]));
  const maxAbs = Math.max(1, ...a.byMonth.map((b) => Math.abs(b.net)));
  const fys = [...a.byFy].reverse();
  if (!fys.length) return <div className={s.empty}>No trades in this filter.</div>;
  return (
    <div className={s.scrollX}>
      <div className={s.heat}>
        <div />
        {FY_ORDER.map((m) => <div key={m} className={s.heatH}>{MON[m - 1]}</div>)}
        <div className={s.heatH} style={{ textAlign: "right" }}>Total</div>
        {fys.map((fy) => {
          const y0 = parseInt(fy.key.slice(3, 7));
          return [
            <div key={fy.key} style={{ fontSize: 12, color: "var(--text-muted)" }}>{shortFy(fy.key)}</div>,
            ...FY_ORDER.map((m) => {
              const key = `${m >= 4 ? y0 : y0 + 1}-${String(m).padStart(2, "0")}`;
              const b = months.get(key);
              if (!b) return <div key={key} className={s.heatEmpty} />;
              const alpha = (0.18 + 0.7 * Math.sqrt(Math.min(1, Math.abs(b.net) / maxAbs))).toFixed(2);
              return (
                <div key={key} className={s.heatCell} title={`${MON[m - 1]} ${key.slice(0, 4)}: ${sinr(b.net)} · ${b.trades} trades`}
                  style={{ background: b.net >= 0 ? `rgba(62,207,142,${alpha})` : `rgba(255,107,107,${alpha})` }}>
                  {kfmt(b.net)}
                </div>
              );
            }),
            <div key={fy.key + "t"} className={cls(fy.net)} style={{ textAlign: "right", fontSize: 12.5, fontWeight: 600 }}>{kfmt(fy.net)}</div>,
          ];
        })}
      </div>
    </div>
  );
}

function DivBars({ rows }: { rows: { key: string; label: string; sub: string; v: number }[] }) {
  if (!rows.length) return <div className={s.empty}>Nothing to show.</div>;
  const mx = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <div className={s.bars}>
      {rows.map((r) => (
        <div key={r.key} className={s.barRow}>
          <div className={s.lab} title={r.label}>{r.label}<small>{r.sub}</small></div>
          <div className={s.div}>
            <div>{r.v < 0 && <i style={{ width: `${(Math.abs(r.v) / mx) * 100}%`, background: "var(--loss)", borderRadius: "3px 0 0 3px" }} />}</div>
            <div>{r.v > 0 && <i style={{ width: `${(r.v / mx) * 100}%`, background: "var(--gain)", borderRadius: "0 3px 3px 0" }} />}</div>
          </div>
          <div className={`${s.barVal} ${cls(r.v)}`}>{sinr(r.v)}</div>
        </div>
      ))}
    </div>
  );
}

function TradeDetail({ t }: { t: ClosedTrade }) {
  const c = t.chargeBreakup;
  return (
    <div className={s.detailGrid}>
      <div>
        <div className={s.detailLabel}>Buy lots matched to this sell (FIFO)</div>
        {t.legs.map((l, i) => (
          <div key={i} className={s.leg}>
            <span>Bought {dshort(l.buyDate)} · {l.qty} @ {l.buyPrice.toFixed(2)}</span>
            <span className={s.mut}>{l.holdingDays ? `${l.holdingDays} d held` : "same day"}</span>
            <b className={cls(t.avgSell - l.buyPrice)}>{sinr((t.avgSell - l.buyPrice) * l.qty)}</b>
          </div>
        ))}
        <div className={s.leg}><span>Sold {dshort(t.sellDate)} {t.sellTime.slice(0, 5)} · {t.qty} @ {t.avgSell.toFixed(2)}</span><span className={s.mut}>{t.fy}</span></div>
      </div>
      <div>
        <div className={s.detailLabel}>Charges (from Dhan trade records, buy + sell side)</div>
        <div className={s.chg}>
          {([["STT", c.stt], ["Exchange", c.exchange], ["Stamp duty", c.stamp], ["GST", c.gst], ["Brokerage", c.brokerage], ["SEBI", c.sebi]] as [string, number][]).map(([k, v]) => (
            <div key={k}><span>{k}</span><b>{inr(v, 2)}</b></div>
          ))}
        </div>
        <div className={s.leg} style={{ borderTop: "none", marginTop: 8 }}>
          <span className={s.mut}>Gross {sinr(t.gross, 2)} − charges {inr(t.charges, 2)}</span>
          <b className={cls(t.net)}>Net {sinr(t.net, 2)}</b>
        </div>
      </div>
    </div>
  );
}

function TradesTable({ trades, limit, onMore }: { trades: ClosedTrade[]; limit?: number; onMore?: () => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "sellDate", dir: -1 });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setPage(0), [trades]);

  const sorted = useMemo(() => {
    const v = (t: ClosedTrade) => (sort.key === "sellDate" ? t.sellDate + t.sellTime : sort.key === "symbol" ? t.symbol : (t as any)[sort.key]);
    return [...trades].sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * sort.dir);
  }, [trades, sort]);
  const size = limit ?? PAGE;
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const rows = sorted.slice(page * size, page * size + size);

  const H = ({ k, label, left }: { k?: SortKey; label: string; left?: boolean }) => (
    <th scope="col" className={left ? s.tl : ""}>
      {k && !limit ? (
        <button type="button" aria-pressed={sort.key === k}
          onClick={() => setSort((p) => ({ key: k, dir: p.key === k ? ((-p.dir) as 1 | -1) : -1 }))}>
          {label}{sort.key === k ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
        </button>
      ) : label}
    </th>
  );

  if (!trades.length) return <div className={s.empty}>No closed trades match these filters.</div>;
  return (
    <>
      <div className={s.scrollX}>
        <table className={s.table}>
          <thead>
            <tr>
              <H k="symbol" label="Stock" left /><H label="Type" left /><th scope="col">Qty</th>
              <th scope="col">Bought</th><H k="sellDate" label="Sold" /><H k="holdingDays" label="Held" />
              <th scope="col">Avg buy</th><th scope="col">Avg sell</th><H k="buyValue" label="Invested" />
              <th scope="col">Charges</th><H k="net" label="Net P&L" /><H k="netPct" label="Return" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const isOpen = open === t.id;
              return [
                <tr key={t.id} className={`${s.row} ${isOpen ? s.rowOpen : ""}`} tabIndex={0} aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : t.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : t.id); } }}>
                  <td><div className={s.sym}>{t.symbol}<small title={t.name}>{t.name}</small></div></td>
                  <td className={s.tl}><TypeTag t={t.type} /></td>
                  <td>{t.qty}</td>
                  <td>{dshort(t.firstBuyDate)}{t.firstBuyDate !== t.lastBuyDate && <span className={s.mut}> +</span>}</td>
                  <td>{dshort(t.sellDate)}</td>
                  <td>{held(t)}</td>
                  <td>{t.avgBuy.toFixed(2)}</td>
                  <td>{t.avgSell.toFixed(2)}</td>
                  <td>{inr(t.buyValue)}</td>
                  <td className={s.mut}>{inr(t.charges)}</td>
                  <td className={cls(t.net)} style={{ fontWeight: 600 }}>{sinr(t.net)}</td>
                  <td><Pill v={t.netPct} /></td>
                </tr>,
                isOpen && <tr key={t.id + "d"} className={s.detail}><td colSpan={12}><TradeDetail t={t} /></td></tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className={s.pager}>
        {limit ? (
          <>
            <span>Latest {rows.length} of {trades.length} closed trades · click a row for FIFO lots &amp; charges</span>
            {onMore && <button type="button" className={s.btn} onClick={onMore}>All trades →</button>}
          </>
        ) : (
          <>
            <span>{page * size + 1}–{Math.min(sorted.length, page * size + size)} of {sorted.length} · click a row for FIFO lots &amp; charges</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className={s.btn} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <button type="button" className={s.btn} disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ---------- Tax statement tab ---------- */

function TaxTab({ all, data, onCheck }: { all: ClosedTrade[]; data: Payload; onCheck?: () => void }) {
  const fys = useMemo(() => [...new Set(all.map((t) => t.fy))].sort().reverse(), [all]);
  const [fy, setFy] = useState(fys[0]);
  useEffect(() => { if (!fys.includes(fy)) setFy(fys[0]); }, [fys, fy]);
  const ts = useMemo(() => all.filter((t) => t.fy === fy), [all, fy]);
  const a = useMemo(() => computeAnalytics(ts), [ts]);
  const allA = useMemo(() => computeAnalytics(all), [all]);
  const tx = useMemo(() => taxByFy(ts)[0], [ts]);
  if (!fy || !tx) return <div className={s.empty}>No closed trades yet.</div>;

  const groups: [string, ClosedTrade[]][] = [
    ["Intraday", ts.filter((t) => t.type === "INTRADAY")],
    ["Short-term", ts.filter((t) => t.type === "STCG")],
    ["Long-term", ts.filter((t) => t.type === "LTCG")],
    ["Total", ts],
  ];
  const S = (arr: ClosedTrade[], f: (t: ClosedTrade) => number) => arr.reduce((x, t) => x + f(t), 0);
  const money = (v: number, d = 0) => <span className={cls(v)}>{sinr(v, d)}</span>;
  const lines: { label: string; f: (arr: ClosedTrade[]) => React.ReactNode; kind?: "sub" | "bold" | "total" }[] = [
    { label: "Closed trades", f: (arr) => arr.length },
    { label: "Sale value", f: (arr) => inr(S(arr, (t) => t.sellValue)) },
    { label: "Less: cost of acquisition", f: (arr) => "− " + inr(S(arr, (t) => t.buyValue)) },
    { label: "Gross realized", f: (arr) => money(S(arr, (t) => t.gross)), kind: "bold" },
    { label: "Brokerage", f: (arr) => inr(S(arr, (t) => t.chargeBreakup.brokerage), 2), kind: "sub" },
    { label: "STT", f: (arr) => inr(S(arr, (t) => t.chargeBreakup.stt), 2), kind: "sub" },
    { label: "Exchange transaction", f: (arr) => inr(S(arr, (t) => t.chargeBreakup.exchange), 2), kind: "sub" },
    { label: "SEBI turnover fee", f: (arr) => inr(S(arr, (t) => t.chargeBreakup.sebi), 2), kind: "sub" },
    { label: "Stamp duty", f: (arr) => inr(S(arr, (t) => t.chargeBreakup.stamp), 2), kind: "sub" },
    { label: "GST", f: (arr) => inr(S(arr, (t) => t.chargeBreakup.gst), 2), kind: "sub" },
    { label: "Less: total charges", f: (arr) => "− " + inr(S(arr, (t) => t.charges), 2) },
    { label: "Net realized P&L", f: (arr) => money(S(arr, (t) => t.net)), kind: "total" },
    { label: "Return on cost", f: (arr) => { const b = S(arr, (t) => t.buyValue); return b ? pct((S(arr, (t) => t.net) / b) * 100) : "—"; } },
  ];

  // Waterfall: winners (gross) → losers (gross) → charges → net.
  const winG = S(ts.filter((t) => t.gross > 0), (t) => t.gross);
  const lossG = S(ts.filter((t) => t.gross <= 0), (t) => t.gross);
  const steps: [string, number][] = [["Winning trades", winG], ["Losing trades", lossG], ["Charges", -a.charges]];
  const W = 520, Hh = 230;
  const levels = [0, winG, winG + lossG, a.net];
  const top = Math.max(1, ...levels), bot = Math.min(0, ...levels);
  const yy = (v: number) => 24 + (1 - (v - bot) / (top - bot)) * (Hh - 56);
  const bw = 90, gap = 36;
  let run = 0;
  const bars = steps.map(([lab, v], i) => {
    const x = 10 + i * (bw + gap), y1 = yy(run), y2 = yy(run + v);
    run += v;
    return { lab, v, x, y: Math.min(y1, y2), h: Math.max(1, Math.abs(y2 - y1)) };
  });
  const nx = 10 + 3 * (bw + gap);

  const yoyMax = Math.max(1, ...allA.byFy.map((b) => Math.abs(b.net)));
  const stocks = a.bySymbol;

  return (
    <>
      <div className={s.controls}>
        <div className={s.seg} role="group" aria-label="Financial year">
          {fys.map((f) => <button key={f} type="button" aria-pressed={f === fy} onClick={() => setFy(f)}>{shortFy(f)}</button>)}
        </div>
        <div className={s.spacer} />
        <button type="button" className={s.btn} onClick={() => downloadCsv(ts, `realized-pnl-${fy.replace(/\s/g, "")}.csv`)}>Download {shortFy(fy)} CSV</button>
      </div>

      <div className={s.kpis}>
        <Kpi label={`Net realized · ${shortFy(fy)}`} value={sinr(a.net)} tone={s.goldTxt} sub={`${pct(a.returnPct)} on ${inr(a.buyValue)} cost`} />
        <Kpi label="Estimated tax" value={inr(tx.estTax)} sub={a.net > 0 ? `${((tx.estTax / a.net) * 100).toFixed(1)}% of net · excl. intraday` : "excl. intraday"} />
        <Kpi label="Win rate" value={`${a.winRate.toFixed(0)}%`} sub={`${a.wins} of ${a.count} trades · PF ${a.profitFactor?.toFixed(2) ?? "—"}`} />
        <Kpi label="Charges paid" value={inr(a.charges)} sub={`${a.gross > 0 ? ((a.charges / a.gross) * 100).toFixed(1) + "% of gross · " : ""}STT ${inr(a.chargeBreakup.stt)}`} />
      </div>

      <div className={s.grid2}>
        <Card title="P&L statement" sub="by tax category">
          <div className={s.scrollX}>
            <table className={s.stmt}>
              <thead><tr><th />{groups.map(([g]) => <th key={g} scope="col">{g}</th>)}</tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.label} className={l.kind === "sub" ? s.subRow : l.kind === "bold" ? s.bold : l.kind === "total" ? s.total : ""}>
                    <th scope="row">{l.label}</th>
                    {groups.map(([g, arr]) => <td key={g}>{l.f(arr)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={`Capital gains tax estimate · ${shortFy(fy)}`}>
          <div className={s.taxRow}><span>Short-term gains (net)</span><b className={cls(tx.stcgNet)}>{sinr(tx.stcgNet)}</b></div>
          <div className={s.taxRow}><span>Taxable STCG {tx.stcgOld && tx.stcgNew ? "(15% / 20%)" : tx.stcgOld ? "× 15%" : "× 20%"}</span><b>{inr(tx.taxableStcg)}</b></div>
          <div className={s.taxRow}><span>Long-term gains (net)</span><b className={cls(tx.ltcgNet)}>{sinr(tx.ltcgNet)}</b></div>
          <div className={s.taxRow} style={{ flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>LTCG exemption used</span><b>{inr(tx.exemptionUsed)} / {inr(tx.exemption)}</b></div>
            <div className={s.meter}><i style={{ width: `${Math.max(1, (tx.exemptionUsed / tx.exemption) * 100)}%` }} /></div>
            <span style={{ fontSize: 11.5 }}>{inr(tx.exemption - tx.exemptionUsed)} more long-term gain can be booked tax-free this FY</span>
          </div>
          <div className={s.taxRow}><span>Taxable LTCG {tx.ltcgOld && !tx.ltcgNew ? "× 10%" : "× 12.5%"}</span><b>{inr(tx.taxableLtcg)}</b></div>
          <div className={s.taxRow}><span>Intraday — speculative income</span><b className={cls(tx.intradayNet)}>{sinr(tx.intradayNet)}</b></div>
          {tx.carryForwardLoss > 0 && <div className={s.taxRow}><span>Capital loss to carry forward</span><b className={s.dn}>{inr(tx.carryForwardLoss)}</b></div>}
          <div className={`${s.taxRow} ${s.taxStrong}`}><span>Estimated tax incl. 4% cess</span><b className={s.goldTxt}>{inr(tx.estTax)}</b></div>
          <div className={`${s.taxRow} ${s.taxStrong}`}><span>Post-tax realized P&amp;L</span><b className={cls(a.net - tx.estTax)}>{sinr(a.net - tx.estTax)}</b></div>
          <p className={s.fine}>
            Estimate for planning, not a filing. Listed equity, STT paid: STCG 20% and LTCG 12.5% above ₹1.25L for sales from 23 Jul 2024 (15% / 10% above ₹1L before).
            Short-term losses offset STCG then LTCG; long-term losses offset LTCG only. Intraday is added to income at your slab rate. No surcharge or 87A rebate; losses carried in from earlier years aren't applied.
          </p>
        </Card>
      </div>

      <div className={s.grid2}>
        <Card title="From gross to net" sub={shortFy(fy)}>
          <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`Waterfall: winning trades ${sinr(winG)}, losing trades ${sinr(lossG)}, charges ${sinr(-a.charges)}, net ${sinr(a.net)}`}>
            <line x1="0" x2={W} y1={yy(0)} y2={yy(0)} stroke="var(--border-strong)" />
            {bars.map((b) => (
              <g key={b.lab}>
                <rect x={b.x} y={b.y} width={bw} height={b.h} rx="4" fill={b.v >= 0 ? "var(--gain)" : "var(--loss)"} opacity="0.9" />
                <text x={b.x + bw / 2} y={b.y - 6} textAnchor="middle" fill="var(--text)" fontSize="12" fontWeight="600">{sinr(b.v)}</text>
                <text x={b.x + bw / 2} y={Hh - 8} textAnchor="middle" fill="var(--text-muted)" fontSize="11.5">{b.lab}</text>
              </g>
            ))}
            <rect x={nx} y={Math.min(yy(a.net), yy(0))} width={bw} height={Math.max(1, Math.abs(yy(0) - yy(a.net)))} rx="4" fill={a.net >= 0 ? "var(--gold)" : "var(--loss)"} />
            <text x={nx + bw / 2} y={Math.min(yy(a.net), yy(0)) - 6} textAnchor="middle" fill="var(--gold-bright)" fontSize="12" fontWeight="700">{sinr(a.net)}</text>
            <text x={nx + bw / 2} y={Hh - 8} textAnchor="middle" fill="var(--text-muted)" fontSize="11.5">Net</text>
          </svg>
        </Card>
        <Card title="Year on year" sub="net realized per FY">
          <div className={s.yoy}>
            {allA.byFy.map((b) => (
              <div key={b.key} className={b.key === fy ? s.on : ""}>
                <span className={cls(b.net)} style={{ fontSize: 12, fontWeight: 600 }}>{kfmt(b.net)}</span>
                <i style={{ height: `${Math.max(3, (Math.abs(b.net) / yoyMax) * 110)}px`, ...(b.net < 0 && b.key !== fy ? { background: "var(--loss)", opacity: 0.6 } : {}) }} />
                <small style={{ color: b.key === fy ? "var(--text)" : undefined }}>{shortFy(b.key)}</small>
                <small>{b.trades} tr · {Math.round((b.wins / b.trades) * 100)}%</small>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title={`Stock-wise realized · ${shortFy(fy)}`} sub={`${stocks.length} stocks`}>
        <div className={s.scrollX}>
          <table className={s.table} style={{ minWidth: 640 }}>
            <thead><tr><th scope="col">Stock</th><th scope="col">Trades</th><th scope="col">Qty sold</th><th scope="col">Cost</th><th scope="col">Sale value</th><th scope="col">Charges</th><th scope="col">Net P&amp;L</th><th scope="col">Win rate</th></tr></thead>
            <tbody>
              {stocks.map((x) => (
                <tr key={x.key}>
                  <td><div className={s.sym}>{x.symbol}<small>{x.name}</small></div></td>
                  <td>{x.trades}</td><td>{x.qty}</td><td>{inr(x.buyValue)}</td><td>{inr(x.buyValue + x.gross)}</td>
                  <td className={s.mut}>{inr(x.charges)}</td>
                  <td className={cls(x.net)} style={{ fontWeight: 600 }}>{sinr(x.net)}</td>
                  <td>{Math.round((x.wins / x.trades) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DataChecks data={data} />
    </>
  );
}

function DataChecks({ data }: { data: Payload }) {
  const n = data.unmatched.length + data.mismatches.length;
  return (
    <section className={s.card} id="data-checks">
      <div className={s.cardHead}>
        <h2 className={s.cardTitle}>Data checks</h2>
        <span className={s.cardSub}>
          {data.totals.equityTrades} equity trades from {dshort(data.totals.firstTrade)} to {dshort(data.totals.lastTrade)}
        </span>
      </div>
      {n === 0 && <div className={s.mut} style={{ fontSize: 13 }}>Every sell matched a buy, and what's left matches your Dhan holdings.</div>}
      {data.unmatched.map((u, i) => (
        <div key={"u" + i} className={s.checkRow}>
          <span className={`${s.tag} ${s.tagS}`}>No buy found</span>
          <b>{u.symbol}</b>
          <span className={s.what}>Sold {u.qty} @ {u.sellPrice.toFixed(2)} on {dshort(u.sellDate)} ({inr(u.sellValue)}). Bought before the history window, or a bonus/IPO/transfer credit — left out of P&amp;L.</span>
        </div>
      ))}
      {data.mismatches.map((m) => (
        <div key={m.isin} className={s.checkRow}>
          <span className={`${s.tag} ${s.tagL}`}>Qty mismatch</span>
          <b>{m.symbol}</b>
          <span className={s.what}>Trade history leaves {m.fromHistory}, Dhan holds {m.held}. Usually a split, bonus or older shares — this stock's P&amp;L may be off.</span>
        </div>
      ))}
    </section>
  );
}

function downloadCsv(trades: ClosedTrade[], name: string) {
  const blob = new Blob([tradesToCsv(trades)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Page ---------- */

export default function PnlPage() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<string>("ALL"); // "ALL" | fy | "CUSTOM"
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [typeF, setTypeF] = useState<TypeF>("ALL");
  const [outcome, setOutcome] = useState<Outcome>("ALL");
  const [q, setQ] = useState("");

  const load = (mode?: "refresh" | "full") => {
    setSyncing(true);
    fetch(`/api/pnl${mode ? `?${mode}=1` : ""}`)
      .then((r) => {
        if (r.status === 401) { router.push("/login"); return null; }
        return r.json();
      })
      .then((d) => { if (d) { setData(d); setErr(null); } })
      .catch((e) => setErr(String(e)))
      .finally(() => setSyncing(false));
  };
  useEffect(() => { load(); }, []);

  const fys = useMemo(() => [...new Set((data?.trades || []).map((t) => t.fy))].sort().reverse(), [data]);

  const filtered = useMemo(() => {
    let ts = data?.trades || [];
    if (period === "CUSTOM") {
      if (from) ts = ts.filter((t) => t.sellDate >= from);
      if (to) ts = ts.filter((t) => t.sellDate <= to);
    } else if (period !== "ALL") ts = ts.filter((t) => t.fy === period);
    if (typeF === "DELIVERY") ts = ts.filter((t) => t.type !== "INTRADAY");
    else if (typeF !== "ALL") ts = ts.filter((t) => t.type === typeF);
    if (outcome === "WIN") ts = ts.filter((t) => t.net > 0);
    if (outcome === "LOSS") ts = ts.filter((t) => t.net <= 0);
    const qq = q.trim().toLowerCase();
    if (qq) ts = ts.filter((t) => t.symbol.toLowerCase().includes(qq) || t.name.toLowerCase().includes(qq));
    return ts;
  }, [data, period, from, to, typeF, outcome, q]);

  const a = useMemo(() => computeAnalytics(filtered), [filtered]);
  const latestTax = useMemo(() => (data ? taxByFy(data.trades)[0] : null), [data]);

  if (!data && !err) {
    return <div style={{ padding: "40px 0", color: "var(--text-muted)" }}>Loading your trade history… the first load downloads everything from Dhan and can take up to a minute.</div>;
  }
  if (!data) return <div className={`${s.note} ${s.noteErr}`}>Couldn't load P&amp;L: {err}</div>;

  const issues = data.unmatched.length + data.mismatches.length;
  const synced = data.fetchedAt ? new Date(data.fetchedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";
  const periodLabel = period === "ALL" ? "all time" : period === "CUSTOM" ? "custom range" : shortFy(period);

  return (
    <div style={{ paddingBottom: 40 }}>
      <header className={s.head}>
        <div>
          <h1 className={s.title}>Realized P&amp;L</h1>
          <div className={s.sub}>
            Closed stock trades · FIFO-matched from full Dhan history{data.totals.firstTrade ? ` since ${dshort(data.totals.firstTrade)}` : ""} · synced {synced}
          </div>
        </div>
        <div className={s.actions}>
          <button type="button" className={s.btn} disabled={syncing} onClick={() => load("refresh")}>{syncing ? "Syncing…" : "Sync from Dhan"}</button>
          <button type="button" className={`${s.btn} ${s.btnGold}`} disabled={!filtered.length} onClick={() => downloadCsv(filtered, `realized-pnl-${periodLabel.replace(/\s/g, "")}.csv`)}>Export CSV</button>
        </div>
      </header>

      {data.syncError && <div className={`${s.note} ${s.noteErr}`}><b>Sync issue.</b> {data.syncError}</div>}

      <div className={s.tabs} role="tablist" aria-label="P&L views">
        {([["overview", "Overview"], ["trades", `Trades (${filtered.length})`], ["tax", "Tax statement"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" className={s.tab} aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "tax" ? (
        <TaxTab all={data.trades} data={data} />
      ) : (
        <>
          <div className={s.controls}>
            <div className={s.seg} role="group" aria-label="Period">
              <button type="button" aria-pressed={period === "ALL"} onClick={() => setPeriod("ALL")}>All time</button>
              {fys.map((f) => <button key={f} type="button" aria-pressed={period === f} onClick={() => setPeriod(f)}>{shortFy(f)}</button>)}
              <button type="button" aria-pressed={period === "CUSTOM"} onClick={() => setPeriod("CUSTOM")}>Custom</button>
            </div>
            {period === "CUSTOM" && (
              <div className={s.dates}>
                <label htmlFor="pnl-from">From</label>
                <input id="pnl-from" type="date" className={s.input} value={from} onChange={(e) => setFrom(e.target.value)} />
                <label htmlFor="pnl-to">to</label>
                <input id="pnl-to" type="date" className={s.input} value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            )}
            <div className={s.seg} role="group" aria-label="Trade type">
              {([["ALL", "All"], ["DELIVERY", "Delivery"], ["INTRADAY", "Intraday"], ["LTCG", "Long-term"]] as [TypeF, string][]).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={typeF === k} onClick={() => setTypeF(k)}>{l}</button>
              ))}
            </div>
            <div className={s.seg} role="group" aria-label="Outcome">
              {([["ALL", "All"], ["WIN", "Winners"], ["LOSS", "Losers"]] as [Outcome, string][]).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={outcome === k} onClick={() => setOutcome(k)}>{l}</button>
              ))}
            </div>
            <div className={s.spacer} />
            <input type="search" aria-label="Search stock" placeholder="Search stock…" className={`${s.input} ${s.search}`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          {data.trades.length === 0 ? (
            <div className={s.empty}>No closed stock trades found in your Dhan history yet.</div>
          ) : tab === "trades" ? (
            <section className={s.card}><TradesTable trades={filtered} /></section>
          ) : (
            <>
              <div className={s.kpis}>
                <div className={s.hero}>
                  <div className={s.kpiL}>Net realized P&amp;L · {periodLabel} · after all charges</div>
                  <div className={`${s.heroBig} ${a.net >= 0 ? s.goldTxt : s.dn}`}>{sinr(a.net)}</div>
                  <div className={cls(a.returnPct)} style={{ fontSize: 13, fontWeight: 600 }}>
                    {pct(a.returnPct)} <span className={s.mut} style={{ fontWeight: 400 }}>on {inr(a.buyValue)} deployed</span>
                  </div>
                  <div className={s.heroRow}>
                    <div><div className={s.l}>Gross</div><div className={`${s.v} ${cls(a.gross)}`}>{sinr(a.gross)}</div></div>
                    <div><div className={s.l}>Charges paid</div><div className={s.v}>{inr(a.charges)}</div></div>
                    <div><div className={s.l}>Closed trades</div><div className={s.v}>{a.count}</div></div>
                    <div><div className={s.l}>Avg hold</div><div className={s.v}>{Math.round(a.avgHoldDays)} days</div></div>
                  </div>
                </div>
                <div className={s.kpi}>
                  <div className={s.kpiL}>Win rate</div>
                  <div className={s.kpiV}>{a.winRate.toFixed(1)}%</div>
                  <div className={s.wl}>
                    <i style={{ width: `${a.count ? (a.wins / a.count) * 100 : 0}%`, background: "var(--gain)" }} />
                    <i style={{ flex: 1, background: a.losses ? "var(--loss)" : "transparent" }} />
                  </div>
                  <div className={s.kpiS}>{a.wins} wins · {a.losses} losses{a.currentStreak.kind ? ` · on a ${a.currentStreak.n}-${a.currentStreak.kind === "W" ? "win" : "loss"} streak` : ""}</div>
                </div>
                <Kpi label="Profit factor" value={a.profitFactor === null ? (a.wins ? "∞" : "—") : a.profitFactor.toFixed(2)} sub={`Avg win ${inr(a.avgWin)} vs loss ${inr(a.avgLoss)}`} />
                <Kpi label="Expectancy / trade" value={sinr(a.expectancy)} tone={cls(a.expectancy)} sub={a.payoff !== null ? `Payoff ratio ${a.payoff.toFixed(2)}×` : "—"} />
                <Kpi label="Max drawdown" value={a.maxDrawdown < 0 ? sinr(a.maxDrawdown) : "₹0"} tone={a.maxDrawdown < 0 ? s.dn : ""} sub={a.maxDrawdown < 0 ? `${dshort(a.maxDrawdownFrom)} → ${dshort(a.maxDrawdownTo)}` : "No drawdown from a peak"} />
                <Kpi label="Best trade" value={a.best ? sinr(a.best.net) : "—"} tone={s.up} sub={a.best ? `${a.best.symbol} · ${pct(a.best.netPct)} · ${dshort(a.best.sellDate)}` : ""} />
                <Kpi label="Worst trade" value={a.worst ? sinr(a.worst.net) : "—"} tone={a.worst && a.worst.net < 0 ? s.dn : ""} sub={a.worst ? `${a.worst.symbol} · ${pct(a.worst.netPct)} · ${dshort(a.worst.sellDate)}` : ""} />
              </div>

              <Card title="Cumulative realized P&L" right={
                <div className={s.legend}>
                  <span><i style={{ width: 14, height: 3, background: "var(--gain)", display: "block" }} />Net P&amp;L</span>
                  <span><i style={{ width: 12, height: 10, background: "rgba(255,107,107,.4)", display: "block" }} />Drawdown from peak</span>
                </div>
              }>
                <Curve a={a} />
              </Card>

              <div className={s.grid2}>
                <Card title="Monthly P&L" sub="Indian FY · Apr → Mar"><Heatmap a={a} /></Card>
                <Card title="By holding period" sub="net after charges">
                  <DivBars rows={a.byHold.filter((b) => b.trades).map((b) => ({ key: b.key, label: b.label, sub: `${b.trades} trades · ${Math.round((b.wins / b.trades) * 100)}% win`, v: b.net }))} />
                </Card>
              </div>

              <div className={s.grid2}>
                <Card title="Top stocks" sub="realized in this filter">
                  <DivBars rows={a.bySymbol.filter((x) => x.net > 0).slice(0, 6).map((x) => ({ key: x.key, label: x.symbol, sub: `${x.trades} trades · ${Math.round((x.wins / x.trades) * 100)}% win`, v: x.net }))} />
                </Card>
                <Card title="Biggest drags">
                  <DivBars rows={[...a.bySymbol].reverse().filter((x) => x.net < 0).slice(0, 6).map((x) => ({ key: x.key, label: x.symbol, sub: `${x.trades} trades · ${Math.round((x.wins / x.trades) * 100)}% win`, v: x.net }))} />
                </Card>
              </div>

              <Card title="Recent closed trades">
                <TradesTable trades={filtered} limit={8} onMore={() => setTab("trades")} />
              </Card>

              {latestTax && (
                <Card title={`Tax snapshot · ${latestTax.fy}`} right={<button type="button" className={s.linkBtn} onClick={() => setTab("tax")}>Full tax statement →</button>}>
                  <div className={s.kpis} style={{ marginTop: 0 }}>
                    <Kpi label="Short-term gains" value={sinr(latestTax.stcgNet)} tone={cls(latestTax.stcgNet)} sub="taxed at 20%" />
                    <div className={s.kpi}>
                      <div className={s.kpiL}>Long-term gains</div>
                      <div className={`${s.kpiV} ${cls(latestTax.ltcgNet)}`}>{sinr(latestTax.ltcgNet)}</div>
                      <div className={s.meter}><i style={{ width: `${Math.max(1, (latestTax.exemptionUsed / latestTax.exemption) * 100)}%` }} /></div>
                      <div className={s.kpiS}>{inr(latestTax.exemptionUsed)} of {inr(latestTax.exemption)} exemption used</div>
                    </div>
                    <Kpi label="Intraday (speculative)" value={sinr(latestTax.intradayNet)} tone={cls(latestTax.intradayNet)} sub="added to income, slab rate" />
                    <Kpi label="Estimated tax" value={inr(latestTax.estTax)} sub="incl. 4% cess · excl. intraday" />
                  </div>
                </Card>
              )}

              {issues > 0 && (
                <div className={s.note}>
                  <b>{issues} item{issues > 1 ? "s" : ""} to review.</b>
                  {data.unmatched.length > 0 && <span>{data.unmatched.length} sell{data.unmatched.length > 1 ? "s" : ""} had no buy in your Dhan history and {data.unmatched.length > 1 ? "were" : "was"} left out rather than guessed.</span>}
                  {data.mismatches.length > 0 && <span>{data.mismatches.length} stock{data.mismatches.length > 1 ? "s" : ""} where history and holdings disagree (split/bonus?).</span>}
                  <button type="button" className={s.linkBtn} onClick={() => setTab("tax")}>Review in Tax statement →</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
