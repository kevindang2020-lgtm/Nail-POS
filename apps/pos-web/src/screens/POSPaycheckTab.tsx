// POSPaycheckTab.tsx — Team › Payroll › Weekly paychecks (Weekly Technician Paycheck mandate, Oct 21 2026). The SAME
// payroll (its periods and lines), carried to the technician's hand:
//   the week → Calculate (statements, the salon's 50 / 50 default split) → the manager reviews each technician, changes a
//   split when needed (percent or dollars, with a reason the owner sees) → Submit to the owner → the owner approves (all, or
//   holding some), returns or rejects → checks (number, deliver, void + replacement) and cash (from the drawer, the safe or
//   the bank; hand over; the technician's PIN) → partially paid / paid.
// The server decides every figure; this screen only sends choices (a split, a check number, a cash source, a PIN).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KpiCard, StatusBadge, DataTable, EmptyState, Drawer, parseDollarsToCents, qrPath, type Column, type Tone } from '@aipowersalon/ui';
import type { PaycheckOwnerSummary, PaycheckWeek, PayStatementDetail, PaycheckPayout, PaycheckReport, PayrollScheduleView, PaycheckPolicyType, CashSource, PaycheckPreparationReport, PaycheckHandoffToken, PayrollTechnicianDetail } from '@aipowersalon/api-contracts/tenant';
import { posPayrollApi } from '../api/posPayrollApi';
import { t as tx, getLanguage } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
import { displayLocale, fmtInZone, fmtDateTime } from '../i18n/format';
type StepUp = <T>(action: () => Promise<T>) => Promise<T>;
type PeriodRow = { id: string; label: string | null; periodStart: string; periodEnd: string; status: string };
const money = (c: number | null | undefined) => { const n = Math.trunc(Number(c) || 0); const a = Math.abs(n); return `${n < 0 ? '−' : ''}$${Math.floor(a / 100).toLocaleString()}.${String(a % 100).padStart(2, '0')}`; };
const sel: React.CSSProperties = { height: 32, border: '1px solid var(--aps-line)', borderRadius: 8, padding: '0 8px', background: 'var(--aps-card)', fontFamily: 'inherit', fontSize: 12, color: 'var(--aps-text)' };
const card: React.CSSProperties = { background: 'var(--aps-card)', border: '1px solid var(--aps-line)', borderRadius: 14, padding: 12 };
const btn = (p?: boolean, danger?: boolean): React.CSSProperties => ({ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid ' + (danger ? 'var(--aps-danger)' : p ? 'var(--aps-gold)' : 'var(--aps-line)'), background: p ? 'var(--aps-gold)' : 'var(--aps-card)', color: danger ? 'var(--aps-danger)' : p ? '#fff' : 'var(--aps-text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' });
const small: React.CSSProperties = { fontSize: 11.5, color: 'var(--aps-muted)' };
const errText = (e: any, fallback: string) => {
  if (e?.code === 'STEP_UP_CANCELLED') return tx('pos.not_changed_the_password_confirmation_was_wxix');
  const issues: Array<{ message: string }> | undefined = e?.details?.issues;
  if (issues?.length) return `${e?.message || fallback} ${issues.map((i) => i.message).join(' ')}`;
  return e?.message || fallback;
};
// id → label, translated when READ (a language switch re-renders in place; nothing may be frozen at import)
const labelsById = (list: Array<{ id: string; label: string }>) => Object.defineProperties({}, Object.fromEntries(list.map((x) => [x.id, { get: () => x.label, enumerable: true }]))) as Record<string, string>;
const STATEMENT_TONE: Record<string, Tone> = { draft: 'neutral', ready_for_review: 'neutral', submitted: 'warning', held: 'danger', approved: 'info', locked: 'info', issued: 'purple', partially_paid: 'warning', paid: 'success', voided: 'neutral' };
const STATEMENT_LABEL_LIST: Array<{ id: string; label: string }> = [{ id: 'draft', get label() { return tx('pos.manager_review'); } }, { id: 'ready_for_review', get label() { return tx('pos.manager_review'); } }, { id: 'submitted', get label() { return tx('pos.with_the_owner'); } }, { id: 'held', get label() { return tx('pos.held_by_the_owner'); } }, { id: 'approved', get label() { return tx('pos.approved'); } }, { id: 'locked', get label() { return tx('pos.approved_unpaid'); } }, { id: 'issued', get label() { return tx('pos.being_paid'); } }, { id: 'partially_paid', get label() { return tx('pos.partially_paid'); } }, { id: 'paid', get label() { return tx('pos.paid_3'); } }, { id: 'voided', get label() { return tx('pos.voided_2'); } }];
const STATEMENT_LABEL = labelsById(STATEMENT_LABEL_LIST) as Record<string, string>;
const PERIOD_LABEL_LIST: Array<{ id: string; label: string }> = [{ id: 'draft', get label() { return tx('pos.manager_review'); } }, { id: 'review', get label() { return tx('pos.waiting_for_the_owner'); } }, { id: 'finalized', get label() { return tx('pos.approved'); } }, { id: 'paid', get label() { return tx('pos.paid_3'); } }, { id: 'canceled', get label() { return tx('people.paycheck.status.canceled'); } }];
const FREQ_KEY: Record<string, string> = { weekly: 'people.paycheck.freq.weekly', biweekly: 'people.paycheck.freq.biweekly', semimonthly: 'people.paycheck.freq.semimonthly', monthly: 'people.paycheck.freq.monthly' };
const minutesToHours = (m: number) => (Math.round((Number(m) || 0) / 6) / 10).toFixed(1);
const PERIOD_LABEL = labelsById(PERIOD_LABEL_LIST) as Record<string, string>;
const POLICY_LABEL_LIST: Array<{ id: string; label: string }> = [{ id: 'split_check_cash', get label() { return tx('pos.salon_default_split'); } }, { id: 'all_check', get label() { return tx('pos.all_by_check'); } }, { id: 'all_cash', get label() { return tx('pos.all_in_cash'); } }, { id: 'manual_percent', get label() { return tx('pos.custom_percent'); } }, { id: 'manual_amount', get label() { return tx('pos.custom_dollar_amounts'); } }];
const POLICY_LABEL = labelsById(POLICY_LABEL_LIST) as Record<PaycheckPolicyType, string>;
const SOURCE_LABEL_LIST: Array<{ id: string; label: string }> = [{ id: 'register_drawer', get label() { return tx('pos.register_drawer'); } }, { id: 'safe', get label() { return tx('pos.safe'); } }, { id: 'bank_withdrawal', get label() { return tx('pos.bank_withdrawal'); } }, { id: 'other_recorded_source', get label() { return tx('pos.other_recorded_source'); } }];
const SOURCE_LABEL = labelsById(SOURCE_LABEL_LIST) as Record<CashSource, string>;
// §67: what each statement exception is called on the POS (the server's codes — payroll-paycheck.ts statementExceptions)
const EXCEPTION_LABEL: Record<string, string> = {
  MANUAL_ADJUSTMENT: 'pos.payroll_ex_MANUAL_ADJUSTMENT', MISSING_CLOCK_OUT: 'pos.payroll_ex_MISSING_CLOCK_OUT', PENDING_ADJUSTMENT: 'pos.payroll_ex_PENDING_ADJUSTMENT',
  DEDUCTION_EXCEEDS_EARNINGS: 'pos.payroll_ex_DEDUCTION_EXCEEDS_EARNINGS', DEDUCTION_OVER_CAP: 'pos.payroll_ex_DEDUCTION_OVER_CAP', CHANGED_SINCE_BUILD: 'pos.payroll_ex_CHANGED_SINCE_BUILD',
  NEGATIVE_PAYABLE: 'pos.payroll_ex_NEGATIVE_PAYABLE', PAYOUT_SPLIT_MISMATCH: 'pos.payroll_ex_PAYOUT_SPLIT_MISMATCH',
  UNALLOCATED_TIP: 'pos.payroll_ex_UNALLOCATED_TIP', MISSING_COMMISSION_RULE: 'pos.payroll_ex_MISSING_COMMISSION_RULE',
};
const methodTotal = (s: PayStatementDetail, m: string) => (s.plan?.instructions ?? []).filter((i) => i.status !== 'canceled' && i.method === m).reduce((a, i) => a + i.amountCents, 0);

export function PaycheckTab({ periods, reload, can, stepUp }: { periods: PeriodRow[]; reload: () => Promise<unknown>; can: (p: string) => boolean; stepUp: StepUp }) {
  const [view, setView] = useState<'week' | 'reports' | 'settings' | 'prep'>('week');
  const [cancelWhy, setCancelWhy] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<string | null>(periods[0]?.id ?? null);
  const [week, setWeek] = useState<PaycheckWeek | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [hold, setHold] = useState<string[]>([]);
  const [decision, setDecision] = useState<'returned' | 'rejected' | null>(null);
  const [note, setNote] = useState('');
  // the 27″ workspace (≥ 1536 × 820): the statement opens beside the worklist instead of in a drawer
  const wide = useWideWorkspace();

  const [summary, setSummary] = useState<PaycheckOwnerSummary | null>(null);
  useEffect(() => { Promise.resolve().then(() => posPayrollApi.paySummary()).then((r) => setSummary(r ?? null)).catch(() => setSummary(null)); }, [week]);
  // §66/§67: a 200-statement week is reviewed by exception — the server narrows the list (the totals stay the week's)
  const [exOnly, setExOnly] = useState(false);
  const [techQ, setTechQ] = useState('');
  const filterRef = useRef({ exceptionsOnly: false, search: '' }); filterRef.current = { exceptionsOnly: exOnly, search: techQ };
  const load = useCallback(async (id: string | null) => {
    if (!id) { setWeek(null); return; }
    try { setWeek(await posPayrollApi.payWeek(id, filterRef.current)); setErr(null); } catch (e: any) { setWeek(null); setErr(errText(e, tx('pos.failed_to_load_payroll'))); }
  }, []);
  useEffect(() => { const t = setTimeout(() => { void load(periodId); }, techQ ? 250 : 0); return () => clearTimeout(t); }, [periodId, load, exOnly, techQ]);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); setMsg(done); await reload(); await load(periodId); } catch (e: any) { setErr(errText(e, tx('pos.that_did_not_work'))); } finally { setBusy(false); }
  };
  const p = week?.period;
  const v = p?.version;
  const cols: Column<PayStatementDetail>[] = useMemo(() => [
    { key: 'tech', get header() { return tx('pos.technician'); }, render: (s) => <button style={{ ...btn(), border: 'none', padding: 0, background: 'transparent' }} onClick={() => setOpen(s.id)}><b>{s.technicianName || s.technicianId}</b> <span style={small}>{s.statementNumber}</span></button> },
    { key: 'status', get header() { return tx('pos.status'); }, render: (s) => <StatusBadge tone={STATEMENT_TONE[s.status] ?? 'neutral'}>{STATEMENT_LABEL[s.status] ?? s.status}</StatusBadge> },
    { key: 'gross', get header() { return tx('pos.earned_2'); }, align: 'right', render: (s) => money(s.grossEarningsCents) },
    { key: 'already', get header() { return tx('pos.already_paid'); }, align: 'right', render: (s) => (s.alreadyPaidCents ? money(s.alreadyPaidCents) : '—') },
    { key: 'payable', get header() { return tx('pos.payable'); }, align: 'right', render: (s) => <b>{money(s.approvedPayableCents)}</b> },
    { key: 'check', get header() { return tx('pos.check'); }, align: 'right', render: (s) => money(methodTotal(s, 'check')) },
    { key: 'cash', get header() { return tx('pos.cash'); }, align: 'right', render: (s) => money(methodTotal(s, 'cash')) },
    { key: 'paid', get header() { return tx('pos.paid_3'); }, align: 'right', render: (s) => money(s.paidCents) },
    { key: 'unpaid', get header() { return tx('pos.unpaid'); }, align: 'right', render: (s) => money(s.unpaidCents) },
    { key: 'flags', header: '', render: (s) => <>{s.reviewRequired ? <span style={{ color: 'var(--aps-danger)', fontSize: 11 }}>{tx('pos.owes_more_than_earned')}{' '}</span> : null}{s.plan?.differsFromDefault ? <span style={{ color: 'var(--aps-gold)', fontSize: 11 }}>{tx('pos.custom_split')}{' '}</span> : null}{s.plan?.issues.length ? <span style={{ color: 'var(--aps-danger)', fontSize: 11 }}>{tx('pos.split_needs_fixing')}</span> : null}{(s.exceptions ?? []).filter((x) => x.code !== 'NEGATIVE_PAYABLE' && x.code !== 'PAYOUT_SPLIT_MISMATCH').map((x) => <span key={x.code} title={x.message} style={{ color: 'var(--aps-gold)', fontSize: 11 }}>{' '}{tx(EXCEPTION_LABEL[x.code] ?? 'pos.need_a_look')}</span>)}</> },
    ...(p?.status === 'review' && can('payroll.approve') ? [{ key: 'hold', get header() { return tx('pos.hold'); }, render: (s: PayStatementDetail) => <input type="checkbox" aria-label={tx('pos.hold_v0', { v0: String(s.technicianName || '') })} checked={hold.includes(s.technicianId)} onChange={(e) => setHold(e.target.checked ? [...hold, s.technicianId] : hold.filter((x) => x !== s.technicianId))} /> } as Column<PayStatementDetail>] : []),
  ], [p?.status, hold, can]);

  // SUNMI FLEX 3 Weekly Technician Paycheck addendum (Nov 6 2026) §05: the week is ONE workspace on the 27″ screen — a
  // readiness bar, the server's totals, the worklist beside the selected technician's statement, Exceptions / Owner review /
  // Payouts / Audit cards and a role-aware Quick Actions bar. Every figure is the server's (PaycheckWeek totals, statement
  // exceptions, the owner summary); nothing here calculates pay. On a narrower screen (or a test without layout) the same
  // pieces stack and the statement opens in the drawer, as before.
  const sorted = useMemo(() => (week ? [...week.statements].sort((a, b) => Number(!!(b.exceptions?.length || b.reviewRequired)) - Number(!!(a.exceptions?.length || a.reviewRequired))) : []), [week]);
  const flagged = sorted.filter((x) => x.exceptions?.length || x.reviewRequired);
  const steps: { id: string; label: string; done: boolean; on: boolean }[] = p ? [
    { id: 'calculated', label: tx('sunmi.pay.ready.calculated'), done: (week?.statements.length ?? 0) > 0, on: p.status === 'draft' && !(week?.statements.length) },
    { id: 'manager', label: tx('sunmi.pay.ready.managerReview'), done: ['review', 'finalized', 'paid'].includes(p.status), on: p.status === 'draft' && (week?.statements.length ?? 0) > 0 },
    { id: 'owner', label: tx('sunmi.pay.ready.withOwner'), done: ['finalized', 'paid'].includes(p.status), on: p.status === 'review' },
    { id: 'approved', label: tx('sunmi.pay.ready.approved'), done: p.status === 'paid', on: p.status === 'finalized' },
    { id: 'paid', label: tx('sunmi.pay.ready.paid'), done: p.status === 'paid', on: false },
  ] : [];
  const exportCsv = async () => {
    if (!p) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const f = await posPayrollApi.exportPeriod(p.id, 'csv');
      const bin = atob(f.base64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: f.mimeType })); const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg(tx('sunmi.pay.exported', { n: String(f.rowCount) }));
    } catch (e: any) { setErr(errText(e, tx('pos.that_did_not_work'))); } finally { setBusy(false); }
  };
  const delta = week && week.previousPayableCents != null ? week.totals.payableCents - week.previousPayableCents : null;
  const card2: React.CSSProperties = { ...card, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' };
  const cardH: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontWeight: 800, fontSize: 14, marginBottom: 6 };
  const cardB: React.CSSProperties = { flex: '1 1 auto', minHeight: 0, overflow: 'auto', fontSize: 13 };
  const kv = (label: string, value: React.ReactNode) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}><span style={small}>{label}</span><b>{value}</b></div>;

  return (
    <div className={'pc-ws' + (view === 'week' && week && p ? ' pc-week' : '')} style={{ display: 'grid', gap: 10 }}>
      <div className="pc-nav" data-module-id="pc-nav" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn(view === 'week')} onClick={() => setView('week')}>{tx('pos.this_week')}</button>
        <button style={btn(view === 'reports')} onClick={() => setView('reports')}>{tx('pos.payroll_reports_2')}</button>
        {can('payroll.issue_check') || can('payroll.cash_handoff') || can('payroll.approve') ? <button style={btn(view === 'prep')} onClick={() => setView('prep')}>{tx('people.paycheck.prep.tab')}</button> : null}
        {can('payroll.approve') ? <button style={btn(view === 'settings')} onClick={() => setView('settings')}>{tx('pos.pay_schedule_split')}</button> : null}
        {view === 'week' ? <>
          <select aria-label={tx('pos.pay_week')} style={sel} value={periodId ?? ''} onChange={(e) => setPeriodId(e.target.value || null)}>
            {periods.map((x) => <option key={x.id} value={x.id}>{x.label || `${x.periodStart} – ${x.periodEnd}`}</option>)}
          </select>
          {can('payroll.manage') && !week?.period.branchScope ? <button style={btn()} disabled={busy} onClick={() => act(async () => { const r = await posPayrollApi.openWeek(); setPeriodId(r.periodId); }, (week?.schedule.frequency ?? 'weekly') === 'weekly' ? tx('people.paycheck.done.weekOpen') : tx('people.paycheck.done.periodOpen'))}>{(week?.schedule.frequency ?? 'weekly') === 'weekly' ? tx('pos.open_last_week') : tx('people.paycheck.open.period')}</button> : null}
        </> : null}
      </div>
      {summary && !(view === 'week' && week && p) ? <div style={small}>{tx('pos.cash_waiting_to_hand_over')}{' '}{summary.cashAwaitingHandoff} ({money(summary.cashAwaitingHandoffCents)}{tx('pos.checks_to_deliver')}{' '}{summary.checksAwaitingDelivery} {tx('pos.payouts_with_a_problem')}{' '}{summary.exceptionPayouts} {tx('pos.approved_and_unpaid')}{' '}{money(summary.unpaidCents)}</div> : null}
      {msg ? <div role="status" style={{ ...small, color: 'var(--aps-success)' }}>{msg}</div> : null}
      {err ? <div role="alert" style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{err}</div> : null}

      {view === 'reports' ? <ReportsView /> : null}
      {view === 'prep' ? (periodId ? <PreparationView periodId={periodId} /> : <EmptyState title={tx('pos.no_pay_week_yet')} message={tx('pos.open_last_week_to_calculate_everyone_w7kh')} />) : null}
      {view === 'settings' ? <ScheduleView stepUp={stepUp} /> : null}
      {view === 'week' && !periodId ? <EmptyState title={tx('pos.no_pay_week_yet')} message={tx('pos.open_last_week_to_calculate_everyone_w7kh')} /> : null}
      {view === 'week' && week && p ? <>
        <div className="pc-period" data-module-id="pc-period">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>{p.periodStart} – {p.periodEnd}</b>
          <StatusBadge tone={p.status === 'paid' ? 'success' : p.status === 'review' ? 'warning' : p.status === 'finalized' ? 'info' : p.status === 'canceled' ? 'danger' : 'neutral'}>{PERIOD_LABEL[p.status] ?? p.status}</StatusBadge>
          {p.payDate ? <span style={small}>{tx('pos.pay_day')}{' '}{p.payDate}</span> : null}
          {week.schedule.frequency !== 'weekly' ? <span style={small}>{tx(FREQ_KEY[week.schedule.frequency] ?? 'people.paycheck.freq.weekly')}</span> : null}
          {p.status === 'canceled' ? <span style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{tx('people.paycheck.canceledBanner', { reason: p.cancelReason ?? '' })}</span> : null}
          {p.branchScope && can('payroll.manage') ? <span style={small}>{tx('people.paycheck.branchScoped')}</span> : null}
          {p.ownerDecision === 'returned' || p.ownerDecision === 'rejected' ? <span style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{p.ownerDecision === 'rejected' ? tx('pos.rejected_by_the_owner') : tx('pos.returned_by_the_owner')}: {p.ownerNote}</span> : null}
        </div>
          <ol className="pc-steps" aria-label={tx('sunmi.pay.ready.label')}>
            {p.status === 'canceled' ? <li className="on">{tx('sunmi.pay.ready.canceled')}</li> : steps.map((x) => <li key={x.id} className={x.done ? 'done' : x.on ? 'on' : ''} aria-current={x.on ? 'step' : undefined}>{x.done ? '✓ ' : ''}{x.label}</li>)}
          </ol>
        </div>
        <div className="pc-kpis" data-module-id="pc-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <KpiCard label={tx('pos.technicians')} value={String(week.totals.technicians)} tone="info" />
          <KpiCard label={tx('sunmi.pay.kpi.earned')} value={money(week.totals.grossEarningsCents)} tone="neutral" />
          <KpiCard label={tx('sunmi.pay.kpi.alreadyPaid')} value={money(week.totals.alreadyPaidCents)} tone="neutral" />
          <KpiCard label={tx('pos.payable')} value={money(week.totals.payableCents)} tone="purple" />
          <KpiCard label={tx('pos.by_check')} value={money(week.totals.checkCents)} tone="teal" />
          <KpiCard label={tx('pos.in_cash')} value={money(week.totals.cashCents)} tone="success" />
          <KpiCard label={tx('pos.paid_3')} value={money(week.totals.paidCents)} tone="success" />
          <KpiCard label={tx('pos.unpaid')} value={money(week.totals.unpaidCents)} tone="warning" />
          <KpiCard label={tx('sunmi.pay.kpi.exceptions')} value={String(week.totals.exceptions)} tone={week.totals.exceptions ? 'danger' : 'neutral'} />
        </div>
        <section className="pc-worklist" data-module-id="pc-worklist" style={card2}>
          <div style={cardH}><span>{tx('sunmi.pay.worklist')}</span><span style={{ ...small, fontWeight: 400 }}>{tx('sunmi.pay.worklistOrder')}</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <label style={{ ...small, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={exOnly} onChange={(e) => setExOnly(e.target.checked)} />{tx('pos.payroll_exceptions_only')}</label>
          <input aria-label={tx('pos.payroll_search_technician')} placeholder={tx('pos.payroll_search_technician')} style={{ ...sel, minWidth: 200 }} value={techQ} onChange={(e) => setTechQ(e.target.value)} />
          {week.view && (week.view.exceptionsOnly || week.view.search) ? <span style={small}>{tx('pos.payroll_showing_x_of_y', { x: String(week.view.matched), y: String(week.view.total) })}</span> : null}
        </div>
          <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
          <DataTable<PayStatementDetail> columns={cols} rows={sorted} getRowKey={(s) => s.id} maxHeight="100%" empty={<EmptyState title={tx('pos.no_statements_yet')} message={tx('pos.calculate_the_week_to_make_everyone_1pf1')} />} />
        </div>
        </section>
        <section className="pc-selected" data-module-id="pc-selected" style={card2}>
          <div style={cardH}><span>{tx('sunmi.pay.selected')}</span></div>
          <div style={cardB}>{wide && open ? <StatementPanel id={open} can={can} stepUp={stepUp} onChanged={() => { void reload(); void load(periodId); }} /> : <div style={small}>{tx('sunmi.pay.selectHint')}</div>}</div>
        </section>
        <section className="pc-exceptions" data-module-id="pc-exceptions" style={card2}>
          <div style={cardH}><span>{tx('sunmi.pay.exceptions')} · {week.totals.exceptions}</span><button style={{ ...btn(exOnly), minHeight: 36 }} onClick={() => setExOnly(!exOnly)}>{exOnly ? tx('sunmi.pay.showAll') : tx('sunmi.pay.showOnly')}</button></div>
          <div style={cardB}>
            {(week.view?.periodIssues ?? []).map((x) => <div key={x.code} style={{ padding: '2px 0' }}><b>{tx('sunmi.pay.weekIssue')}:</b> {x.message}{x.count > 1 ? ` (${x.count})` : ''}</div>)}
            {flagged.slice(0, 20).map((x) => <button key={x.id} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '4px 0', minHeight: 36, cursor: 'pointer', font: 'inherit' }} onClick={() => setOpen(x.id)}>
              <b>{x.technicianName || x.technicianId}</b> <span style={small}>{x.exceptions?.length ? (EXCEPTION_LABEL[x.exceptions[0].code] ?? x.exceptions[0].message) : tx('pos.owes_more_than_earned')}{(x.exceptions?.length ?? 0) > 1 ? ` +${(x.exceptions?.length ?? 0) - 1}` : ''}</span></button>)}
            {!flagged.length && !(week.view?.periodIssues ?? []).length ? <div style={small}>{tx('sunmi.pay.exceptionsNone')}</div> : null}
          </div>
        </section>
        <section className="pc-owner" data-module-id="pc-owner" style={card2}>
          <div style={cardH}><span>{tx('sunmi.pay.owner')}</span><StatusBadge tone={p.status === 'paid' ? 'success' : p.status === 'review' ? 'warning' : p.status === 'finalized' ? 'info' : p.status === 'canceled' ? 'danger' : 'neutral'}>{PERIOD_LABEL[p.status] ?? p.status}</StatusBadge></div>
          <div style={cardB}>
            <div style={small}>{p.submittedAt ? tx('sunmi.pay.submittedAt', { at: fmtDateTime(p.submittedAt) }) : tx('sunmi.pay.notSubmitted')}</div>
            {p.ownerDecision ? <div style={{ fontSize: 12.5, color: p.ownerDecision === 'approved' ? 'var(--aps-success)' : 'var(--aps-danger)' }}>{tx('sunmi.pay.decision', { decision: p.ownerDecision === 'rejected' ? tx('pos.rejected_by_the_owner') : p.ownerDecision === 'returned' ? tx('pos.returned_by_the_owner') : PERIOD_LABEL[p.status] ?? p.ownerDecision })}{p.ownerNote ? ` — ${p.ownerNote}` : ''}</div> : null}
            {week.previousPayableCents != null ? <>
              {kv(tx('sunmi.pay.lastWeek'), money(week.previousPayableCents))}
              {kv(tx('sunmi.pay.thisWeek'), money(week.totals.payableCents))}
              {kv(tx('sunmi.pay.change'), delta == null ? '—' : `${delta >= 0 ? '+' : '−'}${money(Math.abs(delta))}`)}
            </> : <div style={small}>{tx('sunmi.pay.noLastWeek')}</div>}
            {kv(tx('sunmi.pay.customSplits'), String(week.totals.overrides))}
            {cancelWhy != null && p.status === 'draft' ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input aria-label={tx('people.paycheck.cancel.why')} placeholder={tx('people.paycheck.cancel.why')} style={{ ...sel, flex: 1, minWidth: 260 }} value={cancelWhy} onChange={(e) => setCancelWhy(e.target.value)} />
          <button style={btn(false, true)} disabled={busy || cancelWhy.trim().length < 3} onClick={() => act(() => stepUp(() => posPayrollApi.payCancelPeriod(p.id, cancelWhy.trim(), v)).then(() => setCancelWhy(null)), tx('people.paycheck.cancel.done'))}>{tx('people.paycheck.cancel.confirm')}</button>
          <button style={btn()} onClick={() => setCancelWhy(null)}>{tx('pos.cancel')}</button>
        </div> : null}
            {decision ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input aria-label={tx('pos.note_for_the_manager')} placeholder={decision === 'rejected' ? tx('pos.why_is_this_payroll_rejected') : tx('pos.what_should_the_manager_change')} style={{ ...sel, flex: 1, minWidth: 260 }} value={note} onChange={(e) => setNote(e.target.value)} />
          <button style={btn(true)} disabled={busy || note.trim().length < 3} onClick={() => act(() => (decision === 'rejected' ? posPayrollApi.payReject(p.id, note.trim(), v) : posPayrollApi.payReturn(p.id, note.trim(), v)).then(() => { setDecision(null); setNote(''); }), decision === 'rejected' ? tx('pos.rejected_the_manager_was_told_why') : tx('pos.returned_to_the_manager'))}>{tx('pos.send')}</button>
          <button style={btn()} onClick={() => setDecision(null)}>{tx('pos.cancel')}</button>
        </div> : null}
          </div>
        </section>
        <section className="pc-payouts" data-module-id="pc-payouts" style={card2}>
          <div style={cardH}><span>{tx('sunmi.pay.payouts')}</span>{can('payroll.issue_check') || can('payroll.cash_handoff') || can('payroll.approve') ? <button style={{ ...btn(), minHeight: 36 }} onClick={() => setView('prep')}>{tx('sunmi.pay.openPrep')}</button> : null}</div>
          <div style={cardB}>
            {summary ? <>
              {kv(tx('sunmi.pay.cashWaiting'), `${summary.cashAwaitingHandoff} · ${money(summary.cashAwaitingHandoffCents)}`)}
              {kv(tx('sunmi.pay.checksToDeliver'), String(summary.checksAwaitingDelivery))}
              {kv(tx('sunmi.pay.problemPayouts'), String(summary.exceptionPayouts))}
              {kv(tx('sunmi.pay.pendingApproval'), String(summary.pendingOwnerApproval))}
            </> : <div style={small}>{tx('sunmi.pay.summaryUnavailable')}</div>}
            <div style={{ ...small, marginTop: 4 }}>{tx('sunmi.pay.notPaidYet')}</div>
          </div>
        </section>
        <section className="pc-audit" data-module-id="pc-audit" style={card2}>
          <div style={cardH}><span>{tx('sunmi.pay.audit')}</span></div>
          <div style={cardB}>
            {kv(tx('sunmi.pay.version'), String(p.version))}
            {kv(tx('sunmi.pay.payoutStatus'), statusLabel('payout', p.payoutStatus))}
            {kv(tx('sunmi.pay.approvedBy'), p.approvedBy ?? '—')}
            {kv(tx('sunmi.pay.fingerprint'), p.approvalHash ? p.approvalHash.slice(0, 12) : '—')}
            {kv(tx('sunmi.pay.scope'), p.branchScope ? tx('sunmi.pay.scopeBranch') : tx('sunmi.pay.scopeTenant'))}
          </div>
        </section>
        <nav className="pc-actions" data-module-id="pc-actions" aria-label={tx('sunmi.pay.quick')}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {p.status === 'draft' && can('payroll.manage') && !p.branchScope ? <>
            <button style={btn()} disabled={busy} onClick={() => act(() => posPayrollApi.payCalculate(p.id), tx('people.paycheck.done.recalculated'))}>{tx('pos.calculate')}</button>
            <button style={btn()} disabled={busy} onClick={() => act(() => posPayrollApi.payApplyDefault(p.id), tx('people.paycheck.done.defaultSplit'))}>{tx('pos.use_the_default_split_for_everyone')}</button>
            <button style={btn(true)} disabled={busy} onClick={() => act(() => posPayrollApi.paySubmit(p.id, v), tx('people.paycheck.done.submitted'))}>{tx('pos.submit_to_owner')}</button>
            <button style={btn(false, true)} disabled={busy} onClick={() => setCancelWhy(cancelWhy == null ? '' : null)}>{tx('people.paycheck.cancel.button')}</button>
          </> : null}
          {p.status === 'review' && can('payroll.approve') ? <>
            <button style={btn(true)} disabled={busy} onClick={() => act(() => stepUp(() => posPayrollApi.payApprove(p.id, { expectedVersion: v, holdTechnicianIds: hold })), hold.length ? tx('pos.approved_the_held_statements_wait') : tx('pos.approved_checks_and_cash_can_be_anxm'))}>{hold.length ? tx('pos.approve_hold_length', { length: String(hold.length) }) : tx('pos.approve_all')}</button>
            <button style={btn()} disabled={busy} onClick={() => setDecision('returned')}>{tx('pos.return_for_changes')}</button>
            <button style={btn(false, true)} disabled={busy} onClick={() => setDecision('rejected')}>{tx('pos.reject')}</button>
          </> : null}
          {p.status === 'review' && !can('payroll.approve') ? <span style={small}>{tx('pos.waiting_for_the_owner_s_decision')}</span> : null}
                    {can('payroll.export') ? <button style={btn()} disabled={busy} onClick={exportCsv} data-testid="pc-export">{tx('sunmi.pay.export')}</button> : null}
            <button style={btn()} onClick={() => setView('reports')}>{tx('pos.payroll_reports_2')}</button>
          </div>
        </nav>
        <Drawer open={!!open && !wide} onClose={() => setOpen(null)} title={tx('pos.pay_statement')} width={560}>
          {open ? <StatementPanel id={open} can={can} stepUp={stepUp} onChanged={() => { void reload(); void load(periodId); }} /> : null}
        </Drawer>
      </> : null}
    </div>
  );
}

function useWideWorkspace(): boolean {
  const q = '(min-width: 1536px) and (min-height: 820px)';
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  const [on, setOn] = useState(get);
  useEffect(() => { if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return; const m = window.matchMedia(q); const f = () => setOn(m.matches); m.addEventListener?.('change', f); return () => m.removeEventListener?.('change', f); }, []);
  return on;
}

function Row({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  if (!cents && !strong) return null;
  return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: strong ? 800 : 500 }}><span>{label}</span><span>{money(cents)}</span></div>;
}

/** 17.5 (Oct 27 2026): the approved statement's pay stub — a PDF the server builds from the locked snapshot, saved as a file
 *  (a download for the technician's records; the POS never opens a print dialog — PRINT_FEATURES_REMOVED.md) */
const STUB_READY = ['locked', 'issued', 'partially_paid', 'paid'];
function PayStubDownload({ s }: { s: PayStatementDetail }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  if (!STUB_READY.includes(s.status)) return <div style={small}>{tx('people.paycheck.stub.notYet')}</div>;
  const go = async () => {
    setBusy(true); setNote(null);
    try {
      const blob = await posPayrollApi.payStub(s.id, getLanguage());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `pay-stub-${s.statementNumber}.pdf`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNote({ ok: true, text: tx('people.paycheck.stub.done') });
    } catch (e) { setNote({ ok: false, text: errText(e, tx('people.paycheck.stub.failed')) }); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button style={btn()} disabled={busy} onClick={go}>{busy ? tx('people.paycheck.stub.preparing') : tx('people.paycheck.stub.download')}</button>
      {note ? <span role={note.ok ? 'status' : 'alert'} style={{ fontSize: 12, color: note.ok ? 'var(--aps-success, #2E9E54)' : 'var(--aps-danger)' }}>{note.text}</span> : null}
    </div>
  );
}

/** One technician's statement: figures, branch breakdown, the payout split (before submit) and the payouts (after approval). */
function StatementPanel({ id, can, stepUp, onChanged }: { id: string; can: (p: string) => boolean; stepUp: StepUp; onChanged: () => void }) {
  const [s, setS] = useState<PayStatementDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => posPayrollApi.payStatement(id).then((r) => { setS(r); setErr(null); }).catch((e: any) => setErr(errText(e, tx('people.paycheck.err.statement')))), [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(); onChanged(); } catch (e: any) { setErr(errText(e, tx('pos.that_did_not_work'))); } finally { setBusy(false); }
  };
  if (!s) return <div style={{ padding: 14 }}>{err ? <div role="alert" style={{ color: 'var(--aps-danger)', fontSize: 12 }}>{err}</div> : <div style={small}>{tx('pos.loading')}</div>}</div>;
  const editable = s.status === 'draft' || s.status === 'ready_for_review';
  return (
    <div style={{ padding: 14, display: 'grid', gap: 12, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><b>{s.technicianName}</b><div style={small}>{s.statementNumber}</div></div>
        <StatusBadge tone={STATEMENT_TONE[s.status] ?? 'neutral'}>{STATEMENT_LABEL[s.status] ?? s.status}</StatusBadge>
      </div>
      {err ? <div role="alert" style={{ color: 'var(--aps-danger)', fontSize: 12 }}>{err}</div> : null}
      <div style={{ ...card, display: 'grid', gap: 4 }}>
        <Row label={tx('pos.service_commission')} cents={s.serviceCommissionCents} />
        <Row label={tx('pos.hourly_pay')} cents={s.hourlyPayCents} />
        <Row label={tx('pos.salary')} cents={s.salaryPayCents} />
        <Row label={tx('pos.card_tips_2')} cents={s.cardTipCents} />
        <Row label={tx('pos.cash_tips_2')} cents={s.cashTipCents} />
        <Row label={tx('pos.retail_commission')} cents={s.retailCommissionCents} />
        <Row label={tx('pos.bonus')} cents={s.bonusCents} />
        <Row label={tx('pos.guarantee_top_up')} cents={s.guaranteeTopUpCents} />
        <Row label={tx('pos.adjustments')} cents={s.positiveAdjustmentsCents} />
        <Row label={tx('pos.deductions')} cents={-s.deductionsCents} />
        <Row label={tx('pos.reversals')} cents={-s.reversalsCents} />
        {s.reversalsCents ? <div style={{ paddingLeft: 12, display: 'grid', gap: 2 }}>
          <Row label={tx('people.paycheck.reversal.refund')} cents={-(s.refundReversalCents ?? 0)} />
          <Row label={tx('people.paycheck.reversal.tip')} cents={-(s.tipAdjustmentCents ?? 0)} />
          <Row label={tx('people.paycheck.reversal.retail')} cents={-(s.retailReversalCents ?? 0)} />
          <Row label={tx('people.paycheck.reversal.other')} cents={-(s.reversalsCents - (s.refundReversalCents ?? 0) - (s.tipAdjustmentCents ?? 0) - (s.retailReversalCents ?? 0))} />
        </div> : null}
        <Row label={tx('pos.gross_earnings')} cents={s.grossEarningsCents} strong />
        <Row label={tx('pos.already_paid')} cents={-s.alreadyPaidCents} />
        <Row label={tx('pos.payable')} cents={s.approvedPayableCents} strong />
        <Row label={tx('pos.paid_3')} cents={s.paidCents} />
        <Row label={tx('pos.unpaid')} cents={s.unpaidCents} strong />
      </div>
      {s.reviewRequired ? <div style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{tx('pos.this_technician_owes_more_than_they_k9uz')}</div> : null}
      {s.branchBreakdown.length > 1 ? <div style={card}>
        <b style={{ fontSize: 12 }}>{tx('pos.by_branch')}</b>
        {s.branchBreakdown.map((b) => <div key={b.branchId ?? 'none'} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{b.branchName || tx('pos.branch')} · {b.services} {tx('pos.services_5')}</span><span>{money(b.serviceEarningsCents)} + {money(b.tipsCents)} {tx('pos.tips_6')}</span></div>)}
      </div> : null}
      <EvidenceToggle periodId={s.periodId} technicianId={s.technicianId} />
      <PayStubDownload s={s} />
      {s.plan ? <SplitEditor s={s} editable={editable && can('payroll.manage')} busy={busy} onSave={(b) => act(() => posPayrollApi.payPlan(s.id, { ...b, expectedVersion: s.version }))} /> : null}
      {s.status === 'held' && can('payroll.approve') ? <button style={btn(true)} disabled={busy} onClick={() => act(() => stepUp(() => posPayrollApi.payApproveHeld(s.id)))}>{tx('pos.approve_this_statement')}</button> : null}
      {s.payouts.length ? <div style={{ display: 'grid', gap: 8 }}>
        <b style={{ fontSize: 12 }}>{tx('pos.payouts')}</b>
        {s.payouts.map((x) => <PayoutCard key={x.id} x={x} can={can} stepUp={stepUp} busy={busy} act={act} />)}
      </div> : null}
      {s.unpaidCents > 0 && ['locked', 'issued', 'partially_paid'].includes(s.status) ? <AddPayout s={s} can={can} stepUp={stepUp} busy={busy} act={act} /> : null}
    </div>
  );
}

function SplitEditor({ s, editable, busy, onSave }: { s: PayStatementDetail; editable: boolean; busy: boolean; onSave: (b: { policyType: PaycheckPolicyType; entries?: Array<{ method: string; basisPoints?: number | null; amountCents?: number | null }>; overrideReason?: string | null }) => void }) {
  const plan = s.plan!;
  const [kind, setKind] = useState<PaycheckPolicyType>(plan.policyType);
  const [checkVal, setCheckVal] = useState('');
  const [cashVal, setCashVal] = useState('');
  const [reason, setReason] = useState(plan.overrideReason ?? '');
  const [err, setErr] = useState<string | null>(null);
  const live = plan.instructions.filter((i) => i.status !== 'canceled');
  // §7.4: what is still unallocated, recomputed on every keystroke (UX only — the server re-validates the exact split)
  const remaining = (() => {
    if (kind === 'manual_percent') { const c = Number(checkVal) || 0, k = Number(cashVal) || 0; const left = Math.round((100 - c - k) * 100) / 100; return { kind: 'percent' as const, left }; }
    if (kind === 'manual_amount') { const c = parseDollarsToCents(checkVal || '0') ?? 0, k = parseDollarsToCents(cashVal || '0') ?? 0; return { kind: 'amount' as const, left: s.approvedPayableCents - c - k }; }
    return null;
  })();
  const save = () => {
    setErr(null);
    if (kind === 'manual_percent') {
      const c = Math.round(Number(checkVal) * 100), k = Math.round(Number(cashVal) * 100);
      if (!Number.isFinite(c) || !Number.isFinite(k) || c + k !== 10000) { setErr(tx('pos.the_percentages_must_add_up_to_1qbt')); return; }
      onSave({ policyType: kind, entries: [{ method: 'check', basisPoints: c }, { method: 'cash', basisPoints: k }].filter((e) => (e.basisPoints ?? 0) > 0), overrideReason: reason.trim() || null });
    } else if (kind === 'manual_amount') {
      const c = parseDollarsToCents(checkVal || '0'), k = parseDollarsToCents(cashVal || '0');
      if (c == null || k == null) { setErr(tx('pos.enter_dollar_amounts')); return; }
      if (c + k !== s.approvedPayableCents) { setErr(tx('pos.check_cash_must_equal_approvedpayablecents_now_9y8w', { approvedPayableCents: String(money(s.approvedPayableCents)), v1: String(money(c + k)) })); return; }
      onSave({ policyType: kind, entries: [{ method: 'check', amountCents: c }, { method: 'cash', amountCents: k }].filter((e) => (e.amountCents ?? 0) > 0), overrideReason: reason.trim() || null });
    } else onSave({ policyType: kind, overrideReason: reason.trim() || null });
  };
  return (
    <div style={{ ...card, display: 'grid', gap: 8 }}>
      <b style={{ fontSize: 12 }}>{tx('pos.how')}{' '}{s.technicianName || tx('pos.this_technician')} {tx('pos.is_paid')}</b>
      {live.map((i) => <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span>{i.method === 'check' ? tx('pos.check') : i.method === 'cash' ? tx('glossary.checkout.cash') : statusLabel('paymentMethod', i.method)}{i.basisPoints != null ? ` · ${(i.basisPoints / 100).toFixed(2)}%` : ''}</span><b>{money(i.amountCents)}</b></div>)}
      {plan.differsFromDefault ? <div style={{ fontSize: 11.5, color: 'var(--aps-gold)' }}>{tx('pos.custom_split_2')}{' '}{plan.overrideReason}</div> : null}
      {plan.issues.map((i) => <div key={i.code} style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{i.message}</div>)}
      {editable ? <>
        <select aria-label={tx('pos.payout_split')} style={sel} value={kind} onChange={(e) => setKind(e.target.value as PaycheckPolicyType)}>
          {(Object.keys(POLICY_LABEL) as PaycheckPolicyType[]).map((k) => <option key={k} value={k}>{POLICY_LABEL[k]}</option>)}
        </select>
        {kind === 'manual_percent' || kind === 'manual_amount' ? <div style={{ display: 'flex', gap: 6 }}>
          <input aria-label={kind === 'manual_percent' ? tx('pos.check_percent') : tx('pos.check_amount')} placeholder={kind === 'manual_percent' ? tx('pos.check_2') : tx('pos.check_3')} style={{ ...sel, flex: 1 }} value={checkVal} onChange={(e) => setCheckVal(e.target.value)} />
          <input aria-label={kind === 'manual_percent' ? tx('pos.cash_percent') : tx('pos.cash_amount')} placeholder={kind === 'manual_percent' ? tx('pos.cash_3') : tx('pos.cash_4')} style={{ ...sel, flex: 1 }} value={cashVal} onChange={(e) => setCashVal(e.target.value)} />
        </div> : null}
        {remaining ? <div role="status" data-testid="split-remaining" style={{ fontSize: 12, fontWeight: 700, color: remaining.left === 0 ? 'var(--aps-success)' : remaining.left < 0 ? 'var(--aps-danger)' : 'var(--aps-gold)' }}>
          {remaining.kind === 'percent' ? (remaining.left === 0 ? tx('people.paycheck.split.exact', { payable: '100%' }) : tx('people.paycheck.split.percentLeft', { percent: String(remaining.left) }))
            : remaining.left === 0 ? tx('people.paycheck.split.exact', { payable: money(s.approvedPayableCents) }) : remaining.left > 0 ? tx('people.paycheck.split.remaining', { amount: money(remaining.left) }) : tx('people.paycheck.split.over', { amount: money(-remaining.left) })}
        </div> : null}
        <input aria-label={tx('pos.reason_for_a_custom_split')} placeholder={tx('pos.reason_the_owner_sees_it')} style={sel} value={reason} onChange={(e) => setReason(e.target.value)} />
        {err ? <div role="alert" style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{err}</div> : null}
        <button style={btn(true)} disabled={busy} onClick={save}>{tx('pos.save_split')}</button>
      </> : null}
    </div>
  );
}

function PayoutCard({ x, can, stepUp, busy, act }: { x: PaycheckPayout; can: (p: string) => boolean; stepUp: StepUp; busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [num, setNum] = useState('');
  const [reason, setReason] = useState('');
  const [replacement, setReplacement] = useState('');
  const [source, setSource] = useState<CashSource>('register_drawer');
  const [pin, setPin] = useState('');
  const [token, setToken] = useState<PaycheckHandoffToken | null>(null);
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState('');
  const isCheck = x.method === 'check', isCash = x.method === 'cash';
  const state = isCheck ? x.checkStatus : isCash ? x.cashStatus : x.status;
  const waitingCash = x.cashStatus === 'ready_for_handoff' || x.cashStatus === 'handed_off' || x.cashStatus === 'disputed';
  const qr = token ? qrPath(`aps-cash:${x.id}:${token.handoffCode}`) : null;
  return (
    <div style={{ ...card, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span><b>{isCheck ? tx('pos.check') : isCash ? tx('glossary.checkout.cash') : statusLabel('paymentMethod', x.method)}</b> {x.checkNumber ? `#${x.checkNumber}` : ''} {x.cashSource ? `· ${SOURCE_LABEL[x.cashSource as CashSource] ?? x.cashSource}` : ''}</span>
        <span><b>{money(x.amountCents)}</b> <StatusBadge tone={x.status === 'paid' ? 'success' : x.status === 'canceled' ? 'neutral' : x.status === 'processing' ? 'warning' : 'info'}>{statusLabel('payout', state == null ? '' : String(state))}</StatusBadge></span>
      </div>
      {x.replacesPayoutId ? <div style={small}>{tx('pos.replaces_a_voided_check')}</div> : null}
      {x.checkVoidReason ? <div style={small}>{tx('pos.voided_3')}{' '}{x.checkVoidReason}</div> : null}
      {x.cashDisputeReason ? <div style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{tx('pos.disputed')}{' '}{x.cashDisputeReason}</div> : null}
      {x.cashAckMethod ? <div style={small}>{tx(`people.paycheck.ack.method.${x.cashAckMethod}`)}</div> : null}
      {x.cashAckSignature ? <svg viewBox="0 0 300 100" aria-label={tx('people.paycheck.ack.method.signature')} style={{ width: 150, height: 50, background: '#fff', border: '1px solid var(--aps-line)', borderRadius: 6 }}><path d={x.cashAckSignature} fill="none" stroke="#1b1410" strokeWidth={2} /></svg> : null}
      {isCheck && can('payroll.issue_check') ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {x.checkStatus === 'planned' ? <><input aria-label={tx('pos.check_number')} placeholder={tx('pos.check_number')} style={{ ...sel, width: 140 }} value={num} onChange={(e) => setNum(e.target.value)} /><button style={btn(true)} disabled={busy || !num.trim()} onClick={() => act(() => stepUp(() => posPayrollApi.checkIssue(x.id, num.trim())))}>{tx('pos.issue_check')}</button></> : null}
        {x.checkStatus === 'issued' ? <button style={btn(true)} disabled={busy} onClick={() => act(() => stepUp(() => posPayrollApi.checkDeliver(x.id)))}>{tx('pos.handed_to_technician')}</button> : null}
        {x.checkStatus === 'delivered' ? <button style={btn()} disabled={busy} onClick={() => act(() => posPayrollApi.checkClear(x.id))}>{tx('pos.cleared_the_bank')}</button> : null}
        {x.checkStatus && !['voided', 'returned'].includes(x.checkStatus) ? <>
          <input aria-label={tx('pos.void_reason')} placeholder={tx('pos.why_void')} style={{ ...sel, width: 150 }} value={reason} onChange={(e) => setReason(e.target.value)} />
          <input aria-label={tx('pos.replacement_check_number')} placeholder={tx('pos.new_check_optional')} style={{ ...sel, width: 150 }} value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          <button style={btn(false, true)} disabled={busy || reason.trim().length < 3} onClick={() => act(() => stepUp(() => posPayrollApi.checkVoid(x.id, { reason: reason.trim(), replacementCheckNumber: replacement.trim() || null })))}>{tx('pos.void_check')}</button>
          {x.checkStatus === 'delivered' || x.checkStatus === 'cleared' ? <button style={btn(false, true)} disabled={busy || reason.trim().length < 3} onClick={() => act(() => stepUp(() => posPayrollApi.checkVoid(x.id, { reason: reason.trim(), returned: true, replacementCheckNumber: replacement.trim() || null })))}>{tx('pos.returned_by_the_bank')}</button> : null}
        </> : null}
      </div> : null}
      {isCash && can('payroll.cash_handoff') ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {x.cashStatus === 'planned' ? <><select aria-label={tx('pos.cash_source')} style={sel} value={source} onChange={(e) => setSource(e.target.value as CashSource)}>{(Object.keys(SOURCE_LABEL) as CashSource[]).map((k) => <option key={k} value={k}>{SOURCE_LABEL[k]}</option>)}</select>
          <button style={btn(true)} disabled={busy} onClick={() => act(() => stepUp(() => posPayrollApi.cashPrepare(x.id, { cashSource: source })))}>{tx('pos.prepare_cash')}</button></> : null}
        {x.cashStatus === 'ready_for_handoff' ? <button style={btn()} disabled={busy} onClick={() => act(() => posPayrollApi.cashHandOff(x.id))}>{tx('pos.hand_over')}</button> : null}
        {x.cashStatus === 'ready_for_handoff' || x.cashStatus === 'handed_off' ? <><input aria-label={tx('pos.technician_pin')} type="password" inputMode="numeric" placeholder={tx('pos.technician_pin')} style={{ ...sel, width: 120 }} value={pin} onChange={(e) => setPin(e.target.value)} />
          <button style={btn(true)} disabled={busy || pin.length < 4} onClick={() => act(() => posPayrollApi.cashAckPin(x.id, pin).then(() => setPin('')))}>{tx('pos.technician_confirms')}</button></> : null}
        {x.cashStatus === 'disputed' ? <><input aria-label={tx('pos.resolution_note')} placeholder={tx('pos.what_was_done')} style={{ ...sel, width: 180 }} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button style={btn()} disabled={busy || reason.trim().length < 3} onClick={() => act(() => stepUp(() => posPayrollApi.cashResolve(x.id, { action: 'rehandoff', reason: reason.trim() })))}>{tx('pos.hand_over_again')}</button></> : null}
        {x.cashStatus && ['planned', 'ready_for_handoff', 'disputed'].includes(x.cashStatus) ? <><input aria-label={tx('pos.cancel_reason_2')} placeholder={tx('pos.why_cancel')} style={{ ...sel, width: 150 }} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button style={btn(false, true)} disabled={busy || reason.trim().length < 3} onClick={() => act(() => stepUp(() => posPayrollApi.cashResolve(x.id, { action: 'cancel', reason: reason.trim() })))}>{tx('pos.cancel_cash')}</button></> : null}
      </div> : null}
      {isCash && can('payroll.cash_handoff') && waitingCash ? <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button style={btn()} disabled={busy} onClick={() => act(async () => { setToken(await posPayrollApi.cashHandoffToken(x.id)); })}>{tx('people.paycheck.ack.qr')}</button>
          <button style={btn()} disabled={busy} onClick={() => setSigning(!signing)}>{tx('people.paycheck.ack.signature')}</button>
          <button style={btn()} disabled={busy || pin.length < 4} title={tx('people.paycheck.ack.dualHint')} onClick={() => act(() => stepUp(() => posPayrollApi.cashAckDual(x.id, pin)).then(() => setPin('')))}>{tx('people.paycheck.ack.dual')}</button>
        </div>
        {token && qr ? <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={tx('people.paycheck.ack.qr')} style={{ width: 140, height: 140, background: '#fff', borderRadius: 8 }} shapeRendering="crispEdges"><path d={qr.d} fill="#1b1410" /></svg>
          <div style={small}>{tx('people.paycheck.ack.qrHint', { token: token.handoffCode, until: fmtInZone(token.expiresAt, { hour: '2-digit', minute: '2-digit' }) })}</div>
        </div> : null}
        {signing ? <SignaturePad value={signature} onChange={setSignature} onConfirm={() => act(() => posPayrollApi.cashAckSignature(x.id, { pin, signature }).then(() => { setPin(''); setSignature(''); setSigning(false); }))} busy={busy || pin.length < 4} /> : null}
      </div> : null}
    </div>
  );
}

function AddPayout({ s, can, stepUp, busy, act }: { s: PayStatementDetail; can: (p: string) => boolean; stepUp: StepUp; busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const committed = s.payouts.filter((x) => x.status !== 'canceled' && x.status !== 'failed').reduce((a, x) => a + x.amountCents, 0);
  const left = s.approvedPayableCents - committed;
  if (left <= 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={small}>{money(left)} {tx('pos.is_not_planned_for_payment')}</span>
      {can('payroll.issue_check') ? <button style={btn()} disabled={busy} onClick={() => act(() => stepUp(() => posPayrollApi.payAddPayout(s.id, { method: 'check' })))}>{tx('pos.pay_it_by_check')}</button> : null}
      {can('payroll.cash_handoff') ? <button style={btn()} disabled={busy} onClick={() => act(() => stepUp(() => posPayrollApi.payAddPayout(s.id, { method: 'cash' })))}>{tx('pos.pay_it_in_cash')}</button> : null}
    </div>
  );
}

/** §8.4: the evidence behind one statement — services, tips by ticket, the time clock (scheduled vs clocked, breaks, the
 *  rate), adjustments — fetched on demand from the technician drill-down. Read-only. */
function EvidenceToggle({ periodId, technicianId }: { periodId: string; technicianId: string }) {
  const [open, setOpen] = useState(false);
  const [ev, setEv] = useState<PayrollTechnicianDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!open) return; posPayrollApi.payEvidence(periodId, technicianId).then((r) => { setEv(r); setErr(null); }).catch((e: any) => setErr(errText(e, tx('people.paycheck.err.evidence')))); }, [open, periodId, technicianId]);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button style={{ ...btn(), width: 'fit-content' }} onClick={() => setOpen(!open)}>{open ? tx('people.paycheck.evidence.hide') : tx('people.paycheck.evidence.open')}</button>
      {open && err ? <div role="alert" style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{err}</div> : null}
      {open && ev ? <div style={{ ...card, display: 'grid', gap: 8 }} data-testid="paycheck-evidence">
        <div>
          <b style={{ fontSize: 12 }}>{tx('people.paycheck.evidence.hours')}</b>
          {ev.hours?.plan && ev.hours.plan.hourlyRateCents != null ? <div style={small}>{tx('people.paycheck.evidence.rate', { rate: money(ev.hours.plan.hourlyRateCents), breaks: ev.hours.plan.breaksPaid ? tx('people.paycheck.evidence.breaksPaid') : tx('people.paycheck.evidence.breaksUnpaid') })}</div> : null}
          {ev.hours && ev.hours.entries.length ? ev.hours.entries.map((e) => <div key={e.shiftId} style={{ fontSize: 12 }}>{tx('people.paycheck.evidence.entry', { date: e.shiftDate, clocked: String(e.workedMinutes), scheduled: String(e.scheduledMinutes), breaks: String(e.breakMinutes), paid: String(e.paidMinutes) })}{e.open ? <span style={{ color: 'var(--aps-danger)' }}> · {tx('people.paycheck.evidence.openPunch')}</span> : null}</div>) : <div style={small}>{tx('people.paycheck.evidence.noHours')}</div>}
          {ev.hours && ev.hours.plan && ev.hours.plan.hourlyRateCents != null ? <div style={{ fontSize: 12, fontWeight: 700 }}>{tx('people.paycheck.evidence.hoursTotal', { hours: minutesToHours(ev.hours.totals.paidMinutes), pay: money(ev.hours.totals.computedHourlyPayCents) })} · <span style={{ color: ev.hours.totals.matchesLine ? 'var(--aps-success)' : 'var(--aps-danger)' }}>{ev.hours.totals.matchesLine ? tx('people.paycheck.evidence.matches') : tx('people.paycheck.evidence.mismatch')}</span></div> : null}
        </div>
        <div>
          <b style={{ fontSize: 12 }}>{tx('people.paycheck.evidence.services')}</b>
          {ev.services.length ? ev.services.slice(0, 60).map((x, i) => <div key={`${x.ticketId}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{x.completedAt.slice(0, 10)} · {x.serviceName}</span><span>{money(x.lineTotalCents)} → {money(x.commissionCents)}</span></div>) : <div style={small}>{tx('people.paycheck.evidence.none')}</div>}
        </div>
        <div>
          <b style={{ fontSize: 12 }}>{tx('people.paycheck.evidence.tips')}</b>
          {ev.tips.length ? ev.tips.slice(0, 60).map((x) => <div key={x.ticketId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{x.ticketId.slice(0, 8)}</span><span>{money(x.cardTipCents)} + {money(x.cashTipCents)} {tx('pos.cash')}</span></div>) : <div style={small}>{tx('people.paycheck.evidence.none')}</div>}
        </div>
        <div>
          <b style={{ fontSize: 12 }}>{tx('people.paycheck.evidence.adjustments')}</b>
          {ev.adjustments.length ? ev.adjustments.map((a) => <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{statusLabel('payrollAdjustment', a.category)} · {a.reason}</span><span>{money(a.amountCents)} · {statusLabel('payout', a.status)}</span></div>) : <div style={small}>{tx('people.paycheck.evidence.none')}</div>}
        </div>
      </div> : null}
    </div>
  );
}

/** §11.5: the technician signs on the manager's device — strokes become SVG path data (never a bitmap), sent with the PIN. */
function SignaturePad({ value, onChange, onConfirm, busy }: { value: string; onChange: (d: string) => void; onConfirm: () => void; busy: boolean }) {
  const drawing = useRef(false);
  const point = (e: React.PointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); return `${Math.round(((e.clientX - r.left) / r.width) * 300)} ${Math.round(((e.clientY - r.top) / r.height) * 100)}`; };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={small}>{tx('people.paycheck.ack.signHere')}</div>
      <svg viewBox="0 0 300 100" data-testid="signature-pad" style={{ width: '100%', maxWidth: 360, height: 120, background: '#fff', border: '1px dashed var(--aps-line)', borderRadius: 8, touchAction: 'none' }}
        onPointerDown={(e) => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); onChange(`${value}${value ? ' ' : ''}M ${point(e)}`); }}
        onPointerMove={(e) => { if (drawing.current) onChange(`${value} L ${point(e)}`); }}
        onPointerUp={() => { drawing.current = false; }}>
        <path d={value} fill="none" stroke="#1b1410" strokeWidth={2} />
      </svg>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={btn()} onClick={() => onChange('')}>{tx('people.paycheck.ack.clear')}</button>
        <button style={btn(true)} disabled={busy || value.length < 8} onClick={onConfirm}>{tx('people.paycheck.ack.confirmSignature')}</button>
      </div>
    </div>
  );
}

/** §12.4: the cash envelopes to prepare and the check run of an approved period, by technician, with the totals — for the
 *  people who pay out. Every figure comes from the server's preparation report. */
function PreparationView({ periodId }: { periodId: string }) {
  const [r, setR] = useState<PaycheckPreparationReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setR(null); posPayrollApi.payPreparation(periodId).then((x) => { setR(x); setErr(null); }).catch((e: any) => setErr(e?.code === 'PAYROLL_PERIOD_NOT_READY' ? tx('people.paycheck.prep.notApproved') : errText(e, tx('people.paycheck.err.prep')))); }, [periodId]);
  if (err) return <div role="alert" style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{err}</div>;
  if (!r) return <div style={small}>{tx('pos.loading')}</div>;
  const group = (title: string, lines: PaycheckPreparationReport['checks']['lines'], extra: React.ReactNode) => (
    <div style={card} data-testid="prep-group">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><b style={{ fontSize: 12 }}>{title}</b><span style={small}>{extra}</span></div>
      {lines.length ? lines.map((l) => <div key={l.payoutId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span>{l.technicianName || l.technicianId} · {l.statementNumber}{l.checkNumber ? ` · #${l.checkNumber}` : ''}{l.cashSource ? ` · ${SOURCE_LABEL[l.cashSource as CashSource] ?? l.cashSource}` : ''}</span>
        <span><b>{money(l.amountCents)}</b> · {statusLabel('payout', String(l.checkStatus ?? l.cashStatus ?? l.status))}</span>
      </div>) : <div style={small}>{tx('people.paycheck.prep.empty')}</div>}
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="preparation-report">
      <b>{tx('people.paycheck.prep.title', { start: r.period.periodStart, end: r.period.periodEnd })}</b>
      <div style={small}>{tx('people.paycheck.prep.technicians', { n: String(r.technicians), payable: money(r.totals.payableCents), paid: money(r.totals.paidCents), unpaid: money(r.totals.unpaidCents) })}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <KpiCard label={tx('people.paycheck.prep.checks')} value={money(r.checks.amountCents)} tone="teal" />
        <KpiCard label={tx('people.paycheck.prep.cash')} value={money(r.cash.amountCents)} tone="success" />
        <KpiCard label={tx('pos.paid_3')} value={money(r.totals.paidCents)} tone="success" />
        <KpiCard label={tx('pos.unpaid')} value={money(r.totals.unpaidCents)} tone="warning" />
      </div>
      <div style={{ ...small, color: r.totals.reconciles ? 'var(--aps-success)' : 'var(--aps-danger)' }}>{r.totals.reconciles ? tx('people.paycheck.prep.reconciles') : tx('people.paycheck.prep.notReconciled')}</div>
      {group(tx('people.paycheck.prep.checks'), r.checks.lines, <>{tx('people.paycheck.prep.toIssue', { n: String(r.checks.toIssue) })} · {tx('people.paycheck.prep.toDeliver', { n: String(r.checks.toDeliver) })}</>)}
      {group(tx('people.paycheck.prep.cash'), r.cash.lines, <>{tx('people.paycheck.prep.toPrepare', { n: String(r.cash.toPrepare) })} · {tx('people.paycheck.prep.toHandOff', { n: String(r.cash.toHandOff) })} · {tx('people.paycheck.prep.toAcknowledge', { n: String(r.cash.toAcknowledge) })}</>)}
      {Object.keys(r.cash.bySource).length ? <div style={small}>{tx('people.paycheck.prep.bySource')}: {Object.entries(r.cash.bySource).map(([k, v]) => `${k === 'not_prepared' ? tx('people.paycheck.prep.notPrepared') : (SOURCE_LABEL[k as CashSource] ?? k)} ${v.count} · ${money(v.amountCents)}`).join(' · ')}</div> : null}
      {r.other.count ? group(tx('people.paycheck.prep.other'), r.other.lines, <>{r.other.count}</>) : null}
      {r.unplanned.length ? <div style={card}><b style={{ fontSize: 12 }}>{tx('people.paycheck.prep.unplanned')}</b>{r.unplanned.map((u) => <div key={u.statementId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{u.technicianName || u.technicianId} · {u.statementNumber}</span><b>{money(u.amountCents)}</b></div>)}</div> : null}
    </div>
  );
}

/** Weekly / monthly / year-to-date payroll: by technician, branch and method; the cash payouts and the check register. */
function ReportsView() {
  const [range, setRange] = useState<'week' | 'month' | 'ytd'>('month');
  const [r, setR] = useState<PaycheckReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { posPayrollApi.payReport({ range }).then((x) => { setR(x); setErr(null); }).catch((e: any) => setErr(errText(e, tx('people.paycheck.err.report')))); }, [range]);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <select aria-label={tx('pos.report_range')} style={{ ...sel, width: 200 }} value={range} onChange={(e) => setRange(e.target.value as 'week' | 'month' | 'ytd')}>
        <option value="week">{tx('pos.last_7_days_2')}</option><option value="month">{tx('pos.this_month')}</option><option value="ytd">{tx('pos.year_to_date')}</option>
      </select>
      {err ? <div role="alert" style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{err}</div> : null}
      {r ? <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <KpiCard label={tx('pos.payroll_expense')} value={money(r.accounting.compensationExpenseCents)} tone="purple" />
          <KpiCard label={tx('pos.paid_by_check')} value={money(r.accounting.settledByCheckCents)} tone="teal" />
          <KpiCard label={tx('pos.paid_in_cash')} value={money(r.accounting.settledByCashCents)} tone="success" />
          <KpiCard label={tx('pos.unpaid')} value={money(r.accounting.unpaidCents)} tone="warning" />
        </div>
        <div style={small}>{r.accounting.reconciles ? tx('pos.check_cash_already_paid_unpaid_equal_1353') : tx('pos.the_payouts_do_not_add_up_1ent')}</div>
        <div style={card}>
          <b style={{ fontSize: 12 }}>{tx('pos.by_technician_2')}</b>
          {r.byTechnician.map((t) => <div key={t.technicianId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{t.technicianName || t.technicianId} · {t.statements} {tx('pos.statements')}</span><span>{money(t.payableCents)} {tx('pos.paid_6')}{' '}{money(t.paidCents)} {tx('pos.unpaid_2')}{' '}{money(t.unpaidCents)}</span></div>)}
        </div>
        {r.byBranch.length ? <div style={card}>
          <b style={{ fontSize: 12 }}>{tx('pos.by_branch_where_the_work_was_1s22')}</b>
          {r.byBranch.map((b) => <div key={b.branchId ?? 'none'} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{b.branchName || tx('pos.branch')}</span><span>{money(b.serviceEarningsCents)} + {money(b.tipsCents)} {tx('pos.tips_6')}</span></div>)}
        </div> : null}
        <div style={card}>
          <b style={{ fontSize: 12 }}>{tx('pos.check_register')}</b>
          {r.checkRegister.length ? r.checkRegister.map((c) => <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>#{c.checkNumber || '—'} · {c.technicianName}</span><span>{money(c.amountCents)} · {statusLabel('payout', c.checkStatus == null ? '' : String(c.checkStatus))}</span></div>) : <div style={small}>{tx('pos.no_checks_in_this_range')}</div>}
        </div>
        <div style={card}>
          <b style={{ fontSize: 12 }}>{tx('pos.cash_payouts')}</b>
          {r.cashPayouts.length ? r.cashPayouts.map((c) => <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{c.technicianName} · {SOURCE_LABEL[c.cashSource as CashSource] ?? '—'}</span><span>{money(c.amountCents)} · {statusLabel('payout', c.cashStatus == null ? '' : String(c.cashStatus))}</span></div>) : <div style={small}>{tx('pos.no_cash_payouts_in_this_range')}</div>}
        </div>
      </> : null}
    </div>
  );
}

/** The owner's pay schedule and payout policy: the week, pay day, the 50 / 50 default, the cash cap, automatic weeks. */
function ScheduleView({ stepUp }: { stepUp: StepUp }) {
  const [s, setS] = useState<PayrollScheduleView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { posPayrollApi.paySchedule().then(setS).catch((e: any) => setErr(errText(e, tx('people.paycheck.err.loadSchedule')))); }, []);
  if (!s) return err ? <div role="alert" style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{err}</div> : <div style={small}>{tx('pos.loading')}</div>;
  const set = (patch: Partial<PayrollScheduleView>) => setS({ ...s, ...patch });
  const save = async () => {
    setErr(null); setMsg(null);
    try { setS(await stepUp(() => posPayrollApi.savePaySchedule(s))); setMsg(tx('pos.pay_schedule_saved')); } catch (e: any) { setErr(errText(e, tx('people.paycheck.err.saveSchedule'))); }
  };
  // weekday names in the POS language (Jan 4 2026 is a Sunday; UTC so no zone shifts the day)
  const DAYS = [0, 1, 2, 3, 4, 5, 6].map((i) => new Intl.DateTimeFormat(displayLocale(), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + i))));
  return (
    <div style={{ ...card, display: 'grid', gap: 8, maxWidth: 560 }}>
      <label style={small}>{tx('people.paycheck.schedule.frequency')}
        <select aria-label={tx('people.paycheck.schedule.frequency')} style={{ ...sel, marginLeft: 8 }} value={s.frequency} onChange={(e) => set({ frequency: e.target.value })}>{Object.keys(FREQ_KEY).map((f) => <option key={f} value={f}>{tx(FREQ_KEY[f])}</option>)}</select></label>
      <label style={small}>{tx('pos.the_week_starts_on')}
        <select aria-label={tx('pos.week_starts_on')} style={{ ...sel, marginLeft: 8 }} value={s.weekStartDay} onChange={(e) => set({ weekStartDay: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
      <label style={small}>{tx('pos.pay_day_days_after_the_week_1xiy')}
        <input aria-label={tx('pos.pay_day_offset')} type="number" min={0} max={31} style={{ ...sel, width: 70, marginLeft: 8 }} value={s.payDayOffsetDays} onChange={(e) => set({ payDayOffsetDays: Number(e.target.value) })} /></label>
      <label style={small}>{tx('pos.default_payout')}
        <select aria-label={tx('pos.default_payout')} style={{ ...sel, marginLeft: 8 }} value={s.defaultPolicy} onChange={(e) => set({ defaultPolicy: e.target.value as PayrollScheduleView['defaultPolicy'] })}>
          <option value="split_check_cash">{tx('pos.split_check_cash')}</option><option value="all_check">{tx('pos.all_by_check')}</option><option value="all_cash">{tx('pos.all_in_cash')}</option>
        </select></label>
      <label style={small}>{tx('pos.check_share_of_the_split')}
        <input aria-label={tx('pos.check_percent')} type="number" min={0} max={100} style={{ ...sel, width: 70, marginLeft: 8 }} value={s.defaultCheckBp / 100} onChange={(e) => set({ defaultCheckBp: Math.round(Number(e.target.value) * 100) })} /></label>
      <label style={small}>{tx('pos.the_odd_cent_goes_to')}
        <select aria-label={tx('pos.primary_method')} style={{ ...sel, marginLeft: 8 }} value={s.primaryMethod} onChange={(e) => set({ primaryMethod: e.target.value as 'check' | 'cash' })}><option value="check">{tx('pos.check')}</option><option value="cash">{tx('pos.cash')}</option></select></label>
      <label style={small}><input type="checkbox" checked={s.cashEnabled} onChange={(e) => set({ cashEnabled: e.target.checked })} /> {tx('pos.pay_part_of_payroll_in_cash')}</label>
      <label style={small}>{tx('pos.most_of_a_paycheck_that_may_18lz')}
        <input aria-label={tx('pos.cash_limit')} type="number" min={0} max={100} style={{ ...sel, width: 70, marginLeft: 8 }} value={s.maxCashBp / 100} onChange={(e) => set({ maxCashBp: Math.round(Number(e.target.value) * 100) })} /></label>
      <label style={small}><input type="checkbox" checked={s.manualSplitAllowed} onChange={(e) => set({ manualSplitAllowed: e.target.checked })} /> {tx('pos.managers_may_set_a_custom_split_9ejh')}</label>
      <label style={small}><input type="checkbox" checked={s.cashTipsAlreadyPaid} onChange={(e) => set({ cashTipsAlreadyPaid: e.target.checked })} /> {tx('pos.cash_tips_are_handed_to_technicians_mzax')}</label>
      <label style={small}>{tx('pos.cash_counts_as_paid_when')}
        <select aria-label={tx('pos.cash_paid_on')} style={{ ...sel, marginLeft: 8 }} value={s.cashPaidOn} onChange={(e) => set({ cashPaidOn: e.target.value as 'acknowledged' | 'handed_off' })}><option value="acknowledged">{tx('pos.the_technician_confirms')}</option><option value="handed_off">{tx('pos.the_manager_hands_it_over')}</option></select></label>
      <label style={small}><input type="checkbox" checked={s.autoPrepare} onChange={(e) => set({ autoPrepare: e.target.checked })} /> {tx('pos.open_and_calculate_each_week_automatically_1j16')}</label>
      {err ? <div role="alert" style={{ fontSize: 12, color: 'var(--aps-danger)' }}>{err}</div> : null}
      {msg ? <div role="status" style={{ ...small, color: 'var(--aps-success)' }}>{msg}</div> : null}
      <button style={btn(true)} onClick={save}>{tx('pos.save_2')}</button>
    </div>
  );
}
