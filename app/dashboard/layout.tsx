"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { sectorFor } from "@/lib/sectors";

const sign = (n: number) => (n >= 0 ? "+" : "−");

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [holdings, setHoldings] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/portfolio")
      .then((r) => r.json())
      .then((d) => { if (!d.empty) setHoldings(d.holdings || []); });
  }, []);

  const navItems = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/dashboard/holdings", label: "Holdings" },
    { href: "/dashboard/mutual-funds", label: "Mutual Funds" },
    { href: "/dashboard/orders", label: "Orders" },
    { href: "/dashboard/alerts", label: "Alerts" },
    { href: "/settings", label: "Settings" },
  ];

  const sectorTotals: Record<string, number> = {};
  let sectorSum = 0;
  holdings.forEach((h) => {
    const sec = sectorFor(h.symbol);
    sectorTotals[sec] = (sectorTotals[sec] || 0) + h.current;
    sectorSum += h.current;
  });
  const topSectors = Object.entries(sectorTotals).sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <>
      {holdings.length > 0 && (
        <div className="marquee-wrap">
          <div className="marquee-track">
            {[...holdings, ...holdings].map((h, i) => (
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
