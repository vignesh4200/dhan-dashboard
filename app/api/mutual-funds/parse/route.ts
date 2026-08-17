import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { parseCsv } from "@/lib/csv";
import { parseHoldingsReport } from "@/lib/groww";
import { searchMfSchemes } from "@/lib/mfapi";
import * as XLSX from "xlsx";

// Parses Groww's Holdings Report (CSV or Excel) for Units / Invested Value
// (accurate, from your real report) and also looks up scheme-code candidates
// per fund via mfapi.in, so a daily cron can track live NAV going forward
// instead of relying on Groww's point-in-time snapshot. Nothing is saved
// here — you confirm the right scheme match in the review step first.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  let rows: any[][] = [];

  if (body.xlsxBase64) {
    const buffer = Buffer.from(body.xlsxBase64, "base64");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false });
  } else if (body.csv) {
    rows = parseCsv(body.csv);
  } else {
    return NextResponse.json({ error: "No file content provided" }, { status: 400 });
  }

  const { holdings, reportDate } = parseHoldingsReport(rows);
  if (holdings.length === 0) {
    return NextResponse.json({
      error: "Couldn't find a holdings table in this file — check that it contains a 'HOLDINGS AS ON ...' section with Scheme Name / Units / Current Value columns.",
    }, { status: 400 });
  }

  const withCandidates = await Promise.all(
    holdings.map(async (h) => ({
      ...h,
      candidates: await searchMfSchemes(h.schemeName),
    }))
  );

  return NextResponse.json({ holdings: withCandidates, reportDate });
}
