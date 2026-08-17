"use client";
import { useEffect, useState } from "react";

const inr = (n: number, d = 0) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n >= 0 ? "+" : "−");

export default function MutualFundsPage() {
  const [holdings, setHoldings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ holdings: any[]; reportDate: string | null } | null>(null);
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
  const reportDate = holdings[0]?.reportDate;
  const mostRecentNavUpdate = holdings.reduce((latest: string | null, h) => {
    if (!h.navUpdatedAt) return latest;
    return !latest || h.navUpdatedAt > latest ? h.navUpdatedAt : latest;
  }, null);

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 4 }}>
        Mutual Funds <span style={{ fontSize: 11, background: "var(--gold-soft)", color: "var(--gold)", padding: "3px 9px", borderRadius: 100, marginLeft: 8, verticalAlign: "middle" }}>via Groww + daily NAV</span>
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
        Units and invested amount come from your uploaded Groww report. Current value updates automatically every day using live NAVs.
      </div>

      {!preview && (
        <div className="list-card" style={{ marginBottom: 20 }}>
          <div className="list-head"><div className="list-title">Upload Holdings Report</div></div>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} disabled={busy} className="field-input" />
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10 }}>
            From Groww: Mutual Funds → Reports → Holdings Report. You only need to re-upload this when your holdings
            change (new purchase/redemption) — current value stays live from the daily NAV refresh in between.
          </div>
          {error && <div style={{ color: "var(--loss)", fontSize: 12.5, marginTop: 10 }}>{error}</div>}
          {status && <div style={{ color: "var(--gain)", fontSize: 12.5, marginTop: 10 }}>{status}</div>}
        </div>
      )}

      {preview && (
        <div className="list-card" style={{ marginBottom: 20 }}>
          <div className="list-head">
            <div className="list-title">Review before saving {preview.reportDate && <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 12 }}>· as of {preview.reportDate}</span>}</div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 14 }}>
            Confirm each fund matched the right scheme — this determines which NAV gets tracked daily. Pick a different one from the dropdown if it's wrong.
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
                <div style={{ fontSize: 11.5, color: "var(--loss)", marginTop: 6 }}>No scheme match found — this fund won't get daily NAV updates, current value stays fixed at the report's snapshot.</div>
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

      {!loading && holdings.length > 0 && (
        <>
          <div className="stat-grid" style={{ marginBottom: 8 }}>
            <div className="stat-card"><div className="stat-label">Current Value</div><div className="stat-value">{inr(totalCurrent)}</div></div>
            <div className="stat-card"><div className="stat-label">Invested</div><div className="stat-value">{inr(totalInvested)}</div></div>
            <div className="stat-card"><div className="stat-label">Gain</div><div className="stat-value" style={{ color: totalPnl >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(totalPnl)}{inr(Math.abs(totalPnl))}</div></div>
            <div className="stat-card"><div className="stat-label">Return</div><div className="stat-value" style={{ color: totalPnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(totalPnlPct)}{Math.abs(totalPnlPct).toFixed(1)}%</div></div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 18 }}>
            {reportDate && <>Report as of {reportDate}</>}
            {mostRecentNavUpdate && <> · NAVs last refreshed {new Date(mostRecentNavUpdate).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</>}
            {!mostRecentNavUpdate && <> · Live NAV refresh hasn't run yet — values shown are from the report</>}
          </div>

          <div className="list-card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 11.5 }}>
                  <th style={{ textAlign: "left", paddingBottom: 10 }}>Fund</th>
                  <th>Units</th><th>Invested</th><th>NAV</th><th>Current</th><th>Return</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "11px 0", fontWeight: 600 }}>
                      {h.schemeName}
                      <div style={{ fontWeight: 400, fontSize: 10.5, color: "var(--text-muted)" }}>{h.amc} · {h.category} · Folio {h.folioNo}</div>
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.units.toFixed(2)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{inr(h.invested)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.currentNav ? h.currentNav.toFixed(2) : "—"}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{inr(h.currentValue)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: h.returns >= 0 ? "var(--gain)" : "var(--loss)" }}>
                      {sign(h.returns)}{inr(Math.abs(h.returns))} ({h.returnsPct.toFixed(1)}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && holdings.length === 0 && !preview && (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No mutual fund holdings saved yet — upload a Holdings Report above to get started.</div>
      )}
    </div>
  );
}
