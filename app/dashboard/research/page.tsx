"use client";
import { useEffect, useState } from "react";

export default function ResearchPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/research").then((r) => r.json()).then(setData);
  }, []);

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Research</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
        Powered by OpenBB (self-hosted)
      </div>

      {!data && <div style={{ padding: "40px 0" }}>Loading…</div>}

      {data && !data.configured && (
        <div className="list-card">
          <p>OpenBB isn&apos;t connected yet.</p>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Deploy the open-source OpenBB ODP REST server (pip install openbb, then
            run openbb-api) anywhere free — Render, Railway, or your own machine —
            and set OPENBB_API_URL (and OPENBB_API_KEY if needed) in this project&apos;s
            environment variables. See README.md for the full walkthrough.
          </p>
        </div>
      )}

      {data && data.configured && (
        <>
          <div className="list-card" style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Quotes</div>
            {data.quotes.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No quote data returned yet.</p>}
            {data.quotes.map((q: any) => (
              <div className="dash-holding-row" key={q.symbol}>
                <span>{q.name || q.symbol}</span>
                <span style={{ color: (q.changePercent ?? 0) >= 0 ? "var(--gain)" : "var(--loss)" }}>
                  {q.price != null ? q.price.toFixed(2) : "—"}
                  {q.changePercent != null ? ` (${q.changePercent.toFixed(1)}%)` : ""}
                </span>
              </div>
            ))}
          </div>

          <div className="list-card">
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Company news</div>
            {data.sentiment.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No news returned yet.</p>}
            {data.sentiment.map((entry: any) => (
              <div key={entry.symbol} style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{entry.symbol}</div>
                {entry.items.map((item: any, i: number) => (
                  <a key={i} href={item.url} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 13, marginBottom: 4, color: "var(--text)" }}>
                    {item.title}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
