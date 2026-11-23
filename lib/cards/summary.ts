// Builds the Credit picture (cards, EMIs and loans) from the cc_* tables: open bills, what's
// still owed, interest risk, spend vs cap, autopays on closed cards, and the
// alerts/reminders that follow from all of that.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { estimateFinanceCharge } from "./interest";

const DAY = 86_400_000;

export function todayIst(): string {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}
export function istHour(): number {
  return new Date(Date.now() + 330 * 60 * 1000).getUTCHours();
}
const daysBetween = (a: string, b: string) => Math.round((+new Date(b) - +new Date(a)) / DAY);
export const inr = (n: number | null | undefined) =>
  n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");

export type Bill = {
  key: string;            // statement id or "emi:<last4>:<due>"
  statementId: number | null;
  last4: string;
  name: string;
  kind: string;           // card | emi | loan
  statementDate: string | null;
  dueDate: string;
  totalDue: number;
  minDue: number | null;
  paid: number;
  left: number;
  daysLeft: number;
  status: "open" | "paid" | "short" | "overdue";
  autoDebit: boolean;
  estIfMinimum: number | null;
};

export async function loadAll() {
  const since = new Date(Date.now() - 400 * DAY).toISOString();
  const [cards, stmts, pays, txns, settings] = await Promise.all([
    supabaseAdmin.from("cc_cards").select("*").order("id"),
    supabaseAdmin.from("cc_statements").select("*").order("due_date", { ascending: false }).limit(200),
    supabaseAdmin.from("cc_payments").select("*").gte("paid_at", since).order("paid_at", { ascending: false }).limit(1000),
    supabaseAdmin.from("cc_transactions").select("*").gte("txn_at", since).order("txn_at", { ascending: false }).limit(3000),
    supabaseAdmin.from("cc_settings").select("*").eq("id", 1).single(),
  ]);
  return {
    cards: cards.data || [],
    statements: stmts.data || [],
    payments: pays.data || [],
    txns: txns.data || [],
    settings: settings.data || ({} as any),
  };
}

export function buildBills(d: Awaited<ReturnType<typeof loadAll>>, today = todayIst()): Bill[] {
  const bills: Bill[] = [];
  const cardBy = new Map<string, any>(d.cards.map((c: any) => [c.last4, c]));
  const before = (iso: string, days: number) => new Date(+new Date(iso + "T00:00:00Z") - days * DAY).toISOString().slice(0, 10);

  // Statements per card, newest first. The newest one decides what is owed:
  // a "nothing due" statement (no due date) means older bills are settled.
  const byCard = new Map<string, any[]>();
  for (const s of d.statements) (byCard.get(s.card_last4) || byCard.set(s.card_last4, []).get(s.card_last4)!).push(s);
  for (const list of byCard.values()) list.sort((a, b) => (b.statement_date || b.due_date || "").localeCompare(a.statement_date || a.due_date || ""));

  // Payments: attributed ones go to their card; unattributed ones (a UPI debit
  // to CRED / a card-bill payee) fill the open bill due soonest.
  const attributed = new Map<string, any[]>();
  const loose: any[] = [];
  for (const p of d.payments) (p.card_last4 ? (attributed.get(p.card_last4) || attributed.set(p.card_last4, []).get(p.card_last4)!) : loose).push(p);

  for (const [last4, list] of byCard) {
    const s = list[0];
    if (!s?.due_date || s.total_due == null || Number(s.total_due) <= 0) continue;
    const card = cardBy.get(last4) || { name: `HDFC card ••${last4}`, kind: "card", monthly_rate: 3.75 };
    if (card.status === "closed" && card.kind !== "card") continue;
    // Before tracking started for this account: history, not a live bill.
    if (card.track_from && s.due_date < card.track_from) continue;
    // Only the current cycle matters; older bills are history.
    if (daysBetween(s.due_date, today) > 35) continue;
    const cycleStart = s.statement_date || before(s.due_date, 20);
    const paid = (attributed.get(last4) || [])
      .filter((p) => p.paid_at.slice(0, 10) > cycleStart)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    bills.push(makeBill(card, last4, s, paid, today, d));
  }

  // Loose payments, soonest open bill first.
  const open = bills.filter((b) => b.kind === "card" && b.left > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const p of loose.sort((a, b) => a.paid_at.localeCompare(b.paid_at))) {
    let amt = Number(p.amount);
    for (const b of open) {
      if (amt <= 0) break;
      if (p.paid_at.slice(0, 10) <= (b.statementDate || "0000")) continue;
      const take = Math.min(amt, b.left);
      if (take <= 0) continue;
      b.paid += take; b.left -= take; amt -= take;
      Object.assign(b, statusOf(b, today));
    }
  }

  // Scheduled EMIs (loans, Snapmint, …): one due per month on emi_due_day,
  // from the later of the first EMI and the day tracking started. Payments
  // (ticked on the page) settle the earliest unpaid month first, so a missed
  // month stays overdue until it is ticked.
  for (const c of d.cards) {
    if (c.status !== "active" || c.kind === "card" || !c.emi_amount || !c.emi_due_day) continue;
    const from = [c.first_emi_date, c.track_from].filter(Boolean).sort().pop() || before(today, 31);
    const stmts = byCard.get(c.last4) || [];
    const dues: string[] = [];
    const f = new Date(from + "T00:00:00Z");
    for (let i = 0; i < 4; i++) {
      const dt = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + i, Math.min(c.emi_due_day, 28) === c.emi_due_day ? c.emi_due_day : 28));
      const iso = dt.toISOString().slice(0, 10);
      if (iso < from || (c.last_emi_date && iso > c.last_emi_date)) continue;
      if (daysBetween(today, iso) > 40) break;
      // A statement already covers this month (e.g. Debit Card EMI).
      if (stmts.some((s) => s.due_date && Math.abs(daysBetween(s.due_date, iso)) <= 10)) continue;
      dues.push(iso);
    }
    const amount = Number(c.emi_amount);
    const rows = dues.map((due) => ({ due, paid: 0 }));
    for (const p of (attributed.get(c.last4) || []).slice().sort((a, b) => a.paid_at.localeCompare(b.paid_at))) {
      let amt = Number(p.amount);
      for (const r of rows) {
        if (amt <= 0) break;
        if (r.paid >= amount - 1 || p.paid_at.slice(0, 10) <= before(r.due, 28)) continue;
        const take = Math.min(amt, amount - r.paid);
        r.paid += take; amt -= take;
      }
    }
    // Every unpaid month up to today, plus the next one coming up.
    let shownUpcoming = false;
    for (const r of rows) {
      const upcoming = r.due >= before(today, 2);
      if (!upcoming && r.paid >= amount - 1) continue;
      if (upcoming && shownUpcoming) break;
      if (upcoming) shownUpcoming = true;
      const b: Bill = {
        key: `emi:${c.last4}:${r.due}`, statementId: null, last4: c.last4, name: c.name, kind: c.kind,
        statementDate: null, dueDate: r.due, totalDue: amount, minDue: amount, paid: r.paid,
        left: Math.max(0, amount - r.paid), daysLeft: 0, status: "open", autoDebit: true, estIfMinimum: null,
      };
      Object.assign(b, statusOf(b, today));
      bills.push(b);
    }
  }

  return bills.sort((a, b) => (a.left > 0 ? 0 : 1) - (b.left > 0 ? 0 : 1) || a.dueDate.localeCompare(b.dueDate));
}

export type Loan = {
  key: string; name: string; kind: string; status: string; note: string | null;
  emi: number | null; dueDay: number | null; interestOnly: boolean;
  principal: number | null; annualRate: number | null; tenure: number | null;
  firstEmi: string | null; lastEmi: string | null;
  emisDone: number | null; emisTotal: number | null; outstanding: number | null; outstandingIsEstimate: boolean;
  next: Bill | null;
};

// Loans and EMI plans with their progress. Balances are worked out from the
// loan terms (lenders don't email them), so they are estimates unless a
// statement says otherwise.
export function buildLoans(d: Awaited<ReturnType<typeof loadAll>>, bills: Bill[], today = todayIst()): Loan[] {
  const out: Loan[] = [];
  for (const c of d.cards) {
    if (c.kind === "card" || c.status === "closed") continue;
    const emi = c.emi_amount != null ? Number(c.emi_amount) : null;
    const tenure = c.tenure_months ?? (c.first_emi_date && c.last_emi_date ? monthsBetween(c.first_emi_date, c.last_emi_date) + 1 : null);
    let emisDone: number | null = null;
    if (c.first_emi_date && tenure) {
      emisDone = c.first_emi_date > today ? 0 : Math.min(tenure, monthsBetween(c.first_emi_date, today) + (Number(today.slice(8)) >= Number(c.first_emi_date.slice(8)) ? 1 : 0));
    }
    let outstanding: number | null = null;
    if (emi && tenure != null && emisDone != null) {
      const r = c.annual_rate ? Number(c.annual_rate) / 1200 : 0;
      const left = tenure - emisDone;
      outstanding = r > 0 ? Math.round((emi * (1 - Math.pow(1 + r, -left))) / r) : Math.round(emi * left * 100) / 100;
    }
    const mine = bills.filter((b) => b.last4 === c.last4).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    out.push({
      key: c.last4, name: c.name, kind: c.kind, status: c.status, note: c.note || null,
      emi, dueDay: c.emi_due_day ?? null, interestOnly: !!c.interest_only,
      principal: c.principal != null ? Number(c.principal) : null, annualRate: c.annual_rate != null ? Number(c.annual_rate) : null,
      tenure, firstEmi: c.first_emi_date || null, lastEmi: c.last_emi_date || null,
      emisDone, emisTotal: tenure, outstanding, outstandingIsEstimate: !!(c.annual_rate && outstanding != null),
      next: mine.find((b) => b.left > 1) || mine[mine.length - 1] || null,
    });
  }
  return out;
}

function monthsBetween(a: string, b: string) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

function statusOf(b: Bill, today: string): Pick<Bill, "status" | "daysLeft"> {
  const daysLeft = daysBetween(today, b.dueDate);
  let status: Bill["status"] = "open";
  if (b.left <= 1) status = "paid";
  else if (daysLeft < 0) status = "overdue";
  else if (b.paid > 0) status = "short";
  return { status, daysLeft };
}

function makeBill(card: any, last4: string, s: any, paid: number, today: string, d: any): Bill {
  const total = Number(s.total_due);
  const b: Bill = {
    key: `stmt:${s.id}`, statementId: s.id, last4, name: card.name, kind: card.kind,
    statementDate: s.statement_date, dueDate: s.due_date, totalDue: total,
    minDue: s.min_due != null ? Number(s.min_due) : null, paid, left: Math.max(0, total - paid),
    daysLeft: 0, status: "open", autoDebit: card.kind !== "card", estIfMinimum: null,
  };
  Object.assign(b, statusOf(b, today));
  if (card.kind === "card" && b.left > 1) {
    const cycleTxns = cycleSpend(d.txns, last4, s.statement_date, 31);
    b.estIfMinimum = estimateFinanceCharge({
      totalDue: total, payAmount: Math.max(paid, b.minDue || 0), statementDate: s.statement_date,
      dueDate: s.due_date, txns: cycleTxns, monthlyRatePct: Number(card.monthly_rate || 3.75),
    }).total;
  }
  return b;
}

// Purchases on a card in the N days up to a statement date.
export function cycleSpend(txns: any[], last4: string, statementDate: string | null, n: number) {
  if (!statementDate) return [];
  const from = new Date(+new Date(statementDate) - n * DAY).toISOString();
  const to = new Date(+new Date(statementDate) + DAY).toISOString();
  return txns
    .filter((t) => t.card_last4 === last4 && ["purchase", "cash", "mandate_paid"].includes(t.kind) && t.txn_at >= from && t.txn_at < to)
    .map((t) => ({ date: t.txn_at, amount: Number(t.amount) }));
}

// Spend since each active card's last statement (the bill now being built).
export function currentCycle(d: Awaited<ReturnType<typeof loadAll>>, today = todayIst()) {
  const latestStmt = new Map<string, string>();
  for (const s of d.statements) if (s.statement_date && !latestStmt.has(s.card_last4)) latestStmt.set(s.card_last4, s.statement_date);
  const active = new Set(d.cards.filter((c: any) => c.kind === "card" && c.status === "active").map((c: any) => c.last4));
  const fallbackStart = new Date(+new Date(today) - 30 * DAY).toISOString().slice(0, 10);
  let total = 0;
  const byCat: Record<string, number> = {};
  for (const t of d.txns) {
    if (!t.card_last4 || !active.has(t.card_last4)) continue;
    const start = latestStmt.get(t.card_last4) || fallbackStart;
    if (t.txn_at.slice(0, 10) <= start) continue;
    const sign = ["purchase", "cash", "mandate_paid"].includes(t.kind) ? 1 : t.kind === "refund" ? -1 : 0;
    if (!sign) continue;
    total += sign * Number(t.amount);
    const c = t.category || "Other";
    byCat[c] = (byCat[c] || 0) + sign * Number(t.amount);
  }
  const starts = [...active].map((l) => latestStmt.get(l as string) || fallbackStart).sort();
  return { total, byCat, cycleStart: starts[0] || fallbackStart };
}

export function lastBankBalance(d: Awaited<ReturnType<typeof loadAll>>) {
  const t = d.txns.find((x: any) => x.bank_balance != null);
  return t ? { amount: Number(t.bank_balance), at: t.txn_at as string } : null;
}

export function closedCardMandates(d: Awaited<ReturnType<typeof loadAll>>) {
  const closed = new Set(d.cards.filter((c: any) => c.status === "closed").map((c: any) => c.last4));
  const seen = new Map<string, any>();
  for (const t of d.txns) {
    if (!["mandate_declined", "mandate_upcoming"].includes(t.kind) || !closed.has(t.card_last4)) continue;
    if (+new Date(t.txn_at) < Date.now() - 60 * DAY) continue;
    const k = `${t.merchant}|${t.card_last4}`;
    if (!seen.has(k)) seen.set(k, t);
  }
  return [...seen.values()];
}

export type Alert = { key: string; level: "urgent" | "warn" | "info"; title: string; body: string };

// Everything worth telling the user right now. Callers dedupe on `key`.
export function collectAlerts(d: Awaited<ReturnType<typeof loadAll>>, opts: { remindersWindow: boolean }): Alert[] {
  const today = todayIst();
  const out: Alert[] = [];
  const bills = buildBills(d, today);
  const bal = lastBankBalance(d);

  for (const b of bills) {
    if (b.left <= 1) continue;
    const who = `${b.name}${b.kind === "card" ? ` ••${b.last4}` : ""}`;
    const interest = b.estIfMinimum ? ` If only the minimum is paid, expect about ${inr(b.estIfMinimum)} in interest + GST.` : "";

    // Paid something, but not all of it: the Regalia mistake. Flag at once.
    if (b.kind === "card" && b.paid > 0 && b.left > 1) {
      out.push({
        key: `short:${b.key}:${Math.round(b.paid)}`,
        level: "urgent",
        title: `${inr(b.left)} still due on ${who} by ${fmtDate(b.dueDate)}`,
        body: `You've paid ${inr(b.paid)} of ${inr(b.totalDue)}. Any amount left after the due date makes the WHOLE bill attract interest from each purchase date.${interest}`,
      });
    }

    if (!opts.remindersWindow) continue;
    const dl = b.daysLeft;
    const cash = bal && dl <= 7 ? ` Last a/c balance seen: ${inr(bal.amount)} (${fmtDate(bal.at.slice(0, 10))})${bal.amount < b.left ? " — LOWER than this bill." : "."}` : "";
    const verb = b.autoDebit ? "Auto-debit of" : "Pay";
    if (dl < 0 && dl >= -30) {
      out.push({ key: `overdue:${b.key}:${today}`, level: "urgent", title: `OVERDUE ${-dl}d: ${who} — ${inr(b.left)}`, body: `Due date was ${fmtDate(b.dueDate)}. Pay now to stop late fees and further interest. Already paid? Tap "Mark paid" on the Credit page so reminders stop.${interest}` });
    } else if ([7, 3, 1, 0].includes(dl)) {
      const when = dl === 0 ? "TODAY" : `in ${dl} day${dl > 1 ? "s" : ""}`;
      out.push({
        key: `due:${b.key}:T-${dl}`,
        level: dl <= 1 ? "urgent" : "warn",
        title: `${verb} ${inr(b.left)} — ${who} due ${when}`,
        body: `${b.autoDebit ? "Keep the balance in your account." : `Pay the TOTAL ${inr(b.left)}, not the minimum${b.minDue ? ` (${inr(b.minDue)})` : ""}.`}${cash}${b.autoDebit ? "" : interest}`,
      });
    }
  }

  // Spend cap.
  const cap = Number(d.settings?.spend_cap || 0);
  if (cap > 0 && opts.remindersWindow) {
    const cyc = currentCycle(d, today);
    for (const pct of [90, 70]) {
      if (cyc.total >= (cap * pct) / 100) {
        out.push({ key: `cap:${pct}:${cyc.cycleStart}`, level: pct === 90 ? "urgent" : "warn", title: `Card spend at ${Math.round((cyc.total / cap) * 100)}% of your ${inr(cap)} cap`, body: `${inr(cyc.total)} spent this cycle. Next bill will need that much in full by the due date.` });
        break;
      }
    }
  }

  // Cash withdrawals on a credit card: interest from day 1.
  for (const t of d.txns) {
    if (t.kind !== "cash" || +new Date(t.txn_at) < Date.now() - 3 * DAY) continue;
    out.push({ key: `cash:${t.external_id}`, level: "urgent", title: `Cash withdrawal on card ••${t.card_last4}: ${inr(t.amount)}`, body: "Cash on a credit card attracts interest from day 1 plus a cash fee. Repay it now, separately from the bill." });
  }

  // Autopays still pointing at a closed card (weekly nudge).
  if (opts.remindersWindow) {
    const wk = `${new Date().getUTCFullYear()}-${Math.floor((+new Date() - +new Date(new Date().getUTCFullYear(), 0, 1)) / (7 * DAY))}`;
    for (const t of closedCardMandates(d)) {
      out.push({ key: `mandate:${t.merchant}:${t.card_last4}:${wk}`, level: "warn", title: `${t.merchant} autopay (${inr(t.amount)}) still on closed card ••${t.card_last4}`, body: "It keeps getting declined. Move the mandate to an active card or cancel it at merchantmandate.hdfc.bank.in." });
    }
  }
  return out;
}

export function fmtDate(isoDate: string) {
  const d = new Date(isoDate + "T00:00:00Z");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
}

// Logs and returns only alerts not sent before.
export async function freshAlerts(alerts: Alert[]): Promise<Alert[]> {
  if (!alerts.length) return [];
  const keys = alerts.map((a) => a.key);
  const { data } = await supabaseAdmin.from("cc_reminder_log").select("dedupe_key").in("dedupe_key", keys);
  const sent = new Set((data || []).map((r: any) => r.dedupe_key));
  const fresh = alerts.filter((a) => !sent.has(a.key));
  if (fresh.length) await supabaseAdmin.from("cc_reminder_log").upsert(fresh.map((a) => ({ dedupe_key: a.key })), { onConflict: "dedupe_key", ignoreDuplicates: true });
  return fresh;
}
