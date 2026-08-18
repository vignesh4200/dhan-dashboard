// News via Google News RSS — a stable, well-established public feed format.
// Searches by real company name (resolved via getCompanyName), not raw
// ticker symbol — searching "MAMATA" or "PGEL" as a bare keyword produced
// loosely-matched, sometimes wrong results, since real articles don't use
// ticker symbols in their text.
import { getCompanyName } from "./yahoo-profile";

export type NewsItem = {
  symbol: string;
  headline: string;
  source: string;
  when: string;
  url: string;
};

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  return match[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
}

async function getNewsForOneSymbol(symbol: string): Promise<NewsItem[]> {
  try {
    const companyName = await getCompanyName(symbol);
    // Unquoted — Google News' natural relevance matching across the company
    // name's words. An earlier version used a strict quoted exact phrase,
    // which returned zero results for most holdings since real headlines
    // rarely repeat a company's full legal name verbatim.
    const query = encodeURIComponent(companyName);
    const res = await fetch(
      `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return [];
    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

    return items.slice(0, 2).map((block) => {
      const title = extractTag(block, "title");
      const link = extractTag(block, "link");
      const pubDate = extractTag(block, "pubDate");
      const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
      const source = sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim() : "Google News";
      const when = pubDate ? new Date(pubDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
      return { symbol, headline: title, source, when, url: link };
    });
  } catch {
    return [];
  }
}

export async function getNewsForSymbols(symbols: string[]): Promise<NewsItem[]> {
  const unique = [...new Set(symbols)];
  const results = await Promise.all(unique.map(getNewsForOneSymbol));
  return results.flat().slice(0, 15);
}
