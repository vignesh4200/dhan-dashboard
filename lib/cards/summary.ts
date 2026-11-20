// Builds the Credit Cards picture from the cc_* tables: open bills, what's
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

  // Latest statement per card/EMI that has a due date.
  const latest = new Map<string, any>();
  for (const s of d.statements) {
    if (!s.due_date || s.total_due == null) continue;
    if (!latest.has(s.card_last4)) latest.set(s.card_last4, s);
  }

  // Payments: attributed ones go to their card; unattributed ones (a UPI debit
  // to CRED / a card-bill payee) fill the open bill due soonest.
  const attributed = new Map<string, any[]>();
  const loose: any[] = [];
  for (const p of d.payments) (p.card_last4 ? (attributed.get(p.card_last4) || attributed.set(p.card_last4, []).get(p.card_last4)!) : loose).push(p);

  for (const [last4, s] of latest) {
    const card = cardBy.get(last4) || { name: `HDFC card ••${last4}`, kind: "card", monthly_rate: 3.75 };
    const cycleStart = s.statement_date || new Date(+new Date(s.due_date) - 20 * DAY).toISOString().slice(0, 10);
    const paid = (attributed.get(last4) || [])
      .filter((p) => p.paid_at.slice(0, 10) > cycleStart)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    // Only the current cycle matters; older bills are history.
    if (daysBetween(s.due_date, today) > 35) continue;
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

  // EMI / loan rows without a fresh statement: next due from emi_due_day.
  for (const c of d.cards) {
    if (c.status !== "active" || c.kind === "card" || !c.emi_amount || !c.emi_due_day) continue;
    const s = latest.get(c.last4);
    if (s && daysBetween(today, s.due_date) >= -2) continue;
    const t = new Date(today + "T00:00:00Z");
    let due = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), c.emi_due_day));
    if (+due < +t - 2 * DAY) due = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, c.emi_due_day));
    const dueDate = due.toISOString().slice(0, 10);
    bills.push({
      key: `emi:${c.last4}:${dueDate}`, statementId: null, last4: c.last4, name: c.name, kind: c.kind,
      statementDate: null, dueDate, totalDue: Number(c.emi_amount), minDue: Number(c.emi_amount), paid: 0,
      left: Number(c.emi_amount), daysLeft: daysBetween(today, dueDate), status: "open", autoDebit: true, estIfMinimum: null,
    });
  }

  return bills.sort((a, b) => (a.left > 0 ? 0 : 1) - (b.left > 0 ? 0 : 1) || a.dueDate.localeCompare(b.dueDate));
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
      out.push({ key: `overdue:${b.key}:${today}`, level: "urgent", title: `OVERDUE ${-dl}d: ${who} — ${inr(b.left)}`, body: `Due date was ${fmtDate(b.dueDate)}. Pay now to stop late fees and further interest. Already paid? Tap "Mark paid" on the Credit Cards page so reminders stop.${interest}` });
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
