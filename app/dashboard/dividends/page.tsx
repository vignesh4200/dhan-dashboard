"use client";
import { useEffect, useState } from "react";

const inr = (n: number | null | undefined, d = 0) =>
  "₹" + (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number | null | undefined) => ((n ?? 0) >= 0 ? "+" : "−");

type SortMode = "date" | "amount";

export default function DividendsPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [portfolioHoldings, setPortfolioHoldings] = useState<any[]>([]);
  const [received, setReceived] = useState<any[]>([]);
  const [receivedThisFY, setReceivedThisFY] = useState(0);
  const [fyLabel, setFyLabel] = useState("");
  const [yieldRanking, setYieldRanking] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [hidePending, setHidePending] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [symbol, setSymbol] = useState("");
  const [amount, setAmount] = useState("");
  const [recordDate, setRecordDate] = useState("");
  const [note, setNote] = useState("");

  function loadData() {
    setLoading(true);
    Promise.all([
      fetch("/api/dividends").then((r) => r.json()),
      fetch("/api/portfolio").then((r) => r.json()),
      fetch("/api/dividends/page-data").then((r) => r.json()),
    ]).then(([divData, portfolioData, pageData]) => {
      setEvents((divData.events || []).filter((e: any) => e.type === "dividend"));
      setPortfolioHoldings(portfolioData.holdings || []);
      setReceived(pageData.received || []);
      setReceivedThisFY(pageData.receivedThisFY || 0);
      setFyLabel(pageData.fyLabel || "");
      setYieldRanking(pageData.yieldRanking || []);
      setLoading(false);
    });
  }

  useEffect(() => { loadData(); }, []);

  async function addManualEntry() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/dividends/received", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, amount: parseFloat(amount), recordDate, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setSymbol(""); setAmount(""); setRecordDate(""); setNote("");
      setShowForm(false);
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(id: number) {
    setBusy(true);
    try {
      await fetch("/api/dividends/received", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      loadData();
    } finally {
      setBusy(false);
    }
  }

  const enrichedEvents = events.map((e: any) => {
    const holding = portfolioHoldings.find((h: any) => h.symbol === e.symbol);
    const amountMatch = (e.label || "").match(/R[se]\.?\s*([\d.]+)/i);
    const isPending = !amountMatch;
    const computedAmount = holding && amountMatch ? parseFloat(amountMatch[1]) * holding.qty : null;
    return { ...e, computedAmount, isPending };
  });

  const visibleEvents = hidePending ? enrichedEvents.filter((e) => !e.isPending) : enrichedEvents;
  const sortedEvents = [...visibleEvents].sort((a, b) => {
    if (sortMode === "amount") return (b.computedAmount ?? 0) - (a.computedAmount ?? 0);
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  const totalUpcoming = enrichedEvents.reduce((s, e) => s + (e.computedAmount ?? 0), 0);
  const portfolioValue = portfolioHoldings.reduce((s: number, h: any) => s + (h.current ?? 0), 0);
  const portfolioYield = portfolioValue > 0 ? (receivedThisFY / portfolioValue) * 100 : 0;

  if (loading) return <div style={{ padding: "40px 0" }}>Loading…</div>;

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600 }}>Dividends</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4, marginBottom: 20 }}>
        All upcoming and received dividends across your stock holdings.
      </div>

      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <div className="stat-card"><div className="stat-label">Upcoming</div><div className="stat-value" style={{ color: "var(--gain)" }}>{inr(totalUpcoming)}</div></div>
        <div className="stat-card"><div className="stat-label">Received This FY</div><div className="stat-value">{inr(receivedThisFY)}</div><div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 }}>{fyLabel}</div></div>
        <div className="stat-card"><div className="stat-label">Portfolio Yield</div><div className="stat-value">{portfolioYield.toFixed(2)}%</div></div>
      </div>

      <div className="list-card" style={{ marginBottom: 18 }}>
        <div className="list-head">
          <div className="list-title">Upcoming</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setSortMode("date")}
              style={{ background: sortMode === "date" ? "var(--purple)" : "transparent", color: sortMode === "date" ? "#fff" : "var(--text-muted)", border: sortMode === "date" ? "none" : "1px solid var(--border)", borderRadius: 8, padding: "5px 12px", fontSize: 11.5, cursor: "pointer" }}
            >
              Date
            </button>
            <button
              onClick={() => setSortMode("amount")}
              style={{ background: sortMode === "amount" ? "var(--purple)" : "transparent", color: sortMode === "amount" ? "#fff" : "var(--text-muted)", border: sortMode === "amount" ? "none" : "1px solid var(--border)", borderRadius: 8, padding: "5px 12px", fontSize: 11.5, cursor: "pointer" }}
            >
              Amount
            </button>
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)", marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={hidePending} onChange={(e) => setHidePending(e.target.checked)} />
          Hide pending-approval entries
        </label>

        {sortedEvents.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 12.5 }}>No upcoming dividends found.</div>
        ) : (
          sortedEvents.map((e, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
              <span>
                <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 100, marginRight: 8, background: e.isPending ? "rgba(138,143,163,0.14)" : "var(--gold-soft)", color: e.isPending ? "var(--text-muted)" : "var(--gold)" }}>
                  {e.isPending ? "PENDING" : "DIVIDEND"}
                </span>
                <b>{e.symbol}</b> — {e.label}
              </span>
              <span style={{ textAlign: "right" }}>
                {e.computedAmount !== null && <div style={{ color: "var(--gain)", fontWeight: 600 }}>{inr(e.computedAmount)}</div>}
                <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{e.date}</div>
              </span>
            </div>
          ))
        )}
      </div>

      <div className="list-card" style={{ marginBottom: 18 }}>
        <div className="list-head">
          <div className="list-title">Received <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>· {fyLabel}</span></div>
          <button className="btn" style={{ padding: "6px 14px", fontSize: 12.5 }} onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ Add Manual Entry"}
          </button>
        </div>

        {showForm && (
          <div style={{ padding: "14px 0", borderBottom: "1px solid var(--border)", marginBottom: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label className="field-label">Symbol</label>
                <input className="field-input" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="RELIANCE" />
              </div>
              <div>
                <label className="field-label">Amount (₹)</label>
                <input className="field-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1200" />
              </div>
              <div>
                <label className="field-label">Record Date</label>
                <input className="field-input" type="date" value={recordDate} onChange={(e) => setRecordDate(e.target.value)} />
              </div>
              <div>
                <label className="field-label">Note (optional)</label>
                <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. from old broker statement" />
              </div>
            </div>
            {error && <div style={{ color: "var(--loss)", fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
            <button className="btn" disabled={busy || !symbol || !amount || !recordDate} onClick={addManualEntry}>
              {busy ? "Adding…" : "Save entry"}
            </button>
          </div>
        )}

        {received.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 12.5 }}>
            No dividends received yet — these get logged automatically once a dividend's record date passes, or add one manually for older history.
          </div>
        ) : (
          received.map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
              <span>
                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 100, marginRight: 8, background: r.source === "manual" ? "rgba(138,143,163,0.14)" : "var(--gold-soft)", color: r.source === "manual" ? "var(--text-muted)" : "var(--gold)" }}>
                  {r.source === "manual" ? "MANUAL" : "AUTO"}
                </span>
                <b>{r.symbol}</b>{r.note && <span style={{ color: "var(--text-muted)" }}> — {r.note}</span>}
              </span>
              <span style={{ textAlign: "right" }}>
                <div style={{ color: "var(--gain)", fontWeight: 600 }}>{inr(r.amount)}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                  {r.record_date}
                  {r.source === "manual" && (
                    <button onClick={() => deleteEntry(r.id)} disabled={busy} style={{ background: "none", border: "none", color: "var(--loss)", fontSize: 10, cursor: "pointer", marginLeft: 8, padding: 0 }}>
                      Remove
                    </button>
                  )}
                </div>
              </span>
            </div>
          ))
        )}
      </div>

      {yieldRanking.length > 0 && (
        <div className="list-card" style={{ marginBottom: 40 }}>
          <div className="list-head"><div className="list-title">Best Income Generators <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>· by yield on your cost</span></div></div>
          {yieldRanking.map((y) => (
            <div key={y.symbol} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
              <span><b>{y.symbol}</b></span>
              <span style={{ color: "var(--gain)", fontWeight: 600 }}>{y.yieldPct.toFixed(2)}% <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({inr(y.totalReceived)} total)</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}