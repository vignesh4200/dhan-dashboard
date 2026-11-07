"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

const sign = (n: number) => (n >= 0 ? "+" : "−");

// Line icons for the sidebar (Private Banking theme, Nov 2026).
const ICONS: Record<string, string> = {
  "/dashboard": '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  "/dashboard/holdings": '<path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/>',
  "/dashboard/mutual-funds": '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 5"/>',
  "/dashboard/gold": '<path d="M5 18h14l-2-6H7z"/><path d="M8 12l1.5-5h5L16 12"/>',
  "/dashboard/dividends": '<path d="M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6"/>',
  "/dashboard/signals": '<path d="M3 12h4l3 7 4-14 3 7h4"/>',
  "/dashboard/analyst-desk": '<path d="M4 20V10l8-6 8 6v10"/><path d="M9 20v-6h6v6"/>',
  "/dashboard/pnl": '<path d="M4 4v16h16"/><path d="M7 14l4-4 3 3 5-6"/>',
  "/dashboard/orders": '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  "/dashboard/alerts": '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  "/settings": '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
};
function NavIcon({ href }: { href: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[href] || "" }} />
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [holdings, setHoldings] = useState<any[]>([]);
  const [mfTotal, setMfTotal] = useState(0);
  const [goldTotal, setGoldTotal] = useState(0);

  useEffect(() => {
    fetch("/api/portfolio")
      .then((r) => r.json())
      .then((d) => { if (!d.empty) setHoldings(d.holdings || []); });
    fetch("/api/mutual-funds")
      .then((r) => r.json())
      .then((d) => setMfTotal((d.holdings || []).reduce((s: number, h: any) => s + (h.currentValue ?? 0), 0)));
    fetch("/api/gold")
      .then((r) => r.json())
      .then((d) => setGoldTotal((d.holdings || []).reduce((s: number, h: any) => s + (h.currentValue ?? 0), 0)));
  }, []);

  const navItems = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/dashboard/holdings", label: "Holdings" },
    { href: "/dashboard/mutual-funds", label: "Mutual Funds" },
    { href: "/dashboard/gold", label: "Gold" },
    { href: "/dashboard/dividends", label: "Dividends" },
    { href: "/dashboard/signals", label: "Smart Signals" },
    { href: "/dashboard/analyst-desk", label: "Analyst Desk" },
    { href: "/dashboard/pnl", label: "Realized P&L" },
    { href: "/dashboard/orders", label: "Orders" },
    { href: "/dashboard/alerts", label: "Alerts" },
    { href: "/settings", label: "Settings" },
  ];

  const stocksTotal = holdings.reduce((s, h) => s + (h.current ?? 0), 0);
  const assetSum = stocksTotal + mfTotal + goldTotal;

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
        <nav className="dash-sidebar" aria-label="Main">
          <div className="dash-logo">
            <div className="dash-logo-text">Dhan Vault</div>
            <div className="dash-logo-sub">Portfolio dashboard</div>
          </div>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`dash-nav-item ${pathname === item.href ? "active" : ""}`}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              <NavIcon href={item.href} />
              {item.label}
            </Link>
          ))}

          {assetSum > 0 && (mfTotal > 0 || goldTotal > 0) && (
            <>
              <div className="dash-sidebar-section">Asset mix</div>
              <div className="dash-holding-row"><span>Stocks (Dhan)</span><span>{((stocksTotal / assetSum) * 100).toFixed(0)}%</span></div>
              {mfTotal > 0 && <div className="dash-holding-row"><span>Mutual Funds (Groww)</span><span>{((mfTotal / assetSum) * 100).toFixed(0)}%</span></div>}
              {goldTotal > 0 && <div className="dash-holding-row"><span>Gold (IBJA)</span><span>{((goldTotal / assetSum) * 100).toFixed(0)}%</span></div>}
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
        </nav>

        <div className="dash-main">{children}</div>
      </div>
    </>
  );
}
