"use client";
import { useEffect, useState, MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const inr = (n: number | null | undefined, d = 0) =>
  "₹" + (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number | null | undefined) => ((n ?? 0) >= 0 ? "+" : "−");

const ASSET_TABS = [
  { key: "all", label: "All" },
  { key: "stocks", label: "Stocks" },
  { key: "mf", label: "Mutual Funds" },
  { key: "gold", label: "Gold" },
];

const RANGE_OPTIONS = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "All", days: null },
];

function smoothPath(coords: { x: number; y: number }[]): string {
  if (coords.length < 2) return "";
  if (coords.length === 2) return `M ${coords[0].x},${coords[0].y} L ${coords[1].x},${coords[1].y}`;
  let path = `M ${coords[0].x},${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i === 0 ? i : i - 1];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2 < coords.length ? i + 2 : i + 1];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return path;
}

// Builds a closed polygon between the current-value curve and the invested
// curve, so the enclosed area can be filled green (profit) or red (loss).
function bandBetween(topCoords: { x: number; y: number }[], bottomCoords: { x: number; y: number }[]): string {
  const top = smoothPath(topCoords);
  const bottomReversed = [...bottomCoords].reverse();
  const bottomPath = smoothPath(bottomReversed).replace(/^M [^C]+/, (m) => `L ${m.slice(2)}`);
  return `${top} ${bottomPath} Z`;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <svg viewBox="0 0 120 30" aria-hidden="true" />;
  const w = 120, h = 30, mn = Math.min(...values), mx = Math.max(...values), span = mx - mn || 1;
  const pts = values.map((v, i) => [(i * w) / (values.length - 1), h - 3 - ((v - mn) / span) * (h - 6)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${w} ${h} L0 ${h}Z`} fill={color} opacity="0.14" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill={color} />
    </svg>
  );
}

// Last ~30 days of a performance series, thinned to at most 40 points.
function trendOf(points: { captured_at: string; current: number }[]): number[] {
  const cutoff = Date.now() - 30 * 86400000;
  const recent = points.filter((p) => new Date(p.captured_at).getTime() >= cutoff);
  const src = recent.length >= 2 ? recent : points.slice(-40);
  const step = Math.max(1, Math.ceil(src.length / 40));
  const out = src.filter((_, i) => i % step === 0).map((p) => p.current);
  if (src.length && out[out.length - 1] !== src[src.length - 1].current) out.push(src[src.length - 1].current);
  return out;
}

// Per-share amount from an NSE dividend label ("Rs 3.25", "Re 1 Per Share").
function perShareOf(label: string | undefined): number | null {
  const m = (label || "").match(/R[se]\.?\s*([\d.]+)/i);
  return m ? parseFloat(m[1]) : null;
}

function PerfChart() {
  const [assetType, setAssetType] = useState("all");
  const [range, setRange] = useState("1M");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [points, setPoints] = useState<{ captured_at: string; current: number; invested: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setHoverIdx(null);
    fetch(`/api/performance?type=${assetType}`)
      .then((r) => r.json())
      .then((d) => { setPoints(d.points || []); setLoading(false); });
  }, [assetType]);

  const usingCustomRange = Boolean(customFrom && customTo);
  const rangeOption = RANGE_OPTIONS.find((r) => r.label === range);

  const filteredPoints = usingCustomRange
    ? points.filter((p) => {
        const d = new Date(p.captured_at);
        return d >= new Date(customFrom) && d <= new Date(customTo + "T23:59:59");
      })
    : rangeOption?.days
    ? points.filter((p) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - rangeOption.days!);
        return new Date(p.captured_at) >= cutoff;
      })
    : points;

  function selectPreset(label: string) {
    setRange(label);
    setCustomFrom("");
    setCustomTo("");
    setHoverIdx(null);
  }

  function applyCustomRange() {
    if (customFrom && customTo) setHoverIdx(null);
  }

  function clearCustomRange() {
    setCustomFrom("");
    setCustomTo("");
    setHoverIdx(null);
  }

  const tabs = (
    <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
      {ASSET_TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => setAssetType(t.key)}
          style={{
            background: assetType === t.key ? "var(--purple)" : "transparent",
            color: assetType === t.key ? "var(--gold-ink)" : "var(--text-muted)",
            border: assetType === t.key ? "none" : "1px solid var(--border)",
            borderRadius: 8, padding: "6px 14px", fontSize: 12,
            fontWeight: assetType === t.key ? 600 : 400, cursor: "pointer",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const rangeControls = (
    <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
      {RANGE_OPTIONS.map((r) => (
        <button
          key={r.label}
          onClick={() => selectPreset(r.label)}
          style={{
            background: !usingCustomRange && range === r.label ? "var(--purple)" : "transparent",
            color: !usingCustomRange && range === r.label ? "var(--gold-ink)" : "var(--text-muted)",
            border: !usingCustomRange && range === r.label ? "none" : "1px solid var(--border)",
            borderRadius: 8, padding: "5px 12px", fontSize: 11.5,
            fontWeight: !usingCustomRange && range === r.label ? 600 : 400, cursor: "pointer",
          }}
        >
          {r.label}
        </button>
      ))}

      <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />

      <input
        type="date"
        value={customFrom}
        onChange={(e) => setCustomFrom(e.target.value)}
        style={{
          fontSize: 11.5, padding: "5px 8px", borderRadius: 8,
          border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)",
        }}
      />
      <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>to</span>
      <input
        type="date"
        value={customTo}
        onChange={(e) => setCustomTo(e.target.value)}
        style={{
          fontSize: 11.5, padding: "5px 8px", borderRadius: 8,
          border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)",
        }}
      />
      <button
        onClick={applyCustomRange}
        disabled={!customFrom || !customTo}
        style={{
          background: usingCustomRange ? "var(--purple)" : "transparent",
          color: usingCustomRange ? "var(--gold-ink)" : "var(--text-muted)",
          border: usingCustomRange ? "none" : "1px solid var(--border)",
          borderRadius: 8, padding: "5px 12px", fontSize: 11.5,
          fontWeight: usingCustomRange ? 600 : 400,
          cursor: !customFrom || !customTo ? "default" : "pointer",
          opacity: !customFrom || !customTo ? 0.5 : 1,
        }}
      >
        Apply range
      </button>
      {usingCustomRange && (
        <button
          onClick={clearCustomRange}
          style={{
            background: "transparent", color: "var(--text-muted)", border: "none",
            fontSize: 11.5, textDecoration: "underline", cursor: "pointer", padding: "5px 4px",
          }}
        >
          Clear
        </button>
      )}
    </div>
  );

  if (loading) {
    return <div>{tabs}<div style={{ color: "var(--text-muted)", fontSize: 13, padding: "30px 0", textAlign: "center" }}>Loading…</div></div>;
  }

  if (filteredPoints.length < 2) {
    return (
      <div>
        {tabs}
        {rangeControls}
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "30px 0", textAlign: "center" }}>
          Not enough history yet for this view — it builds up over time as snapshots accumulate.
        </div>
      </div>
    );
  }

  const w = 900, h = 210, padTop = 16, padBottom = 36, padLeft = 8, padRight = 8;
  const allValues = filteredPoints.flatMap((p) => [p.current, p.invested]);
  const min = Math.min(...allValues), max = Math.max(...allValues);
  const rangeSpan = max - min || 1;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;
  const stepX = plotW / (filteredPoints.length - 1);

  const currentCoords = filteredPoints.map((p, i) => ({
    x: padLeft + i * stepX,
    y: padTop + plotH * (1 - (p.current - min) / rangeSpan),
    point: p,
  }));
  const investedCoords = filteredPoints.map((p, i) => ({
    x: padLeft + i * stepX,
    y: padTop + plotH * (1 - (p.invested - min) / rangeSpan),
  }));

  const currentPath = smoothPath(currentCoords);
  const investedPath = smoothPath(investedCoords);
  const bandPath = bandBetween(currentCoords, investedCoords);

  const latest = filteredPoints[filteredPoints.length - 1];
  const first = filteredPoints[0];
  const gain = latest.current - latest.invested;
  const gainPct = latest.invested > 0 ? (gain / latest.invested) * 100 : 0;
  const bandColor = gain >= 0 ? "var(--gain)" : "var(--loss)";

  const labelCount = Math.min(5, currentCoords.length);
  const labelIndices = Array.from({ length: labelCount }, (_, i) =>
    Math.round((i * (currentCoords.length - 1)) / (labelCount - 1))
  );
  const usesLongRange = usingCustomRange
    ? (new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86400000 > 200
    : rangeOption?.days === null || (rangeOption?.days ?? 0) > 200;
  const formatLabel = (iso: string) =>
    usesLongRange
      ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
      : new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

  function handleMouseMove(e: ReactMouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = w / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    let nearest = 0, nearestDist = Infinity;
    currentCoords.forEach((c, i) => {
      const dist = Math.abs(c.x - mouseX);
      if (dist < nearestDist) { nearestDist = dist; nearest = i; }
    });
    setHoverIdx(nearest);
  }

  const hovered = hoverIdx !== null ? filteredPoints[hoverIdx] : null;
  const displayPoint = hovered || latest;
  const displayGain = displayPoint.current - displayPoint.invested;
  const displayGainPct = displayPoint.invested > 0 ? (displayGain / displayPoint.invested) * 100 : 0;

  return (
    <div>
      {tabs}

      <div style={{ display: "flex", gap: 40, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--purple)", display: "inline-block" }} />Current
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700 }}>{inr(displayPoint.current)}</div>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4 }}>
            <span style={{ width: 10, height: 2, background: "var(--text-muted)", display: "inline-block" }} />Invested
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: "var(--text-muted)" }}>{inr(displayPoint.invested)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4 }}>Gain</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: displayGain >= 0 ? "var(--gain)" : "var(--loss)" }}>
            {sign(displayGain)}{inr(Math.abs(displayGain))} <span style={{ fontSize: 13 }}>({sign(displayGainPct)}{Math.abs(displayGainPct).toFixed(1)}%)</span>
          </div>
        </div>
      </div>

      {rangeControls}

      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: "100%", height: 210, cursor: "crosshair" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#d9952a" />
            <stop offset="100%" stopColor="#ffd88a" />
          </linearGradient>
          <filter id="chartGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <line x1={padLeft} y1={padTop + plotH * 0.25} x2={w - padRight} y2={padTop + plotH * 0.25} stroke="var(--border)" strokeWidth="1" />
        <line x1={padLeft} y1={padTop + plotH * 0.5} x2={w - padRight} y2={padTop + plotH * 0.5} stroke="var(--border)" strokeWidth="1" />
        <line x1={padLeft} y1={padTop + plotH * 0.75} x2={w - padRight} y2={padTop + plotH * 0.75} stroke="var(--border)" strokeWidth="1" />

        <text x={padLeft} y={padTop + 6} fontSize="13" fontWeight="600" fill="var(--text)">{inr(max)}</text>
        <text x={padLeft} y={padTop + plotH - 2} fontSize="13" fontWeight="600" fill="var(--text)">{inr(min)}</text>

        {/* profit/loss band between Current and Invested */}
        <path d={bandPath} fill={bandColor} opacity="0.16" />

        <path d={investedPath} fill="none" stroke="var(--text-muted)" strokeWidth="1.75" strokeLinecap="round" strokeDasharray="5,4" />
        <path d={currentPath} fill="none" stroke="url(#lineGrad)" strokeWidth="3" strokeLinecap="round" filter="url(#chartGlow)" />

        <circle cx={currentCoords[currentCoords.length - 1].x} cy={currentCoords[currentCoords.length - 1].y} r="8" fill="#e5a93a" opacity="0.25" />
        <circle cx={currentCoords[currentCoords.length - 1].x} cy={currentCoords[currentCoords.length - 1].y} r="4.5" fill="#fff" stroke="#e5a93a" strokeWidth="2.5" />

        <text
          x={currentCoords[currentCoords.length - 1].x - 10}
          y={currentCoords[currentCoords.length - 1].y - 14}
          fontSize="13" fontWeight="700" fill={bandColor} textAnchor="end"
        >
          {sign(gainPct)}{Math.abs(gainPct).toFixed(1)}%
        </text>

        {labelIndices.map((idx, i) => {
          const c = currentCoords[idx];
          const anchor = i === 0 ? "start" : i === labelIndices.length - 1 ? "end" : "middle";
          return (
            <text key={i} x={c.x} y={h - 8} fontSize="10.5" fontWeight="500" fill="var(--text-muted)" textAnchor={anchor}>
              {formatLabel(c.point.captured_at)}
            </text>
          );
        })}

        {hoverIdx !== null && (() => {
          const hp = filteredPoints[hoverIdx];
          const hGain = hp.current - hp.invested;
          const hGainPct = hp.invested > 0 ? (hGain / hp.invested) * 100 : 0;
          const boxX = currentCoords[hoverIdx].x > w / 2 ? currentCoords[hoverIdx].x - 210 : currentCoords[hoverIdx].x + 10;
          return (
            <g>
              <line x1={currentCoords[hoverIdx].x} y1={padTop} x2={currentCoords[hoverIdx].x} y2={padTop + plotH} stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3,3" />
              <circle cx={currentCoords[hoverIdx].x} cy={currentCoords[hoverIdx].y} r="5" fill="#fff" stroke="#e5a93a" strokeWidth="2.5" />
              <circle cx={investedCoords[hoverIdx].x} cy={investedCoords[hoverIdx].y} r="4" fill="var(--text-muted)" />
              <rect x={boxX} y={padTop + 4} width="200" height="52" rx="8" fill="var(--bg)" stroke="var(--border)" strokeWidth="1" />
              <text x={boxX + 12} y={padTop + 22} fontSize="10" fill="var(--text-muted)">{formatLabel(hp.captured_at)}</text>
              <text x={boxX + 12} y={padTop + 38} fontSize="11" fontWeight="600" fill="var(--text)">
                {inr(hp.current)} <tspan fill="var(--text-muted)" fontWeight="400">/ {inr(hp.invested)}</tspan>
              </text>
              <text x={boxX + 12} y={padTop + 51} fontSize="10.5" fontWeight="600" fill={hGain >= 0 ? "var(--gain)" : "var(--loss)"}>
                {sign(hGain)}{inr(Math.abs(hGain))} ({sign(hGainPct)}{Math.abs(hGainPct).toFixed(1)}%)
              </text>
            </g>
          );
        })()}
      </svg>

      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
        Hover the chart to see Current, Invested, and Gain for any specific date. "{ASSET_TABS.find((t) => t.key === assetType)?.label}" view{assetType !== "stocks" ? " builds up from when combined tracking started" : " uses your full stock history"}.
      </div>
    </div>
  );
}

export default function DashboardOverview() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [movers, setMovers] = useState<any[]>([]);
  const [news, setNews] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [mfHoldings, setMfHoldings] = useState<any[]>([]);
  const [goldHoldings, setGoldHoldings] = useState<any[]>([]);
  const [dividendReceived, setDividendReceived] = useState<any[]>([]);
  const [dividendReceivedThisFY, setDividendReceivedThisFY] = useState(0);
  const [trends, setTrends] = useState<{ stocks: number[]; mf: number[]; gold: number[] }>({ stocks: [], mf: [], gold: [] });
  const [tracks, setTracks] = useState<any[]>([]);
  const [dividendSource, setDividendSource] = useState<{ fromSaved: number; savedAt: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/portfolio").then((r) => {
      if (r.status === 401) return router.push("/login");
      return r.json();
    }).then((snap) => {
      if (!snap) return;
      setData(snap);
      if (!snap.empty) {
        fetch("/api/movers").then((r) => r.json()).then((d) => setMovers(d.movers || []));
        fetch("/api/news").then((r) => r.json()).then((d) => setNews(d.news || []));
        fetch("/api/dividends").then((r) => r.json()).then((d) => { setEvents(d.events || []); setDividendSource(d.dividendSource || null); });
      }
      fetch("/api/mutual-funds").then((r) => r.json()).then((d) => setMfHoldings(d.holdings || []));
      fetch("/api/gold").then((r) => r.json()).then((d) => setGoldHoldings(d.holdings || []));
      fetch("/api/dividends/page-data").then((r) => r.json()).then((d) => {
        setDividendReceived(d.received || []);
        setDividendReceivedThisFY(d.receivedThisFY || 0);
      });
      // Small trend lines on the asset tiles.
      (["stocks", "mf", "gold"] as const).forEach((type) => {
        fetch(`/api/performance?type=${type}`)
          .then((r) => r.json())
          .then((d) => setTrends((prev) => ({ ...prev, [type]: trendOf(d.points || []) })))
          .catch(() => {});
      });
      fetch("/api/signals/track")
        .then((r) => (r.status === 401 ? null : r.json()))
        .then((d) => d && setTracks(d.tracks || []))
        .catch(() => {});
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
  // label, matching "Rs" or "Re") × (units held) across all upcoming dividends.
  const estDividendIncome = events
    .filter((e: any) => e.type === "dividend")
    .reduce((sum: number, e: any) => {
      const holding = data.holdings.find((h: any) => h.symbol === e.symbol);
      if (!holding) return sum;
      const amountMatch = (e.label || "").match(/R[se]\.?\s*([\d.]+)/i);
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

  // Expected payouts from upcoming dividend events: per-share × shares held,
  // bucketed by the month of the record date.
  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const expectedByMonth: Record<string, number> = {};
  events
    .filter((e: any) => e.type === "dividend")
    .forEach((e: any) => {
      const holding = data.holdings.find((h: any) => h.symbol === e.symbol);
      const ps = perShareOf(e.label);
      const when = new Date(e.date);
      if (!holding || ps === null || isNaN(when.getTime())) return;
      const k = monthKey(when);
      expectedByMonth[k] = (expectedByMonth[k] || 0) + ps * holding.qty;
    });

  // Monthly dividend chart: last 6 months received, with expected stacked on
  // top; next month is added too when a payout is already announced for it.
  const monthlyDividends: { label: string; amount: number; expected: number }[] = [];
  const today = new Date();
  for (let i = 5; i >= -1; i--) {
    const monthStart = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() - i + 1, 0, 23, 59, 59);
    const expected = expectedByMonth[monthKey(monthStart)] || 0;
    if (i === -1 && expected === 0) break;
    const label = monthStart.toLocaleDateString("en-IN", { month: "short" });
    const amount = dividendReceived
      .filter((r: any) => {
        const rd = new Date(r.record_date);
        return rd >= monthStart && rd <= monthEnd;
      })
      .reduce((s: number, r: any) => s + Number(r.amount), 0);
    monthlyDividends.push({ label, amount, expected });
  }
  const maxMonthlyDividend = Math.max(...monthlyDividends.map((m) => m.amount + m.expected), 1);
  const anyExpected = monthlyDividends.some((m) => m.expected > 0);
  const expectedThisMonth = expectedByMonth[monthKey(today)] || 0;
  const thisMonthName = today.toLocaleDateString("en-IN", { month: "short" });

  // Cumulative received this FY by month, for the Dividends tile trend line.
  const fyStart = new Date(today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1, 3, 1);
  const divTrend: number[] = [];
  {
    let run = 0;
    for (let m = new Date(fyStart); m <= today; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59);
      run += dividendReceived
        .filter((r: any) => { const rd = new Date(r.record_date); return rd >= m && rd <= mEnd; })
        .reduce((s: number, r: any) => s + Number(r.amount), 0);
      divTrend.push(run);
    }
  }

  const fyPayouts = dividendReceived.filter((r: any) => new Date(r.record_date) >= fyStart).length;
  const boughtTracks = tracks.filter((tr: any) => tr.status === "bought");
  const trackedPnl = boughtTracks.reduce((s: number, tr: any) => s + (tr.pnl ?? 0), 0);
  const mfGainPct = mfTotalInvested > 0 ? ((mfTotalCurrent - mfTotalInvested) / mfTotalInvested) * 100 : 0;

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600 }}>Good day, Vignesh</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
        Last synced {new Date(data.captured_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
      </div>

      <div className="kpi-grid">
        <div className="vault-card vault-hero">
          <span className="vault-rivet" style={{ top: 12, left: 12 }} />
          <span className="vault-rivet" style={{ top: 12, right: 12 }} />
          <span className="vault-rivet" style={{ bottom: 12, left: 12 }} />
          <span className="vault-rivet" style={{ bottom: 12, right: 12 }} />
          <div className="vault-label">Total portfolio value</div>
          <div className="vault-big">{inr(combinedTotal)}</div>
          <div className="vault-hero-row">
            <div>
              <div className="vault-label">Overall P&amp;L</div>
              <div className="val" style={{ color: combinedGain >= 0 ? "var(--gain)" : "var(--loss)" }}>
                {sign(combinedGain)}{inr(Math.abs(combinedGain))} ({sign(combinedGainPct)}{Math.abs(combinedGainPct).toFixed(2)}%)
              </div>
            </div>
            <div>
              <div className="vault-label">Invested</div>
              <div className="val">{inr(combinedInvested)}</div>
            </div>
          </div>
        </div>

        <Link href="/dashboard/dividends" className="vault-card" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="vault-label">Dividends this FY</div>
          <div className="vault-mid">{inr(dividendReceivedThisFY)}</div>
          <div className="vault-sub">
            {expectedThisMonth > 0
              ? <><span style={{ color: "var(--gain)" }}>+{inr(expectedThisMonth)}</span> <span className="muted">expected in {thisMonthName}</span></>
              : <span className="muted">{fyPayouts} payout{fyPayouts === 1 ? "" : "s"} received</span>}
          </div>
        </Link>

        <Link href="/dashboard/signals" className="vault-card" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="vault-label">Open signals</div>
          <div className="vault-mid">{boughtTracks.length}</div>
          <div className="vault-sub">
            {boughtTracks.length === 0
              ? <span className="muted">None marked as bought</span>
              : <span style={{ color: trackedPnl >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(trackedPnl)}{inr(Math.abs(trackedPnl))} <span className="muted">live P&amp;L</span></span>}
          </div>
        </Link>
      </div>

      <div className="section-label">Stocks (Dhan)</div>
      <div className="stat-grid" style={{ marginTop: 14 }}>
        <div className="stat-card"><div className="stat-label">Total return</div><div className="stat-value" style={{ color: data.total_pnl >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(data.total_pnl)}{inr(Math.abs(data.total_pnl))}</div><div className="stat-sub" style={{ color: totalPnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(totalPnlPct)}{Math.abs(totalPnlPct).toFixed(1)}%</div></div>
        <div className="stat-card"><div className="stat-label">Invested</div><div className="stat-value">{inr(data.total_invested)}</div><div className="stat-sub">{data.holdings.length} positions</div></div>
        <div className="stat-card"><div className="stat-label">Day change</div><div className="stat-value" style={{ color: data.day_pnl >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(data.day_pnl)}{inr(Math.abs(data.day_pnl))}</div><div className="stat-sub">today</div></div>
        <div className="stat-card"><div className="stat-label">In profit</div><div className="stat-value">{inProfitPct.toFixed(0)}%</div><div className="stat-sub">of holdings</div></div>
      </div>

      <div className="list-card" style={{ marginTop: 18 }}>
        <div className="list-head"><div className="list-title">Asset Overview</div></div>
        <div className="asset-tiles">
          <Link href="/dashboard/holdings" className="asset-tile">
            <div className="k"><b style={{ background: "var(--c-stocks)" }} />Stocks</div>
            <div className="v">{inr(data.total_current)}</div>
            <div className="p" style={{ color: totalPnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(totalPnlPct)}{Math.abs(totalPnlPct).toFixed(1)}%</div>
            <Sparkline values={trends.stocks} color="var(--c-stocks)" />
          </Link>
          <Link href="/dashboard/mutual-funds" className="asset-tile">
            <div className="k"><b style={{ background: "var(--c-mf)" }} />Mutual Funds</div>
            <div className="v">{inr(mfTotalCurrent)}</div>
            <div className="p" style={{ color: mfGainPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(mfGainPct)}{Math.abs(mfGainPct).toFixed(1)}%</div>
            <Sparkline values={trends.mf} color="var(--c-mf)" />
          </Link>
          <Link href="/dashboard/gold" className="asset-tile">
            <div className="k"><b style={{ background: "var(--c-gold)" }} />Gold</div>
            <div className="v">{inr(goldTotalCurrent)}</div>
            <div className="p" style={{ color: goldTotalGainPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(goldTotalGainPct)}{Math.abs(goldTotalGainPct).toFixed(1)}%</div>
            <Sparkline values={trends.gold} color="var(--c-gold)" />
          </Link>
          <Link href="/dashboard/dividends" className="asset-tile">
            <div className="k"><b style={{ background: "var(--c-div)" }} />Dividends</div>
            <div className="v">{inr(dividendReceivedThisFY)}</div>
            <div className="p" style={{ color: "var(--text-muted)" }}>this FY · {fyPayouts} payout{fyPayouts === 1 ? "" : "s"}</div>
            <Sparkline values={divTrend} color="var(--c-div)" />
          </Link>
        </div>
      </div>

      <div className="list-card" style={{ marginTop: 18 }}>
        <div className="list-head"><div className="list-title">Portfolio Performance</div></div>
        <PerfChart />
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

      {dividendReceived.length > 0 && (
        <div className="list-card" style={{ marginTop: 18 }}>
          <div className="list-head">
            <div className="list-title">Recent Dividends <span style={{ fontSize: 10, background: "rgba(52,211,153,0.14)", color: "var(--gain)", padding: "2px 7px", borderRadius: 100, marginLeft: 8 }}>via Dhan</span></div>
            <Link href="/dashboard/dividends" className="list-link">View All →</Link>
          </div>
          {dividendReceived.slice(0, 5).map((r: any) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{r.symbol}<span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: 11, marginLeft: 6 }}>{r.record_date}</span></span>
              <span style={{ color: "var(--gain)", fontWeight: 600 }}>{inr(r.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {(dividendReceived.length > 0 || anyExpected) && (
        <div className="list-card" style={{ marginTop: 18 }}>
          <div className="list-head"><div className="list-title">Dividend Income by Month</div><Link href="/dashboard/dividends" className="list-link">View All →</Link></div>
          <svg viewBox="0 0 700 150" style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Dividend income by month">
            <defs>
              <pattern id="divHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--gain)" opacity="0.12" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--gain)" strokeWidth="2" opacity="0.45" />
              </pattern>
            </defs>
            <line x1="0" x2="700" y1="115" y2="115" stroke="var(--border-strong)" />
            {monthlyDividends.map((m, i) => {
              const n = monthlyDividends.length;
              const barWidth = n > 6 ? 68 : 80;
              const gap = (700 - barWidth * n) / (n + 1);
              const x = gap + i * (barWidth + gap);
              const hReceived = (m.amount / maxMonthlyDividend) * 90;
              const hExpected = (m.expected / maxMonthlyDividend) * 90;
              const base = 115;
              const total = m.amount + m.expected;
              return (
                <g key={i}>
                  {m.amount > 0 && <rect x={x} y={base - hReceived} width={barWidth} height={hReceived} rx="4" fill="var(--gain)" opacity="0.85" />}
                  {m.expected > 0 && (
                    <rect x={x + 0.75} y={base - hReceived - hExpected + 0.75} width={barWidth - 1.5} height={Math.max(hExpected - 1.5, 2)} rx="4"
                      fill="url(#divHatch)" stroke="var(--gain)" strokeWidth="1.5" strokeDasharray="4 3" />
                  )}
                  <text x={x + barWidth / 2} y={base - hReceived - hExpected - 6} fontSize="10.5" fontWeight="600" fill="var(--text)" textAnchor="middle" fontFamily="var(--font-mono)">
                    {total > 0 ? inr(total) : ""}
                  </text>
                  <text x={x + barWidth / 2} y="133" fontSize="11" fill={m.expected > 0 ? "var(--text)" : "var(--text-muted)"} textAnchor="middle">{m.label}</text>
                  {m.expected > 0 && (
                    <text x={x + barWidth / 2} y="146" fontSize="9.5" fill="var(--text-muted)" textAnchor="middle" fontFamily="var(--font-mono)">
                      {m.amount > 0 ? `${inr(m.expected)} exp.` : "expected"}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {anyExpected && (
            <div style={{ display: "flex", gap: 16, fontSize: 11.5, color: "var(--text-muted)", marginTop: 8, flexWrap: "wrap" }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--gain)", marginRight: 6, verticalAlign: -1 }} />Received</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--gain-soft)", outline: "1.5px dashed var(--gain)", outlineOffset: -1.5, marginRight: 6, verticalAlign: -1 }} />Expected (shares held × announced dividend)</span>
            </div>
          )}
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

      <div className="two-col" style={{ marginTop: 18 }}>
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
        {dividendSource && dividendSource.fromSaved > 0 && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>
            NSE didn&apos;t respond just now. {dividendSource.fromSaved} dividend{dividendSource.fromSaved === 1 ? "" : "s"} shown from saved data
            {dividendSource.savedAt ? ` (last confirmed ${new Date(dividendSource.savedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })})` : ""}.
          </div>
        )}
        {events.length === 0 ? <div style={{ color: "var(--text-muted)", fontSize: 12.5 }}>No upcoming events found.</div> :
          events.map((e, i) => {
            let dividendAmount: number | null = null;
            if (e.type === "dividend") {
              const holding = data.holdings.find((h: any) => h.symbol === e.symbol);
              // Matches "Rs" or "Re" (singular rupee, e.g. "Re 1 Per Share")
              const amountMatch = (e.label || "").match(/R[se]\.?\s*([\d.]+)/i);
              if (holding && amountMatch) {
                dividendAmount = parseFloat(amountMatch[1]) * holding.qty;
              }
            }
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
                <span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 100, marginRight: 8, background: e.type === "dividend" ? "var(--gold-soft)" : "var(--amber-soft)", color: e.type === "dividend" ? "var(--gold)" : "var(--amber)" }}>
                    {e.type.toUpperCase()}
                  </span>
                  {e.symbol} — {e.label}
                </span>
                <span style={{ textAlign: "right" }}>
                  {dividendAmount !== null && (
                    <div style={{ color: "var(--gain)", fontWeight: 600, fontSize: 12.5 }}>{inr(dividendAmount)}</div>
                  )}
                  <div style={{ color: "var(--text-muted)", fontSize: dividendAmount !== null ? 10.5 : 12.5 }}>{e.date}</div>
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
