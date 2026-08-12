// Dhan's holdings API doesn't return sector classification, so this is a
// static, best-effort mapping for common NSE symbols. Anything not listed
// here falls into "Other" — extend this map with your own holdings' symbols
// for a more complete sector-mix chart.
export const SECTOR_MAP: Record<string, string> = {
  RELIANCE: "Energy", ONGC: "Energy", MRPL: "Energy", BPCL: "Energy", IOC: "Energy",
  TCS: "IT", INFY: "IT", KPITTECH: "IT", WIPRO: "IT", HCLTECH: "IT", TECHM: "IT",
  HDFCBANK: "Financials", ICICIBANK: "Financials", SBIN: "Financials", AXISBANK: "Financials",
  KOTAKBANK: "Financials", PFC: "Financials", MOBIKWIK: "Financials", RECLTD: "Financials",
  ITC: "FMCG", HINDUNILVR: "FMCG", NESTLEIND: "FMCG", BRITANNIA: "FMCG",
  LT: "Infrastructure", MAMATA: "Industrials", SIEMENS: "Industrials",
  BHARTIARTL: "Telecom", TEJASNET: "Telecom", IDEA: "Telecom",
  TATAMOTORS: "Auto", MARUTI: "Auto", M_M: "Auto", BAJAJ_AUTO: "Auto",
  MIDHANI: "Metals & Defence", HAL: "Metals & Defence", BEL: "Metals & Defence",
  GMDCLTD: "Mining", COALINDIA: "Mining", VEDL: "Mining",
  INDHOTEL: "Hospitality", EIHOTEL: "Hospitality",
  FIRSTCRY: "Consumer/Retail", ZOMATO: "Consumer/Retail", NYKAA: "Consumer/Retail",
  ADANIENT: "Conglomerate", ADANIPORTS: "Infrastructure",
};

export function sectorFor(symbol: string): string {
  return SECTOR_MAP[symbol] || "Other";
}
