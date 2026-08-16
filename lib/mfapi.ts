// Free, no-auth public API for Indian mutual fund data — confirmed reliable
// via multiple independent sources. Docs: https://www.mfapi.in/docs/
const BASE_URL = "https://api.mfapi.in";

export type MfSchemeCandidate = { schemeCode: number; schemeName: string };

export async function searchMfSchemes(query: string): Promise<MfSchemeCandidate[]> {
  const res = await fetch(`${BASE_URL}/mf/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data.slice(0, 5) : [];
}

export async function getLatestNav(schemeCode: string | number): Promise<number | null> {
  const res = await fetch(`${BASE_URL}/mf/${schemeCode}/latest`);
  if (!res.ok) return null;
  const data = await res.json();
  const nav = data?.data?.[0]?.nav;
  return nav ? parseFloat(nav) : null;
}
