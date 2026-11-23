import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encryptSecret } from "@/lib/crypto";
import { isTelegramConfigured } from "@/lib/telegram";
import { buildBills, buildLoans, closedCardMandates, cycleSpend, currentCycle, lastBankBalance, loadAll, todayIst } from "@/lib/cards/summary";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const d = await loadAll();
  const today = todayIst();
  const bills = buildBills(d, today);
  const cycle = currentCycle(d, today);
  const loans = buildLoans(d, bills, today);

  // Interest & fees in the last 12 months, from parsed statements.
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const charged = d.statements.filter((s: any) => (s.statement_date || "") >= yearAgo && Number(s.finance_charges || 0) > 0);
  const interest12m = charged.reduce((sum: number, s: any) => sum + Number(s.finance_charges || 0), 0);
  const worst = charged.sort((a: any, b: any) => Number(b.finance_charges) - Number(a.finance_charges))[0] || null;

  // Utilisation across active cards with a known limit.
  const active = d.cards.filter((c: any) => c.kind === "card" && c.status === "active");
  const limit = active.reduce((s: number, c: any) => s + Number(c.credit_limit || 0), 0);
  const owed = bills.filter((b) => b.kind === "card").reduce((s, b) => s + b.left, 0) + Math.max(0, cycle.total);

  // Cycle transactions for the interest guard's soonest open card bill.
  const nextCard = bills.find((b) => b.kind === "card" && b.left > 1) || null;
  const guardTxns = nextCard ? cycleSpend(d.txns, nextCard.last4, nextCard.statementDate, 31) : [];

  const txns = d.txns
    .filter((t: any) => ["purchase", "refund", "cash", "mandate_paid", "payment"].includes(t.kind))
    .slice(0, 60)
    .map((t: any) => ({ id: t.id, at: t.txn_at, merchant: t.merchant, card: t.card_last4, kind: t.kind, category: t.category, amount: Number(t.amount) }));

  // Card-year spend for fee-waiver tracking.
  const feeWaivers = active
    .filter((c: any) => c.fee_waiver_spend && c.card_year_start)
    .map((c: any) => {
      const spent = d.txns
        .filter((t: any) => t.card_last4 === c.last4 && t.txn_at.slice(0, 10) >= c.card_year_start && ["purchase", "mandate_paid"].includes(t.kind))
        .reduce((s: number, t: any) => s + Number(t.amount), 0);
      return { last4: c.last4, name: c.name, spent, target: Number(c.fee_waiver_spend), fee: c.annual_fee ? Number(c.annual_fee) : null, yearStart: c.card_year_start };
    });

  return NextResponse.json({
    today,
    cards: d.cards,
    bills,
    loans,
    nextCard,
    guardTxns,
    cycle,
    spendCap: d.settings?.spend_cap ? Number(d.settings.spend_cap) : null,
    hasPdfPassword: !!d.settings?.pdf_password_enc,
    hasTelegram: isTelegramConfigured(),
    lastSyncAt: d.settings?.last_sync_at || null,
    utilisation: limit > 0 ? { pct: Math.round((owed / limit) * 100), owed, limit } : null,
    interest12m,
    worstCharge: worst ? { amount: Number(worst.finance_charges), last4: worst.card_last4, statementDate: worst.statement_date } : null,
    mandates: closedCardMandates(d).map((t: any) => ({ merchant: t.merchant, amount: Number(t.amount), card: t.card_last4, kind: t.kind, at: t.txn_at })),
    reviewStatements: d.statements
      .filter((s: any) => !s.parsed_ok && (s.created_at || "") >= new Date(Date.now() - 60 * 86_400_000).toISOString())
      .map((s: any) => ({ id: s.id, last4: s.card_last4, statementDate: s.statement_date, note: s.parse_note })),
    lastBalance: lastBankBalance(d),
    feeWaivers,
    txns,
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b?.action) return NextResponse.json({ error: "missing action" }, { status: 400 });
  const num = (v: any) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

  switch (b.action) {
    case "markPaid": {
      if (!num(b.amount)) return NextResponse.json({ error: "amount required" }, { status: 400 });
      const { error } = await supabaseAdmin.from("cc_payments").insert({
        external_id: `manual:${randomUUID()}`, card_last4: b.last4 || null, amount: num(b.amount),
        paid_at: b.date ? new Date(b.date + "T12:00:00+05:30").toISOString() : new Date().toISOString(), source: "manual", note: "Marked paid on dashboard",
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }
    case "saveStatement": {
      if (!b.last4 || !b.dueDate || num(b.totalDue) == null) return NextResponse.json({ error: "card, due date and total due are required" }, { status: 400 });
      const row = { card_last4: b.last4, statement_date: b.statementDate || null, due_date: b.dueDate, total_due: num(b.totalDue), min_due: num(b.minDue), parsed_ok: true, parse_note: "entered by hand" };
      const q = b.id
        ? supabaseAdmin.from("cc_statements").update(row).eq("id", b.id)
        : supabaseAdmin.from("cc_statements").insert({ ...row, external_id: `manual:${randomUUID()}` });
      const { error } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }
    case "saveCard": {
      if (!b.last4 || !b.name) return NextResponse.json({ error: "last4 and name required" }, { status: 400 });
      const row = {
        last4: String(b.last4).trim(), name: String(b.name).trim(), kind: b.kind || "card", status: b.status || "active",
        credit_limit: num(b.credit_limit), monthly_rate: num(b.monthly_rate) ?? 3.75, emi_amount: num(b.emi_amount),
        emi_due_day: num(b.emi_due_day), annual_fee: num(b.annual_fee), fee_waiver_spend: num(b.fee_waiver_spend),
        card_year_start: b.card_year_start || null,
        principal: num(b.principal), annual_rate: num(b.annual_rate), tenure_months: num(b.tenure_months),
        first_emi_date: b.first_emi_date || null, last_emi_date: b.last_emi_date || null,
        interest_only: b.interest_only === true || b.interest_only === "true",
        track_from: b.track_from || new Date().toISOString().slice(0, 10), note: b.note || null,
      };
      const { error } = await supabaseAdmin.from("cc_cards").upsert(row, { onConflict: "last4" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }
    case "setStatus": {
      if (!b.last4 || !["active", "closed", "check", "pending"].includes(b.status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
      const { error } = await supabaseAdmin.from("cc_cards").update({ status: b.status }).eq("last4", b.last4);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }
    case "saveSettings": {
      const patch: any = {};
      if ("spendCap" in b) patch.spend_cap = num(b.spendCap);
      if (typeof b.pdfPassword === "string" && b.pdfPassword.trim()) patch.pdf_password_enc = encryptSecret(b.pdfPassword.trim());
      const { error } = await supabaseAdmin.from("cc_settings").update(patch).eq("id", 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
