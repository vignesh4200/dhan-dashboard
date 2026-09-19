"use client";
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const inr = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n >= 0 ? "+" : "−");
const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${sign(n)}${Math.abs(n).toFixed(1)}%`);

type Signal = {
  id: number;
  signalType: string;
  symbol: string | null;
  company: string;
  side: string | null;
  qty: number | null;
  price: number | null;
  valueCr: number | null;
  disclosedDate: string;
  source: string | null;
  mfBuyCount: number;
  screenPassed: boolean;
  currentPrice: number | null;
  stopLoss: number | null;
  target: number | null;
  isHolding: boolean;
  track: { status: string } | null;
};

type Track = {
  id: number;
  signalId: number;
  symbol: string;
  company: string;
  status: string;
  entryPrice: number | null;
  qty: number | null;
  stopLoss: number | null;
  target: number | null;
  takenAt: string;
  ltp: number | null;
  pnlPct: number | null;
  pnl: number | null;
};

type BrokerCall = {
  id: number;
  symbol: string;
  company: string | null;
  brokerName: string | null;
  callType: string;
  entryPrice: number | null;
  stopLoss: number | null;
  target: number | null;
  qty: number | null;
  status: string;
  notes: string | null;
  callDate: string | null;
  takenAt: string;
  closedAt: string | null;
  exitPrice: number | null;
  ltp: number | null;
  pnl: number | null;
  pnlPct: number | null;
};

export default function SignalsPage() {
  const router = useRouter();
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [filter, setFilter] = useState<"all" | "buy" | "screen" | "mine">("all");
  const [openForm, setOpenForm] = useState<number | null>(null);
  const [entryPrice, setEntryPrice] = useState("");
  const [qty, setQty] = useState("");

  const [brokerCalls, setBrokerCalls] = useState<BrokerCall[] | null>(null);
  const [showAddCall, setShowAddCall] = useState(false);
  const [bcSymbol, setBcSymbol] = useState("");
  const [bcBroker, setBcBroker] = useState("");
  const [bcType, setBcType] = useState("buy");
  const [bcEntry, setBcEntry] = useState("");
  const [bcQty, setBcQty] = useState("");
  const [bcStop, setBcStop] = useState("");
  const [bcTarget, setBcTarget] = useState("");
  const [bcNotes, setBcNotes] = useState("");
  const [bcCheck, setBcCheck] = useState<{ status: "idle" | "checking" | "ok" | "bad"; name?: string; price?: number; error?: string }>({ status: "idle" });

  const loadSignals = () =>
    fetch("/api/signals").then((r) => {
      if (r.status === 401) return router.push("/login");
      return r.json();
    }).then((d) => d && setSignals(d.signals || []));

  const loadTracks = () =>
    fetch("/api/signals/track").then((r) => (r.status === 401 ? null : r.json())).then((d) => d && setTracks(d.tracks || []));

  const loadBrokerCalls = () =>
    fetch("/api/broker-calls").then((r) => (r.status === 401 ? null : r.json())).then((d) => d && setBrokerCalls(d.calls || []));

  useEffect(() => {
    loadSignals();
    loadTracks();
    loadBrokerCalls();
  }, []);

  const act = async (signalId: number, status: string, extra: any = {}) => {
    await fetch("/api/signals/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signalId, status, ...extra }),
    });
    setOpenForm(null);
    setEntryPrice("");
    setQty("");
    loadSignals();
    loadTracks();
  };

  const checkBcSymbol = async () => {
    if (!bcSymbol.trim()) return;
    setBcCheck({ status: "checking" });
    const r = await fetch(`/api/broker-calls?checkSymbol=${encodeURIComponent(bcSymbol.trim())}`).then((r) => r.json());
    if (r.valid) setBcCheck({ status: "ok", name: r.name, price: r.price });
    else setBcCheck({ status: "bad", error: r.error });
  };

  const resetAddCallForm = () => {
    setBcSymbol(""); setBcBroker(""); setBcType("buy");
    setBcEntry(""); setBcQty(""); setBcStop(""); setBcTarget(""); setBcNotes("");
    setBcCheck({ status: "idle" });
  };

  const submitBrokerCall = async () => {
    if (bcCheck.status !== "ok") return; // guard: symbol must be checked & valid
    await fetch("/api/broker-calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: bcSymbol.trim().toUpperCase(),
        brokerName: bcBroker.trim() || null,
        callType: bcType,
        entryPrice: bcEntry ? parseFloat(bcEntry) : null,
        stopLoss: bcStop ? parseFloat(bcStop) : null,
        target: bcTarget ? parseFloat(bcTarget) : null,
        qty: bcQty ? parseInt(bcQty) : null,
        notes: bcNotes.trim() || null,
        status: bcEntry ? "bought" : "watching",
      }),
    });
    resetAddCallForm();
    setShowAddCall(false);
    loadBrokerCalls();
  };

  const brokerAct = async (id: number, status: string, extra: any = {}) => {
    await fetch("/api/broker-calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, ...extra }),
    });
    loadBrokerCalls();
  };

  if (!signals) return <div style={{ padding: "40px 0" }}>Loading…</div>;

  let rows = signals;
  if (filter === "buy") rows = rows.filter((r) => r.side === "BUY");
  if (filter === "screen") rows = rows.filter((r) => r.screenPassed);
  if (filter === "mine") rows = rows.filter((r) => r.isHolding);

  const portfolioMatches = signals.filter((s) => s.isHolding).length;
  const boughtTracks = (tracks || []).filter((t) => t.status === "bought");
  const totalTrackedPnl = boughtTracks.reduce((s, t) => s + (t.pnl ?? 0), 0);

  const boughtCalls = (brokerCalls || []).filter((c) => c.status === "bought");
  const totalBrokerPnl = boughtCalls.reduce((s, c) => s + (c.pnl ?? 0), 0);

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Smart Signals</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
        Bulk/block deals &amp; insider disclosures, updated automatically by the daily scan · current prices refresh every 15 min
        {portfolioMatches > 0 && <> · <span style={{ color: "var(--amber)" }}>{portfolioMatches} touch stocks you hold</span></>}
      </div>

      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <div className="stat-card">
          <div className="stat-label">Signals tracked</div>
          <div className="stat-value">{signals.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Passed the screen</div>
          <div className="stat-value">{signals.filter((s) => s.screenPassed).length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">In your portfolio</div>
          <div className="stat-value">{portfolioMatches}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Open tracked trades</div>
          <div className="stat-value" style={{ color: totalTrackedPnl >= 0 ? "var(--gain)" : "var(--loss)" }}>
            {boughtTracks.length > 0 ? `${sign(totalTrackedPnl)}${inr(Math.abs(totalTrackedPnl))}` : "—"}
          </div>
        </div>
      </div>

      {boughtTracks.length > 0 && (
        <div className="list-card" style={{ marginBottom: 22, overflowX: "auto" }}>
          <div className="list-head"><div className="list-title">My tracked trades</div></div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 11.5 }}>
                <th style={{ textAlign: "left", paddingBottom: 10 }}>Stock</th>
                <th>Entry</th><th>Qty</th><th>LTP</th><th>Stop</th><th>Target</th><th>P&amp;L</th><th></th>
              </tr>
            </thead>
            <tbody>
              {boughtTracks.map((t) => (
                <tr key={t.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "11px 0", fontWeight: 600 }}>{t.symbol}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{inr(t.entryPrice, 2)}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{t.qty ?? "—"}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{t.ltp ? t.ltp.toFixed(2) : "—"}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--loss)" }}>{inr(t.stopLoss, 2)}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--gain)" }}>{inr(t.target, 2)}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: (t.pnl ?? 0) >= 0 ? "var(--gain)" : "var(--loss)" }}>
                    {t.pnl != null ? `${sign(t.pnl)}${inr(Math.abs(t.pnl))}` : "—"} {t.pnlPct != null && `(${fmtPct(t.pnlPct)})`}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => act(t.signalId, "sold", { exitPrice: t.ltp })}>
                      Close
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Broker recommendations ---- */}
      <div className="list-card" style={{ marginBottom: 22, overflowX: "auto" }}>
        <div className="list-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="list-title">
            Broker recommendations
            {boughtCalls.length > 0 && (
              <span style={{ marginLeft: 10, fontSize: 12.5, fontWeight: 700, color: totalBrokerPnl >= 0 ? "var(--gain)" : "var(--loss)" }}>
                {sign(totalBrokerPnl)}{inr(Math.abs(totalBrokerPnl))}
              </span>
            )}
          </div>
          <button
            className="btn btn-sm"
            style={{ background: "var(--gold)" }}
            onClick={() => {
              if (showAddCall) resetAddCallForm();
              setShowAddCall(!showAddCall);
            }}
          >
            {showAddCall ? "Cancel" : "+ Log a call"}
          </button>
        </div>

        {showAddCall && (
          <div style={{ marginBottom: 14 }}>
            <div className="track-form">
              <input
                value={bcSymbol}
                onChange={(e) => { setBcSymbol(e.target.value); setBcCheck({ status: "idle" }); }}
                placeholder="Symbol e.g. RELIANCE"
                style={{ width: 130 }}
              />
              <button className="btn btn-sm btn-ghost" onClick={checkBcSymbol} disabled={bcCheck.status === "checking" || !bcSymbol.trim()}>
                {bcCheck.status === "checking" ? "Checking…" : "Check"}
              </button>
              <input value={bcBroker} onChange={(e) => setBcBroker(e.target.value)} placeholder="Broker/advisor" style={{ width: 130 }} />
              <select
                value={bcType}
                onChange={(e) => setBcType(e.target.value)}
                style={{ background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "7px 9px", color: "var(--text)", fontSize: 12.5 }}
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
                <option value="hold">Hold</option>
              </select>
              <input value={bcEntry} onChange={(e) => setBcEntry(e.target.value)} placeholder="Entry ₹" />
              <input value={bcQty} onChange={(e) => setBcQty(e.target.value)} placeholder="Qty" />
              <input value={bcStop} onChange={(e) => setBcStop(e.target.value)} placeholder="Stop ₹" />
              <input value={bcTarget} onChange={(e) => setBcTarget(e.target.value)} placeholder="Target ₹" />
              <input value={bcNotes} onChange={(e) => setBcNotes(e.target.value)} placeholder="Notes (optional)" style={{ width: 180 }} />
              <button className="btn btn-sm" style={{ background: "var(--gain)" }} onClick={submitBrokerCall} disabled={bcCheck.status !== "ok"}>
                Save
              </button>
            </div>
            {bcCheck.status === "ok" && (
              <p style={{ fontSize: 12, color: "var(--gain)", marginTop: 6 }}>
                ✓ Matched: {bcCheck.name} — current price ₹{bcCheck.price?.toFixed(2)}
              </p>
            )}
            {bcCheck.status === "bad" && (
              <p style={{ fontSize: 12, color: "var(--loss)", marginTop: 6 }}>{bcCheck.error}</p>
            )}
            {bcCheck.status === "idle" && (
              <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
                Tap "Check" to confirm the symbol before saving — Save stays disabled until it matches a real NSE stock.
              </p>
            )}
          </div>
        )}

        {(brokerCalls?.length ?? 0) === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 12.5, padding: "6px 0" }}>
            Nothing logged yet — add a call your broker or advisor gave you to track it here alongside the disclosure signals.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 11.5 }}>
                <th style={{ textAlign: "left", paddingBottom: 10 }}>Stock</th>
                <th>Broker</th><th>Type</th><th>Entry</th><th>Qty</th><th>LTP</th><th>Stop / Target</th><th>P&amp;L</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(brokerCalls || []).map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "11px 0", fontWeight: 600 }}>
                    {c.symbol}
                    <div style={{ fontWeight: 400, fontSize: 11.5, color: "var(--text-muted)" }}>{c.company || ""}</div>
                  </td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{c.brokerName || "—"}</td>
                  <td style={{ textAlign: "right", color: c.callType === "buy" ? "var(--gain)" : c.callType === "sell" ? "var(--loss)" : "var(--amber)" }}>
                    {c.callType.toUpperCase()}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{inr(c.entryPrice, 2)}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{c.qty ?? "—"}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{c.ltp ? c.ltp.toFixed(2) : "—"}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    <span style={{ color: "var(--loss)" }}>{inr(c.stopLoss, 0)}</span>
                    {" / "}
                    <span style={{ color: "var(--gain)" }}>{inr(c.target, 0)}</span>
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: (c.pnl ?? 0) >= 0 ? "var(--gain)" : "var(--loss)" }}>
                    {c.pnl != null ? `${sign(c.pnl)}${inr(Math.abs(c.pnl))}` : "—"} {c.pnlPct != null && `(${fmtPct(c.pnlPct)})`}
                  </td>
                  <td style={{ textAlign: "right", textTransform: "capitalize", color: "var(--text-muted)" }}>{c.status}</td>
                  <td style={{ textAlign: "right" }}>
                    {c.status === "watching" && (
                      <button className="btn btn-sm btn-ghost" onClick={() => brokerAct(c.id, "bought", { entryPrice: c.entryPrice ?? c.ltp })}>
                        Bought?
                      </button>
                    )}
                    {c.status === "bought" && (
                      <button className="btn btn-sm btn-ghost" onClick={() => brokerAct(c.id, "sold", { exitPrice: c.ltp })}>
                        Close
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="chip-row">
        {(["all", "buy", "screen", "mine"] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "buy" ? "Buy side" : f === "screen" ? "Passed screen" : "My holdings"}
          </button>
        ))}
      </div>

      <div className="list-card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 11.5 }}>
              <th style={{ textAlign: "left", paddingBottom: 10 }}>Stock</th>
              <th>Side</th><th>Price</th><th>Current / Move</th><th>Value</th><th>Date</th><th>Screen</th><th>Stop / Target</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const already = s.track?.status;
              const movePct = s.currentPrice != null && s.price ? ((s.currentPrice - s.price) / s.price) * 100 : null;
              return (
                <Fragment key={s.id}>
                  <tr style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "11px 0", fontWeight: 600 }}>
                      {s.symbol || s.company}
                      {s.isHolding && <span className="tag-hold">HOLD</span>}
                      <div style={{ fontWeight: 400, fontSize: 11.5, color: "var(--text-muted)" }}>{s.source}</div>
                    </td>
                    <td style={{ textAlign: "right", color: s.side === "BUY" ? "var(--gain)" : "var(--loss)" }}>{s.side || "—"}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{inr(s.price, 2)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                      {s.currentPrice != null ? (
                        <>
                          {s.currentPrice.toFixed(2)}
                          <span style={{ color: movePct != null && movePct >= 0 ? "var(--gain)" : "var(--loss)", marginLeft: 6 }}>
                            {fmtPct(movePct)}
                          </span>
                        </>
                      ) : "—"}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{s.valueCr ? `₹${s.valueCr.toFixed(1)}cr` : "—"}</td>
                    <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{s.disclosedDate}</td>
                    <td style={{ textAlign: "right" }}>{s.screenPassed ? <span className="tag-screen">PASS</span> : "—"}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                      {s.screenPassed ? (
                        <>
                          <span style={{ color: "var(--loss)" }}>{inr(s.stopLoss, 0)}</span>
                          {" / "}
                          <span style={{ color: "var(--gain)" }}>{inr(s.target, 0)}</span>
                        </>
                      ) : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {!s.symbol ? (
                        <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}>no symbol yet</span>
                      ) : already === "bought" ? (
                        <span className="badge up">Bought</span>
                      ) : already === "sold" ? (
                        <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}>Closed</span>
                      ) : (
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => act(s.id, "watching")}>Watch</button>
                          <button
                            className="btn btn-sm"
                            style={{ background: "var(--gain)" }}
                            onClick={() => {
                              setOpenForm(openForm === s.id ? null : s.id);
                              setEntryPrice(s.currentPrice ? String(s.currentPrice) : "");
                            }}
                          >
                            Bought?
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {openForm === s.id && (
                    <tr>
                      <td colSpan={9}>
                        <div className="track-form">
                          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Entry price</span>
                          <input value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} placeholder="₹" />
                          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Qty</span>
                          <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="shares" />
                          <button
                            className="btn btn-sm"
                            style={{ background: "var(--gold)" }}
                            onClick={() =>
                              act(s.id, "bought", {
                                entryPrice: parseFloat(entryPrice) || s.currentPrice,
                                qty: parseInt(qty) || null,
                                stopLoss: s.stopLoss,
                                target: s.target,
                              })
                            }
                          >
                            Confirm
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 16, lineHeight: 1.6, maxWidth: 640 }}>
        Public bulk/block deal and insider disclosures, not investment advice. Stop-loss/target are a mechanical
        −15% / +20% band off the disclosed price for stocks that pass the screen — not a guarantee. Broker
        recommendations above are what you manually log from your own broker/advisor, validated against live
        NSE prices before saving. "Bought" only logs a trade you made elsewhere; this dashboard never places
        real orders.
      </p>
    </div>
  );
}