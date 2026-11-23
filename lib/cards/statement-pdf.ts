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
  prevDues: number | null;
  paymentsReceived: number | null;
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

// HDFC's current layout (2026) prints the account summary as a formula, with
// the rupee sign extracted as "C":
//   C 59,739.54 C 66,038.45 + C 6,298.91 + C 0.00 = C 0.00
//   previous dues − payments + purchases + finance charges = total due
// and puts "MINIMUM DUE  DUE DATE" values on a row of their own, e.g.
//   C 2,990.00 05 Jun, 2026      or      C 0.00 Nil   (nothing due)
const CUR = String.raw`(?:C|₹|Rs\.?|INR|\x60)\s?`;
const DUE_ROW = new RegExp(String.raw`^` + CUR + String.raw`([\d,]+(?:\.\d{2})?)\s+(Nil|` + DATE.slice(1, -1) + String.raw`)$`, "i");

export function parseHdfcSummary(lines: string[]) {
  const flat = lines.join(" ");
  const f = new RegExp(
    CUR + String.raw`([\d,]+\.\d{2})\s+` + CUR + String.raw`([\d,]+\.\d{2})\s*\+\s*` + CUR + String.raw`([\d,]+\.\d{2})\s*\+\s*` + CUR + String.raw`([\d,]+\.\d{2})\s*=`
  ).exec(flat);
  if (!f) return null;
  const [prev, paid, spent, fin] = f.slice(1, 5).map((x) => toAmount(x) || 0);
  const balance = Math.round((prev - paid + spent + fin) * 100) / 100;

  let dueRaw: string | null = null;
  let minDue: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const r = DUE_ROW.exec(lines[i].trim());
    if (!r) continue;
    dueRaw = r[2];
    // The amount is the minimum due on card statements; on EMI statements the
    // same row carries the loan amount instead.
    if (lines.slice(Math.max(0, i - 4), i).some((l) => /MINIMUM DUE/i.test(l))) minDue = toAmount(r[1]);
    break;
  }

  let creditLimit: number | null = null;
  const li = lines.findIndex((l) => /TOTAL CREDIT LIMIT/i.test(l));
  if (li >= 0) {
    for (const l of lines.slice(li, li + 6)) {
      const r = new RegExp(String.raw`^` + CUR + String.raw`([\d,]+(?:\.\d{2})?)\s+` + CUR + String.raw`[\d,]+(?:\.\d{2})?\s+` + CUR + String.raw`[\d,]+(?:\.\d{2})?$`).exec(l.trim());
      if (r) { creditLimit = toAmount(r[1]); break; }
    }
  }

  return {
    prevDues: prev,
    paymentsReceived: paid,
    totalDue: Math.max(0, balance), // a credit balance means nothing is due
    financeCharges: fin,
    minDue,
    dueDate: dueRaw && !/^nil$/i.test(dueRaw) ? iso(dueRaw) : null,
    nothingDue: balance <= 0 || (dueRaw != null && /^nil$/i.test(dueRaw)),
    creditLimit,
  };
}

export function parseStatementLines(lines: string[]): ParsedStatement {
  const text = lines.join("\n");
  const flat = lines.join(" ");
  const hdfc = parseHdfcSummary(lines);

  let dueDate = hdfc ? hdfc.dueDate : iso(find(flat, new RegExp(String.raw`(?:Payment )?Due Date\s*:?\s*` + DATE, "i")));
  let totalDue = hdfc ? hdfc.totalDue : toAmount(find(flat, new RegExp(String.raw`Total (?:Amount )?Dues?\s*:?\s*` + AMT, "i")));
  let minDue = hdfc ? hdfc.minDue : toAmount(find(flat, new RegExp(String.raw`Minimum (?:Amount )?Due\s*:?\s*` + AMT, "i")));
  const statementDate = iso(find(flat, new RegExp(String.raw`Statement Date\s*:?\s*` + DATE, "i")));

  // Older layout: a header row of labels, the values on the next line.
  if (!hdfc && (!dueDate || totalDue == null || minDue == null)) {
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

  const financeCharges = hdfc ? hdfc.financeCharges : (() => {
    const all = [...text.matchAll(/Finance Charges?[^\d\n]{0,20}([\d,]+\.\d{2})/gi)].map((m) => toAmount(m[1]) || 0);
    return all.length ? Math.max(...all) : null;
  })();
  const creditLimit = hdfc?.creditLimit ?? toAmount(find(flat, new RegExp(String.raw`Credit Limit\s*:?\s*` + AMT_INT, "i")));
  const last4 = find(flat, /(?:\d{4}|X{4})[X\d ]{4,12}?(\d{4})\b/);

  const ok = (!!dueDate && totalDue != null) || (!!hdfc?.nothingDue && totalDue != null);
  return {
    last4,
    statementDate,
    dueDate,
    totalDue,
    minDue,
    financeCharges,
    creditLimit,
    prevDues: hdfc?.prevDues ?? null,
    paymentsReceived: hdfc?.paymentsReceived ?? null,
    ok,
    note: ok ? (dueDate ? "parsed" : "parsed — nothing due this cycle") : "Could not find due date / total due in the PDF — add them by hand on the Credit Cards page",
  };
}
