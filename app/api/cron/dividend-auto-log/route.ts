import { NextRequest, NextResponse } from "next/server";
import { runDividendAutoLog } from "@/lib/dividend-auto-log";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Kept as a standalone route for manual/backup triggering, but this logic
// now also runs automatically at the end of every /api/cron/refresh
// invocation (the job actually scheduled via cron-job.org — see README
// step 6), since this route on its own was never wired to a schedule.
//
//   GET https://your-app.vercel.app/api/cron/dividend-auto-log?secret=YOUR_CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results = await runDividendAutoLog();
  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}