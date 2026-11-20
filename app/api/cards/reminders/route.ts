import { NextRequest, NextResponse } from "next/server";
import { collectAlerts, freshAlerts, istHour, loadAll } from "@/lib/cards/summary";
import { deliverAlerts } from "@/lib/cards/deliver";

export const dynamic = "force-dynamic";

// Called by the Gmail Apps Script on every run (every 15 min). Due-date
// reminders (T-7 with a cash check, T-3, T-1, due day, then daily while
// overdue), spend-cap alerts and closed-card autopay nudges only go out
// between 8am and 10pm IST, and each one only once (cc_reminder_log).
//   GET /api/cards/reminders?secret=CARD_INGEST_SECRET  → { emails: [...] }
export async function GET(req: NextRequest) {
  const s = req.nextUrl.searchParams.get("secret");
  if (!process.env.CARD_INGEST_SECRET || s !== process.env.CARD_INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const h = istHour();
  const remindersWindow = h >= 8 && h < 22;
  const d = await loadAll();
  const fresh = await freshAlerts(collectAlerts(d, { remindersWindow }));
  const emails = await deliverAlerts(fresh, req.nextUrl.origin);
  return NextResponse.json({ emails, remindersWindow });
}
