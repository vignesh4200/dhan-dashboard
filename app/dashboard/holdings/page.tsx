"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const inr = (n: number, d = 0) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n >= 0 ? "+" : "−");

export default function HoldingsPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [sortKey, setSortKey] = useState<"pnlPct" | "current" | "symbol">("pnlPct");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/portfolio").then((r) => {
      if (r.status === 401) return router.push("/login");
      return r.json();
    }).then((d) => d && setData(d));
  }, []);

  if (!data) return <div style={{ padding: "40px 0" }}>Loading…</div>;
  if (data.empty) return <div className="list-card"><p>{data.message}</p></div>;

  let holdings = [...data.holdings];
  if (query) holdings = holdings.filter((h) => h.symbol.toLowerCase().includes(query.toLowerCase()));
  holdings.sort((a, b) => {
    if (sortKey === "symbol") return a.symbol.localeCompare(b.symbol);
    return b[sortKey] - a[sortKey];
  });

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Holdings</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>{data.holdings.length} positions · {inr(data.total_current, 2)} total value</div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input
          placeholder="Search symbol…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="field-input"
          style={{ maxWidth: 220 }}
        />
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)} className="field-input" style={{ maxWidth: 180 }}>
          <option value="pnlPct">Sort by P&amp;L %</option>
          <option value="current">Sort by value</option>
          <option value="symbol">Sort by symbol</option>
        </select>
      </div>

      <div className="list-card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 11.5 }}>
              <th style={{ textAlign: "left", paddingBottom: 10 }}>Stock</th>
              <th>Qty</th><th>Avg</th><th>LTP</th><th>Value</th><th>P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.symbol} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "11px 0", fontWeight: 600 }}>{h.symbol}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.qty}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.avg.toFixed(2)}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.ltp.toFixed(2)}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{inr(h.current)}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: h.pnl >= 0 ? "var(--gain)" : "var(--loss)" }}>
                  {sign(h.pnl)}{inr(Math.abs(h.pnl))} ({h.pnlPct.toFixed(1)}%)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
