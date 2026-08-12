"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sectorFor } from "@/lib/sectors";

const inr = (n: number, d = 0) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n >= 0 ? "+" : "−");

type Holding = { symbol: string; qty: number; avg: number; ltp: number; current: number; pnl: number; pnlPct: number };
type Snapshot = {
  empty?: boolean;
  message?: string;
  captured_at: string;
  holdings: Holding[];
  total_invested: number;
  total_current: number;
  total_pnl: number;
  day_pnl: number;
};

const SECTOR_COLORS: Record<string, string> = {
  Financials: "#D4A24C", IT: "#6B8CAE", Energy: "#C0714A", FMCG: "#7BA88C",
  Infrastructure: "#9B7FB5", Telecom: "#C77B93", Auto: "#6FA8A0",
  "Metals & Defence": "#B5915E", Mining: "#8C6F4F", Hospitality: "#7B9BA8",
  "Consumer/Retail": "#A88C7B", Conglomerate: "#8C7BA8", Industrials: "#6FA88C",
  Other: "#5C6670",
};

function PerformanceChart({ points }: { points: { captured_at: string; total_current: number }[] }) {
  if (points.length < 2) {
    return <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>Not enough history yet — check back after a few refreshes.</div>;
  }
  const w = 900, h = 220, pad = 10;
  const values = points.map((p) => p.total_current);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (p.total_current - min) / range);
    return `${x},${y}`;
  });
  const linePath = "M" + coords.join(" L");
  const areaPath = linePath + ` L${pad + (points.length - 1) * stepX},${h - pad} L${pad},${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 220 }}>
      <defs>
        <linearGradient id="perfGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D4A24C" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#D4A24C" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#perfGradient)" />
      <path d={linePath} fill="none" stroke="#D4A24C" strokeWidth="2" />
    </svg>
  );
}

function SectorDonut({ holdings }: { holdings: Holding[] }) {
  const totals: Record<string, number> = {};
  let sum = 0;
  holdings.forEach((h) => {
    const sec = sectorFor(h.symbol);
    totals[sec] = (totals[sec] || 0) + h.current;
    sum += h.current;
  });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const r = 60, cx = 75, cy = 75, circumference = 2 * Math.PI * r;
  let cumulative = 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <svg width="150" height="150" viewBox="0 0 150 150">
        {entries.map(([sec, val]) => {
          const pct = val / sum;
          const dash = `${pct * circumference} ${circumference}`;
          const offset = -cumulative * circumference;
          cumulative += pct;
          return (
            <circle
              key={sec} cx={cx} cy={cy} r={r} fill="none"
              stroke={SECTOR_COLORS[sec] || SECTOR_COLORS.Other} strokeWidth="20"
              strokeDasharray={dash} strokeDashoffset={offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
        })}
      </svg>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map(([sec, val]) => (
          <div key={sec} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: SECTOR_COLORS[sec] || SECTOR_COLORS.Other }} />
              {sec}
            </span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{((val / sum) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Snapshot | null>(null);
  const [perf, setPerf] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [closedTrades, setClosedTrades] = useState<any[]>([]);
  const [movers, setMovers] = useState<any[]>([]);
  const [news, setNews] = useState<any[]>([]);

  async function load() {
    const res = await fetch("/api/portfolio");
    if (res.status === 401) return router.push("/login");
    const snap = await res.json();
    setData(snap);
    if (!snap.empty) {
      fetch("/api/performance").then((r) => r.json()).then((d) => setPerf(d.points || []));
      fetch("/api/orders").then((r) => r.json()).then((d) => setOrders(d.orders || []));
      fetch("/api/trades").then((r) => r.json()).then((d) => setClosedTrades(d.closedTrades || []));
      fetch("/api/movers").then((r) => r.json()).then((d) => setMovers(d.movers || []));
      fetch("/api/news").then((r) => r.json()).then((d) => setNews(d.news || []));
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  if (!data) return <div className="wrap" style={{ paddingTop: 60 }}>Loading…</div>;

  if (data.empty) {
    return (
      <div className="wrap" style={{ paddingTop: 60 }}>
        <div className="panel">
          <p>{data.message}</p>
          <a className="btn" style={{ display: "inline-block", width: "auto", padding: "10px 18px", textDecoration: "none" }} href="/settings">
            Go to Settings
          </a>
        </div>
      </div>
    );
  }

  const totalPnlPct = (data.total_pnl / data.total_invested) * 100;
  const alerts = data.holdings.filter((h) => h.pnlPct >= 7).sort((a, b) => b.pnlPct - a.pnlPct);

  return (
    <>
      <div style={{ background: "#0D1215", borderBottom: "1px solid var(--border)", overflow: "hidden", whiteSpace: "nowrap", padding: "9px 0" }}>
        <div style={{ display: "inline-flex" }}>
          {[...data.holdings, ...data.holdings].map((h, i) => (
            <span key={i} style={{ display: "inline-flex", gap: 7, padding: "0 22px", fontFamily: "var(--font-mono)", fontSize: 12.5, borderRight: "1px solid var(--border)" }}>
              <span style={{ color: "var(--text-muted)" }}>{h.symbol}</span>
              <span style={{ fontWeight: 600 }}>{h.ltp.toFixed(2)}</span>
              <span style={{ color: h.pnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(h.pnlPct)}{Math.abs(h.pnlPct).toFixed(1)}%</span>
            </span>
          ))}
        </div>
      </div>

      <div className="wrap" style={{ paddingTop: 34 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 20, borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 600 }}>Portfolio</div>
          <div style={{ display: "flex", gap: 10 }}>
            <a href="/settings" style={{ fontSize: 13, color: "var(--text-muted)", textDecoration: "none" }}>Settings</a>
            <button onClick={logout} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>Log out</button>
          </div>
        </header>

        <section className="panel" style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Portfolio Value</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 38, fontWeight: 600, marginTop: 10 }}>{inr(data.total_current, 2)}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <span className={`badge ${totalPnlPct >= 0 ? "up" : "down"}`}>{sign(totalPnlPct)}{Math.abs(totalPnlPct).toFixed(2)}%</span>
            <span className={`badge ${data.day_pnl >= 0 ? "up" : "down"}`}>Day {sign(data.day_pnl)}{inr(Math.abs(data.day_pnl))}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10, fontFamily: "var(--font-mono)" }}>
            Last synced {new Date(data.captured_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · updates every 15 min
          </div>
        </section>

        {alerts.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, marginBottom: 12 }}>Profit-booking alerts</div>
            <div className="panel" style={{ display: "grid", gap: 10 }}>
              {alerts.map((h) => (
                <div key={h.symbol} style={{ display: "flex", justifyContent: "space-between", borderLeft: `3px solid ${h.pnlPct >= 8 ? "var(--gain)" : "var(--amber)"}`, paddingLeft: 12 }}>
                  <span style={{ fontWeight: 600 }}>{h.symbol}</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--gain)" }}>+{h.pnlPct.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ marginTop: 28 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, marginBottom: 12 }}>Daily performance</div>
          <div className="panel"><PerformanceChart points={perf} /></div>
        </section>

        <section style={{ marginTop: 28, display: "grid", gridTemplateColumns: "1.65fr 1fr", gap: 24, alignItems: "start" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, marginBottom: 12 }}>Holdings</div>
            <div className="panel" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 11.5 }}>
                    <th style={{ textAlign: "left", paddingBottom: 10 }}>Stock</th>
                    <th>Qty</th><th>Avg</th><th>LTP</th><th>Value</th><th>P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {data.holdings.map((h) => (
                    <tr key={h.symbol} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 0", fontWeight: 600 }}>{h.symbol}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.qty}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.avg.toFixed(2)}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.ltp.toFixed(2)}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{inr(h.current)}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: h.pnl >= 0 ? "var(--gain)" : "var(--loss)" }}>
                        {sign(h.pnl)}{inr(Math.abs(h.pnl))} ({h.pnlPct.toFixed(1)}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, marginBottom: 12 }}>Sector mix</div>
            <div className="panel"><SectorDonut holdings={data.holdings} /></div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
              Approximate — Dhan doesn't return sector data, this uses a static symbol mapping.
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, marginBottom: 12 }}>Today's orders</div>
            <div className="panel">
              {orders.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No orders placed today.</div>
              ) : (
                orders.map((o, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                    <div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 7px", borderRadius: 5, marginRight: 8, color: o.transactionType === "BUY" ? "var(--gain)" : "var(--loss)", background: o.transactionType === "BUY" ? "var(--gain-soft)" : "var(--loss-soft)" }}>{o.transactionType}</span>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{o.tradingSymbol}</span>
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-muted)" }}>{o.quantity} @ {o.price}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, marginBottom: 12 }}>Volume &amp; momentum</div>
            <div className="panel">
              {movers.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No data yet.</div>
              ) : (
                movers.map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{m.symbol}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{m.signal}</div>
                    </div>
                    <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                      <div style={{ color: m.dayChgPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(m.dayChgPct)}{Math.abs(m.dayChgPct).toFixed(2)}%</div>
                      <div style={{ color: "var(--gold)", fontSize: 11 }}>{m.volX.toFixed(1)}x avg vol</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, marginBottom: 12 }}>Closed trades (today)</div>
          <div className="panel" style={{ overflowX: "auto" }}>
            {closedTrades.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No same-day closed trades yet.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 11.5 }}>
                    <th style={{ textAlign: "left", paddingBottom: 10 }}>Stock</th>
                    <th>Qty</th><th>Entry</th><th>Exit</th><th>P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.map((t, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 0", fontWeight: 600 }}>{t.symbol}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{t.qty}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{t.entry.toFixed(2)}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{t.exit.toFixed(2)}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: t.pnl >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(t.pnl)}{inr(Math.abs(t.pnl))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section style={{ marginTop: 28, marginBottom: 60 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, marginBottom: 12 }}>Portfolio news</div>
          <div className="panel">
            {news.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No news found right now.</div>
            ) : (
              news.map((n, i) => (
                <a key={i} href={n.url} target="_blank" rel="noreferrer" style={{ display: "block", padding: "12px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none", textDecoration: "none", color: "var(--text)" }}>
                  <div style={{ fontSize: 13 }}>{n.headline}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
                    <span style={{ background: "var(--panel-2)", border: "1px solid var(--border-strong)", borderRadius: 5, padding: "1px 6px", marginRight: 6 }}>{n.symbol}</span>
                    {n.source} · {n.when}
                  </div>
                </a>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}
