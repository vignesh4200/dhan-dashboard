// Saved copy of upcoming dividends, so a blocked NSE request doesn't make
// the dashboard show "no upcoming dividends".
//
// NSE's anti-bot protection intermittently blocks requests from Vercel's
// cloud IPs, and the fetchers treat a blocked request as "no dividend". So
// every time NSE does answer, the dividends it returned are saved here, and
// every read merges the live answer with the saved rows (live wins per
// symbol). Rows drop off once their record date has passed.
import { supabaseAdmin } from "./supabaseAdmin";
import { getCalendarEvents, CalendarEvent } from "./calendar";

type DividendLike = { symbol: string; label: string; date: string };

export type DividendSourceInfo = {
  live: number; // dividends NSE returned on this request
  fromSaved: number; // dividends filled in from the saved copy
  savedAt: string | null; // when the oldest saved row used was last confirmed by NSE
};

function istToday(): string {
  // YYYY-MM-DD in IST
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function toIsoDate(display: string): string | null {
  const d = new Date(display);
  if (isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export async function saveUpcomingDividends(userId: string, dividends: DividendLike[]): Promise<void> {
  const now = new Date().toISOString();
  const rows = dividends
    .map((d) => ({
      user_id: userId,
      symbol: d.symbol,
      label: d.label,
      event_date: toIsoDate(d.date),
      display_date: d.date,
      updated_at: now,
    }))
    .filter((r) => r.event_date !== null);

  try {
    if (rows.length > 0) {
      await supabaseAdmin
        .from("upcoming_dividends_cache")
        .upsert(rows, { onConflict: "user_id,symbol,event_date" });
    }
    // Housekeeping: drop rows whose record date has passed.
    await supabaseAdmin
      .from("upcoming_dividends_cache")
      .delete()
      .eq("user_id", userId)
      .lt("event_date", istToday());
  } catch {
    // Saving is best-effort; never break a page load over it.
  }
}

// Live calendar events (earnings + dividends), with any dividends NSE failed
// to return filled in from the saved copy.
export async function getCalendarEventsWithSavedDividends(
  userId: string,
  symbols: string[]
): Promise<{ events: CalendarEvent[]; dividendSource: DividendSourceInfo }> {
  const live = await getCalendarEvents(symbols);
  const liveDividends = live.filter((e) => e.type === "dividend");

  if (liveDividends.length > 0) {
    await saveUpcomingDividends(userId, liveDividends);
  }

  let saved: any[] = [];
  try {
    const { data } = await supabaseAdmin
      .from("upcoming_dividends_cache")
      .select("symbol, label, display_date, updated_at, event_date")
      .eq("user_id", userId)
      .gte("event_date", istToday())
      .order("event_date", { ascending: true });
    saved = data || [];
  } catch {
    saved = [];
  }

  const held = new Set(symbols);
  const liveSymbols = new Set(liveDividends.map((d) => d.symbol));
  const fillIns = saved.filter((r) => held.has(r.symbol) && !liveSymbols.has(r.symbol));

  const events: CalendarEvent[] = [
    ...live,
    ...fillIns.map((r) => ({ symbol: r.symbol, type: "dividend" as const, label: r.label, date: r.display_date })),
  ];
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const savedAt = fillIns.length
    ? fillIns.map((r) => r.updated_at as string).sort()[0]
    : null;

  return {
    events,
    dividendSource: { live: liveDividends.length, fromSaved: fillIns.length, savedAt },
  };
}
