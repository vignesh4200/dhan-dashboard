// Dividend and earnings dates via Yahoo Finance's quoteSummary "calendarEvents"
// module — same free/unofficial family of endpoint as the price and news
// lookups. Field names for this specific module weren't independently
// confirmed at build time (Yahoo's response nesting for quoteSummary modules
// has changed across versions in the wild) — if this comes back empty for a
// symbol that should have data, check the raw shape via
// query1.finance.yahoo.com/v10/finance/quoteSummary/SYMBOL.NS?modules=calendarEvents
// and adjust the parsing below.
export type CalendarEvent = {
  symbol: string;
  type: "dividend" | "earnings";
  label: string;
  date: string;
};

export async function getCalendarEvents(symbols: string[]): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];

  await Promise.all(
    symbols.slice(0, 10).map(async (symbol) => {
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}.NS?modules=calendarEvents`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (!res.ok) return;
        const data = await res.json();
        const cal = data?.quoteSummary?.result?.[0]?.calendarEvents;
        if (!cal) return;

        const divDate = cal.dividendDate?.fmt;
        if (divDate) {
          events.push({ symbol, type: "dividend", label: "Upcoming dividend", date: divDate });
        }
        const earningsDates: any[] = cal.earnings?.earningsDate || [];
        if (earningsDates[0]?.fmt) {
          events.push({ symbol, type: "earnings", label: "Quarterly results", date: earningsDates[0].fmt });
        }
      } catch {
        // Skip this symbol on failure.
      }
    })
  );

  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return events.slice(0, 8);
}
