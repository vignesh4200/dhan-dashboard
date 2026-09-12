// Dhan's ScanX bulk data endpoint — returns data for all NSE equities in a
// single request, including ISIN and trading symbol for each. Used to
// build a complete ISIN -> symbol lookup that isn't limited to current
// holdings, so dividend reconstruction can resolve fully-exited past
// positions too, not just stocks still held today.
//
// Response shape not confirmed against the live endpoint at time of
// writing — this is a first attempt based on documented request fields;
// the diagnostic route built alongside this will reveal the real shape
// if this parsing doesn't match.
export async function fetchDhanScanXAllEquities(): Promise<any> {
  const res = await fetch("https://ow-scanx-analytics.dhan.co/customscan/fetchdt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json, text/plain, */*",
      "Origin": "https://scanx.dhan.co",
      "Referer": "https://scanx.dhan.co/",
    },
    body: JSON.stringify({
      data: {
        sort: "Mcap",
        sorder: "desc",
        count: 5000,
        fields: ["Isin", "Sym", "DispSym", "Sid"],
        params: [
          { field: "OgInst", op: "", val: "ES" },
          { field: "Exch", op: "", val: "NSE" },
        ],
        pgno: 0,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dhan ScanX fetch failed: ${res.status} ${text}`);
  }

  return res.json();
}