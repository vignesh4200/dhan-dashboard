import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { parseCsv, extractTransactions, aggregateByFund } from "@/lib/csv";
import { searchMfSchemes } from "@/lib/mfapi";

// Step 1 of 2: parse the uploaded CSV and try to match each fund to a
// scheme code via mfapi.in's search. Nothing is saved here — the client
// shows this for you to review/correct before calling /save.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { csv } = await req.json();
  if (!csv) return NextResponse.json({ error: "No CSV content provided" }, { status: 400 });

  const rows = parseCsv(csv);
  const transactions = extractTransactions(rows);
  if (transactions.length === 0) {
    return NextResponse.json({
      error: "Couldn't find recognizable fund/units columns in this file. Check the header row and try again, or share the header row with support so the column matching can be adjusted.",
    }, { status: 400 });
  }

  const funds = aggregateByFund(transactions);

  const withCandidates = await Promise.all(
    funds.map(async (f) => ({
      ...f,
      candidates: await searchMfSchemes(f.fundName),
    }))
  );

  return NextResponse.json({ funds: withCandidates, rowsDetected: transactions.length });
}
