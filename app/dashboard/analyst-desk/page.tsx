"use client";
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Finding = { lead: string; analyst: string; finding: string; isFlag?: boolean };

type Stock = {
  id: number;
  symbol: string;
  company: string | null;
  compositeScore: number | null;
  convictionLabel: string | null;
  equityScore: number | null;
  macroScore: number | null;
  validationScore: number | null;
  flowRead: string | null;
  sentimentRead: string | null;
  flagged: boolean;
  flagReason: string | null;
  findings: Finding[];
  reportMarkdown: string;
  sources: string[];
  updatedAt: string;
  inHoldings: boolean;
  holdingQty: number | null;
  brokerRec: { brokerName: string | null; callType: string } | null;
};

const scoreColor = (score: number | null) => {
  if (score == null) return "var(--text-muted)";
  if (score >= 70) return "var(--gain)";
  if (score >= 50) return "var(--amber)";
  return "var(--loss)";
};

export default function AnalystDeskPage() {
  const router = useRouter();
  const [runDate, setRunDate] = useState<string | null>(null);
  const [stocks, setStocks] = useState<Stock[] | null>(null);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [holdingsCount, setHoldingsCount] = useState(0);
  const [filter, setFilter] = useState<"all" | "holdings" | "buy" | "flagged">("all");
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/analyst-desk")
      .then((r) => {
        if (r.status === 401) return router.push("/login");
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        setRunDate(d.runDate);
        setStocks(d.stocks || []);
        setAvgScore(d.avgScore);
        setFlaggedCount(d.flaggedCount || 0);
        setHoldingsCount(d.holdingsCount || 0);
      });
  }, [router]);

  if (!stocks) return <div style={{ padding: "40px 0" }}>Loading…</div>;

  let rows = stocks;
  if (filter === "holdings") rows = rows.filter((s) => s.inHoldings);
  if (filter === "buy") rows = rows.filter((s) => s.brokerRec?.callType === "buy");
  if (filter === "flagged") rows = rows.filter((s) => s.flagged);

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Analyst Desk</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
        Every holding + watchlist stock, scored fundamentals-first (earnings quality + margin of safety) · flow &amp;
        sentiment shown as context, never blended into the score · refreshed once daily, pre-market
        {runDate && <> · last run {runDate}</>}
      </div>

      {stocks.length === 0 ? (
        <div className="list-card">
          <p>No desk run yet.</p>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Nothing has been ingested into <code>analyst_desk_scores</code> yet — once the daily scheduled task
            starts posting to <code>/api/analyst-desk/ingest</code>, stocks will show up here automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="stat-grid" style={{ marginBottom: 22 }}>
            <div className="stat-card">
              <div className="stat-label">Stocks tracked</div>
              <div className="stat-value">{stocks.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avg. conviction score</div>
              <div className="stat-value" style={{ color: scoreColor(avgScore) }}>
                {avgScore != null ? avgScore.toFixed(1) : "—"}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">In your holdings</div>
              <div className="stat-value">{holdingsCount}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Flagged</div>
              <div className="stat-value" style={{ color: flaggedCount > 0 ? "var(--loss)" : "var(--text)" }}>
                {flaggedCount}
              </div>
            </div>
          </div>

          <div className="chip-row" style={{ marginBottom: 14 }}>
            {(["all", "holdings", "buy", "flagged"] as const).map((f) => (
              <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "holdings" ? "My holdings" : f === "buy" ? "Broker: Buy-rated" : "Flagged"}
              </button>
            ))}
          </div>

          <div className="list-card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 11.5 }}>
                  <th style={{ textAlign: "left", paddingBottom: 10 }}>Stock</th>
                  <th>Broker rec.</th>
                  <th>Score</th>
                  <th>Conviction</th>
                  <th style={{ textAlign: "left" }}>Desk read</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <Fragment key={s.id}>
                    <tr style={{ borderTop: "1px solid var(--border)", background: s.flagged ? "rgba(227,128,128,0.06)" : undefined }}>
                      <td style={{ padding: "11px 0", fontWeight: 600 }}>
                        {s.symbol}
                        {s.inHoldings && <span className="tag-hold">HOLD</span>}
                        <div style={{ fontWeight: 400, fontSize: 11.5, color: "var(--text-muted)" }}>{s.company || ""}</div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {s.brokerRec ? (
                          <span
                            className="tag-hold"
                            style={{
                              background: s.brokerRec.callType === "buy" ? "rgba(120,200,150,0.14)" : "var(--gold-soft)",
                              color: s.brokerRec.callType === "buy" ? "var(--gain)" : "var(--gold)",
                            }}
                          >
                            {s.brokerRec.callType.toUpperCase()}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: scoreColor(s.compositeScore) }}>
                        {s.compositeScore != null ? s.compositeScore.toFixed(1) : "—"}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{s.convictionLabel || "—"}</td>
                      <td style={{ fontSize: 12, color: s.flagged ? "var(--loss)" : "var(--text-muted)" }}>
                        {s.flagged ? `⚑ ${s.flagReason || "flagged"}` : s.equityScore != null ? "Fundamentals-led read" : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                          {openId === s.id ? "Hide" : "Report"}
                        </button>
                      </td>
                    </tr>
                    {openId === s.id && (
                      <tr>
                        <td colSpan={6}>
                          <div style={{ padding: "16px 4px 22px", display: "flex", gap: 24, flexWrap: "wrap" }}>
                            <div style={{ flex: "1 1 320px", minWidth: 280 }}>
                              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                Feeds the score
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, marginBottom: 14 }}>
                                <div>Equity Research <span style={{ float: "right", fontFamily: "var(--font-mono)" }}>{s.equityScore ?? "—"} × 40%</span></div>
                                <div>Independent Validation <span style={{ float: "right", fontFamily: "var(--font-mono)" }}>{s.validationScore ?? "—"} × 35%</span></div>
                                <div>Industry &amp; Macro <span style={{ float: "right", fontFamily: "var(--font-mono)" }}>{s.macroScore ?? "—"} × 15%</span></div>
                              </div>
                              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                Context — not scored
                              </div>
                              <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
                                <div><b style={{ color: "var(--text)" }}>Flow/Derivatives:</b> {s.flowRead || "—"}</div>
                                <div><b style={{ color: "var(--text)" }}>News/Sentiment:</b> {s.sentimentRead || "—"}</div>
                              </div>
                            </div>

                            {s.findings.length > 0 && (
                              <div style={{ flex: "1 1 320px", minWidth: 280 }}>
                                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                  Analyst findings
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
                                  {s.findings.map((f, i) => (
                                    <div key={i} style={{ color: f.isFlag ? "var(--loss)" : "var(--text-muted)" }}>
                                      <b style={{ color: "var(--text)" }}>{f.analyst}</b> ({f.lead}) — {f.finding}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div style={{ flex: "2 1 480px", minWidth: 320 }}>
                              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                CMIO report
                              </div>
                              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.6, color: "var(--text)", margin: 0 }}>
                                {s.reportMarkdown}
                              </pre>
                              {s.sources.length > 0 && (
                                <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
                                  Sources: {s.sources.join(" · ")}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 16, lineHeight: 1.6, maxWidth: 640 }}>
            Composite score = fundamentals + valuation only (Graham-weighted: 40% Equity Research, 35% Independent
            Validation, 15% Industry &amp; Macro). Flow, derivatives and news are still fully analyzed but shown as
            context, never scored. Broker rec. is whatever you&apos;ve logged in Smart Signals, shown alongside for
            reference. This is a research-conviction framework, not investment advice.
          </p>
        </>
      )}
    </div>
  );
}
