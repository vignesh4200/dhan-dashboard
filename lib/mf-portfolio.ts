// Mutual fund look-through data.
//
// Portfolio (which stocks/bonds each fund holds, % of fund) comes from
// Groww's public fund-page API, the same data its website shows. This is
// unofficial: confirmed working from Vercel in Oct 2026 (search API returns
// the fund's search_id, the scheme API returns `holdings` with company_name,
// sector_name, corpus_per, nature_name, portfolio_date). Funds disclose
// portfolios monthly, so results are cached in mf_portfolio_cache and only
// refetched after a week; if Groww stops answering, the last cached copy is
// used.
//
// NAV history comes from mfapi.in (full daily history per AMFI scheme code).
import { supabaseAdmin } from "./supabaseAdmin";

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
};
const REFRESH_AFTER_MS = 7 * 86400000;

export type FundHolding = {
  name: string;
  sector: string;
  pct: number; // % of the fund's assets
  nature: string; // EQUITY / DEBT / CASH / ...
  instrument: string;
};

export type FundPortfolio = {
  schemeCode: string;
  portfolioDate: string | null;
  holdings: FundHolding[];
  expenseRatio: number | null;
  aumCr: number | null;
  fetchedAt: string | null;
  stale: boolean; // true when Groww failed and an old cached copy is shown
};

function cleanQuery(name: string): string {
  return name
    .replace(/\b(direct|regular)\b.*$/i, "")
    .replace(/[-–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function findGrowwSearchId(schemeCode: string, schemeName: string): Promise<string | null> {
  const queries = [cleanQuery(schemeName), schemeName.split(/\s+/).slice(0, 3).join(" ")];
  for (const q of queries) {
    try {
      const res = await fetch(
        `https://groww.in/v1/api/search/v1/entity?app=false&page=0&q=${encodeURIComponent(q)}&size=10`,
        { headers: UA, cache: "no-store" }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const hit = (data?.content || []).find((c: any) => String(c.scheme_code) === String(schemeCode) && c.search_id);
      if (hit) return hit.search_id;
    } catch {}
  }
  return null;
}

async function fetchFromGroww(searchId: string) {
  const res = await fetch(`https://groww.in/v1/api/data/mf/web/v4/scheme/search/${encodeURIComponent(searchId)}`, {
    headers: UA,
    cache: "no-store",
  });
  if (!res.ok) return null;
  const d = await res.json();
  const holdings: FundHolding[] = (d?.holdings || [])
    .map((h: any) => ({
      name: String(h.company_name || "").trim(),
      sector: String(h.sector_name || "Unspecified"),
      pct: Number(h.corpus_per) || 0,
      nature: String(h.nature_name || "OTHER").toUpperCase(),
      instrument: String(h.instrument_name || ""),
    }))
    .filter((h: FundHolding) => h.name && h.pct > 0);
  const rawDate = d?.holdings?.[0]?.portfolio_date;
  // Groww stores the month-end date as midnight IST in UTC (e.g. 2026-09-29T18:30Z = 30 Sep).
  const portfolioDate = rawDate
    ? new Date(new Date(rawDate).getTime() + 5.5 * 3600000).toISOString().slice(0, 10)
    : null;
  return {
    holdings,
    portfolioDate,
    expenseRatio: d?.expense_ratio != null ? Number(d.expense_ratio) : null,
    aumCr: d?.aum != null ? Number(d.aum) : null,
  };
}

export async function getFundPortfolio(schemeCode: string, schemeName: string): Promise<FundPortfolio> {
  const { data: cached } = await supabaseAdmin
    .from("mf_portfolio_cache")
    .select("*")
    .eq("scheme_code", schemeCode)
    .maybeSingle();

  const fresh = cached && Date.now() - new Date(cached.fetched_at).getTime() < REFRESH_AFTER_MS;
  const fromCache = (stale: boolean): FundPortfolio => ({
    schemeCode,
    portfolioDate: cached?.portfolio_date ?? null,
    holdings: (cached?.holdings as FundHolding[]) || [],
    expenseRatio: cached?.meta?.expenseRatio ?? null,
    aumCr: cached?.meta?.aumCr ?? null,
    fetchedAt: cached?.fetched_at ?? null,
    stale,
  });
  if (fresh) return fromCache(false);

  try {
    const searchId = cached?.search_id || (await findGrowwSearchId(schemeCode, schemeName));
    if (searchId) {
      const g = await fetchFromGroww(searchId);
      if (g && g.holdings.length > 0) {
        const fetchedAt = new Date().toISOString();
        await supabaseAdmin.from("mf_portfolio_cache").upsert({
          scheme_code: schemeCode,
          search_id: searchId,
          portfolio_date: g.portfolioDate,
          holdings: g.holdings,
          meta: { expenseRatio: g.expenseRatio, aumCr: g.aumCr },
          fetched_at: fetchedAt,
        });
        return { schemeCode, portfolioDate: g.portfolioDate, holdings: g.holdings, expenseRatio: g.expenseRatio, aumCr: g.aumCr, fetchedAt, stale: false };
      }
    }
  } catch {}

  return fromCache(Boolean(cached));
}

// Daily NAV history, oldest first, as [YYYY-MM-DD, nav].
export async function getNavHistory(schemeCode: string): Promise<[string, number][]> {
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}`, {
      next: { revalidate: 6 * 3600 },
    } as any);
    if (!res.ok) return [];
    const d = await res.json();
    const out: [string, number][] = [];
    for (const row of d?.data || []) {
      const m = String(row.date || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
      const nav = parseFloat(row.nav);
      if (m && !isNaN(nav) && nav > 0) out.push([`${m[3]}-${m[2]}-${m[1]}`, nav]);
    }
    out.sort((a, b) => a[0].localeCompare(b[0]));
    return out;
  } catch {
    return [];
  }
}
