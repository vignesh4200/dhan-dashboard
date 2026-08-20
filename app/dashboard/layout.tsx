"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

const sign = (n: number) => (n >= 0 ? "+" : "−");

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [holdings, setHoldings] = useState<any[]>([]);
  const [mfTotal, setMfTotal] = useState(0);

  useEffect(() => {
    fetch("/api/portfolio")
      .then((r) => r.json())
      .then((d) => { if (!d.empty) setHoldings(d.holdings || []); });
    fetch("/api/mutual-funds")
      .then((r) => r.json())
      .then((d) => setMfTotal((d.holdings || []).reduce((s: number, h: any) => s + (h.currentValue ?? 0), 0)));
  }, []);

  const navItems = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/dashboard/holdings", label: "Holdings" },
    { href: "/dashboard/mutual-funds", label: "Mutual Funds" },
    { href: "/dashboard/orders", label: "Orders" },
    { href: "/dashboard/alerts", label: "Alerts" },
    { href: "/settings", label: "Settings" },
  ];

  const stocksTotal = holdings.reduce((s, h) => s + (h.current ?? 0), 0);
  const assetSum = stocksTotal + mfTotal;

  const sectorTotals: Record<string, number> = {};
  let sectorSum = 0;
  holdings.forEach((h) => {
    const sec = h.sector || "Other";
    sectorTotals[sec] = (sectorTotals[sec] || 0) + h.current;
    sectorSum += h.current;
  });
  const topSectors = Object.entries(sectorTotals).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const marqueeHoldings = [...holdings].sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));

  return (
    <>
      {holdings.length > 0 && (
        <div className="marquee-wrap">
          <div className="marquee-track">
            {[...marqueeHoldings, ...marqueeHoldings].map((h, i) => (
              <span className="marquee-item" key={i}>
                <span style={{ color: "var(--text-muted)" }}>{h.symbol}</span>
                <span style={{ fontWeight: 600 }}>{h.ltp.toFixed(2)}</span>
                <span style={{ color: h.pnlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>
                  {sign(h.pnlPct)}{Math.abs(h.pnlPct).toFixed(1)}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="dash-shell">
        <div className="dash-sidebar">
          <div className="dash-logo">
            <div className="dash-logo-mark" />
            <div className="dash-logo-text">Portfolio</div>
          </div>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`dash-nav-item ${pathname === item.href ? "active" : ""}`}
            >
              <span className="dash-nav-dot" />
              {item.label}
            </Link>
          ))}

          {assetSum > 0 && mfTotal > 0 && (
            <>
              <div className="dash-sidebar-section">Asset mix</div>
              <div className="dash-holding-row"><span>Stocks (Dhan)</span><span>{((stocksTotal / assetSum) * 100).toFixed(0)}%</span></div>
              <div className="dash-holding-row"><span>Mutual Funds (Groww)</span><span>{((mfTotal / assetSum) * 100).toFixed(0)}%</span></div>
            </>
          )}

          {topSectors.length > 0 && (
            <>
              <div className="dash-sidebar-section">Sector exposure</div>
              {topSectors.map(([sec, val]) => (
                <div className="dash-holding-row" key={sec}>
                  <span>{sec}</span>
                  <span>{((val / sectorSum) * 100).toFixed(0)}%</span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="dash-main">{children}</div>
      </div>
    </>
  );
}
