"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const inr = (n: number, d = 0) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n >= 0 ? "+" : "−");

function PerfChart({ points }: { points: { captured_at: string; total_current: number }[] }) {
  if (points.length < 2) {
    return <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "30px 0", textAlign: "center" }}>Not enough history yet.</div>;
  }
  const w = 900, h = 160, pad = 10;
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
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 160 }}>
      <defs>
        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6B5CE6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#6B5CE6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#pg)" />
      <path d={linePath} fill="none" stroke="#6B5CE6" strokeWidth="2.5" />
    </svg>
  );
}

export default function DashboardOverview() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [perf, setPerf] = useState<any[]>([]);
  const [movers, setMovers] = useState<any[]>([]);
  const [news, setNews] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/portfolio").then((r) => {
      if (r.status === 401) return router.push("/login");
      return r.json();
    }).then((snap) => {
      if (!snap) return;
      setData(snap);
      if (!snap.empty) {
        fetch("/api/performance").then((r) => r.json()).then((d) => setPerf(d.points || []));
        fetch("/api/movers").then((r) => r.json()).then((d) => setMovers(d.movers || []));
        fetch("/api/news").then((r) => r.json()).then((d) => setNews(d.news || []));
        fetch("/api/dividends").then((r) => r.json()).then((d) => setEvents(d.events || []));
      }
    });
  }, []);

  if (!data) return <div style={{ padding: "40px 0" }}>Loading…</div>;

  if (data.empty) {
    return (
      <div className="list-card">
        <p>{data.message}</p>
        <Link href="/settings" className="badge up" style={{ textDecoration: "none", display: "inline-block", padding: "8px 16px" }}>Go to Settings</Link>
      </div>
    );
  }

  const totalPnlPct = (data.total_pnl / data.total_invested) * 100;
  const inProfitPct = (data.holdings.filter((h: any) => h.pnl >= 0).length / data.holdings.length) * 100;

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600 }}>Good day, Vignesh 👋</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
        Last synced {new Date(data.captured_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
      </div>

      <div style={{ marginTop: 22, borderRadius: 20, padding: "28px 30px", background: "linear-gradient(135deg,#6B5CE6 0%,#4B3FB0 100%)" }}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>Total Portfolio Value</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 38, fontWeight: 700, marginTop: 10, color: "#fff" }}>{inr(data.total_current, 2)}</div>
        <div style={{ marginTop: 8, fontSize: 13.5, color: data.day_pnl >= 0 ? "#B9F5DC" : "#FBD4CE", fontWeight: 600 }}>
          {sign(data.day_pnl)}{inr(Math.abs(data.day_pnl))} today
        </div>
      </div>

      <div className="stat-grid" style={{ marginTop: 16 }}>
        <div className="stat-card"><div className="stat-label">Total Return</div><div className="stat-value">{inr(data.total_pnl)}</div><div style={{ fontSize: 11.5, marginTop: 5, color: totalPnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(totalPnlPct)}{Math.abs(totalPnlPct).toFixed(1)}%</div></div>
        <div className="stat-card"><div className="stat-label">Invested</div><div className="stat-value">{inr(data.total_invested)}</div><div style={{ fontSize: 11.5, marginTop: 5, color: "var(--text-muted)" }}>{data.holdings.length} positions</div></div>
        <div className="stat-card"><div className="stat-label">Day Change</div><div className="stat-value">{sign(data.day_pnl)}{inr(Math.abs(data.day_pnl))}</div></div>
        <div className="stat-card"><div className="stat-label">In Profit</div><div className="stat-value">{inProfitPct.toFixed(0)}%</div><div style={{ fontSize: 11.5, marginTop: 5, color: "var(--text-muted)" }}>of holdings</div></div>
      </div>

      <div className="list-card" style={{ marginTop: 18 }}>
        <div className="list-head"><div className="list-title">Portfolio Performance</div></div>
        <PerfChart points={perf} />
      </div>

      <div className="list-card" style={{ marginTop: 18 }}>
        <div className="list-head"><div className="list-title">Top Holdings</div><Link href="/dashboard/holdings" className="list-link">View All →</Link></div>
        {data.holdings.slice(0, 5).map((h: any) => (
          <div key={h.symbol} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{h.symbol}</span>
            <span style={{ color: h.pnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(h.pnlPct)}{Math.abs(h.pnlPct).toFixed(1)}%</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 18 }}>
        <div className="list-card">
          <div className="list-head"><div className="list-title">Momentum &amp; Volume</div></div>
          {movers.length === 0 ? <div style={{ color: "var(--text-muted)", fontSize: 12.5 }}>No data yet.</div> :
            movers.slice(0, 4).map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
                <span><b>{m.symbol}</b><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.signal}</div></span>
                <span style={{ color: m.dayChgPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(m.dayChgPct)}{Math.abs(m.dayChgPct).toFixed(1)}% <span style={{ color: "var(--amber)" }}>{m.volX.toFixed(1)}x</span></span>
              </div>
            ))}
        </div>
        <div className="list-card">
          <div className="list-head"><div className="list-title">Stock News</div></div>
          {news.length === 0 ? <div style={{ color: "var(--text-muted)", fontSize: 12.5 }}>No news found.</div> :
            news.slice(0, 3).map((n, i) => (
              <a key={i} href={n.url} target="_blank" rel="noreferrer" style={{ display: "block", padding: "9px 0", borderBottom: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}>
                <div style={{ fontSize: 12.5 }}>{n.headline}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>{n.symbol} · {n.source}</div>
              </a>
            ))}
        </div>
      </div>

      <div className="list-card" style={{ marginTop: 18, marginBottom: 40 }}>
        <div className="list-head"><div className="list-title">Dividends &amp; Earnings</div></div>
        {events.length === 0 ? <div style={{ color: "var(--text-muted)", fontSize: 12.5 }}>No upcoming events found.</div> :
          events.map((e, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
              <span>
                <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 100, marginRight: 8, background: e.type === "dividend" ? "var(--gold-soft)" : "var(--amber-soft)", color: e.type === "dividend" ? "var(--gold)" : "var(--amber)" }}>
                  {e.type.toUpperCase()}
                </span>
                {e.symbol} — {e.label}
              </span>
              <span style={{ color: "var(--text-muted)" }}>{e.date}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
