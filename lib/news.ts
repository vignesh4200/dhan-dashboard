// Free news lookup via Yahoo Finance's public (unofficial, undocumented) search
// endpoint — no API key needed. Like the price feed, this could change or get
// rate-limited without notice, but works well for a handful of holdings on a
// personal dashboard.
export type NewsItem = {
  symbol: string;
  headline: string;
  source: string;
  when: string;
  url: string;
};

export async function getNewsForSymbols(symbols: string[]): Promise<NewsItem[]> {
  const items: NewsItem[] = [];

  await Promise.all(
    symbols.slice(0, 8).map(async (symbol) => {
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}.NS&newsCount=2`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (!res.ok) return;
        const data = await res.json();
        for (const n of data?.news || []) {
          items.push({
            symbol,
            headline: n.title,
            source: n.publisher || "Unknown",
            when: n.providerPublishTime
              ? new Date(n.providerPublishTime * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
              : "",
            url: n.link,
          });
        }
      } catch {}
    })
  );

  return items.slice(0, 10);
}
