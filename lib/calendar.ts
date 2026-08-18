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

function parseDateField(field: any): string | null {
  if (!field) return null;
  if (typeof field === "string") return field;
  if (typeof field === "number") return new Date(field * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  if (field.fmt) return field.fmt;
  if (typeof field.raw === "number") return new Date(field.raw * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return null;
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
    if (divDate) events.push({ symbol, type: "dividend", label: "Upcoming dividend", date: divDate });

    const earningsDates: any[] = cal.earnings?.earningsDate || [];
    const firstEarnings = parseDateField(earningsDates[0]);
    if (firstEarnings) events.push({ symbol, type: "earnings", label: "Quarterly results", date: firstEarnings });

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
