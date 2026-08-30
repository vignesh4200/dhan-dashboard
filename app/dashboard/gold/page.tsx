"use client";
import { useEffect, useState } from "react";

const inr = (n: number | null | undefined, d = 0) =>
  "₹" + (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number | null | undefined) => ((n ?? 0) >= 0 ? "+" : "−");

const PURITY_OPTIONS = [
  { value: "999", label: "999 (24K / Fine Gold)" },
  { value: "22k", label: "22K" },
  { value: "20k", label: "20K" },
  { value: "18k", label: "18K" },
  { value: "14k", label: "14K" },
];

const RANGE_OPTIONS = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 365 * 3 },
  { label: "5Y", days: 365 * 5 },
  { label: "10Y", days: 365 * 10 },
  { label: "20Y", days: 365 * 20 },
  { label: "All", days: null },
];

function GoldChart({ points }: { points: any[] }) {
  const [range, setRange] = useState("1Y");

  const validPoints = points.filter((p) => p.rate_22k !== null);
  const rangeOption = RANGE_OPTIONS.find((r) => r.label === range);
  const filteredPoints = rangeOption?.days
    ? validPoints.filter((p) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - rangeOption.days!);
        return new Date(p.captured_at) >= cutoff;
      })
    : validPoints;

  if (filteredPoints.length < 2) {
    return (
      <div>
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.label)}
              style={{
                background: range === r.label ? "var(--purple)" : "transparent",
                color: range === r.label ? "#fff" : "var(--text-muted)",
                border: range === r.label ? "none" : "1px solid var(--border)",
                borderRadius: 8, padding: "5px 12px", fontSize: 11.5,
                fontWeight: range === r.label ? 600 : 400, cursor: "pointer",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "30px 0", textAlign: "center" }}>
          Not enough history yet for this range — try a shorter range, or check back after the backfill/refresh has run.
        </div>
      </div>
    );
  }

  const w = 900, h = 210, padTop = 16, padBottom = 36, padLeft = 8, padRight = 8;
  const values = filteredPoints.map((p) => p.rate_22k);
  const min = Math.min(...values), max = Math.max(...values);
  const rangeSpan = max - min || 1;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  const stepX = plotW / (filteredPoints.length - 1);
  const coords = filteredPoints.map((p, i) => {
    const x = padLeft + i * stepX;
    const y = padTop + plotH * (1 - (p.rate_22k - min) / rangeSpan);
    return { x, y, point: p };
  });

  const linePath = "M" + coords.map((c) => `${c.x},${c.y}`).join(" L");
  const areaPath = linePath + ` L${coords[coords.length - 1].x},${padTop + plotH} L${coords[0].x},${padTop + plotH} Z`;

  const latest = filteredPoints[filteredPoints.length - 1];
  const first = filteredPoints[0];
  const changePct = first.rate_22k > 0 ? ((latest.rate_22k - first.rate_22k) / first.rate_22k) * 100 : 0;

  const labelCount = Math.min(5, coords.length);
  const labelIndices = Array.from({ length: labelCount }, (_, i) =>
    Math.round((i * (coords.length - 1)) / (labelCount - 1))
  );

  const usesLongRange = rangeOption?.days === null || (rangeOption?.days ?? 0) > 400;
  const formatLabel = (iso: string) =>
    usesLongRange
      ? new Date(iso).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
      : new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

  const hasBackfillData = filteredPoints.some((p) => p.source === "goldbees_backfill");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 700 }}>{inr(latest.rate_22k)}<span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 400 }}>/g · 22K</span></div>
        <div style={{ fontSize: 13, fontWeight: 600, color: changePct >= 0 ? "var(--gain)" : "var(--loss)" }}>
          {sign(changePct)}{Math.abs(changePct).toFixed(2)}% over this period
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {RANGE_OPTIONS.map((r) => (
          <button
            key={r.label}
            onClick={() => setRange(r.label)}
            style={{
              background: range === r.label ? "var(--purple)" : "transparent",
              color: range === r.label ? "#fff" : "var(--text-muted)",
              border: range === r.label ? "none" : "1px solid var(--border)",
              borderRadius: 8, padding: "5px 12px", fontSize: 11.5,
              fontWeight: range === r.label ? 600 : 400, cursor: "pointer",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 210 }}>
        <defs>
          <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F0B94F" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#F0B94F" stopOpacity="0" />
          </linearGradient>
        </defs>

        <text x={padLeft} y={padTop + 6} fontSize="13" fontWeight="600" fill="var(--text)">{inr(max)}</text>
        <text x={padLeft} y={padTop + plotH - 2} fontSize="13" fontWeight="600" fill="var(--text)">{inr(min)}</text>

        <path d={areaPath} fill="url(#goldGrad)" />
        <path d={linePath} fill="none" stroke="#F0B94F" strokeWidth="2.5" />
        <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="4" fill="#F0B94F" />

        {labelIndices.map((idx, i) => {
          const c = coords[idx];
          const anchor = i === 0 ? "start" : i === labelIndices.length - 1 ? "end" : "middle";
          return (
            <text key={i} x={c.x} y={h - 8} fontSize="10.5" fontWeight="500" fill="var(--text-muted)" textAnchor={anchor}>
              {formatLabel(c.point.captured_at)}
            </text>
          );
        })}
      </svg>

      {hasBackfillData && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
          Older history in this range comes from GOLDBEES (an NSE-traded ETF that directly tracks domestic Indian gold prices), converted to 22K equivalent — real Indian market data, not an international-price approximation. Recent data uses IBJA's own published rate directly.
        </div>
      )}
    </div>
  );
}

export default function GoldPage() {
  const [holdings, setHoldings] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [news, setNews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [showForm, setShowForm] = useState(false);

  const [weightGrams, setWeightGrams] = useState("");
  const [purity, setPurity] = useState("22k");
  const [amountPaid, setAmountPaid] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [note, setNote] = useState("");

  function loadData() {
    setLoading(true);
    fetch("/api/gold").then((r) => r.json()).then((d) => {
      setHoldings(d.holdings || []);
      setHistory(d.history || []);
      setLoading(false);
    });
    fetch("/api/gold/news").then((r) => r.json()).then((d) => setNews(d.news || []));
  }

  useEffect(() => { loadData(); }, []);

  async function addHolding() {
    setBusy(true); setError(""); setStatus("");
    try {
      const res = await fetch("/api/gold/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weightGrams: parseFloat(weightGrams),
          purity,
          amountPaid: parseFloat(amountPaid),
          purchaseDate: purchaseDate || null,
          note,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setStatus("Added.");
      setWeightGrams(""); setAmountPaid(""); setPurchaseDate(""); setNote("");
      setShowForm(false);
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteHolding(id: number) {
    setBusy(true);
    try {
      await fetch("/api/gold/holdings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      loadData();
    } finally {
      setBusy(false);
    }
  }

  const totalCurrent = holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
  const totalInvested = holdings.reduce((s, h) => s + h.amountPaid, 0);
  const totalGain = totalCurrent - totalInvested;
  const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;
  const totalWeight = holdings.reduce((s, h) => s + h.weightGrams, 0);

  const latestRates = history[history.length - 1];

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 4 }}>
        Gold <span style={{ fontSize: 11, background: "var(--gold-soft)", color: "var(--gold)", padding: "3px 9px", borderRadius: 100, marginLeft: 8, verticalAlign: "middle" }}>via IBJA</span>
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
        Rates from IBJA (India Bullion and Jewellers Association) — base bullion value per gram, excluding 3% GST and making charges.
      </div>

      {!loading && holdings.length > 0 && (
        <>
          <div className="stat-grid" style={{ marginBottom: 8 }}>
            <div className="stat-card"><div className="stat-label">Current Value</div><div className="stat-value">{inr(totalCurrent)}</div></div>
            <div className="stat-card"><div className="stat-label">Invested</div><div className="stat-value">{inr(totalInvested)}</div><div style={{ fontSize: 11.5, marginTop: 5, color: "var(--text-muted)" }}>{totalWeight.toFixed(2)}g total</div></div>
            <div className="stat-card"><div className="stat-label">Gain</div><div className="stat-value" style={{ color: totalGain >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(totalGain)}{inr(Math.abs(totalGain))}</div></div>
            <div className="stat-card"><div className="stat-label">Return</div><div className="stat-value" style={{ color: totalGainPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(totalGainPct)}{Math.abs(totalGainPct).toFixed(1)}%</div></div>
          </div>
          {holdings[0]?.rateUpdatedAt && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 18 }}>
              Rates last refreshed {new Date(holdings[0].rateUpdatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            </div>
          )}
        </>
      )}

      {latestRates && (
        <div className="list-card" style={{ marginBottom: 18 }}>
          <div className="list-head"><div className="list-title">Today's Rate {latestRates.ibja_date && <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 12 }}>· {latestRates.ibja_date}</span>}</div></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            {[
              { label: "999 (24K)", val: latestRates.rate_999 },
              { label: "22K", val: latestRates.rate_22k },
              { label: "20K", val: latestRates.rate_20k },
              { label: "18K", val: latestRates.rate_18k },
              { label: "14K", val: latestRates.rate_14k },
            ].map((r) => (
              <div key={r.label}>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.label}</div>
                <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{r.val ? inr(r.val) : "—"}<span style={{ fontSize: 10, color: "var(--text-muted)" }}>/g</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="list-card" style={{ marginBottom: 18 }}>
        <div className="list-head"><div className="list-title">Price Trend (22K)</div></div>
        <GoldChart points={history} />
      </div>

      <div className="list-card" style={{ marginBottom: 18 }}>
        <div className="list-head">
          <div className="list-title">Your Holdings</div>
          <button className="btn" style={{ padding: "6px 14px", fontSize: 12.5 }} onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ Add Purchase"}
          </button>
        </div>

        {showForm && (
          <div style={{ padding: "14px 0", borderBottom: "1px solid var(--border)", marginBottom: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label className="field-label">Weight (grams)</label>
                <input className="field-input" type="number" value={weightGrams} onChange={(e) => setWeightGrams(e.target.value)} placeholder="10" />
              </div>
              <div>
                <label className="field-label">Purity</label>
                <select className="field-input" value={purity} onChange={(e) => setPurity(e.target.value)}>
                  {PURITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Amount Paid (₹)</label>
                <input className="field-input" type="number" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="150000" />
              </div>
              <div>
                <label className="field-label">Purchase Date</label>
                <input className="field-input" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
              </div>
            </div>
            <label className="field-label">Note (optional)</label>
            <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. wedding necklace" />
            {error && <div style={{ color: "var(--loss)", fontSize: 12.5, marginTop: 8 }}>{error}</div>}
            <button className="btn" disabled={busy || !weightGrams || !amountPaid} onClick={addHolding} style={{ marginTop: 12 }}>
              {busy ? "Adding…" : "Save purchase"}
            </button>
          </div>
        )}

        {status && <div style={{ color: "var(--gain)", fontSize: 12.5, marginBottom: 10 }}>{status}</div>}

        {!loading && holdings.length === 0 && !showForm && (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No gold holdings added yet — click "+ Add Purchase" to get started.</div>
        )}

        {holdings.map((h) => (
          <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{h.weightGrams}g · {h.purity.toUpperCase()} {h.note && <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>— {h.note}</span>}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                Invested {inr(h.amountPaid)} {h.purchaseDate && `· ${h.purchaseDate}`}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 600 }}>{inr(h.currentValue)}</div>
              <div style={{ fontSize: 11.5, color: h.pnl >= 0 ? "var(--gain)" : "var(--loss)" }}>
                {sign(h.pnl)}{inr(Math.abs(h.pnl))} ({h.pnlPct.toFixed(1)}%)
              </div>
              <button
                onClick={() => deleteHolding(h.id)}
                disabled={busy}
                style={{ background: "none", border: "none", color: "var(--loss)", fontSize: 11, cursor: "pointer", marginTop: 4, padding: 0 }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="list-card" style={{ marginBottom: 40 }}>
        <div className="list-head"><div className="list-title">Gold News</div></div>
        {news.length === 0 ? <div style={{ color: "var(--text-muted)", fontSize: 12.5 }}>No news found.</div> :
          news.map((n, i) => (
            <a key={i} href={n.url} target="_blank" rel="noreferrer" style={{ display: "block", padding: "9px 0", borderBottom: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}>
              <div style={{ fontSize: 12.5 }}>{n.headline}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>{n.source} · {n.when}</div>
            </a>
          ))}
      </div>
    </div>
  );
}
