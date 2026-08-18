// Yahoo Finance's quoteSummary endpoints (used for sector, company name, and
// dividend data) require a session cookie + "crumb" token — Yahoo added this
// anti-scraping measure in 2023 and it's why those three features returned
// empty/wrong data while the chart/price endpoint (no auth needed) kept
// working fine throughout. This gets both via the documented two-step
// handshake and caches them in memory for reuse within a warm serverless
// instance, refreshing automatically if a request comes back Unauthorized.
//
// Caveat: this is based on the widely-documented community pattern for this
// handshake, not something testable from this build environment (no network
// access here) — if it still fails after deploying, the next debugging step
// is checking exactly what the cookie-fetch step returns.
let cached: { cookie: string; crumb: string } | null = null;

async function fetchSession(): Promise<{ cookie: string; crumb: string } | null> {
  try {
    // Step 1: hit a Yahoo endpoint to receive session cookies.
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "manual",
    });
    const getAll = (cookieRes.headers as any).getSetCookie;
    const rawCookies: string[] = typeof getAll === "function"
      ? getAll.call(cookieRes.headers)
      : [cookieRes.headers.get("set-cookie")].filter(Boolean) as string[];
    const cookie = rawCookies.map((c) => c.split(";")[0]).join("; ");
    if (!cookie) return null;

    // Step 2: exchange the cookie for a crumb (plain text response, not JSON).
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie },
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.toLowerCase().includes("<html")) return null;

    return { cookie, crumb };
  } catch {
    return null;
  }
}

async function getYahooSession(): Promise<{ cookie: string; crumb: string } | null> {
  if (cached) return cached;
  cached = await fetchSession();
  return cached;
}

function clearYahooSession() {
  cached = null;
}

// Fetches a Yahoo quoteSummary-family URL with the required cookie+crumb
// attached. Retries once with a fresh session if the first attempt comes
// back Unauthorized (session expired).
export async function fetchYahooAuthed(url: string): Promise<Response | null> {
  let session = await getYahooSession();
  if (!session) return null;

  const sep = url.includes("?") ? "&" : "?";
  let res = await fetch(`${url}${sep}crumb=${encodeURIComponent(session.crumb)}`, {
    headers: { "User-Agent": "Mozilla/5.0", Cookie: session.cookie },
  });

  if (res.status === 401) {
    clearYahooSession();
    session = await getYahooSession();
    if (!session) return null;
    res = await fetch(`${url}${sep}crumb=${encodeURIComponent(session.crumb)}`, {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: session.cookie },
    });
  }

  return res;
}
