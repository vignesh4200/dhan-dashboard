// OpenBB Open Data Platform (ODP) integration — optional, self-hosted.
//
// This is NOT a hosted API OpenBB runs for you. It calls a REST server YOU
// deploy from the open-source `openbb` Python package (pip install openbb,
// then run `openbb-api`) — e.g. on a free Render/Railway instance, a VM, or
// locally while testing. Point this app at that deployment.
//
// Env vars (set in Vercel or .env):
//   OPENBB_API_URL — base URL of your ODP REST server, e.g. https://your-openbb.onrender.com
//   OPENBB_API_KEY — optional, only if your deployment requires a bearer token
//
// NOTE: the ODP route paths below (equity/price/quote, news/company) follow
// OpenBB's documented router naming pattern, but the platform evolves fast —
// once you have your own server running, hit its /docs (FastAPI Swagger UI)
// page and adjust the paths here if yours differ.
// VERIFIED 2026-08-25: /api/v1/equity/price/quote and /api/v1/news/company
// both confirmed working against the live self-hosted OpenBB server.

const BASE_URL = process.env.OPENBB_API_URL;
const API_KEY = process.env.OPENBB_API_KEY;

export const openbbConfigured = () => Boolean(BASE_URL);

async function openbbFetch(path: string, params: Record<string, string> = {}) {
    if (!BASE_URL) return null;
    try {
          const url = new URL(path, BASE_URL);
          Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
          const res = await fetch(url.toString(), {
                  headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
                  signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) return null;
          return await res.json();
    } catch {
          return null;
    }
}

export type OpenbbQuote = {
    symbol: string;
    price: number | null;
    changePercent: number | null;
    name: string | null;
};

// Equity quote — mirrors ODP's equity/price/quote router.
export async function getQuotes(symbols: string[]): Promise<OpenbbQuote[]> {
    if (!symbols.length) return [];
    const data = await openbbFetch("/api/v1/equity/price/quote", {
          symbol: symbols.join(","),
          provider: "yfinance",
    });
    const rows = data?.results ?? data ?? [];
    if (!Array.isArray(rows)) return [];
    return rows.map((r: any) => ({
          symbol: r.symbol ?? r.ticker ?? "",
          price: r.last_price ?? r.price ?? null,
          changePercent: r.change_percent ?? r.changesPercentage ?? null,
          name: r.name ?? null,
    }));
}

// Company news/sentiment — mirrors ODP's news/company router, trimmed down.
export async function getCompanySentiment(symbol: string) {
    const data = await openbbFetch("/api/v1/news/company", {
          symbol,
          provider: "yfinance",
          limit: "5",
    });
    const rows = data?.results ?? data ?? [];
    if (!Array.isArray(rows)) return [];
    return rows.map((r: any) => ({
          title: r.title ?? "",
          date: r.date ?? "",
          url: r.url ?? "",
    }));
}
