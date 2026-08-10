"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const inr = (n: number, d = 0) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n >= 0 ? "+" : "−");

type Holding = { symbol: string; qty: number; avg: number; ltp: number; current: number; pnl: number; pnlPct: number };
type Snapshot = {
  empty?: boolean;
  message?: string;
  captured_at: string;
  holdings: Holding[];
  total_invested: number;
  total_current: number;
  total_pnl: number;
  day_pnl: number;
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Snapshot | null>(null);

  async function load() {
    const res = await fetch("/api/portfolio");
    if (res.status === 401) return router.push("/login");
    setData(await res.json());
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // poll every minute; data itself refreshes server-side every 15 min
    return () => clearInterval(id);
  }, []);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  if (!data) return <div className="wrap" style={{ paddingTop: 60 }}>Loading…</div>;

  if (data.empty) {
    return (
      <div className="wrap" style={{ paddingTop: 60 }}>
        <div className="panel">
          <p>{data.message}</p>
          <a className="btn" style={{ display: "inline-block", width: "auto", padding: "10px 18px", textDecoration: "none" }} href="/settings">
            Go to Settings
          </a>
        </div>
      </div>
    );
  }

  const totalPnlPct = (data.total_pnl / data.total_invested) * 100;
  const alerts = data.holdings.filter((h) => h.pnlPct >= 7).sort((a, b) => b.pnlPct - a.pnlPct);

  return (
    <div className="wrap" style={{ paddingTop: 34 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 20, borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 600 }}>Portfolio</div>
        <div style={{ display: "flex", gap: 10 }}>
          <a href="/settings" style={{ fontSize: 13, color: "var(--text-muted)", textDecoration: "none" }}>Settings</a>
          <button onClick={logout} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>Log out</button>
        </div>
      </header>

      <section className="panel" style={{ marginTop: 24 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Portfolio Value</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 38, fontWeight: 600, marginTop: 10 }}>{inr(data.total_current, 2)}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <span className={`badge ${totalPnlPct >= 0 ? "up" : "down"}`}>{sign(totalPnlPct)}{Math.abs(totalPnlPct).toFixed(2)}%</span>
          <span className={`badge ${data.day_pnl >= 0 ? "up" : "down"}`}>Day {sign(data.day_pnl)}{inr(Math.abs(data.day_pnl))}</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10, fontFamily: "var(--font-mono)" }}>
          Last synced {new Date(data.captured_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · updates every 15 min
        </div>
      </section>

      {alerts.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, marginBottom: 12 }}>Profit-booking alerts</div>
          <div className="panel" style={{ display: "grid", gap: 10 }}>
            {alerts.map((h) => (
              <div key={h.symbol} style={{ display: "flex", justifyContent: "space-between", borderLeft: `3px solid ${h.pnlPct >= 8 ? "var(--gain)" : "var(--amber)"}`, paddingLeft: 12 }}>
                <span style={{ fontWeight: 600 }}>{h.symbol}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--gain)" }}>+{h.pnlPct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginTop: 28 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, marginBottom: 12 }}>Holdings</div>
        <div className="panel" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 11.5 }}>
                <th style={{ textAlign: "left", paddingBottom: 10 }}>Stock</th>
                <th>Qty</th><th>Avg</th><th>LTP</th><th>Value</th><th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h) => (
                <tr key={h.symbol} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 0", fontWeight: 600 }}>{h.symbol}</td>
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
      </section>
    </div>
  );
}
