"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const inr = (n: number | null | undefined, d = 0) =>
  "₹" + (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number | null | undefined) => ((n ?? 0) >= 0 ? "+" : "−");

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
  const [mfHoldings, setMfHoldings] = useState<any[]>([]);
  const [goldHoldings, setGoldHoldings] = useState<any[]>([]);

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
      fetch("/api/mutual-funds").then((r) => r.json()).then((d) => setMfHoldings(d.holdings || []));
      fetch("/api/gold").then((r) => r.json()).then((d) => setGoldHoldings(d.holdings || []));
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

  const mfTotalCurrent = mfHoldings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
  const mfTotalInvested = mfHoldings.reduce((s, h) => s + (h.invested ?? 0), 0);

  const goldTotalCurrent = goldHoldings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
  const goldTotalInvested = goldHoldings.reduce((s, h) => s + (h.amountPaid ?? 0), 0);
  const goldTotalGain = goldTotalCurrent - goldTotalInvested;
  const goldTotalGainPct = goldTotalInvested > 0 ? (goldTotalGain / goldTotalInvested) * 100 : 0;

  const combinedTotal = data.total_current + mfTotalCurrent + goldTotalCurrent;
  const combinedInvested = data.total_invested + mfTotalInvested + goldTotalInvested;
  const combinedGain = combinedTotal - combinedInvested;
  const combinedGainPct = combinedInvested > 0 ? (combinedGain / combinedInvested) * 100 : 0;

  // Estimated dividend income — sum (per-share amount parsed from the event
  // label) × (units held) across all upcoming dividends.
  const estDividendIncome = events
    .filter((e: any) => e.type === "dividend")
    .reduce((sum: number, e: any) => {
      const holding = data.holdings.find((h: any) => h.symbol === e.symbol);
      if (!holding) return sum;
      const amountMatch = (e.label || "").match(/Rs\.?\s*([\d.]+)/i);
      const perShare = amountMatch ? parseFloat(amountMatch[1]) : 0;
      return sum + perShare * holding.qty;
    }, 0);
  const dividendCount = events.filter((e: any) => e.type === "dividend").length;

  const sectorPerf: Record<string, { invested: number; pnl: number }> = {};
  data.holdings.forEach((h: any) => {
    const sec = h.sector || "Other";
    sectorPerf[sec] = sectorPerf[sec] || { invested: 0, pnl: 0 };
    sectorPerf[sec].invested += h.invested;
    sectorPerf[sec].pnl += h.pnl;
  });
  const sectorPerfList = Object.entries(sectorPerf)
    .map(([sec, v]) => ({ sec, pct: v.invested > 0 ? (v.pnl / v.invested) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct);

  const sortedByValue = [...data.holdings].sort((a: any, b: any) => b.current - a.current);
  const top3Value = sortedByValue.slice(0, 3).reduce((s: number, h: any) => s + h.current, 0);
  const top3Pct = data.total_current > 0 ? (top3Value / data.total_current) * 100 : 0;

  const mfCategoryTotals: Record<string, number> = {};
  mfHoldings.forEach((h: any) => {
    const cat = h.category || "Other";
    mfCategoryTotals[cat] = (mfCategoryTotals[cat] || 0) + (h.currentValue ?? 0);
  });
  const mfCategoryList = Object.entries(mfCategoryTotals).sort((a, b) => b[1] - a[1]);

  const biggestImpact = [...data.holdings].sort((a: any, b: any) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 5);

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600 }}>Good day, Vignesh 👋</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
        Last synced {new Date(data.captured_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
      </div>

      <div style={{ marginTop: 22, borderRadius: 20, padding: "28px 30px", background: "linear-gradient(135deg,#6B5CE6 0%,#4B3FB0 100%)" }}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>Total Portfolio Value</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 38, fontWeight: 700, marginTop: 10, color: "#fff" }}>{inr(combinedTotal, 2)}</div>
        <div style={{ marginTop: 8, fontSize: 13.5, color: data.day_pnl >= 0 ? "#B9F5DC" : "#FBD4CE", fontWeight: 600 }}>
          {sign(data.day_pnl)}{inr(Math.abs(data.day_pnl))} today
        </div>
        {(mfHoldings.length > 0 || goldHoldings.length > 0) && (
          <div style={{ marginTop: 14, display: "flex", gap: 18, fontSize: 12, opacity: 0.9, color: "#fff", flexWrap: "wrap" }}>
            <span>📈 Stocks: {inr(data.total_current)}</span>
            {mfHoldings.length > 0 && <span>🏦 Mutual Funds: {inr(mfTotalCurrent)}</span>}
            {goldHoldings.length > 0 && <span>🪙 Gold: {inr(goldTotalCurrent)}</span>}
          </div>
        )}
      </div>

      <div className="stat-grid" style={{ marginTop: 16 }}>
        <div className="stat-card"><div className="stat-label">Total Return</div><div className="stat-value">{inr(data.total_pnl)}</div><div style={{ fontSize: 11.5, marginTop: 5, color: totalPnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(totalPnlPct)}{Math.abs(totalPnlPct).toFixed(1)}%</div></div>
        <div className="stat-card"><div className="stat-label">Invested</div><div className="stat-value">{inr(data.total_invested)}</div><div style={{ fontSize: 11.5, marginTop: 5, color: "var(--text-muted)" }}>{data.holdings.length} positions</div></div>
        <div className="stat-card"><div className="stat-label">Day Change</div><div className="stat-value">{sign(data.day_pnl)}{inr(Math.abs(data.day_pnl))}</div></div>
        <div className="stat-card"><div className="stat-label">In Profit</div><div className="stat-value">{inProfitPct.toFixed(0)}%</div><div style={{ fontSize: 11.5, marginTop: 5, color: "var(--text-muted)" }}>of holdings</div></div>
      </div>

      {goldHoldings.length > 0 && (
        <div className="stat-grid" style={{ marginTop: 14 }}>
          <div className="stat-card"><div className="stat-label">Gold Invested</div><div className="stat-value">{inr(goldTotalInvested)}</div></div>
          <div className="stat-card"><div className="stat-label">Gold Current Value</div><div className="stat-value">{inr(goldTotalCurrent)}</div></div>
          <div className="stat-card"><div className="stat-label">Gold Gain</div><div className="stat-value" style={{ color: goldTotalGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(goldTotalGain)}{inr(Math.abs(goldTotalGain))}</div></div>
          <div className="stat-card"><div className="stat-label">Gold Return</div><div className="stat-value" style={{ color: goldTotalGainPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(goldTotalGainPct)}{Math.abs(goldTotalGainPct).toFixed(1)}%</div></div>
        </div>
      )}

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

      {mfHoldings.length > 0 && (
        <div className="list-card" style={{ marginTop: 18 }}>
          <div className="list-head">
            <div className="list-title">Mutual Fund Holdings <span style={{ fontSize: 10, background: "var(--gold-soft)", color: "var(--gold)", padding: "2px 7px", borderRadius: 100, marginLeft: 8 }}>via Groww</span></div>
            <Link href="/dashboard/mutual-funds" className="list-link">View All →</Link>
          </div>
          {mfHoldings.slice(0, 5).map((h: any, i: number) => {
            const pnlPct = h.invested > 0 ? (((h.currentValue ?? 0) - h.invested) / h.invested) * 100 : 0;
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{h.schemeName}<span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: 11, marginLeft: 6 }}>{h.category}</span></span>
                <span style={{ color: pnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(pnlPct)}{Math.abs(pnlPct).toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      )}

      {goldHoldings.length > 0 && (
        <div className="list-card" style={{ marginTop: 18 }}>
          <div className="list-head">
            <div className="list-title">Gold Holdings <span style={{ fontSize: 10, background: "var(--gold-soft)", color: "var(--gold)", padding: "2px 7px", borderRadius: 100, marginLeft: 8 }}>via IBJA</span></div>
            <Link href="/dashboard/gold" className="list-link">View All →</Link>
          </div>
          {goldHoldings.slice(0, 5).map((h: any) => (
            <div key={h.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{h.weightGrams}g {h.purity.toUpperCase()}{h.note && <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: 11, marginLeft: 6 }}>{h.note}</span>}</span>
              <span style={{ color: h.pnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(h.pnlPct)}{Math.abs(h.pnlPct).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}

      <div className="list-card" style={{ marginTop: 18 }}>
        <div className="list-head"><div className="list-title">Portfolio Insights</div></div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Estimated Dividend Income</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4, color: "var(--gain)" }}>{inr(estDividendIncome)}</div>
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>from {dividendCount} upcoming payout{dividendCount === 1 ? "" : "s"}</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Concentration</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{top3Pct.toFixed(0)}%</div>
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>in your top 3 holdings</div>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>Sector Performance (overall return)</div>
          {sectorPerfList.map(({ sec, pct }) => (
            <div key={sec} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
              <span>{sec}</span>
              <span style={{ color: pct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(pct)}{Math.abs(pct).toFixed(1)}%</span>
            </div>
          ))}
        </div>

        {mfCategoryList.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>Mutual Fund Asset Mix</div>
            {mfCategoryList.map(([cat, val]) => (
              <div key={cat} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
                <span>{cat}</span>
                <span>{mfTotalCurrent > 0 ? ((val / mfTotalCurrent) * 100).toFixed(0) : 0}% · {inr(val)}</span>
              </div>
            ))}
          </div>
        )}

        <div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>Biggest ₹ Impact (overall)</div>
          {biggestImpact.map((h: any) => (
            <div key={h.symbol} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
              <span>{h.symbol}</span>
              <span style={{ color: h.pnl >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(h.pnl)}{inr(Math.abs(h.pnl))}</span>
            </div>
          ))}
        </div>
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
        <div className="list-card" style={{ maxHeight: 420, overflowY: "auto" }}>
          <div className="list-head"><div className="list-title">Stock News</div></div>
          {news.length === 0 ? <div style={{ color: "var(--text-muted)", fontSize: 12.5 }}>No news found.</div> :
            news.map((n, i) => (
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
