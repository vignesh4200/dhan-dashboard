import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret } from "@/lib/crypto";
import { getDhanLedger } from "@/lib/dhan-ledger";

// Diagnostic only — fetches the raw ledger so we can see how Dhan actually
// labels dividend credit entries before building real parsing logic.
// Visit /api/dividends/ledger-test directly (while logged in) to see it.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: creds } = await supabaseAdmin
    .from("dhan_credentials")
    .select("access_token_encrypted")
    .eq("user_id", user.id)
    .single();

  if (!creds?.access_token_encrypted) {
    return NextResponse.json({ error: "No cached Dhan token yet — trigger the stock refresh cron first, then retry this." });
  }

  try {
    const accessToken = decryptSecret(creds.access_token_encrypted);

    // Financial year to date: April 1 through today.
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fromDate = `${fyStartYear}-04-01`;
    const toDate = now.toISOString().slice(0, 10);

    const ledger = await getDhanLedger(accessToken, fromDate, toDate);
    return NextResponse.json({ fromDate, toDate, ledger });
  } catch (e: any) {
    return NextResponse.json({ error: e.message });
  }
}