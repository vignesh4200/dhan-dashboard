"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const sign = (n: number) => (n >= 0 ? "+" : "−");

export default function AlertsPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/portfolio").then((r) => {
      if (r.status === 401) return router.push("/login");
      return r.json();
    }).then((d) => d && setData(d));
  }, []);

  if (!data) return <div style={{ padding: "40px 0" }}>Loading…</div>;
  if (data.empty) return <div className="list-card"><p>{data.message}</p></div>;

  const alerts = data.holdings.filter((h: any) => h.pnlPct >= 7).sort((a: any, b: any) => b.pnlPct - a.pnlPct);
  const sellZone = alerts.filter((h: any) => h.pnlPct >= 8);
  const approaching = alerts.filter((h: any) => h.pnlPct >= 7 && h.pnlPct < 8);

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Profit-Booking Alerts</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
        Holdings at 7–8% profit are flagged "Approaching" · 8%+ are flagged "Target reached"
      </div>

      {alerts.length === 0 ? (
        <div className="list-card">
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No holdings have crossed the 7% profit threshold right now.</div>
        </div>
      ) : (
        <>
          {sellZone.length > 0 && (
            <div className="list-card" style={{ marginBottom: 16 }}>
              <div className="list-head"><div className="list-title" style={{ color: "var(--gain)" }}>Target reached (8%+)</div></div>
              {sellZone.map((h: any) => (
                <div key={h.symbol} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)", borderLeft: "3px solid var(--gain)", paddingLeft: 12 }}>
                  <span style={{ fontWeight: 600 }}>{h.symbol}</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--gain)" }}>+{h.pnlPct.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          )}
          {approaching.length > 0 && (
            <div className="list-card">
              <div className="list-head"><div className="list-title" style={{ color: "var(--amber)" }}>Approaching target (7–8%)</div></div>
              {approaching.map((h: any) => (
                <div key={h.symbol} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)", borderLeft: "3px solid var(--amber)", paddingLeft: 12 }}>
                  <span style={{ fontWeight: 600 }}>{h.symbol}</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--amber)" }}>+{h.pnlPct.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 24, fontSize: 12, color: "var(--text-muted)" }}>
        These same alerts are also sent to WhatsApp automatically (once configured) whenever a holding first crosses either threshold on a given day.
      </div>
    </div>
  );
}
