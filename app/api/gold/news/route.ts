import { NextResponse } from "next/server";

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
      { headers: { "User-Agent": "Mozilla/5.0" } }
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

    // Sort by actual publish date, most recent first — Google News RSS
    // doesn't guarantee strict chronological order on its own.
    const sorted = parsed.sort((a, b) => b.sortTime - a.sortTime);
    const news = sorted.slice(0, 8).map(({ sortTime, ...rest }) => rest);

    return NextResponse.json({ news });
  } catch {
    return NextResponse.json({ news: [] });
  }
}