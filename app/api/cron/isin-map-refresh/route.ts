import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchDhanScanXAllEquities } from "@/lib/dhan-scanx";

// Run this occasionally (weekly is plenty — ISIN/symbol mappings rarely
// change) to (re)build the complete isin_symbol_map table. On first run,
// check the response carefully — the exact field names/shape from Dhan's
// ScanX endpoint weren't confirmed ahead of time, so this surfaces a raw
// sample alongside whatever it managed to parse.
//   GET https://your-app.vercel.app/api/cron/isin-map-refresh?secret=YOUR_CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const raw = await fetchDhanScanXAllEquities();

    // Try a few plausible shapes for where the row list might live.
    const rows: any[] =
      raw?.data?.data ||
      raw?.data ||
      raw?.result ||
      (Array.isArray(raw) ? raw : []);

    const sample = rows[0] || null;

    let inserted = 0;
    const upsertRows = rows
      .map((r) => ({
        isin: r.Isin || r.isin,
        symbol: r.Sym || r.sym || r.symbol,
        display_name: r.DispSym || r.dispSym || r.displayName || null,
        updated_at: new Date().toISOString(),
      }))
      .filter((r) => r.isin && r.symbol);

    if (upsertRows.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < upsertRows.length; i += batchSize) {
        const batch = upsertRows.slice(i, i + batchSize);
        const { error } = await supabaseAdmin.from("isin_symbol_map").upsert(batch, { onConflict: "isin" });
        if (!error) inserted += batch.length;
      }
    }

    return NextResponse.json({
      ranAt: new Date().toISOString(),
      rawRowCount: rows.length,
      parsedRowCount: upsertRows.length,
      inserted,
      sampleRawRow: sample,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message });
  }
}