import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { renewDhanToken } from "@/lib/dhan";

// Run this once a day, EVERY day including weekends (unlike the 15-min
// holdings refresh, which only needs to run during market hours). Dhan's
// personal access tokens last ~24h, so this has to run more often than once
// every 24h to guarantee it never lapses — every 18-20h is a safe margin.
//
//   GET https://your-app.vercel.app/api/cron/renew-token?secret=YOUR_CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: rows } = await supabaseAdmin
    .from("dhan_credentials")
    .select("user_id, dhan_client_id, access_token_encrypted");

  const results: any[] = [];

  for (const row of rows || []) {
    try {
      const currentToken = decryptSecret(row.access_token_encrypted);
      const renewed = await renewDhanToken(row.dhan_client_id, currentToken);

      if (!renewed) {
        // Token had already fully expired (e.g. this job missed a day) —
        // nothing we can do automatically. The user needs to regenerate it
        // manually from Dhan Web and re-paste it into Settings.
        results.push({ user: row.user_id, ok: false, reason: "expired, needs manual regeneration" });
        continue;
      }

      await supabaseAdmin
        .from("dhan_credentials")
        .update({ access_token_encrypted: encryptSecret(renewed.accessToken), updated_at: new Date().toISOString() })
        .eq("user_id", row.user_id);

      results.push({ user: row.user_id, ok: true });
    } catch (e: any) {
      results.push({ user: row.user_id, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
