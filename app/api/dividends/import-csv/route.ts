import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseDhanDividendCsv } from "@/lib/dhan-dividend-csv";

// Imports Dhan's own "Dividend Payout Report" CSV export — real, settled
// amounts direct from the broker, not a reconstruction/estimate. Resolves
// each row's company name (e.g. "Mishra Dhatu Nigam") to the proper NSE
// ticker symbol (e.g. "MIDHANI") using the isin_symbol_map's display_name
// column where a match exists; falls back to the raw company name
// otherwise, so nothing is silently dropped.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { csvText } = await req.json();
  if (!csvText) return NextResponse.json({ error: "Missing csvText" }, { status: 400 });

  const rows = parseDhanDividendCsv(csvText);
  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid rows found — check this is a genuine Dhan Dividend Payout Report export" }, { status: 400 });
  }

  const { data: symbolMap } = await supabaseAdmin
    .from("isin_symbol_map")
    .select("symbol, display_name");

  const nameToSymbol: Record<string, string> = {};
  for (const row of symbolMap || []) {
    if (row.display_name) nameToSymbol[row.display_name.toLowerCase()] = row.symbol;
  }

  let inserted = 0;
  let unresolvedNames: string[] = [];

  for (const row of rows) {
    const resolvedSymbol = nameToSymbol[row.scripName.toLowerCase()] || row.scripName.toUpperCase();
    if (!nameToSymbol[row.scripName.toLowerCase()] && !unresolvedNames.includes(row.scripName)) {
      unresolvedNames.push(row.scripName);
    }

    const { error } = await supabaseAdmin.from("dividend_received").upsert(
      {
        user_id: user.id,
        symbol: resolvedSymbol,
        amount: row.amount,
        per_share_amount: row.perShare,
        quantity_at_record_date: row.quantity,
        record_date: row.date,
        source: "dhan_report",
        note: `From Dhan report (as "${row.scripName}")`,
      },
      { onConflict: "user_id,symbol,record_date,amount", ignoreDuplicates: true }
    );

    if (!error) inserted++;
  }

  return NextResponse.json({
    ok: true,
    totalRows: rows.length,
    inserted,
    unresolvedNames,
  });
}