// Earnings dates come from Yahoo Finance's quoteSummary "calendarEvents"
// module (works reasonably well for this). Dividend dates come from NSE
// India's own corporate-actions endpoint instead — Yahoo's free dividend
// data for Indian stocks turned out to be essentially empty when compared
// directly against Dhan's own app, while NSE has the real data.
import { fetchYahooAuthed } from "./yahoo-session";
import { getDividendsForSymbols } from "./nse-dividends";

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
// past date (their last known estimate) if they haven't refreshed it yet.
function isUpcoming(d: Date | null): d is Date {
  if (!d) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return d.getTime() >= startOfToday.getTime();
}

async function getEarningsForOneSymbol(symbol: string): Promise<CalendarEvent[]> {
  try {
    const res = await fetchYahooAuthed(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}.NS?modules=calendarEvents`
    );
    if (!res || !res.ok) return [];
    const data = await res.json();
    const cal = data?.quoteSummary?.result?.[0]?.calendarEvents;
    if (!cal) return [];

    const earningsDates: any[] = cal.earnings?.earningsDate || [];
    const upcomingEarnings = earningsDates.map(parseDateField).find(isUpcoming);
    if (!upcomingEarnings) return [];
    return [{ symbol, type: "earnings", label: "Quarterly results", date: formatDate(upcomingEarnings) }];
  } catch {
    return [];
  }
}

export async function getCalendarEvents(symbols: string[]): Promise<CalendarEvent[]> {
  const unique = [...new Set(symbols)];

  const [earningsResults, dividendResults] = await Promise.all([
    Promise.all(unique.map(getEarningsForOneSymbol)),
    getDividendsForSymbols(unique),
  ]);

  const events: CalendarEvent[] = [
    ...earningsResults.flat(),
    ...dividendResults.map((d) => ({ symbol: d.symbol, type: "dividend" as const, label: d.label, date: d.date })),
  ];

  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return events;
}
