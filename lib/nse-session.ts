// NSE India's own corporate-actions endpoint has the authoritative dividend
// data for Indian stocks (confirmed by comparing against Dhan's own app,
// which almost certainly pulls from the same source). This is genuinely
// experimental, though: NSE is known for aggressive anti-bot protection that
// can block requests from cloud/datacenter IPs (like Vercel's) even with a
// correctly-obtained cookie. If dividends stop showing up after this, that's
// very likely NSE blocking the request outright — worth checking directly
// via the raw URL, same way we diagnosed the Yahoo crumb issue.
let cachedCookie: string | null = null;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchNseCookie(): Promise<string | null> {
  try {
    const res = await fetch("https://www.nseindia.com/", {
      headers: { ...BROWSER_HEADERS, Accept: "text/html,application/xhtml+xml" },
    });
    const getAll = (res.headers as any).getSetCookie;
    const rawCookies: string[] = typeof getAll === "function"
      ? getAll.call(res.headers)
      : [res.headers.get("set-cookie")].filter(Boolean) as string[];
    const cookie = rawCookies.map((c) => c.split(";")[0]).join("; ");
    return cookie || null;
  } catch {
    return null;
  }
}

async function getNseCookie(): Promise<string | null> {
  if (cachedCookie) return cachedCookie;
  cachedCookie = await fetchNseCookie();
  return cachedCookie;
}

export async function fetchNseAuthed(url: string): Promise<Response | null> {
  let cookie = await getNseCookie();
  if (!cookie) return null;

  const headers = {
    ...BROWSER_HEADERS,
    Accept: "application/json",
    Referer: "https://www.nseindia.com/companies-listing/corporate-filings-actions",
    Cookie: cookie,
  };

  let res = await fetch(url, { headers });
  if (res.status === 401 || res.status === 403) {
    cachedCookie = null;
    cookie = await getNseCookie();
    if (!cookie) return null;
    res = await fetch(url, { headers: { ...headers, Cookie: cookie } });
  }
  return res;
}
