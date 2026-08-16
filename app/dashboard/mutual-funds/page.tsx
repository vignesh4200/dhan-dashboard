"use client";
import { useEffect, useState } from "react";

const inr = (n: number, d = 0) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n >= 0 ? "+" : "−");

export default function MutualFundsPage() {
  const [holdings, setHoldings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewFunds, setReviewFunds] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  function loadHoldings() {
    setLoading(true);
    fetch("/api/mutual-funds").then((r) => r.json()).then((d) => {
      setHoldings(d.holdings || []);
      setLoading(false);
    });
  }

  useEffect(() => { loadHoldings(); }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(""); setStatus(""); setBusy(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/mutual-funds/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't parse this file");
      setReviewFunds(
        data.funds.map((f: any) => ({
          ...f,
          selectedSchemeCode: f.candidates[0]?.schemeCode || "",
          selectedSchemeName: f.candidates[0]?.schemeName || f.fundName,
        }))
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function updateSelection(index: number, schemeCode: string, schemeName: string) {
    setReviewFunds((prev) =>
      prev!.map((f, i) => (i === index ? { ...f, selectedSchemeCode: schemeCode, selectedSchemeName: schemeName } : f))
    );
  }

  async function confirmSave() {
    setBusy(true); setError("");
    try {
      const payload = reviewFunds!.map((f) => ({
        schemeCode: f.selectedSchemeCode,
        schemeName: f.selectedSchemeName,
        units: f.units,
        invested: f.invested,
        avgNav: f.avgNav,
      }));
      const res = await fetch("/api/mutual-funds/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funds: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setStatus(`Saved ${data.saved} funds.`);
      setReviewFunds(null);
      loadHoldings();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const totalCurrent = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalInvested = holdings.reduce((s, h) => s + h.invested, 0);
  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 4 }}>
        Mutual Funds <span style={{ fontSize: 11, background: "var(--gold-soft)", color: "var(--gold)", padding: "3px 9px", borderRadius: 100, marginLeft: 8, verticalAlign: "middle" }}>via Groww upload</span>
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
        Upload your order history export from Groww to track holdings — no live sync, update whenever you like.
      </div>

      {!reviewFunds && (
        <div className="list-card" style={{ marginBottom: 20 }}>
          <div className="list-head"><div className="list-title">Upload order history</div></div>
          <input type="file" accept=".csv" onChange={handleFile} disabled={busy} className="field-input" />
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10 }}>
            CSV only. Export this from Groww → your MF order/transaction history. Column names vary, so you'll get a
            chance to review and correct the fund matches before anything is saved.
          </div>
          {error && <div style={{ color: "var(--loss)", fontSize: 12.5, marginTop: 10 }}>{error}</div>}
          {status && <div style={{ color: "var(--gain)", fontSize: 12.5, marginTop: 10 }}>{status}</div>}
        </div>
      )}

      {reviewFunds && (
        <div className="list-card" style={{ marginBottom: 20 }}>
          <div className="list-head"><div className="list-title">Review before saving</div></div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 14 }}>
            Confirm each fund matched correctly. If the wrong scheme is picked, choose another candidate from the dropdown.
          </div>
          {reviewFunds.map((f, i) => (
            <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{f.fundName}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                {f.units} units · invested {inr(f.invested)} · avg NAV {f.avgNav.toFixed(2)}
              </div>
              {f.candidates.length > 0 ? (
                <select
                  className="field-input"
                  style={{ marginTop: 8, marginBottom: 0 }}
                  value={f.selectedSchemeCode}
                  onChange={(e) => {
                    const chosen = f.candidates.find((c: any) => String(c.schemeCode) === e.target.value);
                    updateSelection(i, e.target.value, chosen?.schemeName || f.fundName);
                  }}
                >
                  {f.candidates.map((c: any) => (
                    <option key={c.schemeCode} value={c.schemeCode}>{c.schemeName}</option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 11.5, color: "var(--loss)", marginTop: 6 }}>No scheme match found — this fund won't get live NAV updates.</div>
              )}
            </div>
          ))}
          {error && <div style={{ color: "var(--loss)", fontSize: 12.5, marginTop: 10 }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button className="btn" disabled={busy} onClick={confirmSave}>{busy ? "Saving…" : "Confirm & save"}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setReviewFunds(null)}>Cancel</button>
          </div>
        </div>
      )}

      {!loading && holdings.length > 0 && (
        <>
          <div className="stat-grid" style={{ marginBottom: 18 }}>
            <div className="stat-card"><div className="stat-label">Current Value</div><div className="stat-value">{inr(totalCurrent)}</div></div>
            <div className="stat-card"><div className="stat-label">Invested</div><div className="stat-value">{inr(totalInvested)}</div></div>
            <div className="stat-card"><div className="stat-label">Gain</div><div className="stat-value" style={{ color: totalPnl >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(totalPnl)}{inr(Math.abs(totalPnl))}</div></div>
            <div className="stat-card"><div className="stat-label">Return</div><div className="stat-value" style={{ color: totalPnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(totalPnlPct)}{Math.abs(totalPnlPct).toFixed(1)}%</div></div>
          </div>

          <div className="list-card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 11.5 }}>
                  <th style={{ textAlign: "left", paddingBottom: 10 }}>Fund</th>
                  <th>Units</th><th>Avg NAV</th><th>Current NAV</th><th>Value</th><th>Return</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "11px 0", fontWeight: 600 }}>{h.schemeName}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.units}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.avgNav.toFixed(2)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.currentNav.toFixed(2)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{inr(h.currentValue)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: h.pnl >= 0 ? "var(--gain)" : "var(--loss)" }}>
                      {sign(h.pnl)}{inr(Math.abs(h.pnl))} ({h.pnlPct.toFixed(1)}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && holdings.length === 0 && !reviewFunds && (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No mutual fund holdings saved yet — upload a file above to get started.</div>
      )}
    </div>
  );
}
