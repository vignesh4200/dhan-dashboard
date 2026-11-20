// Reads a password-protected HDFC card / Debit Card EMI statement PDF and pulls
// out the figures the tracker needs. Uses the pdf.js build bundled inside
// pdf-parse (already a dependency) because it accepts a password; pdf-parse's
// own entry point does not.
import { parseDayMonYear, parseDmy, toAmount } from "./parse";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjs = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
pdfjs.disableWorker = true;

export type ParsedStatement = {
  last4: string | null;
  statementDate: string | null; // YYYY-MM-DD
  dueDate: string | null;
  totalDue: number | null;
  minDue: number | null;
  financeCharges: number | null;
  creditLimit: number | null;
  ok: boolean;
  note: string;
};

export class WrongPasswordError extends Error {}

export async function pdfToLines(buf: Buffer, passwords: string[]): Promise<string[]> {
  let lastErr: any = null;
  for (const pw of passwords.length ? passwords : [""]) {
    try {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), password: pw });
      const lines: string[] = [];
      const pages = Math.min(doc.numPages, 3); // the summary block is on page 1–2
      for (let p = 1; p <= pages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const rows = new Map<number, { x: number; s: string }[]>();
        for (const it of tc.items as any[]) {
          const y = Math.round(it.transform[5]);
          const x = it.transform[4];
          const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
          if (!rows.has(key)) rows.set(key, []);
          rows.get(key)!.push({ x, s: it.str });
        }
        [...rows.entries()]
          .sort((a, b) => b[0] - a[0])
          .forEach(([, items]) => {
            const line = items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ").replace(/\s+/g, " ").trim();
            if (line) lines.push(line);
          });
      }
      return lines;
    } catch (e: any) {
      lastErr = e;
      if (e?.name !== "PasswordException") break;
    }
  }
  if (lastErr?.name === "PasswordException") throw new WrongPasswordError("Statement PDF password is missing or wrong");
  throw lastErr || new Error("Could not read PDF");
}

const DATE = String.raw`(\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{1,2} [A-Za-z]{3},? \d{4})`;
const AMT = String.raw`(?:Rs\.?|INR|₹|C|\x60)?\s?([\d,]+\.\d{2})`;
const AMT_INT = String.raw`(?:Rs\.?|INR|₹|C|\x60)?\s?([\d,]+(?:\.\d{2})?)`;

function iso(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = parseDmy(s) || parseDayMonYear(s);
  if (!d) return null;
  return `${d.y}-${String(d.m + 1).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

function find(text: string, re: RegExp): string | null {
  const r = re.exec(text);
  return r ? r[1] : null;
}

export function parseStatementLines(lines: string[]): ParsedStatement {
  const text = lines.join("\n");
  const flat = lines.join(" ");

  let dueDate = iso(find(flat, new RegExp(String.raw`(?:Payment )?Due Date\s*:?\s*` + DATE, "i")));
  let totalDue = toAmount(find(flat, new RegExp(String.raw`Total (?:Amount )?Dues?\s*:?\s*` + AMT, "i")));
  let minDue = toAmount(find(flat, new RegExp(String.raw`Minimum (?:Amount )?Due\s*:?\s*` + AMT, "i")));
  const statementDate = iso(find(flat, new RegExp(String.raw`Statement Date\s*:?\s*` + DATE, "i")));

  // Older layout: a header row of labels, the values on the next line.
  if (!dueDate || totalDue == null || minDue == null) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (/Due Date/i.test(lines[i]) && /Total/i.test(lines[i]) && /Minimum/i.test(lines[i])) {
        const nx = lines[i + 1];
        const d = new RegExp(DATE).exec(nx);
        const amts = nx.match(/[\d,]+\.\d{2}/g) || [];
        const order = ["due", "total", "min"].sort(
          (a, b) => lines[i].search(new RegExp(a === "due" ? "Due Date" : a === "total" ? "Total" : "Minimum", "i")) -
            lines[i].search(new RegExp(b === "due" ? "Due Date" : b === "total" ? "Total" : "Minimum", "i"))
        );
        const nums = order.filter((k) => k !== "due");
        if (!dueDate && d) dueDate = iso(d[1]);
        if (totalDue == null && amts[nums.indexOf("total")]) totalDue = toAmount(amts[nums.indexOf("total")]);
        if (minDue == null && amts[nums.indexOf("min")]) minDue = toAmount(amts[nums.indexOf("min")]);
        break;
      }
    }
  }

  const financeCharges = (() => {
    const all = [...text.matchAll(/Finance Charges?[^\d\n]{0,20}([\d,]+\.\d{2})/gi)].map((m) => toAmount(m[1]) || 0);
    return all.length ? Math.max(...all) : null;
  })();
  const creditLimit = toAmount(find(flat, new RegExp(String.raw`Credit Limit\s*:?\s*` + AMT_INT, "i")));
  const last4 = find(flat, /(?:\d{4}|X{4})[X\d ]{4,12}?(\d{4})\b/);

  const ok = !!dueDate && totalDue != null;
  return {
    last4,
    statementDate,
    dueDate,
    totalDue,
    minDue,
    financeCharges,
    creditLimit,
    ok,
    note: ok ? "parsed" : "Could not find due date / total due in the PDF — add them by hand on the Credit Cards page",
  };
}
