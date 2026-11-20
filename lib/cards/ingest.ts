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
  };
  const { error } = await supabaseAdmin.from("cc_statements").upsert(row, { onConflict: "external_id" });
  if (error) return { id: m.id, status: "error", detail: error.message };
  if (parsed?.creditLimit) await supabaseAdmin.from("cc_cards").update({ credit_limit: parsed.creditLimit }).eq("last4", last4);
  return { id: m.id, status: "statement", detail: note };
}
