"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Markdown from "./Markdown";

type Report = {
  id: number;
  symbol: string;
  company: string | null;
  status: "queued" | "running" | "done" | "error";
  decision: string | null;
  conviction: number | null;
  currentPrice: number | null;
  fairValueLow: number | null;
  fairValueHigh: number | null;
  horizon: string | null;
  summary: string | null;
  reportMarkdown: string | null;
  sources: string[];
  error: string | null;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
};

// How often to re-check while reports are queued or being researched.
const POLL_MS = 20 * 1000;
// The routine re-claims a 'running' row after an hour, so past that it's stuck.
const STALE_MS = 70 * 60 * 1000;

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
  const [routineConfigured, setRoutineConfigured] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const seenDone = useRef<Set<number> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/analyst-desk/reports");
      if (r.status === 401) return router.push("/login");
      const d = await r.json();
      if (d.error) return setLoadError(d.error);
      setLoadError(null);
      const list: Report[] = d.reports || [];
      // Auto-open a report that just finished while you were watching.
      const done = list.filter((x) => x.status === "done").map((x) => x.id);
      if (seenDone.current) {
        const fresh = done.find((id) => !seenDone.current!.has(id));
        if (fresh != null) setOpenId(fresh);
      }
      seenDone.current = new Set(done);
      setReports(list);
      setSuggestions(d.suggestions || { holdings: [], watchlist: [] });
      setRoutineConfigured(d.routineConfigured !== false);
    } catch (e) {
      setLoadError(String(e));
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const inFlight = (reports || []).some((r) => r.status === "queued" || r.status === "running");
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [inFlight, load]);

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

  const generate = async (symbols: string[]) => {
    if (symbols.length === 0) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/analyst-desk/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(d.error || `request failed (${res.status})`);
        return;
      }
      const parts: string[] = [];
      if (d.queued?.length) {
        parts.push(
          d.fired
            ? `Queued ${d.queued.length} — the desk has started. Reports usually land in 5–15 minutes; this page updates by itself.`
            : `Queued ${d.queued.length}, but the routine couldn't be started automatically${d.fireError ? ` (${d.fireError})` : ""}. Open claude.ai/code/routines and click Run now on “Analyst Desk — on-demand reports”.`
        );
      }
      if (d.skipped?.alreadyQueued?.length) parts.push(`Already in progress: ${d.skipped.alreadyQueued.join(", ")}.`);
      if (d.skipped?.invalid?.length) parts.push(`Not found on NSE: ${d.skipped.invalid.join(", ")}.`);
      setNotice(parts.join(" "));
      setSelected([]);
      await load();
    } finally {
      setSubmitting(false);
    }
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

  const visibleReports = reports || [];

  return (
    <div style={{ marginBottom: 32 }}>
      <div className="list-card" style={{ marginBottom: 18 }}>
        <div className="list-head">
          <div className="list-title">Request a desk report</div>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 14, lineHeight: 1.6 }}>
          Pick the stocks you want researched. The desk reads the latest filings, results, valuation and news, then writes
          an investment-committee memo that ends in a Buy / Accumulate / Hold / Avoid / Sell decision. Runs on your Claude
          subscription through a Claude Code routine; a batch usually takes 5–15 minutes.
        </div>

        {!routineConfigured && (
          <div className="auth-note" style={{ marginTop: 0, marginBottom: 12 }}>
            Auto-start isn&apos;t set up yet (DESK_ROUTINE_FIRE_URL / DESK_ROUTINE_TOKEN). Requests will wait in the queue
            until you click Run now on the routine at claude.ai/code/routines.
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
            disabled={selected.length === 0 || submitting}
            style={{ opacity: selected.length === 0 || submitting ? 0.5 : 1 }}
            onClick={() => generate(selected)}
          >
            {submitting ? "Queuing…" : "Generate"} {selected.length > 0 ? `${selected.length} report${selected.length > 1 ? "s" : ""}` : "reports"}
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
        {notice && <div className="auth-note">{notice}</div>}
      </div>

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
            const stale = r.status === "running" && Date.now() - new Date(r.claimedAt || r.createdAt).getTime() > STALE_MS;
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
                  {r.status === "queued" && <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Queued — waiting for the desk</span>}
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
                    {(r.status === "done" || r.status === "error" || stale) && (
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
