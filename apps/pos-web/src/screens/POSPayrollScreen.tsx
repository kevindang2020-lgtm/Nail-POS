// POSPayrollScreen.tsx — Team › Payroll. The ONE payroll screen (Payroll mandate §91–§95, wave 2 Oct 12 2026).
// Periods: the pay-period list with the owner dashboard status (§151) and the period workspace — build from sales, prepare
// for review (validation §143–§145), approve (step-up, expected version + the calculation hash the reviewer saw), reopen
// with a reason, record payouts / mark paid (paid vs outstanding per technician, §78), CSV / Excel export (audited, §83),
// per-technician drill-down (§93) with adjustments, carry-forward of a negative balance (§150) and the manual tip re-split
// (§28). Review: pending adjustments / chargeback and closed-period reversals (approve / reject). Exceptions: the financial
// exception queue (§197). Questions: technicians' payroll inquiries (§152). Pay plans: hourly / salary / hybrid + the
// configured deduction types (§38–§45, §59–§61). The server decides every figure; money typed here goes through the shared
// parser. Inline dialogs only. Honest loading / empty / error states.
import { useCallback, useEffect, useState } from 'react';
import { PageHeader, KpiCard, StatusBadge, DataTable, EmptyState, Drawer, parseDollarsToCents, type Column, type Tone } from '@aipowersalon/ui';
import { posPayrollApi } from '../api/posPayrollApi';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { useCan } from '../components/usePermissions';
import { useStepUp } from './access/accessUi';
import { PaycheckTab } from './POSPaycheckTab';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
import { codeLabel } from '../components/peopleLabels';
import { fmtDateTime, fmtInZone } from '../i18n/format';
import { RangeCalendar } from '../components/FinanceKit';
import { Pager } from '../components/FitKit';
type Status = 'draft' | 'review' | 'finalized' | 'paid';
type Dash = 'OPEN' | 'NEEDS_REVIEW' | 'READY_TO_APPROVE' | 'HAS_EXCEPTIONS' | 'LOCKED' | 'PAID';
type Period = { id: string; label: string | null; periodStart: string; periodEnd: string; status: Status; version?: number; previewHash?: string | null; approvalHash?: string | null; dashboardStatus?: Dash;
  blockingCount?: number; warningCount?: number; totalGrossCents: number; totalCommissionCents: number; totalTipsCents: number; totalPayableCents: number; reopenReason?: string | null };
type Line = { id: string; technicianId: string; technicianName: string | null; servicesCount: number; grossSalesCents: number; commissionType: string; commissionValue: number; commissionCents: number;
  tipsCents: number; adjustmentCents: number; payableCents: number; retailCommissionCents?: number; guaranteeTopUpCents?: number; hourlyPayCents?: number; workedMinutes?: number; potentialOvertimeMinutes?: number;
  salaryPayCents?: number; bonusCents?: number; deductionCents?: number; netCents?: number; reviewRequired?: boolean; paidCents?: number; outstandingCents?: number };
type Payout = { id: string; technicianId: string; amountCents: number; method: string; status: string; reference: string | null; paidAt: string | null; createdAt: string };
type Detail = { period: Period; lines: Line[]; payouts?: Payout[]; totals?: { payableCents: number; paidCents: number; outstandingCents: number } };
type Issue = { code: string; severity: 'blocking' | 'warning'; message: string; count: number };
type Validation = { ok: boolean; blocking: number; warnings: number; issues: Issue[] };
type State = { kpis: { totalPeriods: number; openPeriods: number; unpaidPayableCents: number; lifetimePayableCents: number; lifetimeCommissionCents: number; lifetimeTipsCents: number }; periods: Period[] };
type Tab = 'paychecks' | 'periods' | 'review' | 'exceptions' | 'inquiries' | 'plans';

const money = (c: number | null | undefined) => { const n = Math.trunc(Number(c) || 0); const a = Math.abs(n); return `${n < 0 ? '−' : ''}$${Math.floor(a / 100).toLocaleString()}.${String(a % 100).padStart(2, '0')}`; };
const STATUS_TONE: Record<Status, Tone> = { draft: 'neutral', review: 'warning', finalized: 'info', paid: 'success' };
// label tables are functions: they translate when read (a language switch re-labels in place)
const STATUS_LABEL = (): Record<Status, string> => ({ draft: tx('pos.open'), review: tx('pos.in_review'), finalized: tx('people.payroll.status.finalized'), paid: tx('pos.paid_3') });
const DASH_TONE: Record<Dash, Tone> = { OPEN: 'neutral', NEEDS_REVIEW: 'warning', READY_TO_APPROVE: 'info', HAS_EXCEPTIONS: 'danger', LOCKED: 'purple', PAID: 'success' };
const DASH_LABEL = (): Record<Dash, string> => ({ OPEN: tx('pos.open'), NEEDS_REVIEW: tx('pos.needs_review_3'), READY_TO_APPROVE: tx('people.payroll.dash.readyToApprove'), HAS_EXCEPTIONS: tx('people.payroll.dash.hasExceptions'), LOCKED: tx('pos.locked_2'), PAID: tx('pos.paid_3') });
const METHODS: { id: string; label: string }[] = [{ id: 'direct_deposit', get label() { return tx('pos.direct_deposit'); } }, { id: 'check', get label() { return tx('pos.check'); } }, { id: 'cash', get label() { return tx('pos.cash'); } }, { id: 'external_provider', get label() { return tx('pos.payroll_provider'); } }, { id: 'other', get label() { return tx('pos.other'); } }];
const CATEGORIES: { id: string; label: string; sign: 1 | -1 | 0 }[] = [{ id: 'bonus', get label() { return tx('pos.bonus'); }, sign: 1 }, { id: 'commission_correction', get label() { return tx('pos.commission_correction'); }, sign: 0 }, { id: 'guarantee_correction', get label() { return tx('pos.guarantee_correction'); }, sign: 0 }, { id: 'payroll_correction', get label() { return tx('pos.payroll_correction'); }, sign: 0 }, { id: 'deduction', get label() { return tx('pos.deduction'); }, sign: -1 }];
const REASONS: { id: string; label: string }[] = [{ id: 'performance_bonus', get label() { return tx('pos.performance_bonus'); } }, { id: 'attendance_bonus', get label() { return tx('pos.attendance_bonus'); } }, { id: 'campaign_bonus', get label() { return tx('pos.campaign_bonus'); } }, { id: 'manual_bonus', get label() { return tx('pos.manual_bonus'); } },
  { id: 'missed_commission', get label() { return tx('pos.missed_commission'); } }, { id: 'commission_error', get label() { return tx('pos.commission_error'); } }, { id: 'guarantee_error', get label() { return tx('pos.guarantee_error'); } }, { id: 'prior_period_correction', get label() { return tx('pos.prior_period_correction'); } },
  { id: 'supply_charge', get label() { return tx('pos.supply_charge'); } }, { id: 'equipment', get label() { return tx('pos.equipment'); } }, { id: 'advance_repayment', get label() { return tx('pos.advance_repayment'); } }, { id: 'other', get label() { return tx('pos.other'); } }];
const errText = (e: any, fallback: string) => {
  if (e?.code === 'STEP_UP_CANCELLED') return tx('pos.not_changed_the_password_confirmation_was_wxix');
  const issues: Issue[] | undefined = e?.details?.issues;
  if (issues?.length) return `${e?.message || fallback} ${issues.map((i) => i.message).join(' ')}`;
  return e?.message || fallback;
};

const sel: React.CSSProperties = { height: 32, border: '1px solid var(--aps-line)', borderRadius: 8, padding: '0 8px', background: 'var(--aps-card)', fontFamily: 'inherit', fontSize: 12, color: 'var(--aps-text)' };
const card: React.CSSProperties = { background: 'var(--aps-card)', border: '1px solid var(--aps-line)', borderRadius: 14 };
const btn = (p?: boolean, danger?: boolean): React.CSSProperties => ({ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid ' + (danger ? 'var(--aps-danger)' : p ? 'var(--aps-gold)' : 'var(--aps-line)'), background: p ? 'var(--aps-gold)' : 'var(--aps-card)', color: danger ? 'var(--aps-danger)' : p ? '#fff' : 'var(--aps-text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' });
const small: React.CSSProperties = { fontSize: 11.5, color: 'var(--aps-muted)' };

function downloadBase64(filename: string, mimeType: string, base64: string) {
  const bin = atob(base64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function POSPayrollScreen() {
  const can = useCan();
  const { run: stepUp, prompt } = useStepUp(tx('people.payroll.stepUp'));
  const [tab, setTab] = useState<Tab>('periods');
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<{ configured: boolean; reason: string | null } | null>(null);
  const [techs, setTechs] = useState<any[]>([]);

  const loadState = useCallback(() => (posPayrollApi.getState() as Promise<State>).then((d) => { setS(d); setError(null); }).catch((e: any) => setError(e?.message || tx('pos.failed_to_load_payroll'))), []);
  useEffect(() => {
    loadState();
    posTechniciansApi.directory().then((r) => setTechs(r)).catch(() => setTechs([]));   // every technician, not the first page of 20
    posPayrollApi.provider().then(setProvider).catch(() => setProvider(null));
  }, [loadState]);
  const techName = useCallback((id: string) => { const t = techs.find((x) => (x.id || x.technicianId) === id); return t ? (t.fullName || t.displayName || t.name || `${t.firstName || ''} ${t.lastName || ''}`.trim()) : null; }, [techs]);

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_payroll')}</div></div>;
  const k = s.kpis;
  const TABS: { id: Tab; label: string }[] = [{ id: 'paychecks', label: tx('pos.weekly_paychecks') }, { id: 'periods', label: tx('pos.pay_periods') }, { id: 'review', label: tx('pos.adjustments_to_review') }, { id: 'exceptions', label: tx('pos.exceptions') }, { id: 'inquiries', label: tx('pos.questions') }, { id: 'plans', label: tx('pos.pay_plans') }];
  return (
    <div className="work" style={{ display: 'grid', gridTemplateRows: 'auto auto auto minmax(0,1fr)', height: '100%', gap: 10, padding: '14px 16px', boxSizing: 'border-box' }}>
      <PageHeader title={tx('pos.payroll')} subtitle={tx('pos.pay_periods_approval_payouts_exports_totalperiods_1van', { totalPeriods: String(k.totalPeriods), plural: String(k.totalPeriods === 1 ? '' : 's') })}
        actions={provider ? <span style={small} title={provider.reason ? codeLabel(`people.payroll.providerReason.${provider.reason}`, provider.reason) : ''}>{provider.configured ? tx('pos.payroll_provider_connected') : tx('pos.no_payroll_provider_connected_use_the_114d')}</span> : null} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <KpiCard label={tx('pos.open_periods')} value={k.openPeriods.toLocaleString()} tone="info" />
        <KpiCard label={tx('pos.unpaid_payable')} value={money(k.unpaidPayableCents)} tone="warning" />
        <KpiCard label={tx('pos.lifetime_payable')} value={money(k.lifetimePayableCents)} tone="success" />
        <KpiCard label={tx('pos.lifetime_commission')} value={money(k.lifetimeCommissionCents)} tone="purple" />
        <KpiCard label={tx('pos.lifetime_tips')} value={money(k.lifetimeTipsCents)} tone="teal" />
      </div>
      <div role="tablist" data-module-id="pr-tabs" aria-label={tx('pos.payroll_sections')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} style={btn(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <div className="pr-body" style={{ minHeight: 0, overflow: 'auto' }}>
        {tab === 'paychecks' && <PaycheckTab periods={s.periods} reload={loadState} can={can} stepUp={stepUp} />}
        {tab === 'periods' && <PeriodsTab state={s} reload={loadState} can={can} stepUp={stepUp} techs={techs} techName={techName} />}
        {tab === 'review' && <ReviewTab can={can} stepUp={stepUp} techName={techName} />}
        {tab === 'exceptions' && <ExceptionsTab can={can} />}
        {tab === 'inquiries' && <InquiriesTab can={can} />}
        {tab === 'plans' && <PlansTab can={can} stepUp={stepUp} techs={techs} techName={techName} />}
      </div>
      {prompt}
    </div>
  );
}

type StepUp = <T>(action: () => Promise<T>) => Promise<T>;

function PeriodsTab({ state, reload, can, stepUp, techs, techName }: { state: State; reload: () => Promise<unknown>; can: (p: string) => boolean; stepUp: StepUp; techs: any[]; techName: (id: string) => string | null }) {
  // SUNMI batch 9 guide 8 (Nov 10 2026): the period list is searchable, filterable by status and by a From–To range (a
  // period shows when it overlaps the range), newest first (start date, then id) and paged — it was one unsorted column
  const [pf, setPf] = useState<PeriodFilter>({ q: '', status: 'all' });
  const [listPage, setListPage] = useState(1);
  // batch 9 decision 3: the search also finds the periods a technician (name or phone) is paid in — matched by the server
  // against the period lines (GET /pos/payroll/state?technician=), so a name never has to be in the period label
  const [techHits, setTechHits] = useState<Set<string> | null>(null);
  const [techSearchDown, setTechSearchDown] = useState(false);
  useEffect(() => {
    const q = pf.q.trim();
    if (q.length < 2) { setTechHits(null); setTechSearchDown(false); return; }
    let live = true;
    const h = setTimeout(() => {
      posPayrollApi.getState({ technician: q, pageSize: 200 })
        .then((r: any) => { if (live) { setTechHits(new Set(((r?.periods ?? []) as { id: string }[]).map((x) => x.id))); setTechSearchDown(false); } })
        .catch(() => { if (live) { setTechHits(null); setTechSearchDown(true); } });   // shown below the search box — label/date search still works
    }, 300);
    return () => { live = false; clearTimeout(h); };
  }, [pf.q]);
  const shownPeriods = filterPeriods(state.periods, pf, (x) => (x.dashboardStatus ? DASH_LABEL()[x.dashboardStatus] : STATUS_LABEL()[x.status]), techHits);
  const pageOfPeriods = shownPeriods.slice((listPage - 1) * LIST_SIZE, listPage * LIST_SIZE);
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [np, setNp] = useState({ label: '', start: '', end: '' });
  const [form, setForm] = useState<null | 'reopen' | 'sendBack' | 'pay' | 'payout' | 'adjust'>(null);
  const [drawerTech, setDrawerTech] = useState<string | null>(null);
  const [exportsList, setExportsList] = useState<any[]>([]);

  const open = useCallback(async (id: string) => {
    setSelId(id); setNote(null); setForm(null); setValidation(null);
    try { setDetail(await posPayrollApi.getPeriod(id)); } catch (e: any) { setNote({ ok: false, text: e?.message || tx('pos.failed_to_load_the_period') }); }
    posPayrollApi.validation(id).then(setValidation).catch(() => setValidation(null));
    posPayrollApi.exportHistory(id).then((r) => setExportsList(r || [])).catch(() => setExportsList([]));
  }, []);
  const refresh = async () => { await reload(); if (selId) await open(selId); };
  const act = async (label: string, fn: () => Promise<any>, done: string) => {
    setBusy(true); setNote(null);
    try { const r = await fn(); if (r?.validation) setValidation(r.validation); setForm(null); await refresh(); setNote({ ok: true, text: done }); }
    catch (e: any) { if (e?.code === 'PAYROLL_VERSION_CONFLICT' && selId) await open(selId); setNote({ ok: false, text: errText(e, tx('people.payroll.actionFailed', { action: label })) }); }
    finally { setBusy(false); }
  };
  const createPeriod = async () => {
    if (!np.start || !np.end) { setNote({ ok: false, text: tx('pos.start_and_end_dates_are_required') }); return; }
    try { const p = await posPayrollApi.createPeriod({ label: np.label || undefined, periodStart: np.start, periodEnd: np.end }); setNp({ label: '', start: '', end: '' }); await reload(); open(p.id); }
    catch (e: any) { setNote({ ok: false, text: e?.message || tx('pos.failed_to_create_the_period') }); }
  };

  const p = detail?.period;
  const v = p?.version;
  const lineCols: Column<Line>[] = [
    { key: 'tech', header: tx('pos.technician'), render: (l) => <button style={{ ...btn(), border: 'none', padding: 0, background: 'transparent' }} onClick={() => setDrawerTech(l.technicianId)}><b>{l.technicianName || techName(l.technicianId) || l.technicianId}</b>{l.reviewRequired ? <span style={{ color: 'var(--aps-danger)', fontSize: 11 }}> {tx('pos.review_2')}</span> : null}</button> },
    { key: 'svc', header: tx('pos.svcs'), align: 'right', render: (l) => l.servicesCount },
    { key: 'gross', header: tx('pos.service_sales'), align: 'right', render: (l) => money(l.grossSalesCents) },
    { key: 'comm', header: tx('pos.commission'), align: 'right', render: (l) => money(l.commissionCents) },
    { key: 'time', header: tx('pos.hourly_salary'), align: 'right', render: (l) => (l.hourlyPayCents || l.salaryPayCents) ? <span title={l.workedMinutes ? tx('pos.v0_h_worked_v1', { v0: String((l.workedMinutes / 60).toFixed(2)), v1: String(l.potentialOvertimeMinutes ? tx('pos.v0_h_potential_overtime_review', { v0: String((l.potentialOvertimeMinutes / 60).toFixed(2)) }) : '') }) : ''}>{money((l.hourlyPayCents || 0) + (l.salaryPayCents || 0))}</span> : '—' },
    { key: 'tips', header: tx('pos.tips'), align: 'right', render: (l) => money(l.tipsCents) },
    { key: 'retail', header: tx('pos.retail'), align: 'right', render: (l) => money(l.retailCommissionCents) },
    { key: 'bonus', header: tx('pos.bonus'), align: 'right', render: (l) => money(l.bonusCents) },
    { key: 'topup', header: tx('pos.top_up'), align: 'right', render: (l) => money(l.guaranteeTopUpCents) },
    { key: 'ded', header: tx('pos.deductions'), align: 'right', render: (l) => (l.deductionCents ? money(-(l.deductionCents)) : '—') },
    { key: 'adj', header: tx('pos.adj'), align: 'right', render: (l) => money(l.adjustmentCents) },
    { key: 'pay', header: tx('pos.payable'), align: 'right', render: (l) => <b>{money(l.payableCents)}</b> },
    { key: 'paid', header: tx('pos.paid_3'), align: 'right', render: (l) => money(l.paidCents) },
    { key: 'owed', header: tx('pos.outstanding'), align: 'right', render: (l) => money(l.outstandingCents ?? l.payableCents) },
  ];

  return (
    <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(320px,35fr)_minmax(0,65fr)]" style={{ height: '100%' }}>
      <div style={{ ...card, overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {can('payroll.manage') ? (
          <div style={{ padding: 10, borderBottom: '1px solid var(--aps-line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>{tx('pos.new_pay_period')}</div>
            <input style={sel} aria-label={tx('pos.period_label')} placeholder={tx('pos.label_e_g_jun_1_15')} value={np.label} onChange={(e) => setNp({ ...np, label: e.target.value })} />
            <div style={{ display: 'flex', gap: 6 }}><input aria-label={tx('pos.period_start')} style={{ ...sel, flex: 1 }} type="date" value={np.start} onChange={(e) => setNp({ ...np, start: e.target.value })} /><input aria-label={tx('pos.period_end')} style={{ ...sel, flex: 1 }} type="date" value={np.end} onChange={(e) => setNp({ ...np, end: e.target.value })} /></div>
            <button style={btn(true)} onClick={createPeriod}>{tx('pos.create')}</button>
          </div>
        ) : null}
        {state.periods.length === 0 ? <div style={{ padding: 18 }}><EmptyState title={tx('pos.no_pay_periods')} message={tx('pos.create_a_period_to_begin')} /></div> : (<>
          <PeriodListFilters value={pf} onChange={(v) => { setPf(v); setListPage(1); }} total={shownPeriods.length} />
          {techSearchDown ? <div className="s" style={{ padding: '4px 10px', color: 'var(--muted)' }} data-testid="payroll-tech-search-down">{tx('pay.list.techSearchDown')}</div> : null}
          {pageOfPeriods.length === 0 ? <div style={{ padding: 18 }} data-testid="payroll-nomatch">{tx('rpt.tx.noMatch')}</div> : null}
          {pageOfPeriods.map((x) => (
            <button key={x.id} onClick={() => open(x.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--aps-line)', background: selId === x.id ? 'var(--aps-page)' : 'transparent', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><span style={{ fontWeight: 700, fontSize: 13 }}>{x.label || `${x.periodStart} – ${x.periodEnd}`}</span>
                <StatusBadge tone={DASH_TONE[x.dashboardStatus ?? 'OPEN'] ?? STATUS_TONE[x.status]}>{x.dashboardStatus ? DASH_LABEL()[x.dashboardStatus] : STATUS_LABEL()[x.status]}</StatusBadge></div>
              <div style={{ ...small, marginTop: 2 }}>{tx('pos.payable')}{' '}{money(x.totalPayableCents)} · {x.periodStart} – {x.periodEnd}</div>
            </button>
          ))}
          <div style={{ padding: '6px 10px' }}><Pager compact info={{ page: listPage, pageSize: LIST_SIZE, totalItems: shownPeriods.length, totalPages: Math.max(1, Math.ceil(shownPeriods.length / LIST_SIZE)) }} onPage={setListPage} label={tx('pay.list.pager')} /></div>
        </>)}
      </div>

      <div style={{ ...card, minHeight: 0, overflow: 'auto' }}>
        {!detail || !p ? <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><EmptyState title={tx('pos.select_a_pay_period')} message={note?.text || tx('pos.choose_a_period_to_review_approve_1dnl')} /></div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
            <div className="flex flex-wrap justify-between items-center gap-2.5">
              <div>
                <div style={{ fontWeight: 800 }}>{p.label || `${p.periodStart} – ${p.periodEnd}`} <span style={small}>v{v}</span></div>
                <div style={small}>{tx('pos.payable')}{' '}<b>{money(detail.totals?.payableCents ?? p.totalPayableCents)}</b> {tx('pos.paid_4')}{' '}{money(detail.totals?.paidCents ?? 0)} {tx('pos.outstanding_2')}{' '}{money(detail.totals?.outstandingCents ?? p.totalPayableCents)} {tx('pos.commission_2')}{' '}{money(p.totalCommissionCents)} {tx('pos.tips_2')}{' '}{money(p.totalTipsCents)}</div>
                {p.reopenReason && p.status === 'draft' ? <div style={small}>{tx('pos.reopened')}{' '}{p.reopenReason}</div> : null}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusBadge tone={STATUS_TONE[p.status]}>{STATUS_LABEL()[p.status]}</StatusBadge>
                {p.status === 'draft' && can('payroll.manage') ? <button style={btn()} disabled={busy} onClick={() => act(tx('pos.build'), () => posPayrollApi.buildFromSales(p.id), tx('people.payroll.done.rebuilt'))}>{tx('pos.build_from_sales')}</button> : null}
                {p.status === 'draft' && can('payroll.manage') ? <button style={btn(true)} disabled={busy} onClick={() => act(tx('pos.prepare'), () => posPayrollApi.prepare(p.id, v), tx('people.payroll.done.prepared'))}>{tx('pos.prepare_for_review')}</button> : null}
                {p.status === 'review' && can('payroll.manage') ? <button style={btn()} disabled={busy} onClick={() => setForm('sendBack')}>{tx('pos.send_back')}</button> : null}
                {(p.status === 'review' || p.status === 'draft') && can('payroll.approve') ? <button style={btn(true)} disabled={busy} onClick={() => act(tx('pos.approve'), () => stepUp(() => posPayrollApi.finalize(p.id, { expectedVersion: v, calculationHash: p.status === 'review' ? p.previewHash : null })), tx('people.payroll.done.approved'))}>{tx('pos.approve')}</button> : null}
                {p.status === 'finalized' && can('payroll.approve') ? <button style={btn()} disabled={busy} onClick={() => setForm('reopen')}>{tx('pos.reopen')}</button> : null}
                {p.status === 'finalized' && can('payouts.manage') ? <button style={btn()} disabled={busy} onClick={() => setForm('payout')}>{tx('pos.record_payout')}</button> : null}
                {p.status === 'finalized' && can('payouts.manage') ? <button style={btn(true)} disabled={busy} onClick={() => setForm('pay')}>{tx('pos.mark_paid_2')}</button> : null}
                {p.status !== 'draft' && can('payroll.export') ? <><button style={btn()} disabled={busy} onClick={() => act(tx('pos.export'), async () => { const f = await posPayrollApi.exportPeriod(p.id, 'csv'); downloadBase64(f.filename, f.mimeType, f.base64); }, tx('people.payroll.done.csv'))}>{tx('pos.export_csv')}</button>
                  <button style={btn()} disabled={busy} onClick={() => act(tx('pos.export'), async () => { const f = await posPayrollApi.exportPeriod(p.id, 'xlsx'); downloadBase64(f.filename, f.mimeType, f.base64); }, tx('people.payroll.done.excel'))}>{tx('pos.export_excel')}</button></> : null}
              </div>
            </div>
            {note ? <div role={note.ok ? 'status' : 'alert'} style={{ fontSize: 12.5, color: note.ok ? 'var(--aps-success, #2e7d32)' : 'var(--aps-danger)' }}>{note.text}</div> : null}

            {form === 'reopen' ? <ReasonForm label={tx('pos.why_is_this_approved_period_being_9t7f')} confirm={tx('pos.reopen_2')} onCancel={() => setForm(null)} onSubmit={(r) => act(tx('pos.reopen_2'), () => stepUp(() => posPayrollApi.reopen(p.id, r, v)), tx('people.payroll.done.reopened'))} /> : null}
            {form === 'sendBack' ? <ReasonForm label={tx('pos.what_needs_to_change_before_approval')} confirm={tx('pos.send_back')} onCancel={() => setForm(null)} onSubmit={(r) => act(tx('pos.send_back'), () => posPayrollApi.sendBack(p.id, r, v), tx('people.payroll.done.sentBack'))} /> : null}
            {form === 'pay' ? <PayForm onCancel={() => setForm(null)} onSubmit={(method, reference) => act(tx('pos.mark_paid_3'), () => stepUp(() => posPayrollApi.pay(p.id, { expectedVersion: v, method, reference })), tx('people.payroll.done.paid'))} /> : null}
            {form === 'payout' ? <PayoutForm lines={detail.lines} techName={techName} onCancel={() => setForm(null)} onSubmit={(b) => act(tx('pos.record_payout'), () => stepUp(() => posPayrollApi.recordPayout(p.id, b)), tx('people.payroll.done.payoutRecorded'))} /> : null}
            {form === 'adjust' ? <AdjustmentForm techs={techs} lines={detail.lines} techName={techName} onCancel={() => setForm(null)} onSubmit={(b) => act(tx('pos.adjustment'), () => posPayrollApi.createAdjustment(p.id, b), tx('people.payroll.done.adjustment'))} /> : null}

            {validation && validation.issues.length ? (
              <div style={{ border: '1px solid var(--aps-line)', borderRadius: 10, padding: 8 }} aria-label={tx('pos.payroll_checks')}>
                <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>{tx('pos.checks_before_approval')}{' '}{validation.blocking} {tx('pos.blocking')}{' '}{validation.warnings} {tx('pos.warning')}{enPlural(validation.warnings === 1 ? '' : 's')}</div>
                {validation.issues.map((i) => <div key={i.code} style={{ fontSize: 12, color: i.severity === 'blocking' ? 'var(--aps-danger)' : 'var(--aps-muted)' }}>{i.severity === 'blocking' ? '● ' : '○ '}{i.message}{i.count > 1 ? ` (${i.count})` : ''}</div>)}
              </div>
            ) : validation ? <div style={small}>{tx('pos.all_payroll_checks_pass')}</div> : null}

            {p.status === 'draft' ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {can('payroll.adjust') ? <button style={btn()} onClick={() => setForm('adjust')}>{tx('pos.adjustment_bonus_deduction')}</button> : null}
              </div>
            ) : <div style={small}>{p.status === 'paid' ? tx('pos.this_period_is_paid_and_locked_ibq9') : p.status === 'finalized' ? tx('pos.approved_and_locked_reopen_with_a_1ccf') : tx('pos.in_review_lines_are_frozen_send_1r23')}</div>}

            <div className="min-h-0 overflow-x-auto"><div className="min-w-[1100px]">
              <DataTable<Line> columns={lineCols} rows={detail.lines} getRowKey={(l) => l.id} maxHeight="100%" empty={<EmptyState title={tx('pos.no_technician_lines_yet')} message={p.status === 'draft' ? tx('pos.build_from_sales_to_bring_in_dhvl') : tx('pos.no_lines')} />} />
            </div></div>

            {detail.payouts && detail.payouts.length ? (
              <div>
                <div style={{ fontWeight: 700, fontSize: 12.5, margin: '4px 0' }}>{tx('pos.payouts')}</div>
                {detail.payouts.map((o) => (
                  <div key={o.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--aps-line)' }}>
                    <span style={{ minWidth: 140 }}>{techName(o.technicianId) || o.technicianId}</span><b>{money(o.amountCents)}</b><span style={small}>{statusLabel('paymentMethod', o.method)}{o.reference ? ` · ${o.reference}` : ''}</span>
                    <StatusBadge tone={o.status === 'paid' ? 'success' : o.status === 'failed' ? 'danger' : o.status === 'canceled' ? 'neutral' : 'warning'}>{statusLabel('payout', o.status)}</StatusBadge>
                    {can('payouts.manage') && (o.status === 'pending' || o.status === 'processing') ? <><button style={btn()} onClick={() => act(tx('pos.payout'), () => stepUp(() => posPayrollApi.setPayoutStatus(o.id, { status: 'paid' })), tx('people.payroll.done.payoutPaid'))}>{tx('pos.mark_paid_3')}</button>
                      <button style={btn(false, true)} onClick={() => act(tx('pos.payout'), () => stepUp(() => posPayrollApi.setPayoutStatus(o.id, { status: 'canceled' })), tx('people.payroll.done.payoutCanceled'))}>{tx('pos.cancel')}</button></> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {exportsList.length ? <div style={small}>{tx('pos.exports')}{' '}{exportsList.slice(0, 5).map((x) => `${x.format.toUpperCase()} v${x.periodVersion} ${fmtInZone(x.createdAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`).join(' · ')}</div> : null}
          </div>
        )}
      </div>
      <Drawer open={!!drawerTech && !!p} onClose={() => setDrawerTech(null)} title={drawerTech ? (techName(drawerTech) || tx('glossary.people.technician')) : ''} width={520}>
        {drawerTech && p ? <TechnicianDrawer periodId={p.id} periodStatus={p.status} technicianId={drawerTech} can={can} onChanged={refresh} /> : null}
      </Drawer>
    </div>
  );
}

function ReasonForm({ label, confirm, onSubmit, onCancel }: { label: string; confirm: string; onSubmit: (r: string) => void; onCancel: () => void }) {
  const [r, setR] = useState(''); const [err, setErr] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--aps-line)', borderRadius: 10, padding: 8 }}>
      <input aria-label={label} placeholder={label} style={{ ...sel, flex: 1, minWidth: 260 }} value={r} onChange={(e) => setR(e.target.value)} />
      <button style={btn(true)} onClick={() => { if (r.trim().length < 3) { setErr(tx('pos.write_a_short_reason')); return; } onSubmit(r.trim()); }}>{confirm}</button>
      <button style={btn()} onClick={onCancel}>{tx('pos.cancel')}</button>
      {err ? <span role="alert" style={{ color: 'var(--aps-danger)', fontSize: 12 }}>{err}</span> : null}
    </div>
  );
}

function PayForm({ onSubmit, onCancel }: { onSubmit: (method: string, reference: string) => void; onCancel: () => void }) {
  const [method, setMethod] = useState('direct_deposit'); const [ref, setRef] = useState('');
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--aps-line)', borderRadius: 10, padding: 8 }}>
      <span style={{ fontSize: 12 }}>{tx('pos.pay_every_outstanding_amount_by')}</span>
      <select aria-label={tx('pos.payout_method')} style={sel} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
      <input aria-label={tx('pos.payment_reference')} placeholder={tx('pos.reference_batch_check_no')} style={sel} value={ref} onChange={(e) => setRef(e.target.value)} />
      <button style={btn(true)} onClick={() => onSubmit(method, ref.trim())}>{tx('pos.mark_paid_3')}</button>
      <button style={btn()} onClick={onCancel}>{tx('pos.cancel')}</button>
    </div>
  );
}

function PayoutForm({ lines, techName, onSubmit, onCancel }: { lines: Line[]; techName: (id: string) => string | null; onSubmit: (b: { technicianId: string; amountCents: number; method: string; status: 'pending' | 'paid'; reference?: string; idempotencyKey: string }) => void; onCancel: () => void }) {
  const owed = lines.filter((l) => (l.outstandingCents ?? l.payableCents) > 0);
  const [tech, setTech] = useState(owed[0]?.technicianId ?? ''); const [amt, setAmt] = useState(''); const [method, setMethod] = useState('cash'); const [status, setStatus] = useState<'paid' | 'pending'>('paid'); const [ref, setRef] = useState('');
  const [err, setErr] = useState<string | null>(null); const [key] = useState(() => `payout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const line = owed.find((l) => l.technicianId === tech);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--aps-line)', borderRadius: 10, padding: 8 }}>
      <select aria-label={tx('pos.payout_technician')} style={sel} value={tech} onChange={(e) => setTech(e.target.value)}>{owed.map((l) => <option key={l.technicianId} value={l.technicianId}>{l.technicianName || techName(l.technicianId) || l.technicianId} {tx('pos.owed')}{' '}{money(l.outstandingCents ?? l.payableCents)}</option>)}</select>
      <input aria-label={tx('pos.payout_amount')} placeholder={tx('pos.amount_3')} inputMode="decimal" style={{ ...sel, width: 100 }} value={amt} onChange={(e) => setAmt(e.target.value)} />
      <select aria-label={tx('pos.payout_method')} style={sel} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
      <select aria-label={tx('pos.payout_status')} style={sel} value={status} onChange={(e) => setStatus(e.target.value as any)}><option value="paid">{tx('pos.paid_now')}</option><option value="pending">{tx('pos.pending_sent_not_settled')}</option></select>
      <input aria-label={tx('pos.payout_reference')} placeholder={tx('pos.reference')} style={sel} value={ref} onChange={(e) => setRef(e.target.value)} />
      <button style={btn(true)} onClick={() => {
        const cents = parseDollarsToCents(amt);
        if (cents == null || cents <= 0) { setErr(tx('pos.enter_a_valid_amount')); return; }
        if (line && cents > (line.outstandingCents ?? line.payableCents)) { setErr(tx('pos.that_is_more_than_this_technician_1wyt')); return; }
        onSubmit({ technicianId: tech, amountCents: cents, method, status, reference: ref.trim() || undefined, idempotencyKey: key });
      }}>{tx('pos.record')}</button>
      <button style={btn()} onClick={onCancel}>{tx('pos.cancel')}</button>
      {owed.length === 0 ? <span style={small}>{tx('pos.everyone_is_fully_paid')}</span> : null}
      {err ? <span role="alert" style={{ color: 'var(--aps-danger)', fontSize: 12 }}>{err}</span> : null}
    </div>
  );
}

function AdjustmentForm({ techs, lines, techName, onSubmit, onCancel }: { techs: any[]; lines: Line[]; techName: (id: string) => string | null; onSubmit: (b: { technicianId: string; category: string; amountCents: number; reasonCode: string; reason: string; deductionType?: string; idempotencyKey: string }) => void; onCancel: () => void }) {
  const ids = [...new Set([...lines.map((l) => l.technicianId), ...techs.map((t) => t.id || t.technicianId)])].filter(Boolean);
  const [tech, setTech] = useState(ids[0] ?? ''); const [cat, setCat] = useState('bonus'); const [dir, setDir] = useState<1 | -1>(1); const [amt, setAmt] = useState('');
  const [code, setCode] = useState('performance_bonus'); const [reason, setReason] = useState(''); const [dtype, setDtype] = useState(''); const [types, setTypes] = useState<any[]>([]); const [err, setErr] = useState<string | null>(null);
  const [key] = useState(() => `adj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  useEffect(() => { posPayrollApi.deductionTypes().then((r) => setTypes((r || []).filter((t: any) => t.enabled))).catch(() => setTypes([])); }, []);
  const c = CATEGORIES.find((x) => x.id === cat)!;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--aps-line)', borderRadius: 10, padding: 8 }}>
      <select aria-label={tx('pos.adjustment_technician')} style={sel} value={tech} onChange={(e) => setTech(e.target.value)}>{ids.map((id) => <option key={id} value={id}>{techName(id) || id}</option>)}</select>
      <select aria-label={tx('pos.adjustment_type')} style={sel} value={cat} onChange={(e) => setCat(e.target.value)}>{CATEGORIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
      {c.sign === 0 ? <select aria-label={tx('pos.adjustment_direction')} style={sel} value={dir} onChange={(e) => setDir(Number(e.target.value) as 1 | -1)}><option value={1}>{tx('pos.add_to_pay')}</option><option value={-1}>{tx('pos.take_from_pay')}</option></select> : null}
      {cat === 'deduction' ? <select aria-label={tx('pos.deduction_type')} style={sel} value={dtype} onChange={(e) => setDtype(e.target.value)}><option value="">{tx('pos.deduction_type_2')}</option>{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select> : null}
      <input aria-label={tx('pos.adjustment_amount')} placeholder={tx('pos.amount_3')} inputMode="decimal" style={{ ...sel, width: 100 }} value={amt} onChange={(e) => setAmt(e.target.value)} />
      <select aria-label={tx('pos.reason_code')} style={sel} value={code} onChange={(e) => setCode(e.target.value)}>{REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
      <input aria-label={tx('pos.adjustment_explanation')} placeholder={tx('pos.explanation')} style={{ ...sel, flex: 1, minWidth: 200 }} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button style={btn(true)} onClick={() => {
        const cents = parseDollarsToCents(amt);
        if (cents == null || cents <= 0) { setErr(tx('pos.enter_a_valid_amount')); return; }
        if (reason.trim().length < 3) { setErr(tx('pos.explain_the_adjustment')); return; }
        if (cat === 'deduction' && !dtype) { setErr(types.length ? tx('pos.choose_a_deduction_type') : tx('pos.turn_on_a_deduction_type_under_gfey')); return; }
        onSubmit({ technicianId: tech, category: cat, amountCents: c.sign === 0 ? cents * dir : cents, reasonCode: code, reason: reason.trim(), deductionType: cat === 'deduction' ? dtype : undefined, idempotencyKey: key });
      }}>{tx('pos.add')}</button>
      <button style={btn()} onClick={onCancel}>{tx('pos.cancel')}</button>
      <span style={small}>{tx('pos.large_adjustments_wait_for_an_owner_3arl')}</span>
      {err ? <span role="alert" style={{ color: 'var(--aps-danger)', fontSize: 12 }}>{err}</span> : null}
    </div>
  );
}

// ManualLineForm (a hand-typed payroll line beside the canonical one) was REMOVED Oct 13 2026 (FLOW D7): off-POS money is
// an Adjustment (AdjustmentForm) — reason, approval, rebuilt into the lines by PREPARE.

function TechnicianDrawer({ periodId, periodStatus, technicianId, can, onChanged }: { periodId: string; periodStatus: Status; technicianId: string; can: (p: string) => boolean; onChanged: () => Promise<unknown> }) {
  const [d, setD] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null); const [tipTicket, setTipTicket] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => posPayrollApi.technician(periodId, technicianId).then(setD).catch((e: any) => setErr(e?.message || tx('pos.could_not_load_the_technician'))), [periodId, technicianId]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <div className="state">{tx('pos.loading')}</div>;
  const l = d.line;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
      {l ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 12px' }}>
          {[[tx('pos.service_commission'), l.commissionCents], [tx('pos.hourly_pay'), l.hourlyPayCents], [tx('pos.salary'), l.salaryPayCents], [tx('pos.retail_commission'), l.retailCommissionCents], [tx('people.payroll.line.tipsCard'), l.cardTipCents], [tx('people.payroll.line.tipsCash'), l.cashTipCents],
            [tx('people.payroll.line.bonuses'), l.bonusCents], [tx('people.payroll.line.guaranteeTopUp'), l.guaranteeTopUpCents], [tx('people.payroll.line.adjustments'), l.adjustmentCents], [tx('pos.deductions'), -(l.deductionCents || 0)]].filter(([, c]) => c).flatMap(([k, c]) => [<span key={`${k}-l`}>{k}</span>, <span key={`${k}-v`} style={{ textAlign: 'right' }}>{money(c as number)}</span>])}
          <b>{tx('pos.net')}</b><b style={{ textAlign: 'right' }}>{money(l.netCents)}</b>
          <b>{tx('pos.payable')}</b><b style={{ textAlign: 'right' }}>{money(l.payableCents)}</b>
          {l.workedMinutes ? <><span style={small}>{tx('pos.worked')}</span><span style={{ ...small, textAlign: 'right' }}>{(l.workedMinutes / 60).toFixed(2)} h{l.potentialOvertimeMinutes ? tx('pos.v0_h_potential_ot', { v0: String((l.potentialOvertimeMinutes / 60).toFixed(2)) }) : ''}</span></> : null}
        </div>
      ) : <div style={small}>{tx('pos.no_line_for_this_technician_yet')}</div>}
      {l && l.netCents < 0 && periodStatus === 'draft' && can('payroll.adjust') ? (
        <div role="alert" style={{ color: 'var(--aps-danger)' }}>{tx('pos.nets_below_zero_never_paid_as_12in')}
          <button style={{ ...btn(), marginLeft: 8 }} onClick={async () => { try { await posPayrollApi.carryForward(periodId, technicianId); setNote(tx('pos.balance_carried_to_the_next_period')); await onChanged(); await load(); } catch (e: any) { setNote(errText(e, tx('people.payroll.err.carryForward'))); } }}>{tx('pos.carry_to_next_period')}</button></div>
      ) : null}
      {note ? <div role="status" style={small}>{note}</div> : null}
      <div><b>{tx('pos.services_3')}{d.services.length})</b>
        {d.services.length === 0 ? <div style={small}>{tx('pos.no_paid_services_in_this_period')}</div> : d.services.slice(0, 200).map((x: any, i: number) => (
          <div key={x.ticketId + i} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--aps-line)', padding: '2px 0' }}>
            <span>{fmtInZone(x.completedAt, { month: 'short', day: 'numeric', year: 'numeric' })} · {x.serviceName || tx('pos.service_3')} <span style={small}>{money(x.lineTotalCents)}{x.ruleSource ? ` · ${x.ruleSource}` : ''}</span></span><span>{money(x.commissionCents)}</span></div>))}
      </div>
      <div><b>{tx('pos.tips_by_ticket')}</b>
        {d.tips.length === 0 ? <div style={small}>{tx('pos.no_tips')}</div> : d.tips.map((t: any, i: number) => (
          <div key={t.ticketId + i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--aps-line)', padding: '2px 0' }}>
            <span>{t.day} {tx('pos.card_3')}{' '}{money(t.cardTipCents)} {tx('pos.cash_2')}{' '}{money(t.cashTipCents)}</span>
            {can('tips.adjust') ? <button style={btn()} onClick={() => setTipTicket(t.ticketId)}>{tx('pos.re_split')}</button> : null}
          </div>))}
        {tipTicket ? <TipSplitEditor ticketId={tipTicket} onDone={async () => { setTipTicket(null); await onChanged(); await load(); }} onCancel={() => setTipTicket(null)} /> : null}
      </div>
      <div><b>{tx('pos.adjustments')}</b>
        {d.adjustments.length === 0 ? <div style={small}>{tx('pos.none_2')}</div> : d.adjustments.map((a: any) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--aps-line)', padding: '2px 0' }}>
            <span>{statusLabel('payrollAdjustment', a.category)} · <span style={small}>{a.reason}{a.originalPeriodId ? tx('pos.corrects_a_locked_period') : ''} · {statusLabel('payout', a.status)}</span></span><span>{money(a.amountCents)}</span></div>))}
      </div>
      <div><b>{tx('pos.payouts')}</b>
        {d.payouts.length === 0 ? <div style={small}>{tx('pos.none_recorded')}</div> : d.payouts.map((o: any) => <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{statusLabel('paymentMethod', o.method)} · {statusLabel('payout', o.status)}</span><span>{money(o.amountCents)}</span></div>)}
      </div>
    </div>
  );
}

function TipSplitEditor({ ticketId, onDone, onCancel }: { ticketId: string; onDone: () => void; onCancel: () => void }) {
  const [t, setT] = useState<any | null>(null); const [vals, setVals] = useState<Record<string, string>>({}); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { posPayrollApi.ticketTip(ticketId).then((r) => { setT(r); setVals(Object.fromEntries(r.allocations.map((a) => [a.technicianId, (a.tipCents / 100).toFixed(2)]))); }).catch((e: any) => setErr(e?.message || tx('pos.could_not_load_the_tip'))); }, [ticketId]);
  if (!t) return err ? <div role="alert" style={{ color: 'var(--aps-danger)' }}>{err}</div> : <div style={small}>{tx('pos.loading_tip')}</div>;
  const parsed = t.allocations.map((a: any) => ({ technicianId: a.technicianId, tipCents: parseDollarsToCents(vals[a.technicianId] ?? '') }));
  const sum = parsed.reduce((s: number, a: any) => s + (a.tipCents ?? 0), 0);
  return (
    <div style={{ border: '1px solid var(--aps-line)', borderRadius: 10, padding: 8, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontWeight: 700 }}>{tx('pos.tip_3')}{' '}{money(t.tipCents)} {t.locked ? <span style={small}>{tx('pos.paid_the_change_is_recorded_as_rneo')}</span> : null}</div>
      {t.allocations.map((a: any) => (
        <label key={a.technicianId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>{a.name || a.technicianId}
          <input aria-label={tx('pos.tip_for_v0', { v0: String(a.name || a.technicianId) })} inputMode="decimal" style={{ ...sel, width: 100 }} value={vals[a.technicianId] ?? ''} onChange={(e) => setVals({ ...vals, [a.technicianId]: e.target.value })} /></label>))}
      <div style={{ ...small, color: sum === t.tipCents ? 'var(--aps-muted)' : 'var(--aps-danger)' }}>{tx('pos.allocated')}{' '}{money(sum)} {tx('pos.of')}{' '}{money(t.tipCents)}</div>
      {t.locked ? <input aria-label={tx('pos.tip_adjustment_reason')} placeholder={tx('pos.reason_required_the_tip_is_locked_139j')} style={sel} value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={btn(true)} onClick={async () => {
          if (parsed.some((a: any) => a.tipCents == null)) { setErr(tx('pos.enter_each_amount_in_dollars')); return; }
          if (sum !== t.tipCents) { setErr(tx('pos.the_split_must_add_up_to_2hx7')); return; }
          if (t.locked && reason.trim().length < 3) { setErr(tx('pos.give_a_reason_for_the_tip_1hnb')); return; }
          try { await posPayrollApi.setTicketTip(ticketId, { allocations: parsed, reason: reason.trim() || undefined }); onDone(); } catch (e: any) { setErr(errText(e, tx('people.payroll.err.saveSplit'))); }
        }}>{tx('pos.save_split')}</button>
        <button style={btn()} onClick={onCancel}>{tx('pos.cancel')}</button>
      </div>
      {err ? <div role="alert" style={{ color: 'var(--aps-danger)', fontSize: 12 }}>{err}</div> : null}
    </div>
  );
}

function ReviewTab({ can, stepUp, techName }: { can: (p: string) => boolean; stepUp: StepUp; techName: (id: string) => string | null }) {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null); const [rejecting, setRejecting] = useState<string | null>(null);
  const load = useCallback(() => posPayrollApi.adjustments({ status: 'pending' }).then((r) => { setRows(r || []); setErr(null); }).catch((e: any) => setErr(e?.message || tx('pos.could_not_load_adjustments'))), []);
  useEffect(() => { load(); }, [load]);
  const decide = async (id: string, d: 'approve' | 'reject', reason?: string) => { try { await stepUp(() => posPayrollApi.decideAdjustment(id, d, reason)); setRejecting(null); await load(); } catch (e: any) { setErr(errText(e, tx('people.payroll.err.decide'))); } };
  if (rows === null) return err ? <div className="err">{err}</div> : <div className="state">{tx('pos.loading')}</div>;
  return (
    <div style={{ ...card, padding: 12, overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {err ? <div role="alert" className="err">{err}</div> : null}
      {rows.length === 0 ? <EmptyState title={tx('pos.nothing_waiting')} message={tx('pos.large_adjustments_chargeback_reversals_and_refunds_1klt')} /> : rows.map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid var(--aps-line)', fontSize: 12.5 }}>
          <b style={{ minWidth: 140 }}>{a.technicianId ? (techName(a.technicianId) || a.technicianId) : tx('pos.unassigned')}</b>
          <span>{statusLabel('payrollAdjustment', a.category)} <b>{money(a.amountCents)}</b></span>
          <span style={small}>{codeLabel(`people.payroll.source.${a.source}`, a.source)}{a.chargebackId ? tx('pos.chargeback') : ''}{a.originalPeriodId ? tx('pos.against_a_locked_period') : ''} · {a.reason}</span>
          {can('payroll.approve') ? (rejecting === a.id
            ? <ReasonForm label={tx('pos.why_reject_it')} confirm={tx('pos.reject')} onCancel={() => setRejecting(null)} onSubmit={(r) => decide(a.id, 'reject', r)} />
            : <><button style={btn(true)} onClick={() => decide(a.id, 'approve')}>{tx('pos.approve')}</button><button style={btn(false, true)} onClick={() => setRejecting(a.id)}>{tx('pos.reject')}</button></>) : null}
        </div>))}
    </div>
  );
}

const KIND_LABEL = (): Record<string, string> => ({ missing_snapshot: tx('people.payroll.exception.missingSnapshot'), missing_technician: tx('people.payroll.exception.missingTechnician'), unallocated_tip: tx('people.payroll.exception.unallocatedTip'), missing_rule: tx('people.payroll.exception.missingRule'),
  refund_closed_period: tx('people.payroll.exception.refundClosedPeriod'), chargeback_review: tx('people.payroll.exception.chargebackReview'), negative_pay: tx('people.payroll.exception.negativePay'), invalid_data: tx('people.payroll.exception.invalidData') });
function ExceptionsTab({ can }: { can: (p: string) => boolean }) {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null); const [closing, setClosing] = useState<{ id: string; action: 'resolve' | 'dismiss' } | null>(null);
  const load = useCallback(() => posPayrollApi.exceptions({ status: 'open' }).then((r) => { setRows(r || []); setErr(null); }).catch((e: any) => setErr(e?.message || tx('pos.could_not_load_exceptions'))), []);
  useEffect(() => { load(); }, [load]);
  const act = async (id: string, action: 'resolve' | 'dismiss' | 'retry', note?: string) => { try { await posPayrollApi.exceptionAction(id, action, note); setClosing(null); await load(); } catch (e: any) { setErr(errText(e, tx('people.payroll.err.exception'))); } };
  if (rows === null) return err ? <div className="err">{err}</div> : <div className="state">{tx('pos.loading')}</div>;
  return (
    <div style={{ ...card, padding: 12, overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {err ? <div role="alert" className="err">{err}</div> : null}
      {rows.length === 0 ? <EmptyState title={tx('pos.no_open_exceptions')} message={tx('pos.payroll_problems_the_system_cannot_fix_esqa')} /> : rows.map((x) => (
        <div key={x.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid var(--aps-line)', fontSize: 12.5 }}>
          <StatusBadge tone={x.severity === 'blocking' ? 'danger' : 'warning'}>{codeLabel(`people.payroll.severity.${x.severity}`, x.severity)}</StatusBadge>
          <b>{KIND_LABEL()[x.kind] || statusLabel('payrollException', x.kind)}</b>
          <span style={small}>{x.ticketId ? tx('pos.ticket_v0', { v0: String(x.ticketId.slice(0, 8)) }) : ''}{x.attempts ? tx('pos.attempts_retr_plural', { attempts: String(x.attempts), plural: String(x.attempts === 1 ? 'y' : 'ies') }) : ''}{x.lastError ? ` · ${x.lastError}` : ''}</span>
          {can('payroll.manage') ? (closing && closing.id === x.id
            ? <ReasonForm label={tx('pos.note_for_the_record')} confirm={closing.action === 'resolve' ? tx('pos.resolve') : tx('pos.dismiss')} onCancel={() => setClosing(null)} onSubmit={(n) => act(x.id, closing.action, n)} />
            : <>{x.kind === 'missing_snapshot' ? <button style={btn()} onClick={() => act(x.id, 'retry')}>{tx('pos.retry_now')}</button> : null}
              <button style={btn()} onClick={() => setClosing({ id: x.id, action: 'resolve' })}>{tx('pos.resolve')}</button><button style={btn()} onClick={() => setClosing({ id: x.id, action: 'dismiss' })}>{tx('pos.dismiss')}</button></>) : null}
        </div>))}
    </div>
  );
}

function InquiriesTab({ can }: { can: (p: string) => boolean }) {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null); const [answer, setAnswer] = useState<Record<string, { response: string; privateNote: string }>>({});
  const load = useCallback(() => posPayrollApi.inquiries().then((r) => { setRows(r || []); setErr(null); }).catch((e: any) => setErr(e?.message || tx('pos.could_not_load_questions'))), []);
  useEffect(() => { load(); }, [load]);
  if (rows === null) return err ? <div className="err">{err}</div> : <div className="state">{tx('pos.loading')}</div>;
  return (
    <div style={{ ...card, padding: 12, overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {err ? <div role="alert" className="err">{err}</div> : null}
      {rows.length === 0 ? <EmptyState title={tx('pos.no_questions')} message={tx('pos.when_a_technician_asks_about_an_343i')} /> : rows.map((q) => {
        const a = answer[q.id] ?? { response: q.response || '', privateNote: q.privateNote || '' };
        return (
          <div key={q.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--aps-line)', fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div><b>{q.technicianName || tx('pos.technician')}</b> <span style={small}>{fmtDateTime(q.createdAt)} · {codeLabel(`people.payroll.inquiry.${q.status}`, q.status)}</span></div>
            <div>{q.message}</div>
            {can('payroll.manage') && q.status !== 'closed' ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input aria-label={tx('pos.answer_to_the_technician')} placeholder={tx('pos.answer_the_technician_sees_this')} style={{ ...sel, flex: 1, minWidth: 220 }} value={a.response} onChange={(e) => setAnswer({ ...answer, [q.id]: { ...a, response: e.target.value } })} />
                <input aria-label={tx('pos.private_note')} placeholder={tx('pos.private_note_managers_only')} style={{ ...sel, flex: 1, minWidth: 180 }} value={a.privateNote} onChange={(e) => setAnswer({ ...answer, [q.id]: { ...a, privateNote: e.target.value } })} />
                <button style={btn(true)} onClick={async () => { try { await posPayrollApi.respondInquiry(q.id, { response: a.response.trim(), privateNote: a.privateNote.trim() || undefined }); await load(); } catch (e: any) { setErr(errText(e, tx('people.payroll.err.answer'))); } }}>{tx('pos.answer')}</button>
                <button style={btn()} onClick={async () => { try { await posPayrollApi.respondInquiry(q.id, { response: a.response.trim() || 'Closed.', privateNote: a.privateNote.trim() || undefined, close: true }); await load(); } catch (e: any) { setErr(errText(e, tx('people.payroll.err.close'))); } }}>{tx('pos.answer_close')}</button>
              </div>
            ) : q.response ? <div style={small}>{tx('pos.answer_2')}{' '}{q.response}</div> : null}
          </div>);
      })}
    </div>
  );
}

function PlansTab({ can, stepUp, techs, techName }: { can: (p: string) => boolean; stepUp: StepUp; techs: any[]; techName: (id: string) => string | null }) {
  const [plans, setPlans] = useState<any[] | null>(null); const [types, setTypes] = useState<any[]>([]); const [err, setErr] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null);
  const [f, setF] = useState({ technicianId: '', payType: 'hourly', hourly: '', salary: '', breaksPaid: false, start: '', end: '' });
  const [d, setD] = useState({ key: '', label: '', cap: '' });
  const load = useCallback(() => {
    posPayrollApi.payPlans().then((r) => { setPlans(r || []); setErr(null); }).catch((e: any) => { setPlans([]); setErr(e?.status === 403 ? tx('pos.pay_plans_are_visible_to_the_13q5') : (e?.message || tx('pos.could_not_load_pay_plans'))); });
    posPayrollApi.deductionTypes().then((r) => setTypes(r || [])).catch(() => setTypes([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  const manage = can('compensation.manage');
  const save = async () => {
    setNote(null);
    const hourly = f.hourly ? parseDollarsToCents(f.hourly) : null; const salary = f.salary ? parseDollarsToCents(f.salary) : null;
    if (!f.technicianId || !f.start) { setErr(tx('pos.choose_a_technician_and_a_start_1s94')); return; }
    if ((f.hourly && hourly == null) || (f.salary && salary == null)) { setErr(tx('pos.enter_amounts_in_dollars')); return; }
    try { await stepUp(() => posPayrollApi.createPayPlan({ technicianId: f.technicianId, payType: f.payType, hourlyRateCents: hourly, salaryCentsPerPeriod: salary, breaksPaid: f.breaksPaid, effectiveStart: f.start, effectiveEnd: f.end || null })); setNote(tx('pos.pay_plan_saved')); load(); }
    catch (e: any) { setErr(errText(e, tx('people.payroll.err.payPlan'))); }
  };
  if (plans === null) return <div className="state">{tx('pos.loading')}</div>;
  return (
    <div style={{ ...card, padding: 12, overflow: 'auto', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {err ? <div role="alert" className="err">{err}</div> : null}{note ? <div role="status" style={small}>{note}</div> : null}
      <div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{tx('pos.pay_plans')}</div>
        <div style={small}>{tx('pos.commission_is_the_default_hourly_pays_1c6n')}</div>
        {manage ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
            <select aria-label={tx('pos.plan_technician')} style={sel} value={f.technicianId} onChange={(e) => setF({ ...f, technicianId: e.target.value })}><option value="">{tx('pos.technician')}</option>{techs.map((t) => <option key={t.id || t.technicianId} value={t.id || t.technicianId}>{t.fullName || t.displayName || t.name || tx('pos.technician')}</option>)}</select>
            <select aria-label={tx('pos.pay_type')} style={sel} value={f.payType} onChange={(e) => setF({ ...f, payType: e.target.value })}><option value="commission">{tx('pos.commission')}</option><option value="hourly">{tx('pos.hourly')}</option><option value="salary">{tx('pos.salary')}</option><option value="hybrid">{tx('pos.hybrid_commission')}</option></select>
            {(f.payType === 'hourly' || f.payType === 'hybrid') ? <input aria-label={tx('pos.hourly_rate')} placeholder={tx('pos.hourly_2')} inputMode="decimal" style={{ ...sel, width: 90 }} value={f.hourly} onChange={(e) => setF({ ...f, hourly: e.target.value })} /> : null}
            {(f.payType === 'salary' || f.payType === 'hybrid') ? <input aria-label={tx('pos.salary_per_pay_period')} placeholder={tx('pos.salary_period')} inputMode="decimal" style={{ ...sel, width: 120 }} value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} /> : null}
            <label style={{ fontSize: 12 }}><input type="checkbox" checked={f.breaksPaid} onChange={(e) => setF({ ...f, breaksPaid: e.target.checked })} /> {tx('pos.breaks_paid')}</label>
            <input aria-label={tx('pos.plan_start')} type="date" style={sel} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
            <input aria-label={tx('pos.plan_end')} type="date" style={sel} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
            <button style={btn(true)} onClick={save}>{tx('pos.save_plan')}</button>
          </div>
        ) : null}
        {plans.length === 0 ? <div style={{ ...small, marginTop: 6 }}>{tx('pos.no_pay_plans_everyone_is_paid_4wn8')}</div> : plans.map((pl) => (
          <div key={pl.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--aps-line)' }}>
            <b style={{ minWidth: 140 }}>{techName(pl.technicianId) || pl.technicianId}</b><span>{pl.payType}</span>
            <span style={small}>{pl.hourlyRateCents != null ? `${money(pl.hourlyRateCents)}/h ` : ''}{pl.salaryCentsPerPeriod != null ? `${tx('people.payroll.plan.perPeriod', { amount: money(pl.salaryCentsPerPeriod) })} ` : ''}{pl.breaksPaid ? tx('pos.breaks_paid_2') : ''}· {pl.effectiveStart} → {pl.effectiveEnd || tx('people.payroll.plan.openEnded')} · {codeLabel(`people.payroll.plan.${pl.status}`, pl.status)}</span>
            {manage && pl.status === 'active' ? <button style={btn()} onClick={async () => { try { await stepUp(() => posPayrollApi.archivePayPlan(pl.id)); load(); } catch (e: any) { setErr(errText(e, tx('people.payroll.err.endPlan'))); } }}>{tx('pos.end_plan')}</button> : null}
          </div>))}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{tx('pos.deduction_types')}</div>
        <div style={small}>{tx('pos.only_deductions_configured_here_can_be_i3ud')}</div>
        {types.map((t) => (
          <div key={t.key} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5, padding: '3px 0' }}>
            <b>{t.label}</b><span style={small}>{t.key}{t.maxCentsPerPeriod ? tx('pos.max_maxcentsperperiod_period', { maxCentsPerPeriod: String(money(t.maxCentsPerPeriod)) }) : ''}</span>
            {manage ? <button style={btn()} onClick={async () => { try { await posPayrollApi.saveDeductionType({ key: t.key, label: t.label, enabled: !t.enabled, maxCentsPerPeriod: t.maxCentsPerPeriod }); load(); } catch (e: any) { setErr(errText(e, tx('pos.could_not_save_2'))); } }}>{t.enabled ? tx('pos.turn_off') : tx('pos.turn_on')}</button> : <span style={small}>{t.enabled ? tx('people.common.on') : tx('people.common.off')}</span>}
          </div>))}
        {manage ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <input aria-label={tx('pos.deduction_key')} placeholder={tx('pos.key_e_g_supply_kit')} style={sel} value={d.key} onChange={(e) => setD({ ...d, key: e.target.value })} />
            <input aria-label={tx('pos.deduction_label')} placeholder={tx('pos.label')} style={sel} value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} />
            <input aria-label={tx('pos.deduction_cap')} placeholder={tx('pos.max_per_period_optional')} inputMode="decimal" style={sel} value={d.cap} onChange={(e) => setD({ ...d, cap: e.target.value })} />
            <button style={btn(true)} onClick={async () => {
              const cap = d.cap ? parseDollarsToCents(d.cap) : null;
              if (d.cap && (cap == null || cap <= 0)) { setErr(tx('pos.enter_the_limit_in_dollars')); return; }
              try { await posPayrollApi.saveDeductionType({ key: d.key.trim(), label: d.label.trim(), enabled: true, maxCentsPerPeriod: cap }); setD({ key: '', label: '', cap: '' }); load(); } catch (e: any) { setErr(errText(e, tx('people.payroll.err.deductionType'))); }
            }}>{tx('pos.add_type')}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── SUNMI batch 9 guide 8 (Nov 10 2026): pay-period list filters ─────────────────────────────────────────────────────────
const LIST_SIZE = 10;
export type PeriodFilter = { q: string; status: 'all' | Status; from?: string; to?: string };
/** newest first (start date desc, then id desc); search over label, dates and status words; a period shows when it overlaps
 *  the From–To range. Pure — the server still decides every figure. */
export function filterPeriods<P extends { id: string; label: string | null; periodStart: string; periodEnd: string; status: Status }>(rows: P[], f: PeriodFilter, statusText: (p: P) => string, techHits?: Set<string> | null): P[] {
  const fold = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const n = fold(f.q).trim();
  return rows
    .filter((p) => f.status === 'all' || p.status === f.status)
    .filter((p) => (!f.from || p.periodEnd >= f.from) && (!f.to || p.periodStart <= f.to))
    .filter((p) => !n || [p.label, p.periodStart, p.periodEnd, statusText(p)].some((v) => fold(v).includes(n)) || !!techHits?.has(p.id))   // or a technician paid in it (server match)
    .slice().sort((a, b) => (a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
function PeriodListFilters({ value, onChange, total }: { value: PeriodFilter; onChange: (v: PeriodFilter) => void; total: number }) {
  const [cal, setCal] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const range = value.from || value.to ? `${value.from ?? '…'} – ${value.to ?? '…'}` : tx('pay.list.anyDates');
  return (
    <div style={{ padding: 10, borderBottom: '1px solid var(--aps-line)', display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }} data-testid="payroll-list-filters">
      <input className="input" style={{ minHeight: 44 }} data-testid="payroll-search" maxLength={60} value={value.q} onChange={(e) => onChange({ ...value, q: e.target.value })} placeholder={tx('pay.list.search')} aria-label={tx('pay.list.search')} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" style={{ minHeight: 44 }} aria-label={tx('pay.list.status')} data-testid="payroll-status" value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value as PeriodFilter['status'] })}>
          {(['all', 'draft', 'review', 'finalized', 'paid'] as const).map((k) => <option key={k} value={k}>{k === 'all' ? tx('pay.list.allStatuses') : STATUS_LABEL()[k]}</option>)}
        </select>
        <button type="button" className="btn ghost" style={{ minHeight: 44 }} aria-haspopup="dialog" aria-expanded={cal} data-testid="payroll-dates" onClick={() => setCal((o) => !o)}>{range}</button>
        {value.q || value.status !== 'all' || value.from || value.to ? <button type="button" className="btn ghost sm" data-testid="payroll-clear" onClick={() => onChange({ q: '', status: 'all' })}>{tx('rpt.svc.clearAll')}</button> : null}
        <span className="s" data-testid="payroll-count">{tx('pay.list.count', { n: String(total) })}</span>
      </div>
      {cal ? <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 8 }}>
        <RangeCalendar initial={{ from: value.from, to: value.to }} today={today}
          onApply={(r) => { setCal(false); onChange({ ...value, from: r.from, to: r.to }); }} onCancel={() => setCal(false)} onClear={() => { setCal(false); onChange({ ...value, from: undefined, to: undefined }); }} />
      </div> : null}
    </div>
  );
}

