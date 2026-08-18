// Dividend and earnings dates via Yahoo Finance's quoteSummary
// "calendarEvents" module — needs the cookie+crumb session (see
// lib/yahoo-session.ts); this was the source of the "Invalid Crumb" error
// that made every dividend lookup silently return nothing.
import { fetchYahooAuthed } from "./yahoo-session";

export type CalendarEvent = {
  symbol: string;
  type: "dividend" | "earnings";
  label: string;
  date: string;
};

function parseDateField(field: any): Date | null {
  if (!field) return null;
  if (typeof field === "string") { const d = new Date(field); return isNaN(d.getTime()) ? null : d; }
  if (typeof field === "number") return new Date(field * 1000);
  if (field.fmt) { const d = new Date(field.fmt); return isNaN(d.getTime()) ? null : d; }
  if (typeof field.raw === "number") return new Date(field.raw * 1000);
  return null;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Only "upcoming" if it's actually in the future — Yahoo can return a stale
// past date (their last known estimate) if they haven't refreshed it for
// the next quarter yet, which is exactly what caused past earnings dates to
// show up as "upcoming" before this fix.
function isUpcoming(d: Date | null): d is Date {
  if (!d) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return d.getTime() >= startOfToday.getTime();
}

async function getEventsForOneSymbol(symbol: string): Promise<CalendarEvent[]> {
  try {
    const res = await fetchYahooAuthed(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}.NS?modules=calendarEvents`
    );
    if (!res || !res.ok) return [];
    const data = await res.json();
    const cal = data?.quoteSummary?.result?.[0]?.calendarEvents;
    if (!cal) return [];

    const events: CalendarEvent[] = [];

    const divDate = parseDateField(cal.dividendDate);
    if (isUpcoming(divDate)) events.push({ symbol, type: "dividend", label: "Upcoming dividend", date: formatDate(divDate) });

    const earningsDates: any[] = cal.earnings?.earningsDate || [];
    // Some symbols return more than one candidate date (an estimate window)
    // — take the first one that's actually upcoming, not just index 0.
    const upcomingEarnings = earningsDates.map(parseDateField).find(isUpcoming);
    if (upcomingEarnings) events.push({ symbol, type: "earnings", label: "Quarterly results", date: formatDate(upcomingEarnings) });

    return events;
  } catch {
    return [];
  }
}

export async function getCalendarEvents(symbols: string[]): Promise<CalendarEvent[]> {
  const unique = [...new Set(symbols)].slice(0, 10);
  const results = await Promise.all(unique.map(getEventsForOneSymbol));
  const flat = results.flat();
  flat.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return flat.slice(0, 8);
}
