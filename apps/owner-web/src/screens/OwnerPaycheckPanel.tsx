// OwnerPaycheckPanel.tsx — the Owner App's weekly paycheck approval (Weekly Technician Paycheck mandate §9, Oct 21 2026).
// What the manager submitted: each technician's payable and how it is paid (check / cash), every custom split with the
// manager's reason, what needs a look, and last week for comparison. APPROVE ALL, or hold selected technicians and
// approve the rest (security PIN); RETURN FOR CHANGES or REJECT (a note the manager sees). A held statement is approved
// later on its own. The server decides every figure; the PIN is checked on the server.
import { useEffect, useState } from 'react';
import type { PaycheckOwnerSummary, PaycheckWeek, PayStatementDetail, PayrollTechnicianDetail } from '@aipowersalon/api-contracts/tenant';
import { ownerPayrollApi, ownerContextApi } from '../api/ownerApi';
import { t as tr, getLanguage } from '@aipowersalon/mobile-sdk';
import { formatCurrency } from '@aipowersalon/money';

const money = (c: number): string => formatCurrency(c, { fractionDigits: 2 });
const byMethod = (s: PayStatementDetail, m: string) => (s.plan?.instructions ?? []).filter((i) => i.status !== 'canceled' && i.method === m).reduce((a, i) => a + i.amountCents, 0);
const STATUS: Record<string, string> = { draft: 'With the manager', ready_for_review: 'With the manager', submitted: 'Waiting for you', held: 'Held', approved: 'Approved', locked: 'Approved · unpaid', issued: 'Being paid', partially_paid: 'Partially paid', paid: 'Paid' };
const hoursOf = (m: number) => (Math.round((Number(m) || 0) / 6) / 10).toFixed(1);

/** §9.5 (Oct 27 2026): the evidence behind one statement — the services, tips by ticket, the time clock and the adjustments
 *  that made the figures — fetched on demand from the same drill-down the POS uses (the server, never this screen, decides). */
function EvidencePanel({ periodId, technicianId }: { periodId: string; technicianId: string }) {
  const [ev, setEv] = useState<PayrollTechnicianDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { ownerPayrollApi.paycheckEvidence(periodId, technicianId).then((r) => { setEv(r); setErr(null); }).catch((e: any) => setErr(e?.message || tr('owner.paycheck.evidence.failed'))); }, [periodId, technicianId]);
  if (err) return <div className="owner-text-muted" role="alert" style={{ fontSize: 12, color: 'var(--owner-danger)' }}>{err}</div>;
  if (!ev) return <div className="owner-text-muted" style={{ fontSize: 12 }}>{tr('owner.paycheck.evidence.loading')}</div>;
  const h = ev.hours;
  const more = (n: number, shown: number) => (n > shown ? <div className="owner-text-muted" style={{ fontSize: 11 }}>{tr('owner.paycheck.evidence.more', { n: String(n - shown) })}</div> : null);
  return (
    <div className="owner-settingspanel" style={{ margin: '0 0 8px' }} data-testid="owner-evidence">
      <div><div className="k">{tr('owner.paycheck.evidence.services', { n: String(ev.services.length) })}</div><div className="v">{ev.services.length ? <>{ev.services.slice(0, 25).map((x, i) => <div key={`${x.ticketId}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}><span>{x.completedAt.slice(0, 10)} · {x.serviceName}</span><span>{money(x.lineTotalCents)} → {money(x.commissionCents)}</span></div>)}{more(ev.services.length, 25)}</> : tr('owner.paycheck.evidence.none')}</div></div>
      <div><div className="k">{tr('owner.paycheck.evidence.tips', { n: String(ev.tips.length) })}</div><div className="v">{ev.tips.length ? <>{ev.tips.slice(0, 25).map((x) => <div key={x.ticketId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}><span>{x.ticketId.slice(0, 8)}</span><span>{money(x.cardTipCents)} + {money(x.cashTipCents)}</span></div>)}{more(ev.tips.length, 25)}</> : tr('owner.paycheck.evidence.none')}</div></div>
      <div><div className="k">{tr('owner.paycheck.evidence.hours')}</div><div className="v">{h && h.entries.length ? <>
        {h.entries.map((e) => <div key={e.shiftId} style={{ fontSize: 12 }}>{tr('owner.paycheck.evidence.hoursLine', { date: e.shiftDate, clocked: String(e.workedMinutes), scheduled: String(e.scheduledMinutes), breaks: String(e.breakMinutes), paid: String(e.paidMinutes) })}{e.open ? <span style={{ color: 'var(--owner-danger)' }}> · {tr('owner.paycheck.evidence.openPunch')}</span> : null}</div>)}
        {h.plan && h.plan.hourlyRateCents != null ? <div style={{ fontSize: 12, fontWeight: 700 }}>{tr('owner.paycheck.evidence.hoursTotal', { hours: hoursOf(h.totals.paidMinutes), rate: money(h.plan.hourlyRateCents), pay: money(h.totals.computedHourlyPayCents) })}{h.totals.matchesLine ? null : <span style={{ color: 'var(--owner-danger)' }}> · {tr('owner.paycheck.evidence.clockMismatch')}</span>}</div> : null}
      </> : tr('owner.paycheck.evidence.none')}</div></div>
      <div><div className="k">{tr('owner.paycheck.evidence.adjustments', { n: String(ev.adjustments.length) })}</div><div className="v">{ev.adjustments.length ? ev.adjustments.map((a) => <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}><span>{a.category} · {a.reason}</span><span>{money(a.amountCents)}</span></div>) : tr('owner.paycheck.evidence.none')}</div></div>
    </div>
  );
}

/** 17.5 (Oct 27 2026): an approved statement's pay stub — the server's PDF from the locked snapshot, saved as a file */
const STUB_READY = ['locked', 'issued', 'partially_paid', 'paid'];
function PayStubButton({ id, number }: { id: string; number: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async () => {
    setBusy(true); setNote(null);
    try {
      const blob = await ownerPayrollApi.paycheckPayStub(id, getLanguage());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `pay-stub-${number}.pdf`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNote({ ok: true, text: tr('owner.paycheck.stub.done') });
    } catch (e) { setNote({ ok: false, text: (e as { message?: string })?.message || tr('owner.paycheck.stub.failed') }); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
      <button className="owner-tab" disabled={busy} onClick={go}>{busy ? tr('owner.paycheck.stub.preparing') : tr('owner.paycheck.stub.download')}</button>
      {note ? <span role={note.ok ? 'status' : 'alert'} style={{ fontSize: 12, color: note.ok ? 'var(--owner-success)' : 'var(--owner-danger)' }}>{note.text}</span> : null}
    </div>
  );
}

export function OwnerPaycheckPanel({ week, onChanged }: { week: PaycheckWeek; onChanged: (w: PaycheckWeek | null) => void }) {
  const p = week.period;
  const [hold, setHold] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [mode, setMode] = useState<'approve' | 'returned' | 'rejected' | null>(null);
  const [heldId, setHeldId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const waiting = p.status === 'review' && !!p.submittedAt;
  const [summary, setSummary] = useState<PaycheckOwnerSummary | null>(null);
  useEffect(() => { Promise.resolve().then(() => ownerPayrollApi.paycheckSummary()).then((r) => setSummary(r ?? null)).catch(() => setSummary(null)); }, [week]);
  const t = week.totals;
  // §66/§67: a 200-statement week is reviewed by exception — the server narrows the list
  const [exOnly, setExOnly] = useState(!!week.view?.exceptionsOnly);
  const [q, setQ] = useState(week.view?.search ?? '');
  // §66: Filter Branch — the branches this owner is assigned in this salon (the API scopes the week to one of them)
  const [branchId, setBranchId] = useState(week.view?.branchId ?? '');
  const [branches, setBranches] = useState<Array<{ branchId: string; name: string }>>([]);
  useEffect(() => {
    Promise.resolve().then(() => ownerContextApi.context())
      .then((c) => setBranches((c?.allowedBranches ?? []).map((b) => ({ branchId: b.branchId, name: b.branchName || b.salonName }))))
      .catch(() => setBranches([]));
  }, []);
  const filter = { exceptionsOnly: exOnly, search: q, branchId };
  const refilter = (f: { exceptionsOnly: boolean; search: string; branchId: string }) => { ownerPayrollApi.paycheckWeek(p.id, f).then((w) => onChanged(w)).catch((e: any) => setErr(e?.message || 'Could not filter the week.')); };

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setErr(null);
    try { await fn(); onChanged(await ownerPayrollApi.paycheckWeek(p.id, filter)); setDone(msg); setMode(null); setHeldId(null); setPin(''); setNote(''); setHold([]); }
    catch (e: any) { setErr(e?.message || 'That could not be completed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div className="owner-sechead"><div className="h">Weekly paychecks</div><div className="d">{p.periodStart} – {p.periodEnd}{p.payDate ? ` · pay day ${p.payDate}` : ''}</div></div>
      {waiting ? <div className="owner-pill" style={{ marginBottom: 8 }}>Payroll approval required</div> : null}
      {p.ownerDecision === 'returned' || p.ownerDecision === 'rejected' ? <div className="owner-text-muted" style={{ fontSize: 12, marginBottom: 8 }}>{p.ownerDecision === 'rejected' ? 'You rejected this payroll' : 'You returned this payroll'}: {p.ownerNote}</div> : null}
      <div className="owner-kpigrid" style={{ marginBottom: 6 }}>
        <div className="owner-kpi"><div className="label">Payable</div><div className="val">{money(t.payableCents)}</div></div>
        <div className="owner-kpi"><div className="label">Technicians</div><div className="val">{t.technicians}</div></div>
      </div>
      <div className="owner-kpigrid three" style={{ marginBottom: 6 }}>
        <div className="owner-kpi"><div className="label">{tr('owner.paycheck.gross')}</div><div className="val">{money(t.grossEarningsCents)}</div></div>
        <div className="owner-kpi"><div className="label">{tr('owner.paycheck.alreadyPaid')}</div><div className="val">{money(t.alreadyPaidCents)}</div></div>
        <div className="owner-kpi"><div className="label">{tr('owner.paycheck.otherMethods')}</div><div className="val">{money(t.otherCents)}</div></div>
      </div>
      <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
        <div className="owner-kpi"><div className="label">By check</div><div className="val">{money(t.checkCents)}</div></div>
        <div className="owner-kpi"><div className="label">In cash</div><div className="val">{money(t.cashCents)}</div></div>
        <div className="owner-kpi"><div className="label">Unpaid</div><div className="val">{money(t.unpaidCents)}</div></div>
      </div>
      <div className="owner-text-muted" style={{ fontSize: 12, margin: '0 2px 10px' }}>
        {week.previousPayableCents != null ? `Last week ${money(week.previousPayableCents)} · ` : ''}{t.overrides} custom split{t.overrides === 1 ? '' : 's'} · {t.exceptions} need{t.exceptions === 1 ? 's' : ''} a look
      </div>
      {summary ? <div className="owner-text-muted" style={{ fontSize: 12, margin: '0 2px 10px' }}>All weeks: {money(summary.unpaidCents)} approved and unpaid · {summary.cashAwaitingHandoff} cash envelope{summary.cashAwaitingHandoff === 1 ? '' : 's'} ({money(summary.cashAwaitingHandoffCents)}) to hand over · {summary.checksAwaitingDelivery} check{summary.checksAwaitingDelivery === 1 ? '' : 's'} to deliver{summary.exceptionPayouts ? ` · ${summary.exceptionPayouts} payout problem${summary.exceptionPayouts === 1 ? '' : 's'}` : ''}</div> : null}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 2px 10px' }}>
        <label className="owner-text-muted" style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={exOnly} onChange={(e) => { setExOnly(e.target.checked); refilter({ exceptionsOnly: e.target.checked, search: q, branchId }); }} />Show exceptions only</label>
        <input aria-label="Search technician" placeholder="Search technician" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') refilter({ exceptionsOnly: exOnly, search: q, branchId }); }} onBlur={() => refilter({ exceptionsOnly: exOnly, search: q, branchId })} style={{ flex: 1, minWidth: 160, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--owner-border, #e5ddd1)' }} />
        {branches.length > 1 ? (
          <select aria-label={tr('owner.paycheck.branchFilter')} value={branchId} onChange={(e) => { setBranchId(e.target.value); refilter({ exceptionsOnly: exOnly, search: q, branchId: e.target.value }); }}
            style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--owner-border, #e5ddd1)' }}>
            <option value="">{tr('owner.paycheck.allBranches')}</option>
            {branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
          </select>
        ) : null}
        {week.view && (week.view.exceptionsOnly || week.view.search || week.view.branchId) ? <span className="owner-text-muted" style={{ fontSize: 12 }}>Showing {week.view.matched} of {week.view.total}</span> : null}
      </div>
      <div className="owner-drill">
        {week.statements.map((s) => {
          const isOpen = open === s.id;
          return (
            <div key={s.id}>
              <div className="owner-drillrow">
                {waiting ? <input type="checkbox" aria-label={`Hold ${s.technicianName || 'technician'}`} checked={hold.includes(s.technicianId)} onChange={(e) => setHold(e.target.checked ? [...hold, s.technicianId] : hold.filter((x) => x !== s.technicianId))} style={{ marginRight: 8 }} /> : null}
                <button style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)}>
                  <div style={{ fontWeight: 700 }}>{s.technicianName || 'Technician'} {s.plan?.differsFromDefault ? <span style={{ color: 'var(--owner-warning, #a96f22)', fontSize: 11 }}>· custom split</span> : null}{s.reviewRequired ? <span style={{ color: 'var(--owner-danger)', fontSize: 11 }}> · owes more than earned</span> : null}{(s.exceptions ?? []).filter((x) => x.code !== 'NEGATIVE_PAYABLE').map((x) => <span key={x.code} style={{ color: 'var(--owner-warning, #a96f22)', fontSize: 11 }}> · {x.message}</span>)}</div>
                  <div className="owner-text-muted" style={{ fontSize: 12 }}>{STATUS[s.status] ?? s.status} · check {money(byMethod(s, 'check'))} · cash {money(byMethod(s, 'cash'))}</div>
                </button>
                <div style={{ fontWeight: 700, marginLeft: 10 }}>{money(s.approvedPayableCents)}</div>
              </div>
              {isOpen ? (
                <div className="owner-settingspanel" style={{ margin: '0 0 8px' }}>
                  <div><div className="k">Statement</div><div className="v">{s.statementNumber}</div></div>
                  <div><div className="k">Service commission</div><div className="v">{money(s.serviceCommissionCents)}</div></div>
                  {s.hourlyPayCents || s.salaryPayCents ? <div><div className="k">Hourly / salary</div><div className="v">{money(s.hourlyPayCents + s.salaryPayCents)}</div></div> : null}
                  <div><div className="k">Tips (card / cash)</div><div className="v">{money(s.cardTipCents)} / {money(s.cashTipCents)}</div></div>
                  {s.retailCommissionCents ? <div><div className="k">Retail commission</div><div className="v">{money(s.retailCommissionCents)}</div></div> : null}
                  {s.bonusCents ? <div><div className="k">Bonus</div><div className="v">{money(s.bonusCents)}</div></div> : null}
                  {s.deductionsCents ? <div><div className="k">Deductions</div><div className="v">−{money(s.deductionsCents)}</div></div> : null}
                  {s.reversalsCents ? <div><div className="k">{tr('owner.paycheck.reversals')}</div><div className="v">−{money(s.reversalsCents)}<div className="owner-text-muted" style={{ fontSize: 11 }}>{tr('owner.paycheck.reversalDetail', { refund: money(s.refundReversalCents ?? 0), tip: money(s.tipAdjustmentCents ?? 0), retail: money(s.retailReversalCents ?? 0) })}</div></div></div> : null}
                  {s.alreadyPaidCents ? <div><div className="k">Already paid</div><div className="v">−{money(s.alreadyPaidCents)}</div></div> : null}
                  <div><div className="k" style={{ fontWeight: 700 }}>Payable</div><div className="v" style={{ fontWeight: 700 }}>{money(s.approvedPayableCents)}</div></div>
                  {s.plan?.overrideReason ? <div><div className="k">Manager's reason</div><div className="v">{s.plan.overrideReason}</div></div> : null}
                  {s.branchBreakdown.length > 1 ? s.branchBreakdown.map((b) => <div key={b.branchId ?? 'x'}><div className="k">{b.branchName || 'Branch'}</div><div className="v">{money(b.serviceEarningsCents)}</div></div>) : null}
                  <button className="owner-tab" style={{ marginTop: 4 }} onClick={() => setEvidence(evidence === s.id ? null : s.id)}>{evidence === s.id ? tr('owner.paycheck.evidence.hide') : tr('owner.paycheck.evidence.show')}</button>
                  {STUB_READY.includes(s.status) ? <PayStubButton id={s.id} number={s.statementNumber} /> : null}
                  {s.status === 'held' ? <button className="owner-btn" disabled={busy} onClick={() => { setHeldId(s.id); setMode(null); setPin(''); }}>Approve {s.technicianName || 'this statement'}</button> : null}
                </div>
              ) : null}
              {isOpen && evidence === s.id ? <EvidencePanel periodId={p.id} technicianId={s.technicianId} /> : null}
            </div>
          );
        })}
      </div>

      {done ? <div className="owner-state" style={{ color: 'var(--owner-success)', fontWeight: 700 }}>{done}</div> : null}
      {err ? <div className="owner-state" role="alert" style={{ color: 'var(--owner-danger)' }}>{err}</div> : null}

      {waiting && !mode && !heldId ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button className="owner-btn" style={{ flex: 1 }} onClick={() => { setMode('approve'); setPin(''); setErr(null); }}>{hold.length ? `Approve, hold ${hold.length}` : 'Approve all'}</button>
          <button className="owner-tab" style={{ flex: 1 }} onClick={() => { setMode('returned'); setNote(''); setErr(null); }}>Return for changes</button>
          <button className="owner-tab" style={{ flex: 1, color: 'var(--owner-danger)' }} onClick={() => { setMode('rejected'); setNote(''); setErr(null); }}>Reject</button>
        </div>
      ) : null}

      {mode === 'approve' || heldId ? (
        <div className="owner-chartcard" style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{heldId ? 'Approve the held statement' : hold.length ? `Approve ${t.technicians - hold.length}, hold ${hold.length}` : 'Approve this week\'s payroll'}</div>
          <div className="owner-text-muted" style={{ fontSize: 12, marginBottom: 10 }}>Enter your security PIN. Approved statements are locked; checks and cash can then be paid out.</div>
          <input className="owner-input" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Security PIN" aria-label="Security PIN" style={{ width: '100%', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="owner-btn" style={{ flex: 1 }} disabled={busy || !pin} onClick={() => run(() => (heldId ? ownerPayrollApi.paycheckApproveHeld(heldId, pin) : ownerPayrollApi.paycheckApprove(p.id, pin, { expectedVersion: p.version, holdTechnicianIds: hold })), 'Payroll approved.')}>{busy ? 'Working…' : 'Confirm'}</button>
            <button className="owner-tab" style={{ flex: 1 }} disabled={busy} onClick={() => { setMode(null); setHeldId(null); setPin(''); }}>Cancel</button>
          </div>
        </div>
      ) : null}

      {mode === 'returned' || mode === 'rejected' ? (
        <div className="owner-chartcard" style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{mode === 'rejected' ? 'Reject this payroll' : 'Return to the manager'}</div>
          <textarea className="owner-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for the manager" placeholder={mode === 'rejected' ? 'Why is it rejected?' : 'What should the manager change?'} style={{ width: '100%', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="owner-btn" style={{ flex: 1 }} disabled={busy || note.trim().length < 3} onClick={() => run(() => (mode === 'rejected' ? ownerPayrollApi.paycheckReject(p.id, note.trim(), p.version) : ownerPayrollApi.paycheckReturn(p.id, note.trim(), p.version)), mode === 'rejected' ? 'Payroll rejected — the manager was told why.' : 'Returned to the manager.')}>{busy ? 'Working…' : 'Send'}</button>
            <button className="owner-tab" style={{ flex: 1 }} disabled={busy} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
