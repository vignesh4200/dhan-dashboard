"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { estimateFinanceCharge } from "@/lib/cards/interest";

const inr = (n: number | null | undefined) => (n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN"));
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: iso.length === 10 ? "UTC" : "Asia/Kolkata" }) : "—";
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - +new Date(iso)) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

const DOT: Record<string, string> = { card: "var(--gold)", emi: "var(--c-mf)", loan: "var(--c-stocks)" };
const ICON = {
  warn: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  wallet: "M3 7h18v12H3zM16 13h2M3 7l3-4h12l3 4",
  trend: "M4 17l6-6 4 4 6-6M14 9h6v6",
  cash: "M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6",
};
const Svg = ({ d, color }: { d: string; color: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const chip = (fg: string, bg: string): React.CSSProperties => ({ fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 100, color: fg, background: bg, whiteSpace: "nowrap" });
const input: React.CSSProperties = { background: "var(--surface-inset)", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "9px 11px", color: "var(--text)", fontFamily: "inherit", fontSize: 13, minHeight: 40, width: "100%" };

export default function CardsPage() {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pay, setPay] = useState<"full" | "custom" | "min">("min");
  const [custom, setCustom] = useState("");
  const [paying, setPaying] = useState<string | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/cards").then((r) => {
      if (r.status === 401) { router.push("/login"); return null; }
      return r.json();
    }).then((x) => x && (x.error ? setErr(x.error) : setD(x))).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);

  const post = async (body: any) => {
    setBusy(true);
    const r = await fetch("/api/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { alertBox(j.error || "Could not save"); return false; }
    await load();
    return true;
  };
  const alertBox = (m: string) => setErr(m);

  const sim = useMemo(() => {
    const b = d?.nextCard;
    if (!b) return null;
    const amount = pay === "full" ? b.totalDue : pay === "min" ? Math.max(b.minDue || 0, b.paid) : Number(custom || 0);
    const est = estimateFinanceCharge({
      totalDue: b.totalDue, payAmount: amount, statementDate: b.statementDate, dueDate: b.dueDate,
      txns: d.guardTxns || [], monthlyRatePct: Number(d.cards.find((c: any) => c.last4 === b.last4)?.monthly_rate || 3.75),
    });
    return { amount, ...est, pct: est.shortfall ? Math.round((est.total / est.shortfall) * 100) : 0 };
  }, [d, pay, custom]);

  if (err && !d) return <div className="list-card"><p style={{ color: "var(--loss)" }}>{err}</p></div>;
  if (!d) return <div style={{ padding: "40px 0" }}>Loading…</div>;

  const open = d.bills.filter((b: any) => b.left > 1);
  const in30 = open.filter((b: any) => b.daysLeft <= 30);
  const totalDue = in30.reduce((s: number, b: any) => s + b.left, 0);
  const next = in30[0];
  const shortCount = d.bills.filter((b: any) => b.status === "short" || b.status === "overdue").length;
  const cap = d.spendCap;
  const capPct = cap ? Math.round((Math.max(0, d.cycle.total) / cap) * 100) : null;
  const cats = Object.entries(d.cycle.byCat as Record<string, number>).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const catMax = cats[0]?.[1] || 1;
  const nothingYet = !d.bills.length && !d.txns.length;
  const loans: any[] = d.loans || [];
  const liveLoans = loans.filter((l) => l.status === "active");
  const loanOut = liveLoans.reduce((s, l) => s + (l.outstanding || 0), 0);
  const emiLoad = liveLoans.reduce((s, l) => s + (l.emi || 0), 0);
  const toCheck = loans.filter((l) => l.status === "check" || l.status === "pending");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="dash-header">
        <div>
          <div className="eyebrow">Cards, EMIs &amp; loans</div>
          <h1 className="dash-title">Credit</h1>
        </div>
        <div className="dash-actions">
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Gmail synced {ago(d.lastSyncAt)}</span>
          <button className="pill-btn" onClick={load} disabled={busy}>Refresh</button>
        </div>
      </div>

      {err && <div className="raised" style={{ color: "var(--loss)", fontSize: 13 }}>{err} <button className="btn-ghost btn-sm btn" style={{ marginLeft: 8 }} onClick={() => setErr(null)}>Dismiss</button></div>}

      {nothingYet && (
        <div className="list-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="list-title">Waiting for the first Gmail sync</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Card and loan data arrives from your HDFC, DSP and Groww emails through the Gmail Apps Script (scripts/gmail-card-sync.gs in the repo).
            Once it has run, bills, transactions and reminders show up here. Set the statement PDF password under Setup below so due dates can be read.
          </div>
        </div>
      )}

      <div className="kpi-grid" style={{ marginTop: 0 }}>
        <div className="vault-card vault-hero">
          <div className="vault-label">Total due · next 30 days</div>
          <div className="vault-big">{inr(totalDue)}</div>
          <div className="vault-hero-row">
            <div><div className="vault-label">Next due</div><div className="val" style={{ color: next && next.daysLeft <= 3 ? "var(--loss)" : "var(--text)" }}>{next ? `${fmtDate(next.dueDate)} · ${next.daysLeft <= 0 ? "today" : next.daysLeft + " days"}` : "—"}</div></div>
            <div><div className="vault-label">Bills open</div><div className="val">{open.length}</div></div>
            <div><div className="vault-label">Short / overdue</div><div className="val" style={{ color: shortCount ? "var(--loss)" : "var(--gain)" }}>{shortCount}</div></div>
          </div>
        </div>
        <div className="vault-card">
          <div className="vault-label">Interest &amp; finance charges · 12 months</div>
          <div className="vault-mid" style={{ color: d.interest12m > 0 ? "var(--loss)" : "var(--gain)" }}>{inr(d.interest12m)}</div>
          <div className="vault-sub">From parsed statements</div>
        </div>
        <div className="vault-card">
          <div className="vault-label">Utilisation</div>
          {d.utilisation ? (
            <>
              <div className="vault-mid">{d.utilisation.pct}%</div>
              <div style={{ height: 6, background: "var(--surface-inset)", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${Math.min(100, d.utilisation.pct)}%`, height: 6, background: d.utilisation.pct > 30 ? "var(--amber)" : "var(--gold)" }} /></div>
              <div className="vault-sub">Keep under 30% for CIBIL</div>
            </>
          ) : <div className="vault-sub">Add a credit limit under Setup</div>}
        </div>
        <div className="vault-card">
          <div className="vault-label">Loans outstanding</div>
          <div className="vault-mid">{loanOut > 0 ? inr(loanOut) : "—"}</div>
          <div className="vault-sub">{loanOut > 0 ? `EMIs ${inr(emiLoad)}/month · from loan terms` : "Add loan terms under Setup"}</div>
        </div>
      </div>

      <div className="section-label" style={{ margin: "4px 0 -10px" }}>Everything due · cards &amp; loans</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 18 }}>
        {d.bills.length === 0 && <div className="raised" style={{ fontSize: 13, color: "var(--text-muted)" }}>No bills yet.</div>}
        {d.bills.map((b: any) => {
          const [fg, bg, label] =
            b.status === "paid" ? ["var(--gain)", "var(--gain-soft)", "Paid in full"]
            : b.status === "overdue" ? ["var(--loss)", "var(--loss-soft)", `Overdue ${-b.daysLeft}d`]
            : b.status === "short" ? ["var(--loss)", "var(--loss-soft)", `Short · ${b.daysLeft}d`]
            : b.daysLeft <= 7 ? ["#f3c97a", "rgba(243,201,122,0.13)", b.daysLeft <= 0 ? "Due today" : `${b.daysLeft} days`]
            : ["var(--text-muted)", "rgba(163,173,194,0.12)", `${b.daysLeft} days`];
          const pct = b.totalDue ? Math.min(100, Math.round((b.paid / b.totalDue) * 100)) : 0;
          return (
            <div key={b.key} className="raised" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <b style={{ width: 10, height: 10, display: "block", background: DOT[b.kind] || "var(--gold)", flex: "none" }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{b.kind === "card" ? `••${b.last4} · statement ${fmtDate(b.statementDate)}` : b.statementId ? "Auto-debit · amount from statement" : "Loan EMI · tick when paid"}</div>
                  </div>
                </div>
                <span style={chip(fg, bg)}>{label}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div><div style={{ fontSize: 12, color: "var(--text-muted)" }}>Still to pay</div><div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{inr(b.left)}</div></div>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 12, color: "var(--text-muted)" }}>Due</div><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{fmtDate(b.dueDate)}</div></div>
              </div>
              <div style={{ height: 6, background: "var(--surface-inset)", borderRadius: 999, overflow: "hidden" }}><div style={{ height: 6, width: `${pct}%`, background: "var(--gain)" }} /></div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                {b.status === "paid" ? `Paid ${inr(b.paid)} of ${inr(b.totalDue)}.`
                  : b.kind !== "card" ? `Keep ${inr(b.left)} in your account before ${fmtDate(b.dueDate)}.${d.lastBalance ? ` Last balance seen ${inr(d.lastBalance.amount)}.` : ""}`
                  : `Paid ${inr(b.paid)} of ${inr(b.totalDue)}. Pay the total, not the minimum${b.minDue ? ` (${inr(b.minDue)})` : ""}${b.estIfMinimum ? ` — minimum-only costs about ${inr(b.estIfMinimum)}` : ""}.`}
              </div>
              {b.left > 1 && (paying === b.key ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <label style={{ flex: "1 1 110px" }}><span className="field-label">Amount paid</span><input style={input} inputMode="decimal" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></label>
                  <label style={{ flex: "1 1 130px" }}><span className="field-label">Date</span><input style={input} type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></label>
                  <button className="pill-btn" disabled={busy} onClick={async () => { if (await post({ action: "markPaid", last4: b.kind === "card" ? b.last4 : b.last4, amount: payAmt, date: payDate })) setPaying(null); }}>Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPaying(null)}>Cancel</button>
                </div>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", minHeight: 40 }} onClick={() => { setPaying(b.key); setPayAmt(String(Math.round(b.left))); }}>Mark paid</button>
              ))}
            </div>
          );
        })}
      </div>

      <Loans loans={liveLoans} toCheck={toCheck} post={post} busy={busy} />

      <div className="list-card" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="list-head" style={{ marginBottom: 0, flexWrap: "wrap" }}>
          <div className="list-title">Interest guard</div>
          <span className="src-badge" style={{ color: "var(--text-muted)", marginLeft: 0 }}>3.75%/month + 18% GST once you revolve</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
          <div className="chart-well" style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {d.nextCard && sim ? (
              <>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>What if I pay… <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>{d.nextCard.name} · total due {inr(d.nextCard.totalDue)}</span></div>
                <div className="seg-pill" role="group" aria-label="Payment amount" style={{ alignSelf: "flex-start" }}>
                  <button aria-pressed={pay === "full"} onClick={() => setPay("full")}>Full {inr(d.nextCard.totalDue)}</button>
                  <button aria-pressed={pay === "custom"} onClick={() => setPay("custom")}>Other amount</button>
                  <button aria-pressed={pay === "min"} onClick={() => setPay("min")}>Minimum{d.nextCard.minDue ? ` ${inr(d.nextCard.minDue)}` : ""}</button>
                </div>
                {pay === "custom" && (
                  <label style={{ maxWidth: 220 }}><span className="field-label">Amount I can pay</span><input style={input} inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. 15000" /></label>
                )}
                <div className="vault-hero-row">
                  <div><div className="vault-label">Left unpaid</div><div className="val" style={{ fontSize: 18, fontWeight: 700 }}>{inr(sim.shortfall)}</div></div>
                  <div><div className="vault-label">Est. charge on next statement</div><div className="val" style={{ fontSize: 18, fontWeight: 700, color: sim.total ? "var(--loss)" : "var(--gain)" }}>{sim.total ? `≈ ${inr(sim.total)}` : "₹0"}</div></div>
                  <div><div className="vault-label">As % of unpaid</div><div className="val" style={{ fontSize: 18, fontWeight: 700, color: sim.total ? "var(--loss)" : "var(--gain)" }}>{sim.pct}%</div></div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {sim.total
                    ? `Interest runs on the FULL ${inr(d.nextCard.totalDue)} from each purchase date, not only on the ${inr(sim.shortfall)} left, and new swipes lose their free period until the balance is cleared.`
                    : "Paid in full by the due date: no interest, and the next cycle starts clean."}
                </div>
              </>
            ) : <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No open card bill right now. The simulator appears when a statement arrives.</div>}
          </div>
          <div className="insight-grid" style={{ flex: "1 1 280px", gridTemplateColumns: "1fr" }}>
            <div className="insight-card"><Svg d={ICON.warn} color="var(--loss)" /><div><div className="insight-k">Short-pay alert</div><div className="insight-d">A payment below the total due triggers an urgent email with what's left and the interest it will cost.</div></div></div>
            <div className="insight-card"><Svg d={ICON.wallet} color="var(--gold)" /><div><div className="insight-k">Cash check at T-7</div><div className="insight-d">{d.lastBalance ? `Compares dues with your last seen a/c balance: ${inr(d.lastBalance.amount)} on ${fmtDate(d.lastBalance.at)}.` : "Compares dues with the balance quoted in your HDFC account alerts."}</div></div></div>
            <div className="insight-card"><Svg d={ICON.trend} color="var(--c-mf)" /><div><div className="insight-k">Cheaper than revolving</div><div className="insight-d">Short this month? Converting big spends to EMI before the due date usually costs ~13–20% a year plus a fee, against ~45% + GST when you revolve.</div></div></div>
            <div className="insight-card"><Svg d={ICON.cash} color="#f3c97a" /><div><div className="insight-k">Cash withdrawals flagged</div><div className="insight-d">Interest from day 1, so they're flagged the same day.</div></div></div>
          </div>
        </div>
        {d.worstCharge && (
          <div style={{ background: "var(--loss-soft)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 12, padding: "14px 16px", display: "flex", flexWrap: "wrap", gap: "8px 24px", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}><b>Biggest interest hit in the last year:</b> card ••{d.worstCharge.last4}, statement of {fmtDate(d.worstCharge.statementDate)}. It came from paying less than the total due.</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--loss)", whiteSpace: "nowrap" }}>{inr(d.worstCharge.amount)}</div>
          </div>
        )}
      </div>

      <div className="two-col">
        <div className="list-card">
          <div className="list-head"><div className="list-title">Fee &amp; autopay watch</div></div>
          {d.mandates.map((m: any) => (
            <div className="row-line" key={m.merchant + m.card}>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{m.merchant} autopay {inr(m.amount)}</div><div style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 2 }}>Still on closed card ••{m.card} · {m.kind === "mandate_declined" ? "declined" : "upcoming"} {fmtDate(m.at)}</div></div>
              <span style={chip("var(--loss)", "var(--loss-soft)")}>Move mandate</span>
            </div>
          ))}
          {d.feeWaivers.map((f: any) => (
            <div className="row-line" key={f.last4}>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{f.name} fee waiver</div><div style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 2 }}>{inr(f.spent)} of {inr(f.target)} since {fmtDate(f.yearStart)}{f.fee ? ` · fee ${inr(f.fee)} + GST` : ""}</div></div>
              <span style={chip(f.spent >= f.target ? "var(--gain)" : "var(--text-muted)", f.spent >= f.target ? "var(--gain-soft)" : "rgba(163,173,194,0.12)")}>{Math.round((f.spent / f.target) * 100)}%</span>
            </div>
          ))}
          {d.reviewStatements.map((s: any) => (
            <div className="row-line" key={s.id}>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>Statement {fmtDate(s.statementDate)} · {s.last4}</div><div style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 2 }}>{s.note}</div></div>
              <span style={chip("#f3c97a", "rgba(243,201,122,0.13)")}>Needs a look</span>
            </div>
          ))}
          <div className="row-line">
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>Reward redemption fee</div><div style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 2 }}>HDFC charges ₹99 + GST per redemption request — batch redemptions</div></div>
            <span style={chip("var(--text-muted)", "rgba(163,173,194,0.12)")}>Watch</span>
          </div>
        </div>

        <div className="list-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="list-head" style={{ marginBottom: 0 }}><div className="list-title">Cycle spend vs cap</div><span style={{ fontSize: 12, color: "var(--text-muted)" }}>{cap ? `Cap ${inr(cap)}` : "No cap set"}</span></div>
          <div className="chart-well" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontSize: 28, fontWeight: 700 }}>{inr(Math.max(0, d.cycle.total))}</span><span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{capPct != null ? `${capPct}% · ` : ""}since {fmtDate(d.cycle.cycleStart)}</span></div>
            {cap ? (
              <>
                <div style={{ height: 10, background: "var(--panel-2)", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${Math.min(100, capPct || 0)}%`, height: 10, background: (capPct || 0) >= 90 ? "var(--loss)" : (capPct || 0) >= 70 ? "var(--amber)" : "var(--gold)" }} /></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-muted)", flexWrap: "wrap", gap: 6 }}><span>Alert at 70% ({inr(cap * 0.7)})</span><span>Urgent at 90% ({inr(cap * 0.9)})</span></div>
              </>
            ) : <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Set a monthly cap under Setup to get 70% / 90% alerts.</div>}
          </div>
          {cats.map(([name, v]) => (
            <div key={name} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}><span style={{ color: "var(--text-muted)" }}>{name}</span><span style={{ fontWeight: 600 }}>{inr(v)}</span></div>
              <div style={{ height: 5, background: "var(--surface-inset)", borderRadius: 999, overflow: "hidden" }}><div style={{ height: 5, width: `${Math.round((v / catMax) * 100)}%`, background: "var(--c-stocks)" }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="list-card">
        <div className="list-head"><div className="list-title">Transactions <span className="src-badge" style={{ color: "var(--text-muted)" }}>HDFC alert emails</span></div></div>
        {d.txns.length === 0 ? <div style={{ fontSize: 13, color: "var(--text-muted)" }}>None yet.</div> : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 560 }}>
              {d.txns.map((t: any) => {
                const neg = t.kind === "refund" || t.kind === "payment";
                return (
                  <div key={t.id} style={{ display: "grid", gridTemplateColumns: "72px 1fr 90px 140px 100px", gap: 10, alignItems: "center", padding: "11px 4px", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                    <span style={{ color: "var(--text-muted)" }}>{fmtDate(t.at)}</span>
                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.merchant || "—"}</span>
                    <span style={{ color: "var(--text-muted)" }}>{t.card ? `••${t.card}` : "a/c"}</span>
                    <span style={{ color: t.kind === "cash" ? "var(--loss)" : "var(--text-muted)" }}>{t.kind === "payment" ? "Payment" : t.kind === "cash" ? "Cash — interest from day 1" : t.category || "Other"}</span>
                    <span style={{ textAlign: "right", fontWeight: 600, color: neg ? "var(--gain)" : t.kind === "cash" ? "var(--loss)" : "var(--text)" }}>{neg ? "−" : ""}{inr(t.amount)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="raised" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 18px" }}>
        <div style={{ fontSize: 13 }}><b>Reminders</b> <span style={{ color: "var(--text-muted)" }}>· email{d.hasTelegram ? " + Telegram" : ""}, 8am–10pm, until the total due is cleared</span></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["T-7 + cash check", "T-3", "T-1", "Due day"].map((x) => <span key={x} style={chip("var(--gold-bright)", "var(--gold-soft)")}>{x}</span>)}
          <span style={chip("var(--loss)", "var(--loss-soft)")}>Short-pay · overdue daily</span>
        </div>
      </div>

      <Setup d={d} post={post} busy={busy} />
    </div>
  );
}

function Loans({ loans, toCheck, post, busy }: { loans: any[]; toCheck: any[]; post: (b: any) => Promise<boolean>; busy: boolean }) {
  const [paying, setPaying] = useState<string | null>(null);
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  if (!loans.length && !toCheck.length) return null;
  const terms = (l: any) => [
    l.principal ? inr(l.principal) : null,
    l.annualRate ? `${l.annualRate}%` : l.kind === "emi" && !l.interestOnly && l.emi ? "no interest" : null,
    l.interestOnly ? "interest only" : l.emisTotal ? `${l.emisTotal} EMIs` : null,
    l.lastEmi ? `ends ${new Date(l.lastEmi + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <>
      <div className="section-label" style={{ margin: "4px 0 -10px" }}>Loans &amp; EMIs</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 18 }}>
        {loans.map((l) => {
          const b = l.next;
          const pct = l.emisTotal && l.emisDone != null ? Math.round((l.emisDone / l.emisTotal) * 100) : null;
          const paid = b && b.left <= 1;
          return (
            <div key={l.key} className="raised" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <b style={{ width: 10, height: 10, display: "block", background: l.interestOnly ? "var(--c-stocks)" : "var(--c-mf)", flex: "none" }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{terms(l) || (l.note ?? "")}</div>
                  </div>
                </div>
                <span style={chip(l.interestOnly ? "var(--c-stocks)" : "var(--c-mf)", l.interestOnly ? "rgba(122,162,255,0.14)" : "var(--amber-soft)")}>{l.interestOnly ? "Interest" : "EMI"}</span>
              </div>
              {pct != null && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ height: 6, background: "var(--surface-inset)", borderRadius: 999, overflow: "hidden" }}><div style={{ height: 6, width: `${Math.max(2, pct)}%`, background: "var(--gold)" }} /></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-muted)", gap: 8, flexWrap: "wrap" }}>
                    <span>{l.emisDone} of {l.emisTotal} EMIs done</span>
                    {l.outstanding != null && <span>{inr(l.outstanding)} left{l.outstandingIsEstimate ? " (est.)" : ""}</span>}
                  </div>
                </div>
              )}
              {l.note && pct != null && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{l.note}</div>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{b ? `${paid ? "Paid" : "Next"} · ${fmtDate(b.dueDate)}` : "Next"}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, color: b && b.status === "overdue" ? "var(--loss)" : paid ? "var(--gain)" : "var(--text)" }}>
                    {b ? inr(paid ? b.totalDue : b.left) : l.interestOnly ? <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>Awaiting statement email</span> : l.emi ? inr(l.emi) : <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>From next statement</span>}
                  </div>
                </div>
                {b && !paid && (paying === l.key ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ flex: "1 1 100px" }}><span className="field-label">Amount</span><input style={input} inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
                    <label style={{ flex: "1 1 130px" }}><span className="field-label">Date</span><input style={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
                    <button className="pill-btn" disabled={busy} onClick={async () => { if (await post({ action: "markPaid", last4: l.key, amount: amt, date })) setPaying(null); }}>Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setPaying(null)}>Cancel</button>
                  </div>
                ) : (
                  <button className="pill-btn" disabled={busy} onClick={() => { setPaying(l.key); setAmt(String(Math.round(b.left * 100) / 100)); setDate(new Date().toISOString().slice(0, 10)); }}>Mark {fmtDate(b.dueDate)} paid</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {toCheck.map((l) => (
        <div key={l.key} className="raised" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 18px" }}>
          <div style={{ minWidth: 0, flex: "1 1 300px" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{l.name}{l.emi ? ` · ${inr(l.emi)}${l.dueDay ? ` on the ${l.dueDay}${["th", "st", "nd", "rd"][l.dueDay % 10 > 3 || [11, 12, 13].includes(l.dueDay) ? 0 : l.dueDay % 10]}` : ""}` : ""}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>{l.note || (l.status === "pending" ? "Not started yet" : "Still running?")}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {l.status === "check" ? (
              <>
                <button className="btn btn-ghost btn-sm" style={{ minHeight: 40 }} disabled={busy} onClick={() => post({ action: "setStatus", last4: l.key, status: "active" })}>Still running</button>
                <button className="pill-btn" disabled={busy} onClick={() => post({ action: "setStatus", last4: l.key, status: "closed" })}>Closed</button>
              </>
            ) : (
              <>
                <button className="btn btn-ghost btn-sm" style={{ minHeight: 40 }} disabled={busy} onClick={() => post({ action: "setStatus", last4: l.key, status: "closed" })}>Didn&apos;t take it</button>
                <span style={chip("var(--text-muted)", "rgba(163,173,194,0.12)")}>Pending</span>
              </>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}><span className="field-label" style={{ marginBottom: 0 }}>{label}</span>{children}</label>;
}

function Setup({ d, post, busy }: { d: any; post: (b: any) => Promise<boolean>; busy: boolean }) {
  const [pw, setPw] = useState("");
  const [cap, setCap] = useState(d.spendCap ? String(d.spendCap) : "");
  const blank = { last4: "", name: "", kind: "card", status: "active", credit_limit: "", monthly_rate: "3.75", emi_amount: "", emi_due_day: "", annual_fee: "", fee_waiver_spend: "", card_year_start: "", principal: "", annual_rate: "", tenure_months: "", first_emi_date: "", last_emi_date: "", interest_only: "false", track_from: "", note: "" };
  const [card, setCard] = useState<any>(blank);
  const [st, setSt] = useState<any>({ last4: "", statementDate: "", dueDate: "", totalDue: "", minDue: "" });
  const f = (k: string, v: string) => setCard((c: any) => ({ ...c, [k]: v }));
  const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: 12 };

  return (
    <details className="list-card">
      <summary style={{ cursor: "pointer", fontFamily: "var(--font-display)", fontSize: 20, minHeight: 32 }}>Setup</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="insight-k">Statement PDF password {d.hasPdfPassword && <span style={{ ...chip("var(--gain)", "var(--gain-soft)"), marginLeft: 6 }}>Saved</span>}</div>
          <div className="insight-d">HDFC statement PDFs are locked (for HDFC cards usually the first 4 letters of your name in capitals + DDMM of your date of birth). Stored encrypted; one per line if your cards use different ones.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <textarea style={{ ...input, maxWidth: 320, minHeight: 44 }} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={d.hasPdfPassword ? "Enter to replace" : "Password"} aria-label="Statement PDF password" />
            <button className="pill-btn" disabled={busy || !pw.trim()} onClick={async () => { if (await post({ action: "saveSettings", pdfPassword: pw })) setPw(""); }}>Save password</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="insight-k">Monthly spend cap</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...input, maxWidth: 200 }} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="e.g. 40000" aria-label="Monthly spend cap" />
            <button className="pill-btn" disabled={busy} onClick={() => post({ action: "saveSettings", spendCap: cap })}>Save cap</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="insight-k">Cards, EMIs &amp; loans</div>
          <div className="insight-d">Loans that don&apos;t email a debit (e.g. HDFC Personal Loan) need a tick each month; reminders continue daily after the due date until you do.</div>
          {d.cards.map((c: any) => (
            <div className="row-line" key={c.last4}>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{c.name} <span className="sub">{c.kind === "card" ? `••${c.last4}` : c.kind}</span></div>
                <div style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 2 }}>{c.status}{c.credit_limit ? ` · limit ${inr(Number(c.credit_limit))}` : ""}{c.emi_amount ? ` · EMI ${inr(Number(c.emi_amount))} on day ${c.emi_due_day}` : ""}</div></div>
              <button className="btn btn-ghost btn-sm" onClick={() => setCard(Object.fromEntries(Object.entries({ ...blank, ...c }).map(([k, v]) => [k, v == null ? "" : String(v)])))}>Edit</button>
            </div>
          ))}
          <div style={grid}>
            <L label="Last 4 digits, or a short code for a loan"><input style={input} value={card.last4} onChange={(e) => f("last4", e.target.value)} /></L>
            <L label="Name"><input style={input} value={card.name} onChange={(e) => f("name", e.target.value)} placeholder="HDFC Swiggy" /></L>
            <L label="Type"><select style={input} value={card.kind} onChange={(e) => f("kind", e.target.value)}><option value="card">Credit card</option><option value="emi">EMI</option><option value="loan">Loan</option></select></L>
            <L label="Status"><select style={input} value={card.status} onChange={(e) => f("status", e.target.value)}><option value="active">Active</option><option value="closed">Closed</option><option value="check">Needs a check</option><option value="pending">Pending</option></select></L>
            <L label="Credit limit"><input style={input} inputMode="decimal" value={card.credit_limit} onChange={(e) => f("credit_limit", e.target.value)} /></L>
            <L label="Interest % / month"><input style={input} inputMode="decimal" value={card.monthly_rate} onChange={(e) => f("monthly_rate", e.target.value)} /></L>
            <L label="EMI amount (EMI / loan)"><input style={input} inputMode="decimal" value={card.emi_amount} onChange={(e) => f("emi_amount", e.target.value)} /></L>
            <L label="EMI day of month"><input style={input} inputMode="numeric" value={card.emi_due_day} onChange={(e) => f("emi_due_day", e.target.value)} /></L>
            <L label="Annual fee"><input style={input} inputMode="decimal" value={card.annual_fee} onChange={(e) => f("annual_fee", e.target.value)} /></L>
            <L label="Fee waived above spend of"><input style={input} inputMode="decimal" value={card.fee_waiver_spend} onChange={(e) => f("fee_waiver_spend", e.target.value)} /></L>
            <L label="Card year starts"><input style={input} type="date" value={card.card_year_start} onChange={(e) => f("card_year_start", e.target.value)} /></L>
          </div>
          {card.kind !== "card" && (
            <div style={grid}>
              <L label="Loan amount"><input style={input} inputMode="decimal" value={card.principal} onChange={(e) => f("principal", e.target.value)} /></L>
              <L label="Interest % / year"><input style={input} inputMode="decimal" value={card.annual_rate} onChange={(e) => f("annual_rate", e.target.value)} /></L>
              <L label="Tenure (months)"><input style={input} inputMode="numeric" value={card.tenure_months} onChange={(e) => f("tenure_months", e.target.value)} /></L>
              <L label="First EMI"><input style={input} type="date" value={card.first_emi_date} onChange={(e) => f("first_emi_date", e.target.value)} /></L>
              <L label="Last EMI"><input style={input} type="date" value={card.last_emi_date} onChange={(e) => f("last_emi_date", e.target.value)} /></L>
              <L label="Repayment"><select style={input} value={card.interest_only} onChange={(e) => f("interest_only", e.target.value)}><option value="false">EMI</option><option value="true">Interest only</option></select></L>
              <L label="Note"><input style={input} value={card.note} onChange={(e) => f("note", e.target.value)} /></L>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pill-btn" disabled={busy} onClick={async () => { if (await post({ action: "saveCard", ...card })) setCard(blank); }}>Save card</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCard(blank)}>Clear</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="insight-k">Add a bill by hand</div>
          <div className="insight-d">For a statement the PDF reader couldn't read, or a bill that never came by email.</div>
          <div style={grid}>
            <L label="Card"><select style={input} value={st.last4} onChange={(e) => setSt({ ...st, last4: e.target.value })}><option value="">Choose…</option>{d.cards.map((c: any) => <option key={c.last4} value={c.last4}>{c.name}</option>)}</select></L>
            <L label="Statement date"><input style={input} type="date" value={st.statementDate} onChange={(e) => setSt({ ...st, statementDate: e.target.value })} /></L>
            <L label="Due date"><input style={input} type="date" value={st.dueDate} onChange={(e) => setSt({ ...st, dueDate: e.target.value })} /></L>
            <L label="Total due"><input style={input} inputMode="decimal" value={st.totalDue} onChange={(e) => setSt({ ...st, totalDue: e.target.value })} /></L>
            <L label="Minimum due"><input style={input} inputMode="decimal" value={st.minDue} onChange={(e) => setSt({ ...st, minDue: e.target.value })} /></L>
          </div>
          <div><button className="pill-btn" disabled={busy} onClick={async () => { if (await post({ action: "saveStatement", ...st })) setSt({ last4: "", statementDate: "", dueDate: "", totalDue: "", minDue: "" }); }}>Save bill</button></div>
        </div>
      </div>
    </details>
  );
}
