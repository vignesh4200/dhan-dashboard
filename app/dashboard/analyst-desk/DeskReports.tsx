"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Markdown from "./Markdown";

type Report = {
  id: number;
  symbol: string;
  company: string | null;
  status: "running" | "done" | "error";
  decision: string | null;
  conviction: number | null;
  currentPrice: number | null;
  fairValueLow: number | null;
  fairValueHigh: number | null;
  horizon: string | null;
  summary: string | null;
  reportMarkdown: string | null;
  sources: string[];
  model: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

type Pending = { symbol: string; startedAt: number; error?: string };

const CONCURRENCY = 2;
// A run the server never finished (function timeout, redeploy) stays 'running'.
const STALE_MS = 6 * 60 * 1000;

const decisionStyle = (d: string | null) => {
  if (d === "BUY" || d === "ACCUMULATE") return { background: "var(--gain-soft)", color: "var(--gain)" };
  if (d === "AVOID" || d === "SELL") return { background: "rgba(227,128,128,0.14)", color: "var(--loss)" };
  return { background: "var(--amber-soft)", color: "var(--amber)" };
};

const rupee = (n: number | null) => (n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

const label: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-muted)",
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

export default function DeskReports() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [suggestions, setSuggestions] = useState<{ holdings: string[]; watchlist: string[] }>({ holdings: [], watchlist: [] });
  const [configured, setConfigured] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const queue = useRef<string[]>([]);
  const active = useRef(0);

  useEffect(() => {
    fetch("/api/analyst-desk/reports")
      .then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        if (d.error) return setLoadError(d.error);
        setReports(d.reports || []);
        setSuggestions(d.suggestions || { holdings: [], watchlist: [] });
        setConfigured(d.configured !== false);
      })
      .catch((e) => setLoadError(String(e)));
  }, [router]);

  // Re-render every second so elapsed timers move while reports run.
  useEffect(() => {
    if (pending.every((p) => p.error)) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);

  const toggle = (s: string) => setSelected((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const addTyped = () => {
    const syms = input
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (syms.length === 0) return;
    setSelected((cur) => Array.from(new Set([...cur, ...syms])));
    setInput("");
  };

  const runOne = async (symbol: string) => {
    active.current++;
    try {
      const res = await fetch("/api/analyst-desk/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.report) {
        setReports((cur) => [d.report, ...(cur || []).filter((r) => r.id !== d.report.id)]);
        if (d.report.status === "done") setOpenId(d.report.id);
      }
      if (res.ok) {
        setPending((cur) => cur.filter((p) => p.symbol !== symbol));
      } else {
        const msg = d.report?.error || d.error || `request failed (${res.status})`;
        setPending((cur) => cur.map((p) => (p.symbol === symbol ? { ...p, error: msg } : p)));
      }
    } catch (e: any) {
      setPending((cur) =>
        cur.map((p) => (p.symbol === symbol ? { ...p, error: "connection dropped — the report may still finish; reload in a few minutes" } : p))
      );
    } finally {
      active.current--;
      pump();
    }
  };

  const pump = () => {
    while (active.current < CONCURRENCY && queue.current.length > 0) {
      const next = queue.current.shift()!;
      setPending((cur) => cur.map((p) => (p.symbol === next ? { ...p, startedAt: Date.now() } : p)));
      runOne(next);
    }
  };

  const generate = (symbols: string[]) => {
    const running = new Set(pending.filter((p) => !p.error).map((p) => p.symbol));
    const fresh = symbols.filter((s) => !running.has(s));
    if (fresh.length === 0) return;
    setPending((cur) => [...cur.filter((p) => !fresh.includes(p.symbol)), ...fresh.map((symbol) => ({ symbol, startedAt: 0 }))]);
    queue.current.push(...fresh);
    setSelected([]);
    pump();
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this report?")) return;
    const res = await fetch(`/api/analyst-desk/reports?id=${id}`, { method: "DELETE" });
    if (res.ok) setReports((cur) => (cur || []).filter((r) => r.id !== id));
  };

  const chip = (s: string) => (
    <button key={s} className={`chip ${selected.includes(s) ? "active" : ""}`} onClick={() => toggle(s)}>
      {s}
    </button>
  );

  const visibleReports = (reports || []).filter(
    (r) => !(r.status === "running" && pending.some((p) => p.symbol === r.symbol && !p.error))
  );

  return (
    <div style={{ marginBottom: 32 }}>
      <div className="list-card" style={{ marginBottom: 18 }}>
        <div className="list-head">
          <div className="list-title">Request a desk report</div>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 14, lineHeight: 1.6 }}>
          Pick the stocks you want researched. The desk reads the latest filings, results, valuation and news, then writes
          an investment-committee memo that ends in a Buy / Accumulate / Hold / Avoid / Sell decision. Each report takes
          about 2–4 minutes.
        </div>

        {!configured && (
          <div className="auth-error">
            ANTHROPIC_API_KEY isn&apos;t set in the environment, so reports can&apos;t be generated yet.
          </div>
        )}
        {loadError && <div className="auth-error">{loadError}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input
            className="field-input"
            style={{ marginBottom: 0, flex: 1 }}
            placeholder="Type NSE symbols, e.g. TCS, ASTRAL"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTyped()}
          />
          <button className="btn btn-sm btn-ghost" onClick={addTyped}>
            Add
          </button>
        </div>

        {suggestions.holdings.length > 0 && (
          <>
            <div style={label}>Your holdings</div>
            <div className="chip-row">{suggestions.holdings.map(chip)}</div>
          </>
        )}
        {suggestions.watchlist.length > 0 && (
          <>
            <div style={label}>Smart Signals watchlist</div>
            <div className="chip-row">{suggestions.watchlist.map(chip)}</div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-sm"
            disabled={selected.length === 0 || !configured}
            style={{ opacity: selected.length === 0 || !configured ? 0.5 : 1 }}
            onClick={() => generate(selected)}
          >
            Generate {selected.length > 0 ? `${selected.length} report${selected.length > 1 ? "s" : ""}` : "reports"}
          </button>
          {selected.length > 0 && (
            <>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{selected.join(", ")}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setSelected([])}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {pending.length > 0 && (
        <div className="list-card" style={{ marginBottom: 18 }}>
          <div className="list-title" style={{ marginBottom: 10 }}>
            In progress
          </div>
          {pending.map((p) => (
            <div
              key={p.symbol}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}
            >
              <b>{p.symbol}</b>
              {p.error ? (
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: "var(--loss)", fontSize: 12 }}>{p.error}</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => generate([p.symbol])}>
                    Retry
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setPending((cur) => cur.filter((x) => x.symbol !== p.symbol))}>
                    Dismiss
                  </button>
                </span>
              ) : (
                <span style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                  {p.startedAt ? `Researching… ${Math.floor((Date.now() - p.startedAt) / 1000)}s` : "Queued"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="list-card">
        <div className="list-title" style={{ marginBottom: 10 }}>
          Your desk reports
        </div>
        {reports == null ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
        ) : visibleReports.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No reports yet — pick a stock above to get started.</div>
        ) : (
          visibleReports.map((r) => {
            const stale = r.status === "running" && Date.now() - new Date(r.createdAt).getTime() > STALE_MS;
            const open = openId === r.id;
            return (
              <div key={r.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 150 }}>
                    <b>{r.symbol}</b>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{r.company || ""}</div>
                  </div>
                  {r.status === "done" && r.decision && (
                    <span className="badge" style={decisionStyle(r.decision)}>
                      {r.decision}
                    </span>
                  )}
                  {r.status === "done" && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                      {r.conviction != null && <>Conviction {r.conviction}/100 · </>}
                      CMP {rupee(r.currentPrice)}
                      {(r.fairValueLow != null || r.fairValueHigh != null) && (
                        <> · FV {rupee(r.fairValueLow)}–{rupee(r.fairValueHigh)}</>
                      )}
                    </span>
                  )}
                  {r.status === "error" && <span style={{ color: "var(--loss)", fontSize: 12 }}>Failed: {r.error}</span>}
                  {r.status === "running" && (
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{stale ? "Didn't finish — try again" : "Researching…"}</span>
                  )}
                  <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    {r.status === "done" && (
                      <button className="btn btn-sm btn-ghost" onClick={() => setOpenId(open ? null : r.id)}>
                        {open ? "Hide" : "Read"}
                      </button>
                    )}
                    {(r.status !== "running" || stale) && (
                      <button className="btn btn-sm btn-ghost" onClick={() => generate([r.symbol])} title="Generate a fresh report">
                        Refresh
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" onClick={() => remove(r.id)} title="Delete">
                      ✕
                    </button>
                  </span>
                </div>
                {r.status === "done" && r.summary && !open && (
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6 }}>{r.summary}</div>
                )}
                {open && r.reportMarkdown && (
                  <div style={{ padding: "16px 4px 6px" }}>
                    <Markdown source={r.reportMarkdown} />
                    {r.sources.length > 0 && (
                      <details style={{ marginTop: 12, fontSize: 11.5, color: "var(--text-muted)" }}>
                        <summary style={{ cursor: "pointer" }}>Sources ({r.sources.length})</summary>
                        <ul style={{ paddingLeft: 18, lineHeight: 1.6 }}>
                          {r.sources.map((s) => (
                            <li key={s}>
                              <a href={s} target="_blank" rel="noreferrer" style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>
                                {s}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 12, lineHeight: 1.6, maxWidth: 640 }}>
        Reports are AI-generated research from public sources and can contain errors. Check the key figures against the
        filings before acting. This is not investment advice.
      </p>
    </div>
  );
}
