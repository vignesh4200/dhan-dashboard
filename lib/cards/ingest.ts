import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret } from "@/lib/crypto";
import { categorize, htmlToText, parseHdfcAlert } from "./parse";
import { parseStatementLines, pdfToLines, WrongPasswordError } from "./statement-pdf";

export type IncomingMessage = {
  id: string;
  from: string;
  subject: string;
  date: string; // ISO
  body: string; // plain text (or HTML)
  attachments?: { name: string; mimeType?: string; data: string }[]; // base64
};

export type IngestResult = { id: string; status: "saved" | "skipped" | "statement" | "error"; detail?: string };

async function pdfPasswords(): Promise<string[]> {
  const out: string[] = [];
  const { data } = await supabaseAdmin.from("cc_settings").select("pdf_password_enc").eq("id", 1).single();
  if (data?.pdf_password_enc) {
    try { out.push(...decryptSecret(data.pdf_password_enc).split("\n").map((s) => s.trim()).filter(Boolean)); } catch { /* bad key */ }
  }
  if (process.env.CARD_PDF_PASSWORDS) out.push(...process.env.CARD_PDF_PASSWORDS.split(",").map((s) => s.trim()).filter(Boolean));
  return out;
}

async function ensureCard(last4: string, name?: string, kind = "card") {
  const { data } = await supabaseAdmin.from("cc_cards").select("id").eq("last4", last4).maybeSingle();
  if (data) return;
  await supabaseAdmin.from("cc_cards").insert({ last4, name: name || `HDFC card ••${last4}`, kind });
}

export async function ingestMessage(m: IncomingMessage): Promise<IngestResult> {
  const from = (m.from || "").toLowerCase();
  if (from.includes("emailstatements.cards@")) return ingestStatement(m);
  if (from.includes("@dspfin.com")) return ingestLoanEmail(m, "DSP-LAMF", parseDspDue(m));
  if (from.includes("@groww.in")) return ingestLoanEmail(m, "GROWW-PL", parseGrowwEmi(m));
  if (!from.includes("alerts@hdfcbank")) return { id: m.id, status: "skipped", detail: "not an HDFC alert" };

  const text = /<\w+[^>]*>/.test(m.body) ? htmlToText(m.body) : m.body;
  const p = parseHdfcAlert(text, m.date);
  if (!p) return { id: m.id, status: "skipped", detail: "format not recognised" };

  if (p.cardLast4) await ensureCard(p.cardLast4);
  const row = {
    external_id: m.id,
    card_last4: p.cardLast4,
    txn_at: p.txnAt,
    amount: p.amount,
    merchant: p.merchant,
    kind: p.kind,
    category: ["purchase", "cash", "mandate_paid", "refund"].includes(p.kind) ? categorize(p.merchant) : null,
    bank_balance: p.bankBalance ?? null,
    subject: (m.subject || "").slice(0, 200),
  };
  const { error } = await supabaseAdmin.from("cc_transactions").upsert(row, { onConflict: "external_id" });
  if (error) return { id: m.id, status: "error", detail: error.message };

  if (p.kind === "payment") {
    await supabaseAdmin.from("cc_payments").upsert(
      { external_id: m.id, card_last4: p.cardLast4, paid_at: p.txnAt, amount: p.amount, source: "email", note: p.merchant },
      { onConflict: "external_id" }
    );
  }
  return { id: m.id, status: "saved", detail: p.kind };
}

async function ingestStatement(m: IncomingMessage): Promise<IngestResult> {
  const subj = m.subject || "";
  const isEmi = /DEBIT CARD EMI/i.test(subj);
  const cardName = /HDFC Bank - (.+?) Credit Card Statement/i.exec(subj)?.[1]?.trim();
  const pdf = (m.attachments || []).find((a) => /\.pdf$/i.test(a.name) || /pdf/i.test(a.mimeType || ""));

  let parsed: ReturnType<typeof parseStatementLines> | null = null;
  let note = "";
  if (pdf) {
    try {
      const lines = await pdfToLines(Buffer.from(pdf.data, "base64"), await pdfPasswords());
      parsed = parseStatementLines(lines);
      note = parsed.note;
    } catch (e: any) {
      note = e instanceof WrongPasswordError
        ? "PDF password missing or wrong — set it under Setup on the Credit Cards page, then re-sync"
        : `PDF could not be read: ${e?.message || e}`;
    }
  } else {
    note = "No PDF attached";
  }

  // Which card is this? EMI statements map to the Debit Card EMI row; card
  // statements use the last 4 digits printed in the PDF, else the card name
  // from the subject, else the last 2 digits in the attachment's file name.
  let last4: string | null = isEmi ? "EMI-DC" : parsed?.last4 || null;
  if (!last4) {
    const { data: cards } = await supabaseAdmin.from("cc_cards").select("last4,name").eq("kind", "card");
    const tail = /X+(\d{2})_/i.exec(pdf?.name || "")?.[1];
    const byName = cardName && (cards || []).find((c: any) => c.name.toLowerCase().includes(cardName.toLowerCase()));
    const byTail = tail && (cards || []).find((c: any) => c.last4.endsWith(tail));
    last4 = (byName as any)?.last4 || (byTail as any)?.last4 || null;
  }
  if (!last4) last4 = `UNKNOWN-${(cardName || "card").replace(/\W+/g, "").slice(0, 12)}`;
  await ensureCard(last4, isEmi ? "HDFC Debit Card EMI" : cardName ? `HDFC ${cardName}` : undefined, isEmi ? "emi" : "card");

  const row = {
    external_id: m.id,
    card_last4: last4,
    statement_date: parsed?.statementDate || m.date.slice(0, 10),
    due_date: parsed?.dueDate || null,
    total_due: parsed?.totalDue ?? null,
    min_due: parsed?.minDue ?? null,
    finance_charges: parsed?.financeCharges ?? null,
    credit_limit: parsed?.creditLimit ?? null,
    parsed_ok: !!parsed?.ok,
    parse_note: note,
    prev_dues: parsed?.prevDues ?? null,
    payments_received: parsed?.paymentsReceived ?? null,
  };
  const { error } = await supabaseAdmin.from("cc_statements").upsert(row, { onConflict: "external_id" });
  if (error) return { id: m.id, status: "error", detail: error.message };
  if (parsed?.creditLimit) await supabaseAdmin.from("cc_cards").update({ credit_limit: parsed.creditLimit }).eq("last4", last4);
  return { id: m.id, status: "statement", detail: note };
}

// ---- Loans that only announce dues by email -------------------------------

type LoanDue = { dueDate: string; amount: number } | null;
const pad = (n: number) => String(n).padStart(2, "0");

// "Total amount due: Rs 4120 • Due date: 07-11-2026" (DSP Finance, loan against MF)
export function parseDspDue(m: IncomingMessage): LoanDue {
  const t = (/<\w+[^>]*>/.test(m.body) ? htmlToText(m.body) : m.body).replace(/\s+/g, " ");
  const a = /Total amount due:?\s*(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d+)?)/i.exec(t);
  const d = /Due date:?\s*(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/i.exec(t);
  if (!a || !d) return null;
  return { amount: Number(a[1].replace(/,/g, "")), dueDate: `${d[3]}-${pad(+d[2])}-${pad(+d[1])}` };
}

// "Your EMI(s) of ₹3139 towards your personal loan(s) on Groww is due on 2 Aug."
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseGrowwEmi(m: IncomingMessage): LoanDue {
  const t = (/<\w+[^>]*>/.test(m.body) ? htmlToText(m.body) : m.body).replace(/\s+/g, " ");
  const r = /EMI\(?s?\)? of\s*(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d+)?) towards your personal loan.*? due on (\d{1,2}) ([A-Za-z]{3})/i.exec(t);
  if (!r) return null;
  const mon = MON[r[3].toLowerCase()];
  if (!mon) return null;
  const sent = new Date(m.date);
  let y = sent.getUTCFullYear();
  if (mon < sent.getUTCMonth() + 1 - 6) y += 1; // a January due date mailed in December
  return { amount: Number(r[1].replace(/,/g, "")), dueDate: `${y}-${pad(mon)}-${pad(+r[2])}` };
}

async function ingestLoanEmail(m: IncomingMessage, key: string, due: LoanDue): Promise<IngestResult> {
  if (!due) return { id: m.id, status: "skipped", detail: "no amount / due date found" };
  const { data: card } = await supabaseAdmin.from("cc_cards").select("status").eq("last4", key).maybeSingle();
  if (!card) return { id: m.id, status: "skipped", detail: `${key} is not set up` };
  // A fresh reminder means the loan is running: clear a "please confirm" flag.
  // Only a recent one counts — a back-fill replays months-old reminders.
  const recent = +new Date(due.dueDate + "T00:00:00Z") >= Date.now() - 10 * 86_400_000;
  if (card.status === "check" && recent) await supabaseAdmin.from("cc_cards").update({ status: "active" }).eq("last4", key);
  const { error } = await supabaseAdmin.from("cc_statements").upsert({
    external_id: m.id, card_last4: key, statement_date: m.date.slice(0, 10), due_date: due.dueDate,
    total_due: due.amount, parsed_ok: true, parse_note: `from email: ${(m.subject || "").slice(0, 80)}`,
  }, { onConflict: "external_id" });
  if (error) return { id: m.id, status: "error", detail: error.message };
  return { id: m.id, status: "statement", detail: `${key} ${due.amount} due ${due.dueDate}` };
}
