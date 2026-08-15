"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const inr = (n: number, d = 0) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n >= 0 ? "+" : "−");

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [closedTrades, setClosedTrades] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/portfolio").then((r) => {
      if (r.status === 401) return router.push("/login");
      return r.json();
    }).then((d) => {
      if (!d || d.empty) { setLoaded(true); return; }
      Promise.all([
        fetch("/api/orders").then((r) => r.json()),
        fetch("/api/trades").then((r) => r.json()),
      ]).then(([o, t]) => {
        setOrders(o.orders || []);
        setClosedTrades(t.closedTrades || []);
        setLoaded(true);
      });
    });
  }, []);

  if (!loaded) return <div style={{ padding: "40px 0" }}>Loading…</div>;

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Orders</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>Today's activity, live from Dhan</div>

      <div className="list-card">
        <div className="list-head"><div className="list-title">Today's Orders</div></div>
        {orders.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No orders placed today.</div>
        ) : (
          orders.map((o, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: i < orders.length - 1 ? "1px solid var(--border)" : "none" }}>
              <div>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 7px", borderRadius: 5, marginRight: 8, color: o.transactionType === "BUY" ? "var(--gain)" : "var(--loss)", background: o.transactionType === "BUY" ? "var(--gain-soft)" : "var(--loss-soft)" }}>{o.transactionType}</span>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{o.tradingSymbol}</span>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{o.orderStatus}</div>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-muted)" }}>{o.quantity} @ {o.price}</div>
            </div>
          ))
        )}
      </div>

      <div className="list-card" style={{ marginTop: 18, marginBottom: 40 }}>
        <div className="list-head">
          <div className="list-title">Closed Trades (today)</div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -8, marginBottom: 14 }}>
          Same-day buy/sell matches only — see code comments for extending to full trade history.
        </div>
        {closedTrades.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No same-day closed trades yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 11.5 }}>
                <th style={{ textAlign: "left", paddingBottom: 10 }}>Stock</th>
                <th>Qty</th><th>Entry</th><th>Exit</th><th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {closedTrades.map((t, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 0", fontWeight: 600 }}>{t.symbol}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{t.qty}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{t.entry.toFixed(2)}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{t.exit.toFixed(2)}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: t.pnl >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(t.pnl)}{inr(Math.abs(t.pnl))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
