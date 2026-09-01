import { NextResponse } from "next/server";

// Route handlers cache outgoing fetch() calls by default under Next.js's
// Data Cache — a separate mechanism from the client-side Router Cache we
// already fixed in next.config.js. Without these two lines, this route
// could keep serving the same cached Google News response indefinitely.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  return match[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
}

export async function GET() {
  try {
    const query = encodeURIComponent("gold price India");
    const res = await fetch(
      `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`,
      { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
    );
    if (!res.ok) return NextResponse.json({ news: [] });

    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

    const parsed = items.map((block) => {
      const title = extractTag(block, "title");
      const link = extractTag(block, "link");
      const pubDate = extractTag(block, "pubDate");
      const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
      const source = sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim() : "Google News";
      const parsedDate = pubDate ? new Date(pubDate) : null;
      const when = parsedDate ? parsedDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
      return { headline: title, source, when, url: link, sortTime: parsedDate ? parsedDate.getTime() : 0 };
    });

    const sorted = parsed.sort((a, b) => b.sortTime - a.sortTime);
    const news = sorted.slice(0, 8).map(({ sortTime, ...rest }) => rest);

    return NextResponse.json({ news });
  } catch {
    return NextResponse.json({ news: [] });
  }
}