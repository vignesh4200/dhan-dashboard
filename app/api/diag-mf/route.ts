import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
// TEMPORARY diagnostic (preview branch only): which public sources return MF portfolio holdings from Vercel.
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", Accept: "application/json" };
async function probe(url: string) {
  try {
    const r = await fetch(url, { headers: UA, cache: "no-store" });
    const t = await r.text();
    return { url, status: r.status, len: t.length, head: t.slice(0, 1500) };
  } catch (e: any) { return { url, error: e.message }; }
}
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("t") !== "e3ef1f45dbab8ade00cfda15") return NextResponse.json({ error: "no" }, { status: 401 });
  const step = req.nextUrl.searchParams.get("u");
  if (step) return NextResponse.json(await probe(step));
  const out = await Promise.all([
    probe("https://groww.in/v1/api/search/v1/entity?app=false&page=0&q=axis%20elss%20tax%20saver&size=5"),
    probe("https://mfdata.in/api/v1/schemes/120503"),
    probe("https://mfdata.in/api/v1/schemes/120503/holdings"),
    probe("https://api.kuvera.in/mf/api/v5/fund_schemes/120503.json"),
    probe("https://api.mfapi.in/mf/120503/latest"),
  ]);
  return NextResponse.json(out);
}
