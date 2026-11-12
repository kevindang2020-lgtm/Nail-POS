// POSMembershipsScreen.tsx — Customers → Memberships (/tenant/customers/memberships). Membership Overview rebuild (Oct 29 2026,
// "Membership Overview — full-screen rebuild, member search, calendar filters, pagination"): the content pane scrolls vertically
// (the spec allows it; never sideways) instead of shrinking type to fit. Header (Create Membership Plan) · the five KPI cards
// (snapshot vs this-month scope stated on each; each opens its list) · ONE phone-first search + Today / Week / Month / Year /
// Custom (month calendar) with the date field it filters · tabs Overview · Members · Plans · Payments · Benefits · Activity,
// each its own server-paged, newest-first numbered list · Overview keeps Membership Plans | Active Members | Membership
// Activity and the four analytics · the ten Quick Actions under every tab · Member Details (identity, lifecycle, billing,
// benefits, activity + audit) from any member row. A historical period never filters a current-state count: it applies to
// the event lists (activity, payments, redemptions) and, on Members, to the chosen date field only.
// Every number is the server's (/pos/memberships/*, tenant-scoped, integer cents, the salon's time zone).
import { MembershipFirstPaymentPanel } from '../components/MembershipFirstPaymentPanel';
import { SystemCheckButton } from '../components/SystemCheck';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posMembershipsApi, type MemberExportRow, type PaymentExportRow, type RedemptionExportRow } from '../api/posMembershipsApi';
import { MembershipPlanBuilder } from './MembershipPlanBuilder';
import { MembershipEnrollModal } from './MembershipEnrollModal';
import { MembershipManageModal, type ManageMember } from './MembershipManageModal';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { statusLabel } from '../i18n/status-label';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced, downloadCsv, type PageInfo } from '../components/FitKit';
import { ExportPreview } from '../components/ExportPreview';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, useFreshAt, FreshnessLine, type PeriodState } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';

type Kpis = { totalMembers: number; newMembersThisMonth: number; activeMembers: number; activePctOfTotal: number; membershipRevenueCents: number; membershipPaymentsThisMonth?: number;
  revenueDeltaPct: number | null; expiringSoon: number; expiringWindowDays: number; canceledThisMonth: number; canceledDeltaPct: number | null };
type PlanRow = { planId: string; name: string; description: string | null; billingInterval: string; intervalCount: number; priceCents: number; isCustomPricing: boolean; status: string; isPopular: boolean; badge: string | null; memberCount: number; revenueCents: number };
type Overview = { kpis: Kpis; plans: PlanRow[]; revenueSeries: { label: string; cents: number }[]; statusBreakdown: { status: string; count: number; pct: number }[];
  planDistribution: { planName: string; count: number; pct: number; revenueCents: number }[]; topServices: { name: string; redemptions: number; valueCents: number }[]; rangeDays: number;
  distributionTotal?: number; statusTotal?: number };
type Member = { membershipId: string; customerId: string; customerName: string; avatarUrl: string | null; maskedPhone: string | null; planId: string | null; planName: string; status: string; memberNumber: string | null;
  startedAt: string | null; nextDate: string | null; nextDateKind: 'ends' | 'renews' | null; canceledAt: string | null; autoRenew: boolean; redemptions: number; lifetimePaidCents: number; lastPaymentStatus: string | null };
type Activity = { id: string; activityType: string; customerId: string | null; membershipId: string | null; customerName: string | null; planName: string | null; occurredAt: string | null; amountCents: number | null; status: string | null };
type Tab = 'overview' | 'members' | 'plans' | 'payments' | 'benefits' | 'activity';

const TABS: Tab[] = ['overview', 'members', 'plans', 'payments', 'benefits', 'activity'];
const MEMBER_FILTERS = ['any', 'all', 'active', 'expiring', 'canceled_this_month', 'paused', 'past_due', 'trial', 'canceled', 'expired'];
const PANEL_FILTERS = ['active', 'all', 'expiring', 'canceled_this_month', 'paused', 'past_due', 'trial'];
const MEMBER_DF = ['enrolled', 'created', 'renewal', 'expiration', 'canceled'];
const PAY_STATUSES = ['all', 'succeeded', 'pending', 'failed', 'refunded', 'voided'];
const PAGE = 10, PANEL = 5;
/** Each tab keeps its own period (Payments opens on this month — the Revenue card's own scope). */
const PERIOD0: Record<Tab, PeriodState> = { overview: { preset: 'all' }, members: { preset: 'all' }, plans: { preset: 'all' }, payments: { preset: 'month' }, benefits: { preset: 'all' }, activity: { preset: 'all' } };

const nf = (n: number) => fmtNumber(n || 0);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const whenTime = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const ymd = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : '');
const memberStatus = (s: string) => codeLabel(`people.membership.status.${s}`, s);
const interval = (s: string) => codeLabel(`people.membership.interval.${s}`, s);
const activityLabel = (s: string) => codeLabel(`people.membership.activity.${s}`, s);
const filterLabel = (s: string) => (s === 'any' || s === 'canceled' || s === 'expired' ? tx('mos.filter.' + s) : codeLabel(`people.mo.filter.${s}`, s));
const payStatus = (s: string) => (s === 'all' ? tx('mos.pay.all') : statusLabel(['payment', 'paymentAttempt'], s));
const errText = (e: any, fb: string) => errorTextOf(e, fb);
const planPrice = (p: { isCustomPricing: boolean; priceCents: number; billingInterval: string | null }) => (p.isCustomPricing ? tx('pos.custom_pricing') : `${fmtMoney(p.priceCents)} / ${interval(p.billingInterval || 'none')}`);
const planState = (s: string) => (s === 'active' ? tx('pos.active_3') : s === 'draft' ? tx('pos.draft_2') : s === 'paused' ? tx('mos.plan.paused') : tx('pos.archived_2'));
const STATUS_TONE: Record<string, string> = { active: 'ok', comped: 'ok', trial: 'info', grace: 'warn', past_due: 'warn', canceling: 'warn', paused: 'mut', canceled: 'bad', cancelled: 'bad', expired: 'bad', suspended: 'bad' };
const PAY_TONE: Record<string, string> = { succeeded: 'ok', pending: 'warn', failed: 'bad', refunded: 'mut', voided: 'mut' };
const ACT_TONE: Record<string, string> = { purchased: 'ok', renewed: 'ok', payment_recovered: 'ok', resumed: 'ok', upgraded: 'info', downgraded: 'info', transferred: 'info', benefit_redeemed: 'info', credit_rolled_over: 'info', expiring: 'warn', paused: 'mut', canceled: 'bad', payment_failed: 'bad', credit_expired: 'bad' };
const BAR = ['#A96F22', '#6BAF92', '#7B9FD4', '#C89B5A', '#D08C8C', '#B0A0C8', '#8A7A66'];
const pageOf = (d: any): PageInfo | null => (d ? { page: d.page, pageSize: d.pageSize, totalItems: d.totalItems, totalPages: d.totalPages } : null);
const nextText = (m: Member) => (m.status === 'canceled' || m.status === 'cancelled' ? tx('people.mo.canceledOn', { date: when(m.canceledAt) })
  : m.nextDate ? (m.nextDateKind === 'ends' ? tx('people.mo.ends', { date: when(m.nextDate) }) : tx('people.mo.renews', { date: when(m.nextDate) })) : '—');
const toManage = (m: { membershipId: string; customerName: string; planName: string; status: string; nextDate?: string | null; nextBillingAt?: string | null }): ManageMember =>
  ({ membershipId: m.membershipId, customerName: m.customerName, planName: m.planName, status: m.status, nextBillingAt: (m.nextDate ?? m.nextBillingAt) ?? null });

export function POSMembershipsScreen() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const canManage = can('customers.edit');   // pos.memberships.manage → customers.edit (security-core COARSE_DOMAIN)
  const tab: Tab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  const setTab = (t: Tab) => { const p = new URLSearchParams(params); if (t === 'overview') p.delete('tab'); else p.set('tab', t); setParams(p, { replace: true }); };
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [periods, setPeriods] = useState<Record<Tab, PeriodState>>(PERIOD0);
  const period = periods[tab]; const setPeriod = (p: PeriodState) => setPeriods((x) => ({ ...x, [tab]: p }));
  const [memberDf, setMemberDf] = useState('enrolled'); const [payDf, setPayDf] = useState('paid');
  const [memFilter, setMemFilter] = useState('any'); const [planId, setPlanId] = useState('');
  const [payStatusSel, setPayStatusSel] = useState('all'); const [actType, setActType] = useState(''); const [planStatus, setPlanStatus] = useState('');
  const [pages, setPages] = useState<Record<string, number>>({});
  const pg = (k: string) => pages[k] ?? 1; const setPg = (k: string) => (n: number) => setPages((x) => ({ ...x, [k]: n }));
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [rev, setRev] = useState(0);   // bumps after every mutation: KPIs, lists and charts reload
  const changed = (msg: string) => { setNote({ tone: 'ok', text: msg }); setPages({}); setRev((n) => n + 1); };

  // one search box for the whole page: typing on Overview opens Members (the member-first lookup), every list searches the full tenant
  useEffect(() => { if (q && tab === 'overview') setTab('members'); }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps
  const memberScope = { q: q || undefined, filter: memFilter, planId: planId || undefined, dateField: memberDf, ...periodQuery(periods.members) };
  const payScope = { q: q || undefined, status: payStatusSel, dateField: payDf, ...periodQuery(periods.payments) };
  const redScope = { q: q || undefined, ...periodQuery(periods.benefits) };
  const actScope = { q: q || undefined, type: actType || undefined, ...periodQuery(periods.activity) };
  const planScope = { q: q || undefined, status: planStatus || undefined };
  // a changed filter sends only the AFFECTED list back to Page 1
  const keys = { members: JSON.stringify(memberScope), payments: JSON.stringify(payScope), benefits: JSON.stringify(redScope), activity: JSON.stringify(actScope), plans: JSON.stringify(planScope) };
  useEffect(() => setPg('members')(1), [keys.members]);    
  useEffect(() => setPg('payments')(1), [keys.payments]);    
  useEffect(() => setPg('benefits')(1), [keys.benefits]);    
  useEffect(() => setPg('activity')(1), [keys.activity]);    
  useEffect(() => setPg('plans')(1), [keys.plans]);    

  const ov = useLoad(() => posMembershipsApi.overview() as Promise<Overview>, [rev]);
  const freshAt = useFreshAt(ov.data);   // data freshness: only after a successful read; a failed refresh keeps the last good time
  const [panelFilter, setPanelFilter] = useState('active');
  const ovActScope = { ...periodQuery(periods.overview) };
  const panelMembers = useLoad(() => (tab === 'overview' ? posMembershipsApi.members({ page: pg('p-members'), pageSize: PANEL, filter: panelFilter }) : Promise.resolve(null)), [tab === 'overview', pg('p-members'), panelFilter, rev]);
  const panelActivity = useLoad(() => (tab === 'overview' ? posMembershipsApi.activity({ page: pg('p-activity'), pageSize: PANEL, ...ovActScope }) : Promise.resolve(null)), [tab === 'overview', pg('p-activity'), JSON.stringify(ovActScope), rev]);
  useEffect(() => setPg('p-members')(1), [panelFilter]);    
  useEffect(() => setPg('p-activity')(1), [JSON.stringify(ovActScope)]);   // eslint-disable-line react-hooks/exhaustive-deps
  const members = useLoad(() => (tab === 'members' ? posMembershipsApi.members({ ...memberScope, page: pg('members'), pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.members, pg('members'), rev]);
  const payments = useLoad(() => (tab === 'payments' ? posMembershipsApi.payments({ ...payScope, page: pg('payments'), pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.payments, pg('payments'), rev]);
  const redemptions = useLoad(() => (tab === 'benefits' ? posMembershipsApi.redemptions({ ...redScope, page: pg('benefits'), pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.benefits, pg('benefits'), rev]);
  const activity = useLoad(() => (tab === 'activity' ? posMembershipsApi.activity({ ...actScope, page: pg('activity'), pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.activity, pg('activity'), rev]);
  const planList = useLoad(() => (tab === 'plans' || tab === 'overview' ? posMembershipsApi.planList({ ...(tab === 'plans' ? planScope : {}), page: tab === 'plans' ? pg('plans') : pg('p-plans'), pageSize: tab === 'plans' ? PAGE : PANEL }) : Promise.resolve(null)), [tab, keys.plans, pg('plans'), pg('p-plans'), rev]);
  const benefitDefs = useLoad(() => (tab === 'benefits' ? posMembershipsApi.discounts() : Promise.resolve(null)), [tab, rev]);
  // a page past the end is clamped by the server — follow it
  const served = [['members', members.data], ['payments', payments.data], ['benefits', redemptions.data], ['activity', activity.data], ['p-members', panelMembers.data], ['p-activity', panelActivity.data], [tab === 'plans' ? 'plans' : 'p-plans', planList.data]] as const;
  useEffect(() => { for (const [key, d] of served) { const p = (d as { page?: number } | null)?.page; if (p && p !== pg(key)) setPg(key)(p); } }, served.map(([, d]) => d));   // eslint-disable-line react-hooks/exhaustive-deps

  const [dlg, setDlg] = useState<null | { kind: 'create' } | { kind: 'enroll' } | { kind: 'manage'; m: ManageMember } | { kind: 'plan'; plan: PlanRow } | { kind: 'reminder' } | { kind: 'discounts' } | { kind: 'report' } | { kind: 'performance' } | { kind: 'detail'; id: string }>(null);
  const [busyExport, setBusyExport] = useState<string | null>(null);
  const stamp = () => deviceToday();
  const dollars = (c: number) => (c / 100).toFixed(2);
  // Export scope review (backlog Membership · 12): the rows are read first, then a preview shows the real row count and
  // scope; the file is only written after Download (Cancel writes nothing)
  const [pendingExport, setPendingExport] = useState<{ kind: string; n: number; go: () => void } | null>(null);
  const runExport = async (kind: 'members' | 'payments' | 'redemptions') => {
    if (busyExport) return; setBusyExport(kind); setNote(null);
    try {
      if (kind === 'members') {
        const rows = (await posMembershipsApi.exportMembers()) as MemberExportRow[];
        setPendingExport({ kind, n: rows.length, go: () => {
          downloadCsv(`membership-members-${stamp()}.csv`, [tx('people.membership.csv.customer'), tx('people.membership.csv.plan'), tx('people.membership.csv.status'), tx('people.membership.csv.memberNumber'), tx('people.membership.csv.joined'), tx('people.membership.csv.nextBilling'), tx('people.membership.csv.autoRenew'), tx('people.membership.csv.lifetimePaid')],
            rows.map((r) => [r.customerName, r.planName || '', memberStatus(r.status), r.memberNumber || '', ymd(r.joinDate), ymd(r.nextBillingAt), r.autoRenew ? tx('pos.yes') : tx('pos.no'), dollars(r.lifetimePaidCents)]));
          setNote({ tone: 'ok', text: tx('people.mo.exported', { n: nf(rows.length), what: tx('pos.export_members') }) });
        } });
      } else if (kind === 'payments') {
        const rows = (await posMembershipsApi.exportPayments()) as PaymentExportRow[];
        setPendingExport({ kind, n: rows.length, go: () => {
          downloadCsv(`membership-payments-${stamp()}.csv`, [tx('people.membership.csv.customer'), tx('people.membership.csv.plan'), tx('people.membership.csv.kind'), tx('people.membership.csv.amount'), tx('people.membership.csv.tax'), tx('people.membership.csv.status'), tx('people.membership.csv.processor'), tx('people.membership.csv.created'), tx('people.membership.csv.settled')],
            rows.map((r) => [r.customerName, r.planName || '', r.kind, dollars(r.amountCents), dollars(r.taxCents), statusLabel(['payment', 'paymentAttempt'], r.status), r.processor || '', ymd(r.createdAt), ymd(r.settledAt)]));
          setNote({ tone: 'ok', text: tx('people.mo.exported', { n: nf(rows.length), what: tx('pos.export_payments') }) });
        } });
      } else {
        const rows = (await posMembershipsApi.exportRedemptions()) as RedemptionExportRow[];
        setPendingExport({ kind, n: rows.length, go: () => {
          downloadCsv(`membership-redemptions-${stamp()}.csv`, [tx('people.membership.csv.customer'), tx('people.membership.csv.service'), tx('people.membership.csv.standardValue'), tx('people.membership.csv.allocatedValue'), tx('people.membership.csv.upgradeCharge'), tx('people.membership.csv.technician'), tx('people.membership.csv.date')],
            rows.map((r) => [r.customerName, r.serviceName || '', dollars(r.standardValueCents), dollars(r.allocatedValueCents), dollars(r.upgradeChargeCents), r.technicianName || '', ymd(r.createdAt)]));
          setNote({ tone: 'ok', text: tx('people.mo.exported', { n: nf(rows.length), what: tx('pos.export_redemptions') }) });
        } });
      }
    } catch (e) { setNote({ tone: 'bad', text: errText(e, tx('people.mo.exportFailed')) }); } finally { setBusyExport(null); }
  };

  const QUICK: { key: string; label: string; run: () => void; needsManage?: boolean; busy?: boolean }[] = [
    { key: 'add-member', label: tx('pos.add_new_member'), run: () => setDlg({ kind: 'enroll' }), needsManage: true },
    { key: 'create-plan', label: tx('pos.create_plan'), run: () => setDlg({ kind: 'create' }), needsManage: true },
    { key: 'send-reminder', label: tx('pos.send_reminder'), run: () => setDlg({ kind: 'reminder' }), needsManage: true },
    { key: 'manage-discounts', label: tx('pos.manage_discounts'), run: () => setDlg({ kind: 'discounts' }) },
    { key: 'report', label: tx('pos.membership_report'), run: () => setDlg({ kind: 'report' }) },
    { key: 'export-members', label: tx('pos.export_members'), run: () => runExport('members'), busy: busyExport === 'members' },
    { key: 'export-payments', label: tx('pos.export_payments'), run: () => runExport('payments'), busy: busyExport === 'payments' },
    { key: 'export-redemptions', label: tx('pos.export_redemptions'), run: () => runExport('redemptions'), busy: busyExport === 'redemptions' },
    { key: 'plan-performance', label: tx('pos.plan_performance'), run: () => setDlg({ kind: 'performance' }) },
    { key: 'settings', label: tx('pos.membership_settings'), run: () => nav('/settings?section=loyalty-memberships') },
  ];

  const o = ov.data; const k = o?.kpis;
  const delta = (v: number | null | undefined) => (v == null ? '' : `${v >= 0 ? '+' : ''}${v}% ${tx('pos.vs_last_month')}`);
  const series = o?.revenueSeries ?? [];
  const seriesMax = Math.max(1, ...series.map((s) => s.cents));
  const statusTotal = o ? (o.statusTotal ?? o.statusBreakdown.reduce((a, x) => a + x.count, 0)) : 0;
  const distTotal = o ? (o.distributionTotal ?? o.planDistribution.reduce((a, x) => a + x.count, 0)) : 0;
  const openMembers = (f: string) => { setMemFilter(f); setPlanId(''); setPeriods((x) => ({ ...x, members: { preset: 'all' } })); setTab('members'); };
  const openPlan = (p: any) => setDlg({ kind: 'plan', plan: { planId: p.planId, name: p.name, description: p.description ?? null, billingInterval: p.billingInterval ?? 'none', intervalCount: p.intervalCount ?? 1, priceCents: p.priceCents ?? 0,
    isCustomPricing: !!p.isCustomPricing, status: p.status, isPopular: !!p.isPopular, badge: p.badge ?? null, memberCount: p.memberCount ?? p.currentMembers ?? 0, revenueCents: p.revenueCents ?? p.revenueThisMonthCents ?? 0 } });
  const profile = (id: string, name: string) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`);
  const filtered = !!(q || (tab === 'members' && (memFilter !== 'any' || planId || period.preset !== 'all')) || (tab === 'payments' && (payStatusSel !== 'all' || period.preset !== 'month'))
    || ((tab === 'benefits' || tab === 'activity' || tab === 'overview') && period.preset !== 'all') || (tab === 'activity' && actType) || (tab === 'plans' && planStatus));
  const clearAll = () => { setSearch(''); setPeriods(PERIOD0); setMemFilter('any'); setPlanId(''); setPayStatusSel('all'); setActType(''); setPlanStatus(''); setMemberDf('enrolled'); setPayDf('paid'); };
  const serverPeriod = tab === 'members' ? members.data?.period : tab === 'payments' ? payments.data?.period : tab === 'benefits' ? redemptions.data?.period : tab === 'activity' ? activity.data?.period : tab === 'overview' ? panelActivity.data?.period : null;
  const basis = tab === 'members' ? { basis: memberDf, basisOptions: MEMBER_DF.map((f) => ({ value: f, label: tx('mos.df.' + f) })), onBasis: setMemberDf }
    : tab === 'payments' ? { basis: payDf, basisOptions: ['paid', 'created'].map((f) => ({ value: f, label: tx('mos.df.' + f) })), onBasis: setPayDf }
    : tab === 'benefits' ? { basis: 'redeemed', basisOptions: [{ value: 'redeemed', label: tx('mos.df.redeemed') }], onBasis: () => undefined }
    : { basis: 'activity', basisOptions: [{ value: 'activity', label: tx('mos.df.activity') }], onBasis: () => undefined };
  const countOf = (d: any) => (d ? <span className="fk-muted"> · {tx('mos.matching', { n: nf(d.totalItems) })}</span> : null);
  const noRows = (what: string) => (filtered ? <Empty title={q ? tx('mos.noMatchSearch', { q }) : tx('people.fit.noMatch')}><button type="button" className="fk-btn" onClick={clearAll} data-testid="empty-clear">{tx('finance.clearFilters')}</button></Empty> : <Empty title={what} />);

  if (isForbidden(ov.error)) return <div className="work mos" data-testid="memberships-screen"><h1>{tx('pos.membership_overview')}</h1><StateBlock error={ov.error} onRetry={ov.reload} /></div>;
  return (
    <div className="work mos" data-testid="memberships-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.membership_overview')}</h1><div className="sub">{tx('pos.manage_membership_plans_track_member_activity_1q23')}</div></div>
        <div className="fk-head-actions">
          <SystemCheckButton domain="memberships" />
          <button type="button" className="fk-btn" onClick={() => setRev((n) => n + 1)} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'create' })} disabled={!canManage} title={!canManage ? tx('people.fit.noPermission') : undefined} data-testid="create-plan">{tx('pos.create_membership_plan')}</button>
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <FreshnessLine at={freshAt} error={ov.error} testId="memberships-fresh" />
      {pendingExport ? <ExportPreview title={tx('pos.export_' + pendingExport.kind)} count={pendingExport.n} masked={false}
        filters={[tx('people.mo.exportScope.' + pendingExport.kind)]}
        onConfirm={() => { const p = pendingExport; setPendingExport(null); p.go(); }} onCancel={() => setPendingExport(null)} /> : null}
      <div className="fk-kpis five mos-kpis" data-testid="membership-kpis">
        {ov.error ? <StateBlock error={ov.error} onRetry={ov.reload} /> : <>
          <KpiCard testId="kpi-total" label={tx('pos.total_members')} loading={!k} value={k ? nf(k.totalMembers) : ''} sub={k ? `${tx('mos.scope.now')} · ${tx('people.mo.kpi.newThisMonth', { n: nf(k.newMembersThisMonth) })}` : ''} onClick={() => openMembers('all')} />
          <KpiCard testId="kpi-active" label={tx('pos.active_members')} loading={!k} tone="ok" value={k ? nf(k.activeMembers) : ''} sub={k ? `${tx('mos.scope.now')} · ${k.totalMembers > 0 ? tx('people.mo.kpi.activeOf', { pct: String(k.activePctOfTotal), n: nf(k.totalMembers) }) : tx('people.mo.kpi.noMembers')}` : ''} onClick={() => openMembers('active')} />
          <KpiCard testId="kpi-revenue" label={tx('people.mo.kpi.revenue')} loading={!k} tone="gold" value={k ? fmtMoney(k.membershipRevenueCents) : ''} sub={k ? (k.revenueDeltaPct != null ? delta(k.revenueDeltaPct) : tx('people.mo.kpi.payments', { n: nf(k.membershipPaymentsThisMonth ?? 0) })) : ''}
            onClick={() => { setPayStatusSel('succeeded'); setPayDf('paid'); setPeriods((x) => ({ ...x, payments: { preset: 'month' } })); setTab('payments'); }} />
          <KpiCard testId="kpi-expiring" label={tx('pos.expiring_soon')} loading={!k} tone={k && k.expiringSoon > 0 ? 'warn' : undefined} value={k ? nf(k.expiringSoon) : ''} sub={k ? `${tx('mos.scope.now')} · ${tx('people.mo.kpi.nextDays', { n: String(k.expiringWindowDays) })}` : ''} onClick={() => openMembers('expiring')} />
          <KpiCard testId="kpi-canceled" label={tx('pos.canceled_this_month')} loading={!k} tone={k && k.canceledThisMonth > 0 ? 'bad' : undefined} value={k ? nf(k.canceledThisMonth) : ''} sub={k ? (k.canceledDeltaPct != null ? `${tx('mos.scope.month')} · ${delta(k.canceledDeltaPct)}` : tx('people.mo.kpi.thisMonthTz')) : ''} onClick={() => openMembers('canceled_this_month')} />
        </>}
      </div>

      <div className="mos-tools" data-testid="toolbar">
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" inputMode="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('mos.searchPh')} aria-label={tx('mos.searchPh')} data-testid="search"
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        {tab !== 'plans' ? <PeriodBar value={period} onChange={setPeriod} server={serverPeriod} allowAll compact {...basis} /> : <span className="fk-hint">{tx('mos.plansNoPeriod')}</span>}
        {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div>

      <div className="inv2-tabs mos-tabs">
        <div className="fk-seg inv2-tabseg" role="tablist" aria-label={tx('mos.tabs')}>
          {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'tab-' + t}>{tx('mos.tab.' + t)}</button>)}
        </div>
      </div>

      {tab === 'overview' ? <>
        <div className="mos-row three">
          <FitPanel testId="panel-plans" title={<>{tx('pos.membership_plans')}{countOf(planList.data)}</>} actions={<button type="button" className="fk-link" onClick={() => setTab('plans')} data-testid="view-all-plans">{tx('pos.view_all_plans')}</button>}
            footer={<Pager compact info={pageOf(planList.data)} onPage={setPg('p-plans')} />}>
            {planList.error ? <StateBlock error={planList.error} onRetry={planList.reload} /> : !planList.data ? <div className="fk-loading">{tx('pos.loading')}</div> : planList.data.items.length === 0 ? (
              <Empty title={tx('people.mo.noPlans')}>{canManage ? <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'create' })}>{tx('pos.create_membership_plan')}</button> : null}</Empty>
            ) : <ul className="fk-list">{planList.data.items.map((p: any) => (
              <li key={p.planId} className="fk-li clickable" onClick={() => openPlan(p)} data-testid="plan-li">
                <span className={'mo-glyph' + (p.isPopular ? ' pop' : '')} aria-hidden>▭</span>
                <div className="fk-li-main"><span className="fk-li-t">{p.name}{p.isPopular ? ' ★' : ''}</span><span className="fk-li-s">{planPrice(p)} · {tx('mos.activeOfCurrent', { a: nf(p.activeMembers), n: nf(p.currentMembers) })} · {tx('mos.benefitsN', { n: nf(p.benefits) })}</span></div>
                <span className={'fk-chip ' + (p.status === 'active' ? 'ok' : p.status === 'draft' ? 'mut' : 'warn')}>{planState(p.status)}</span>
                <span className="fk-li-acts"><button type="button" className="fk-ibtn" aria-label={tx('pos.manage')} title={tx('pos.manage')} onClick={(e) => { e.stopPropagation(); openPlan(p); }}>›</button></span>
              </li>))}</ul>}
          </FitPanel>

          <FitPanel testId="panel-members" title={<>{panelFilter === 'active' ? tx('pos.active_members') : filterLabel(panelFilter)}{countOf(panelMembers.data)}</>}
            actions={<>
              <select className="fk-select mo-filter" aria-label={tx('people.mo.memberFilter')} value={panelFilter} onChange={(e) => setPanelFilter(e.target.value)} data-testid="panel-filter">
                {PANEL_FILTERS.map((f) => <option key={f} value={f}>{filterLabel(f)}</option>)}
              </select>
              <button type="button" className="fk-link" onClick={() => openMembers(panelFilter)} data-testid="view-all-members">{tx('pos.view_all_members')}</button>
            </>}
            footer={<Pager compact info={pageOf(panelMembers.data)} onPage={setPg('p-members')} />}>
            {panelMembers.error ? <StateBlock error={panelMembers.error} onRetry={panelMembers.reload} /> : !panelMembers.data ? <div className="fk-loading">{tx('pos.loading')}</div> : panelMembers.data.items.length === 0 ? (
              <Empty title={panelFilter === 'active' ? tx('pos.no_members_yet') : tx('people.fit.noMatch')}>{canManage && panelFilter === 'active' ? <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'enroll' })}>{tx('pos.add_new_member')}</button> : null}</Empty>
            ) : <ul className="fk-list">{panelMembers.data.items.map((m: Member) => <MemberLi key={m.membershipId} m={m} onOpen={() => setDlg({ kind: 'detail', id: m.membershipId })} onManage={() => setDlg({ kind: 'manage', m: toManage(m) })} canManage={canManage} />)}</ul>}
          </FitPanel>

          <FitPanel testId="panel-activity" title={<>{tx('pos.membership_activity')}{countOf(panelActivity.data)}</>} actions={<button type="button" className="fk-link" onClick={() => { setPeriods((x) => ({ ...x, activity: x.overview })); setTab('activity'); }} data-testid="view-all-activity">{tx('pos.view_all_activity')}</button>}
            footer={<Pager compact info={pageOf(panelActivity.data)} onPage={setPg('p-activity')} />}>
            {panelActivity.error ? <StateBlock error={panelActivity.error} onRetry={panelActivity.reload} /> : !panelActivity.data ? <div className="fk-loading">{tx('pos.loading')}</div> : panelActivity.data.items.length === 0 ? <Empty title={periods.overview.preset !== 'all' ? tx('mos.noActivityPeriod') : tx('pos.no_activity_yet')} />
              : <ul className="fk-list">{panelActivity.data.items.map((a: Activity) => <ActivityLi key={a.id} a={a} onOpen={a.membershipId ? () => setDlg({ kind: 'detail', id: a.membershipId! }) : undefined} />)}</ul>}
          </FitPanel>
        </div>
        <div className="fk-hint mos-scope" data-testid="overview-scope">{tx('mos.overviewScope')}</div>

        <div className="mos-row four mo-ana">
          <FitPanel testId="ana-revenue" title={tx('pos.membership_revenue')} actions={<button type="button" className="fk-link" onClick={() => { setPayStatusSel('succeeded'); setPeriods((x) => ({ ...x, payments: { preset: 'month' } })); setTab('payments'); }}>{tx('people.mo.details')}</button>}>
            {ov.error ? <StateBlock error={ov.error} onRetry={ov.reload} /> : !o ? <div className="fk-loading">{tx('pos.loading')}</div> : <div className="mo-rev">
              <div className="mo-rev-top"><b>{fmtMoney(o.kpis.membershipRevenueCents)}</b><span className="fk-hint">{tx('people.mo.revenueSub', { n: nf(o.kpis.membershipPaymentsThisMonth ?? 0) })}</span></div>
              {series.some((s) => s.cents > 0) ? <div className="mo-spark" role="img" aria-label={tx('people.mo.revenueTrend', { d: String(o.rangeDays) })}>{series.map((s) => <span key={s.label} title={`${s.label}: ${fmtMoney(s.cents)}`} style={{ height: `${Math.max(3, Math.round((s.cents / seriesMax) * 100))}%` }} className={s.cents ? '' : 'z'} />)}</div>
                : <div className="fk-hint">{tx('pos.no_membership_revenue_yet')}</div>}
            </div>}
          </FitPanel>
          <FitPanel testId="ana-status" title={tx('pos.membership_status')}>
            {ov.error ? <StateBlock error={ov.error} onRetry={ov.reload} /> : !o ? <div className="fk-loading">{tx('pos.loading')}</div> : statusTotal === 0 ? <div className="fk-hint">{tx('pos.no_data_yet')}</div> : <>
              <div className="mo-stack" role="img" aria-label={tx('people.mo.statusOf', { n: nf(statusTotal) })}>{o.statusBreakdown.map((s, i) => <span key={s.status} title={`${memberStatus(s.status)}: ${nf(s.count)} (${s.pct}%)`} style={{ width: `${(s.count / statusTotal) * 100}%`, background: BAR[i % BAR.length] }} />)}</div>
              <ul className="mo-legend">{o.statusBreakdown.map((s, i) => <li key={s.status}><i style={{ background: BAR[i % BAR.length] }} />{memberStatus(s.status)}<b>{nf(s.count)}</b><span>{s.pct}%</span></li>)}</ul>
              <div className="fk-hint">{tx('people.mo.statusDenominator', { n: nf(statusTotal) })}</div>
            </>}
          </FitPanel>
          <FitPanel testId="ana-plans" title={tx('pos.plan_distribution')}>
            {ov.error ? <StateBlock error={ov.error} onRetry={ov.reload} /> : !o ? <div className="fk-loading">{tx('pos.loading')}</div> : distTotal === 0 ? <div className="fk-hint">{tx('pos.no_data_yet')}</div> : <>
              <ul className="mo-bars">{o.planDistribution.map((d, i) => <li key={d.planName + i} title={`${d.planName}: ${nf(d.count)} (${d.pct}%)`}><span className="mo-bar-l">{d.planName}</span><span className="mo-bar"><span style={{ width: `${(d.count / distTotal) * 100}%`, background: BAR[i % BAR.length] }} /></span><b>{nf(d.count)}</b><span className="mo-pct">{d.pct}%</span></li>)}</ul>
              <div className="fk-hint">{tx('people.mo.distDenominator', { n: nf(distTotal) })}</div>
            </>}
          </FitPanel>
          <FitPanel testId="ana-services" title={tx('pos.top_membership_services')} actions={<button type="button" className="fk-link" onClick={() => setTab('benefits')} title={tx('people.mo.viewRedemptions')} aria-label={tx('people.mo.viewRedemptions')}>{tx('people.mo.details')}</button>}>
            {ov.error ? <StateBlock error={ov.error} onRetry={ov.reload} /> : !o ? <div className="fk-loading">{tx('pos.loading')}</div> : o.topServices.length === 0 ? <div className="fk-hint">{tx('people.mo.noRedemptions')}</div> : (
              <ol className="mo-top">{o.topServices.slice(0, 4).map((t, i) => <li key={t.name}><span className="mo-rank">{i + 1}</span><span className="mo-top-n">{t.name}</span><b>{nf(t.redemptions)}</b><span className="fk-muted">{fmtMoney(t.valueCents)}</span></li>)}</ol>
            )}
          </FitPanel>
        </div>
      </> : null}

      {tab === 'members' ? (
        <FitPanel testId="members-list" title={<>{tx('mos.tab.members')}{countOf(members.data)}</>} actions={<>
          <select className="fk-select" aria-label={tx('people.mo.memberFilter')} value={memFilter} onChange={(e) => setMemFilter(e.target.value)} data-testid="member-filter">{MEMBER_FILTERS.map((f) => <option key={f} value={f}>{filterLabel(f)}</option>)}</select>
          <select className="fk-select" aria-label={tx('people.membership.csv.plan')} value={planId} onChange={(e) => setPlanId(e.target.value)} data-testid="member-plan"><option value="">{tx('mos.allPlans')}</option>{(o?.plans ?? []).map((p) => <option key={p.planId} value={p.planId}>{p.name}</option>)}</select>
        </>} footer={<Pager info={pageOf(members.data)} onPage={setPg('members')} label={tx('mos.tab.members')} />}>
          {members.error ? <StateBlock error={members.error} onRetry={members.reload} /> : !members.data ? <div className="fk-loading">{tx('pos.loading')}</div> : members.data.items.length === 0 ? noRows(tx('pos.no_members_yet')) : (
            <table className="fk-table fn-table mos-table" data-testid="members-table"><thead><tr><th>{tx('mos.col.member')}</th><th>{tx('people.membership.csv.plan')}</th><th>{tx('pos.status')}</th><th className="t-opt">{tx('people.mo.joined')}</th><th>{tx('people.mo.nextDate')}</th><th className="t-opt">{tx('mos.col.lastPayment')}</th><th className="num t-opt2">{tx('people.mo.redemptions')}</th><th className="num">{tx('people.membership.csv.lifetimePaid')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
              <tbody>{members.data.items.map((m: Member) => <tr key={m.membershipId} data-testid="member-row" className="inv2-click" onClick={() => setDlg({ kind: 'detail', id: m.membershipId })}>
                <td><button type="button" className="fk-li-t link" onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'detail', id: m.membershipId }); }} data-testid="member-name">{m.customerName || '—'}</button><span className="fk-li-s">{[m.maskedPhone, m.memberNumber ? '#' + m.memberNumber : null].filter(Boolean).join(' · ') || '—'}</span></td>
                <td>{m.planName || '—'}</td><td><span className={'fk-chip ' + (STATUS_TONE[m.status] ?? 'mut')}>{memberStatus(m.status)}</span></td><td className="t-opt">{when(m.startedAt)}</td>
                <td>{nextText(m)}</td><td className="t-opt">{m.lastPaymentStatus ? <span className={'fk-chip ' + (PAY_TONE[m.lastPaymentStatus] ?? 'mut')}>{payStatus(m.lastPaymentStatus)}</span> : <span className="fk-muted">{tx('mos.noPayments')}</span>}</td>
                <td className="num t-opt2">{nf(m.redemptions)}</td><td className="num">{fmtMoney(m.lifetimePaidCents)}</td>
                <td className="fn-acts" onClick={(e) => e.stopPropagation()}><button type="button" className="fk-btn ghost sm" onClick={() => setDlg({ kind: 'detail', id: m.membershipId })} data-testid="member-details">{tx('mos.details')}</button>
                  <button type="button" className="fk-btn ghost sm" disabled={!canManage} title={!canManage ? tx('people.fit.noPermission') : undefined} onClick={() => setDlg({ kind: 'manage', m: toManage(m) })} data-testid="member-manage">{tx('pos.manage')}</button></td></tr>)}</tbody></table>
          )}
        </FitPanel>
      ) : null}

      {tab === 'plans' ? (
        <FitPanel testId="plans-list" title={<>{tx('pos.membership_plans')}{countOf(planList.data)}</>} actions={<>
          <select className="fk-select" aria-label={tx('pos.status')} value={planStatus} onChange={(e) => setPlanStatus(e.target.value)} data-testid="plan-status"><option value="">{tx('mos.plan.current')}</option>{['active', 'draft', 'paused', 'archived'].map((s) => <option key={s} value={s}>{planState(s)}</option>)}</select>
          {canManage ? <button type="button" className="fk-btn ghost sm" onClick={() => setDlg({ kind: 'create' })}>{tx('pos.create_plan')}</button> : null}
        </>} footer={<Pager info={pageOf(planList.data)} onPage={setPg('plans')} label={tx('pos.membership_plans')} />}>
          {planList.error ? <StateBlock error={planList.error} onRetry={planList.reload} /> : !planList.data ? <div className="fk-loading">{tx('pos.loading')}</div> : planList.data.items.length === 0 ? noRows(tx('people.mo.noPlans')) : (
            <table className="fk-table fn-table mos-table" data-testid="plans-table"><thead><tr><th>{tx('people.membership.csv.plan')}</th><th>{tx('people.mo.price')}</th><th>{tx('pos.status')}</th><th className="num">{tx('mos.col.active')}</th><th className="num t-opt">{tx('mos.col.current')}</th><th className="num t-opt">{tx('people.mo.benefits')}</th><th className="num">{tx('mos.col.revenueMonth')}</th><th className="t-opt2">{tx('mos.col.created')}</th><th /></tr></thead>
              <tbody>{planList.data.items.map((p: any) => <tr key={p.planId} className="inv2-click" onClick={() => openPlan(p)} data-testid="plan-row">
                <td><b>{p.name}</b>{p.code ? <span className="fk-li-s">{p.code}{p.versionNumber ? ` · v${p.versionNumber}` : ''}</span> : p.versionNumber ? <span className="fk-li-s">v{p.versionNumber}</span> : null}</td>
                <td>{planPrice(p)}{p.trialDays ? <span className="fk-li-s">{tx('mos.trialDays', { n: nf(p.trialDays) })}</span> : null}</td>
                <td><span className={'fk-chip ' + (p.status === 'active' ? 'ok' : p.status === 'draft' ? 'mut' : 'warn')}>{planState(p.status)}</span></td>
                <td className="num">{nf(p.activeMembers)}</td><td className="num t-opt">{nf(p.currentMembers)}</td><td className="num t-opt">{nf(p.benefits)}</td><td className="num">{fmtMoney(p.revenueThisMonthCents)}</td><td className="t-opt2">{when(p.createdAt)}</td>
                <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={(e) => { e.stopPropagation(); openPlan(p); }}>{tx('pos.manage')}</button></td></tr>)}</tbody></table>
          )}
        </FitPanel>
      ) : null}

      {tab === 'payments' ? <>
        {payments.data ? <div className="mos-totals" data-testid="pay-totals">
          <div><span>{tx('mos.tot.collected')}</span><b>{fmtMoney(payments.data.totals.collectedCents)}</b></div>
          <div><span>{tx('mos.tot.refunded')}</span><b>{fmtMoney(payments.data.totals.refundedCents)}</b></div>
          <div><span>{tx('mos.tot.net')}</span><b>{fmtMoney(payments.data.totals.netCents)}</b></div>
          <div className={payments.data.totals.failed ? 'bad' : ''}><span>{tx('mos.tot.failed')}</span><b>{nf(payments.data.totals.failed)}</b></div>
          <span className="fk-hint">{tx('mos.tot.rule')}</span>
        </div> : null}
        <FitPanel testId="payments-list" title={<>{tx('mos.tab.payments')}{countOf(payments.data)}</>} actions={
          <select className="fk-select" aria-label={tx('pos.status')} value={payStatusSel} onChange={(e) => setPayStatusSel(e.target.value)} data-testid="pay-status">{PAY_STATUSES.map((s) => <option key={s} value={s}>{payStatus(s)}</option>)}</select>
        } footer={<Pager info={pageOf(payments.data)} onPage={setPg('payments')} label={tx('mos.tab.payments')} />}>
          {payments.error ? <StateBlock error={payments.error} onRetry={payments.reload} /> : !payments.data ? <div className="fk-loading">{tx('pos.loading')}</div> : payments.data.items.length === 0 ? noRows(tx('people.mo.noPayments')) : <PaymentsTable rows={payments.data.items} onOpen={(id) => setDlg({ kind: 'detail', id })} />}
        </FitPanel>
      </> : null}

      {tab === 'benefits' ? <>
        <FitPanel testId="redemptions-list" title={<>{tx('mos.redemptions')}{countOf(redemptions.data)}</>} footer={<Pager info={pageOf(redemptions.data)} onPage={setPg('benefits')} label={tx('mos.redemptions')} />}>
          {redemptions.error ? <StateBlock error={redemptions.error} onRetry={redemptions.reload} /> : !redemptions.data ? <div className="fk-loading">{tx('pos.loading')}</div> : redemptions.data.items.length === 0 ? noRows(tx('people.mo.noRedemptions')) : <RedemptionsTable rows={redemptions.data.items} onOpen={(id) => setDlg({ kind: 'detail', id })} />}
        </FitPanel>
        <FitPanel testId="benefit-defs" title={tx('mos.planBenefits')}>
          {benefitDefs.error ? <StateBlock error={benefitDefs.error} onRetry={benefitDefs.reload} /> : !benefitDefs.data ? <div className="fk-loading">{tx('pos.loading')}</div> : (benefitDefs.data.items ?? []).length === 0 ? <Empty title={tx('people.mo.noBenefitsAny')} /> : <BenefitTable rows={benefitDefs.data.items} withPlan />}
          <div className="fk-hint">{tx('mos.benefitsRule')}</div>
        </FitPanel>
      </> : null}

      {tab === 'activity' ? (
        <FitPanel testId="activity-list" title={<>{tx('pos.membership_activity')}{countOf(activity.data)}</>} actions={
          <select className="fk-select" aria-label={tx('people.mo.activityType')} value={actType} onChange={(e) => setActType(e.target.value)} data-testid="act-type"><option value="">{tx('people.mo.allActivity')}</option>{(activity.data?.types ?? []).map((t: any) => <option key={t.type} value={t.type}>{activityLabel(t.type)} ({nf(t.count)})</option>)}</select>
        } footer={<Pager info={pageOf(activity.data)} onPage={setPg('activity')} label={tx('pos.membership_activity')} />}>
          {activity.error ? <StateBlock error={activity.error} onRetry={activity.reload} /> : !activity.data ? <div className="fk-loading">{tx('pos.loading')}</div> : activity.data.items.length === 0 ? noRows(tx('pos.no_activity_yet')) : <ActivityTable rows={activity.data.items} onOpen={(id) => setDlg({ kind: 'detail', id })} />}
        </FitPanel>
      ) : null}

      <nav className="mo-quick" aria-label={tx('pos.quick_actions_2')} data-testid="membership-quick">
        {QUICK.map((x) => <button type="button" key={x.key} className="fk-btn ghost mo-qa" data-testid={'qa-' + x.key} onClick={x.run} disabled={(x.needsManage && !canManage) || x.busy} title={x.needsManage && !canManage ? tx('people.fit.noPermission') : x.label} aria-label={x.label}>{x.busy ? tx('pos.loading') : x.label}</button>)}
      </nav>

      {dlg?.kind === 'create' ? <MembershipPlanBuilder onClose={() => setDlg(null)} onCreated={() => { setDlg(null); changed(tx('pos.plan_published')); }} /> : null}
      {dlg?.kind === 'enroll' ? <MembershipEnrollModal onClose={() => setDlg(null)} onEnrolled={(msg) => { setDlg(null); setPanelFilter('active'); changed(msg); }} /> : null}
      {dlg?.kind === 'manage' ? <MembershipManageModal member={dlg.m} onClose={() => setDlg(null)} onDone={(msg) => { setDlg(null); changed(msg); }} /> : null}
      {dlg?.kind === 'detail' ? <MemberDetailsDialog id={dlg.id} rev={rev} canManage={canManage} onClose={() => setDlg(null)} onOpen={(id) => setDlg({ kind: 'detail', id })}
        onManage={(m) => setDlg({ kind: 'manage', m })} onProfile={profile} onReminder={() => setDlg({ kind: 'reminder' })} /> : null}
      {dlg?.kind === 'plan' ? <PlanDialog plan={dlg.plan} onClose={() => setDlg(null)} onMembers={() => { setMemFilter('any'); setPlanId(dlg.plan.planId); setDlg(null); setTab('members'); }} canManage={canManage} onCreate={() => setDlg({ kind: 'create' })} /> : null}
      {dlg?.kind === 'reminder' ? <ReminderDialog onClose={() => setDlg(null)} onSent={(msg) => { setDlg(null); changed(msg); }} /> : null}
      {dlg?.kind === 'discounts' ? <DiscountsDialog canManage={canManage} onClose={() => setDlg(null)} onCreate={() => setDlg({ kind: 'create' })} onPromotions={() => nav('/tenant/services/discounts')} /> : null}
      {dlg?.kind === 'report' ? <ReportDialog ov={o} onClose={() => setDlg(null)} onPerformance={() => setDlg({ kind: 'performance' })} /> : null}
      {dlg?.kind === 'performance' ? <PerformanceDialog onClose={() => setDlg(null)} /> : null}
    </div>
  );
}

function MemberLi({ m, onManage, canManage, onOpen }: { m: Member; onManage: () => void; canManage: boolean; onOpen: () => void }) {
  return (
    <li className="fk-li clickable" onClick={onOpen} data-testid="member-li">
      <ProfileAvatarWithPreview name={m.customerName || '—'} url={m.avatarUrl ?? undefined} size={30} type="customer" />
      <div className="fk-li-main">
        <span className="fk-li-t">{m.customerName || '—'}{m.maskedPhone ? <span className="fk-muted"> · {m.maskedPhone}</span> : null}</span>
        <span className="fk-li-s">{m.planName || '—'}{m.nextDate ? ` · ${nextText(m)}` : ''}</span>
      </div>
      <span className={'fk-chip ' + (STATUS_TONE[m.status] ?? 'mut')}>{memberStatus(m.status)}</span>
      <span className="fk-li-acts"><button type="button" className="fk-ibtn" aria-label={tx('pos.manage')} title={canManage ? tx('pos.manage') : tx('people.fit.noPermission')} disabled={!canManage} onClick={(e) => { e.stopPropagation(); onManage(); }} data-testid="member-li-manage">⚙</button></span>
    </li>
  );
}
function ActivityLi({ a, onOpen }: { a: Activity; onOpen?: () => void }) {
  return (
    <li className={'fk-li' + (onOpen ? ' clickable' : '')} onClick={onOpen}>
      <span className={'mo-dot ' + (ACT_TONE[a.activityType] ?? 'mut')} aria-hidden />
      <div className="fk-li-main"><span className="fk-li-t">{a.customerName || tx('pos.a_member')} <span className="mo-act">{activityLabel(a.activityType)}</span>{a.planName ? ` ${a.planName}` : ''}</span><span className="fk-li-s">{whenTime(a.occurredAt)}{a.status ? ` · ${codeLabel('mos.evt.' + a.status, a.status)}` : ''}</span></div>
      {a.amountCents != null ? <span className={'fk-li-num' + (ACT_TONE[a.activityType] === 'bad' ? ' mo-neg' : '')}>{fmtMoney(a.amountCents)}</span> : null}
    </li>
  );
}
function PaymentsTable({ rows, onOpen }: { rows: any[]; onOpen?: (membershipId: string) => void }) {
  return (
    <table className="fk-table fn-table mos-table" data-testid="payments-table"><thead><tr><th>{tx('people.loyalty.when')}</th><th>{tx('pos.customer')}</th><th className="t-opt">{tx('people.membership.csv.plan')}</th><th>{tx('people.membership.csv.kind')}</th><th>{tx('pos.status')}</th><th className="num">{tx('people.membership.csv.amount')}</th><th className="num t-opt2">{tx('people.membership.csv.tax')}</th><th className="t-opt">{tx('mos.col.reference')}</th></tr></thead>
      <tbody>{rows.map((p) => <tr key={p.id} data-testid="payment-row" className={onOpen && p.membershipId ? 'inv2-click' : ''} onClick={onOpen && p.membershipId ? () => onOpen(p.membershipId) : undefined}>
        <td>{whenTime(p.settledAt ?? p.createdAt)}{p.settledAt ? null : <span className="fk-li-s">{tx('mos.notSettled')}</span>}</td><td>{p.customerName || '—'}</td><td className="t-opt">{p.planName || '—'}</td><td>{codeLabel(`people.mo.paymentKind.${p.kind}`, p.kind)}</td>
        <td><span className={'fk-chip ' + (PAY_TONE[p.status] ?? 'mut')}>{payStatus(p.status)}</span>{p.failure ? <span className="fk-li-s">{p.failure}</span> : null}</td>
        <td className="num">{fmtMoney(p.amountCents)}</td><td className="num t-opt2">{fmtMoney(p.taxCents)}</td><td className="t-opt">{p.processor || '—'}{p.reference ? <span className="fk-li-s">{p.reference}</span> : null}</td></tr>)}</tbody></table>
  );
}
function RedemptionsTable({ rows, onOpen }: { rows: any[]; onOpen?: (membershipId: string) => void }) {
  return (
    <table className="fk-table fn-table mos-table" data-testid="redemptions-table"><thead><tr><th>{tx('people.loyalty.when')}</th><th>{tx('pos.customer')}</th><th>{tx('people.mo.benefit')}</th><th className="t-opt">{tx('people.membership.csv.service')}</th><th className="t-opt">{tx('people.membership.csv.technician')}</th><th>{tx('mos.col.ticket')}</th><th className="num">{tx('people.membership.csv.standardValue')}</th><th className="num t-opt2">{tx('people.membership.csv.allocatedValue')}</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} data-testid="redemption-row" className={onOpen ? 'inv2-click' : ''} onClick={onOpen ? () => onOpen(r.membershipId) : undefined}>
        <td>{whenTime(r.at)}</td><td>{r.customerName || '—'}{r.planName ? <span className="fk-li-s">{r.planName}</span> : null}</td><td>{r.benefit || '—'}</td><td className="t-opt">{r.service || tx('people.mo.anyService')}</td><td className="t-opt">{r.technician || '—'}</td>
        <td>{r.ticketNumber ? '#' + r.ticketNumber : '—'}</td><td className="num">{fmtMoney(r.standardValueCents)}</td><td className="num t-opt2">{fmtMoney(r.allocatedValueCents)}</td></tr>)}</tbody></table>
  );
}
function ActivityTable({ rows, onOpen }: { rows: Activity[]; onOpen?: (membershipId: string) => void }) {
  return (
    <table className="fk-table fn-table mos-table" data-testid="activity-table"><thead><tr><th>{tx('people.loyalty.when')}</th><th>{tx('pos.customer')}</th><th>{tx('people.mo.event')}</th><th className="t-opt">{tx('people.membership.csv.plan')}</th><th className="num">{tx('people.membership.csv.amount')}</th><th className="t-opt2">{tx('mos.col.ref')}</th></tr></thead>
      <tbody>{rows.map((a) => <tr key={a.id} data-testid="activity-row" className={onOpen && a.membershipId ? 'inv2-click' : ''} onClick={onOpen && a.membershipId ? () => onOpen(a.membershipId!) : undefined}>
        <td>{whenTime(a.occurredAt)}</td><td>{a.customerName || '—'}</td><td><span className={'fk-chip ' + (ACT_TONE[a.activityType] ?? 'mut')}>{activityLabel(a.activityType)}</span>{a.status ? <span className="fk-li-s">{codeLabel('mos.evt.' + a.status, a.status)}</span> : null}</td>
        <td className="t-opt">{a.planName || '—'}</td><td className="num">{a.amountCents == null ? '—' : fmtMoney(a.amountCents)}</td><td className="t-opt2 fk-muted">{a.id.slice(0, 8)}</td></tr>)}</tbody></table>
  );
}

// ── Member Details ─────────────────────────────────────────────────────────────────────────────────────────────────────
type DTab = 'overview' | 'billing' | 'benefits' | 'activity';
function MemberDetailsDialog({ id, rev, canManage, onClose, onOpen, onManage, onProfile, onReminder }: { id: string; rev: number; canManage: boolean; onClose: () => void; onOpen: (id: string) => void;
  onManage: (m: ManageMember) => void; onProfile: (customerId: string, name: string) => void; onReminder: () => void }) {
  const [t, setT] = useState<DTab>('overview');
  const [pp, setPp] = useState(1); const [rp, setRp] = useState(1); const [ap, setAp] = useState(1);
  const [fp, setFp] = useState(false);
  useEffect(() => { setT('overview'); setPp(1); setRp(1); setAp(1); }, [id]);
  const d = useLoad(() => posMembershipsApi.memberDetail(id), [id, rev]);
  const pays = useLoad(() => (t === 'billing' ? posMembershipsApi.payments({ membershipId: id, status: 'all', preset: 'all', page: pp, pageSize: 8 }) : Promise.resolve(null)), [id, t, pp, rev]);
  const reds = useLoad(() => (t === 'benefits' ? posMembershipsApi.redemptions({ membershipId: id, preset: 'all', page: rp, pageSize: 8 }) : Promise.resolve(null)), [id, t, rp, rev]);
  const acts = useLoad(() => (t === 'activity' ? posMembershipsApi.activity({ membershipId: id, preset: 'all', page: ap, pageSize: 8 }) : Promise.resolve(null)), [id, t, ap, rev]);
  const x = d.data; const m = x?.member; const l = x?.lifecycle; const b = x?.billing;
  const closed = m ? ['canceled', 'cancelled', 'expired'].includes(m.status) : false;
  const price = m ? (m.isCustomPricing ? tx('pos.custom_pricing') : `${fmtMoney(m.priceCents)} / ${interval(m.billingInterval || 'none')}`) : '';
  const dd = (v: string | null | undefined) => (v ? when(v) : <span className="fk-muted">—</span>);
  const tabs = useMemo(() => (['overview', 'billing', 'benefits', 'activity'] as DTab[]), []);
  return (
    <FitDialog wide title={m ? m.customerName || '—' : tx('mos.memberDetails')} subtitle={m ? <>{m.planName || '—'}{m.versionNumber ? ` · v${m.versionNumber}` : ''} · <span className={'fk-chip ' + (STATUS_TONE[m.status] ?? 'mut')}>{memberStatus(m.status)}</span></> : undefined} onClose={onClose} testId="dlg-member"
      footer={<>
        {m ? <button type="button" className="fk-btn ghost" onClick={() => onProfile(m.customerId, m.customerName)} data-testid="md-profile">{tx('mos.customerProfile')}</button> : null}
        {m && !closed && canManage ? <button type="button" className="fk-btn ghost" onClick={onReminder} data-testid="md-reminder">{tx('pos.send_reminder')}</button> : null}
        {m && !closed ? <button type="button" className="fk-btn primary" disabled={!canManage} title={!canManage ? tx('people.fit.noPermission') : undefined}
          onClick={() => onManage({ membershipId: m.membershipId, customerName: m.customerName, planName: m.planName, status: m.status, nextBillingAt: l?.nextBillingAt ?? null })} data-testid="md-manage">{tx('mos.manageMembership')}</button> : null}
        <button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button>
      </>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x || !m || !l || !b ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        {/* D6 §16: a pending membership is waiting for its first payment — collect it here */}
        {m.status === 'pending' && canManage ? (fp ? <MembershipFirstPaymentPanel membershipId={m.membershipId} customerName={m.customerName || '—'} onPaid={() => { setFp(false); d.reload(); }} onLater={() => setFp(false)} />
          : <div className="fk-note" data-testid="md-first-payment"><span>{tx('admin.membership.fp.stillPending', { name: m.customerName || '—' })}</span> <button type="button" className="fk-btn primary sm" onClick={() => setFp(true)}>{tx('admin.membership.fp.title')}</button></div>) : null}
        <div className="fk-seg mos-dtabs" role="tablist" aria-label={tx('mos.memberDetails')}>
          {tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={t === k} className={t === k ? 'on' : ''} onClick={() => setT(k)} data-testid={'md-tab-' + k}>{tx('mos.dtab.' + k)}</button>)}
        </div>
        {t === 'overview' ? <div className="mos-dgrid">
          <section><h3 className="fk-h3">{tx('mos.identity')}</h3><dl className="fk-dl mo-dl" data-testid="md-identity">
            <dt>{tx('mos.col.member')}</dt><dd>{m.customerName || '—'}</dd>
            <dt>{tx('pos.phone')}</dt><dd>{m.maskedPhone ?? <span className="fk-muted">{tx('mos.noPhone')}</span>}</dd>
            <dt>{tx('mos.customerId')}</dt><dd className="mos-mono">{m.customerId}</dd>
            <dt>{tx('mos.membershipId')}</dt><dd className="mos-mono">{m.membershipId}</dd>
            <dt>{tx('people.membership.csv.memberNumber')}</dt><dd>{m.memberNumber ?? '—'}</dd>
            <dt>{tx('people.membership.csv.plan')}</dt><dd>{m.planName || '—'}{m.versionNumber ? <span className="fk-muted"> · v{m.versionNumber}</span> : null}</dd>
            <dt>{tx('people.mo.price')}</dt><dd>{price}{m.comped ? <span className="fk-muted"> · {tx('mos.comped')}</span> : null}</dd>
            <dt>{tx('mos.branch')}</dt><dd>{m.branch ?? '—'}</dd>
          </dl></section>
          <section><h3 className="fk-h3">{tx('mos.lifecycle')}</h3><dl className="fk-dl mo-dl" data-testid="md-lifecycle">
            <dt>{tx('mos.enrolled')}</dt><dd>{dd(l.startedAt)}</dd>
            <dt>{tx('mos.period')}</dt><dd>{l.periodStart || l.periodEnd ? `${when(l.periodStart)} – ${when(l.periodEnd)}` : '—'}</dd>
            <dt>{tx('people.membership.csv.nextBilling')}</dt><dd>{closed ? <span className="fk-muted">—</span> : dd(l.nextBillingAt)}</dd>
            <dt>{tx('mos.endsOn')}</dt><dd>{dd(l.endsAt)}</dd>
            <dt>{tx('people.membership.csv.autoRenew')}</dt><dd>{m.autoRenew ? tx('pos.yes') : tx('pos.no')}</dd>
            <dt>{tx('mos.pause')}</dt><dd>{l.pausedAt ? tx('mos.pausedSince', { d: when(l.pausedAt), r: l.pauseResumesAt ? when(l.pauseResumesAt) : '—' }) : '—'}{l.pauseLimitPerYear != null ? <span className="fk-muted"> · {tx('mos.pausesUsed', { n: nf(l.pausesUsed), max: nf(l.pauseLimitPerYear) })}</span> : null}</dd>
            <dt>{tx('mos.cancellation')}</dt><dd>{l.canceledAt ? tx('mos.canceledEffective', { d: when(l.canceledAt) }) : l.cancelAtPeriodEnd ? tx('mos.cancelRequested', { d: when(l.periodEnd) }) : '—'}{l.cancelReason ? <span className="fk-li-s">{l.cancelReason}</span> : null}</dd>
            <dt>{tx('mos.cycles')}</dt><dd>{nf(l.cyclesBilled)}</dd>
          </dl></section>
          <section><h3 className="fk-h3">{tx('mos.billingSummary')}</h3><dl className="fk-dl mo-dl" data-testid="md-billing">
            <dt>{tx('mos.tot.collected')}</dt><dd>{fmtMoney(b.paidCents)}</dd>
            <dt>{tx('mos.tot.refunded')}</dt><dd>{fmtMoney(b.refundedCents)}</dd>
            <dt>{tx('mos.tot.net')}</dt><dd><b>{fmtMoney(b.netCents)}</b></dd>
            <dt>{tx('mos.lastPaid')}</dt><dd>{dd(b.lastPaidAt)}</dd>
            <dt>{tx('mos.openCharges')}</dt><dd>{b.failedPayments || b.pendingPayments ? tx('mos.openChargesV', { f: nf(b.failedPayments), p: nf(b.pendingPayments) }) : '—'}</dd>
          </dl>{b.paidCents === 0 && !closed ? <div className="fk-hint">{tx('mos.zeroPaid')}</div> : null}</section>
          {x.otherMemberships.length ? <section><h3 className="fk-h3">{tx('mos.otherMemberships')}</h3><ul className="fk-list dense" data-testid="md-others">{x.otherMemberships.map((om: any) => (
            <li key={om.membershipId} className="fk-li clickable" onClick={() => onOpen(om.membershipId)}><div className="fk-li-main"><span className="fk-li-t">{om.planName || '—'}</span><span className="fk-li-s">{tx('mos.enrolled')} {when(om.startedAt)} · <span className="mos-mono">{om.membershipId.slice(0, 8)}</span></span></div><span className={'fk-chip ' + (STATUS_TONE[om.status] ?? 'mut')}>{memberStatus(om.status)}</span></li>))}</ul></section> : null}
        </div> : null}
        {t === 'billing' ? (pays.error ? <StateBlock error={pays.error} onRetry={pays.reload} /> : !pays.data ? <div className="fk-loading">{tx('pos.loading')}</div> : pays.data.items.length === 0 ? <Empty title={tx('people.mo.noPayments')} /> : <>
          <PaymentsTable rows={pays.data.items} /><Pager info={pageOf(pays.data)} onPage={setPp} /></>) : null}
        {t === 'benefits' ? <>
          {x.benefits.length === 0 ? <div className="fk-hint">{tx('people.mo.noBenefits')}</div> : (
            <table className="fk-table fn-table mos-table" data-testid="md-benefits"><thead><tr><th>{tx('people.mo.benefit')}</th><th>{tx('people.membership.csv.service')}</th><th className="num">{tx('mos.col.entitled')}</th><th className="num">{tx('mos.col.usedCycle')}</th><th className="num">{tx('mos.col.remaining')}</th><th className="num">{tx('mos.col.usedTotal')}</th><th>{tx('mos.col.expires')}</th></tr></thead>
              <tbody>{x.benefits.map((bn: any) => <tr key={bn.benefitId}><td>{bn.label || codeLabel(`people.mo.benefitType.${bn.type}`, bn.type)}{bn.percent ? <span className="fk-li-s">{bn.percent}%</span> : bn.valueCents ? <span className="fk-li-s">{fmtMoney(bn.valueCents)}</span> : null}</td>
                <td>{bn.service || tx('people.mo.anyService')}</td><td className="num">{bn.perCycle == null ? tx('mos.unlimited') : nf(bn.perCycle)}</td><td className="num">{nf(bn.usedThisCycle)}</td><td className="num"><b>{bn.remaining == null ? '—' : nf(bn.remaining)}</b></td><td className="num">{nf(bn.usedTotal)}</td><td>{dd(bn.nextExpiry)}</td></tr>)}</tbody></table>)}
          <h3 className="fk-h3">{tx('mos.redemptions')}</h3>
          {reds.error ? <StateBlock error={reds.error} onRetry={reds.reload} /> : !reds.data ? <div className="fk-loading">{tx('pos.loading')}</div> : reds.data.items.length === 0 ? <div className="fk-hint">{tx('people.mo.noRedemptions')}</div> : <><RedemptionsTable rows={reds.data.items} /><Pager info={pageOf(reds.data)} onPage={setRp} /></>}
        </> : null}
        {t === 'activity' ? <>
          {acts.error ? <StateBlock error={acts.error} onRetry={acts.reload} /> : !acts.data ? <div className="fk-loading">{tx('pos.loading')}</div> : acts.data.items.length === 0 ? <div className="fk-hint">{tx('pos.no_activity_yet')}</div> : <><ActivityTable rows={acts.data.items} /><Pager info={pageOf(acts.data)} onPage={setAp} /></>}
          <h3 className="fk-h3">{tx('mos.audit')}</h3>
          {x.audit.length === 0 ? <div className="fk-hint">{tx('mos.noAudit')}</div> : (
            <table className="fk-table fn-table mos-table" data-testid="md-audit"><thead><tr><th>{tx('people.loyalty.when')}</th><th>{tx('mos.col.action')}</th><th>{tx('mos.col.change')}</th><th>{tx('mos.col.by')}</th><th>{tx('mos.col.reason')}</th></tr></thead>
              <tbody>{x.audit.map((a: any) => <tr key={a.id}><td>{whenTime(a.at)}</td><td>{codeLabel('mos.audit.' + a.action, activityLabel(a.action))}</td><td>{a.from || a.to ? `${a.from ? memberStatus(a.from) : '—'} → ${a.to ? memberStatus(a.to) : '—'}` : '—'}</td><td>{a.actor || '—'}</td><td>{a.reason || '—'}</td></tr>)}</tbody></table>)}
        </> : null}
      </>}
    </FitDialog>
  );
}

function PlanDialog({ plan, onClose, onMembers, canManage, onCreate }: { plan: PlanRow; onClose: () => void; onMembers: () => void; canManage: boolean; onCreate: () => void }) {
  const [benefits, setBenefits] = useState<any[] | null>(null); const [perf, setPerf] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    posMembershipsApi.discounts().then((r) => setBenefits((r.items ?? []).filter((b: any) => b.planId === plan.planId))).catch((e) => setErr(errText(e, tx('people.mo.loadFailed'))));
    posMembershipsApi.planPerformance().then((r) => setPerf((r.plans ?? []).find((p: any) => p.planId === plan.planId) ?? null)).catch((e) => setErr(errText(e, tx('people.mo.loadFailed'))));
  }, [plan.planId]);
  return (
    <FitDialog wide title={plan.name} subtitle={`${planPrice(plan)} · ${plan.status === 'active' ? tx('pos.active_3') : plan.status === 'draft' ? tx('pos.draft_2') : tx('pos.archived_2')}`} onClose={onClose} testId="dlg-plan"
      footer={<><button type="button" className="fk-btn ghost" onClick={onMembers}>{tx('people.mo.viewPlanMembers', { n: nf(plan.memberCount) })}</button><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      {plan.description ? <p className="rt-p">{plan.description}</p> : null}
      {err ? <div className="fk-err">{err}</div> : null}
      <h3 className="fk-h3">{tx('people.mo.benefits')}</h3>
      {!benefits ? <div className="fk-loading">{tx('pos.loading')}</div> : benefits.length === 0 ? <div className="fk-hint">{tx('people.mo.noBenefits')}</div> : <BenefitTable rows={benefits} />}
      <h3 className="fk-h3">{tx('people.mo.thisMonth')}</h3>
      {!perf ? <div className="fk-hint">{tx('pos.loading')}</div> : <PerfDl p={perf} />}
      <div className="fk-hint">{tx('people.mo.planEditRule')}</div>
      {canManage ? <div className="fk-hint">{tx('people.mo.planStatusBlocker')} <button type="button" className="fk-link" onClick={onCreate}>{tx('pos.create_plan')}</button></div> : null}
    </FitDialog>
  );
}
function BenefitTable({ rows, withPlan = false }: { rows: any[]; withPlan?: boolean }) {
  const value = (b: any) => (b.percent ?? 0) > 0 ? `${b.percent}%` : (b.valueCents ?? 0) > 0 ? fmtMoney(b.valueCents) : (b.creditsPerCycle ?? 0) > 0 ? tx('people.mo.credits', { n: nf(b.creditsPerCycle) }) : '—';
  return (
    <table className="fk-table"><thead><tr>{withPlan ? <th>{tx('people.membership.csv.plan')}</th> : null}<th>{tx('people.mo.benefit')}</th><th>{tx('people.mo.benefitType')}</th><th>{tx('people.membership.csv.service')}</th><th className="num">{tx('people.mo.value')}</th><th className="num">{tx('people.mo.perCycle')}</th></tr></thead>
      <tbody>{rows.map((b) => <tr key={b.benefitId}>{withPlan ? <td><b>{b.planName}</b> <span className="fk-muted">v{b.versionNumber}</span></td> : null}<td>{b.label || '—'}</td><td>{codeLabel(`people.mo.benefitType.${b.benefitType}`, b.benefitType)}</td><td>{b.serviceName || tx('people.mo.anyService')}</td><td className="num">{value(b)}</td><td className="num">{b.maxPerCycle == null ? '—' : nf(b.maxPerCycle)}</td></tr>)}</tbody></table>
  );
}
function PerfDl({ p }: { p: any }) {
  return (
    <dl className="fk-dl mo-dl">
      <dt>{tx('people.mo.joinedMonth')}</dt><dd>{nf(p.joinedThisMonth)}</dd>
      <dt>{tx('people.mo.canceledMonth')}</dt><dd>{nf(p.canceledThisMonth)}</dd>
      <dt>{tx('people.mo.revenue')}</dt><dd>{fmtMoney(p.revenueThisMonthCents)} <span className="fk-muted">· {tx('people.mo.lastMonth', { v: fmtMoney(p.revenueLastMonthCents) })}</span></dd>
      <dt>{tx('people.mo.renewals')}</dt><dd>{nf(p.renewalsThisMonth)}</dd>
      <dt>{tx('people.mo.failedPayments')}</dt><dd>{nf(p.failedPaymentsThisMonth)}</dd>
      <dt>{tx('people.mo.redemptions')}</dt><dd>{nf(p.redemptionsThisMonth)} <span className="fk-muted">· {fmtMoney(p.redeemedValueThisMonthCents)}</span></dd>
      <dt>{tx('people.mo.mix')}</dt><dd>{Object.keys(p.mix || {}).length ? Object.entries(p.mix).map(([s, n]) => `${memberStatus(s)} ${n}`).join(' · ') : '—'}</dd>
    </dl>
  );
}

export function ReminderDialog({ onClose, onSent }: { onClose: () => void; onSent: (msg: string) => void }) {
  const [days, setDays] = useState(7); const [pv, setPv] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let alive = true; setPv(null); setErr(null); posMembershipsApi.previewReminders(days).then((r) => alive && setPv(r)).catch((e) => alive && setErr(errText(e, tx('people.mo.loadFailed')))); return () => { alive = false; }; }, [days]);
  const send = async () => {
    if (busy || !pv || pv.toRemind === 0) return; setBusy(true); setErr(null);
    try { const r = (await posMembershipsApi.runReminders(days)) as { due: number; sent: number; skipped: number; texted?: number }; onSent(tx('people.mo.remindersSent', { sent: nf(r.sent), texted: nf(r.texted ?? 0), skipped: nf(r.skipped) })); }
    catch (e) { setErr(errText(e, tx('pos.could_not_send_reminders'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('pos.send_reminder')} subtitle={tx('people.mo.reminderSub')} onClose={onClose} busy={busy} testId="dlg-reminder"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" disabled={busy || !pv || pv.toRemind === 0} onClick={send} data-testid="reminder-send">{busy ? tx('pos.saving_2') : tx('people.mo.sendReminders', { n: nf(pv?.toRemind ?? 0) })}</button></>}>
      <div className="fk-seg" role="radiogroup" aria-label={tx('people.mo.window')}>{[3, 7, 14, 30].map((n) => <button type="button" key={n} className={days === n ? 'on' : ''} aria-pressed={days === n} onClick={() => setDays(n)}>{tx('people.mo.nextNDays', { n: String(n) })}</button>)}</div>
      {err ? <div className="fk-err">{err}</div> : !pv ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="rt-counts"><div><b>{nf(pv.due)}</b><span>{tx('people.mo.renewingSoon')}</span></div><div className="ok"><b>{nf(pv.toRemind)}</b><span>{tx('people.mo.willBeReminded')}</span></div><div className="mut"><b>{nf(pv.alreadyReminded)}</b><span>{tx('people.mo.alreadyReminded')}</span></div></div>
        <div className="fk-hint">{pv.texting ? tx('people.mo.channelText', { n: nf(pv.inAppOnly) }) : tx('people.mo.channelInApp')}</div>
        {/* Membership Overview 10: consent + text estimate, read-only (null from an older server → not shown, never "0") */}
        {pv.texting && pv.textOptedOut != null ? <div className="fk-hint" data-testid="reminder-optout">{tx('people.mo.optedOut', { n: nf(pv.textOptedOut) })}</div> : null}
        {pv.texting && pv.textEstimate ? <div className="fk-hint" data-testid="reminder-estimate">{tx('people.mo.textEstimate', { texts: nf(pv.textEstimate.texts), segments: nf(pv.textEstimate.segments) })}{pv.textEstimate.metered === false ? ' ' + tx('people.mo.notMetered') : ''}</div> : null}
        {pv.members.length ? <ul className="fk-list dense rt-roster">{pv.members.map((m: any) => <li key={m.membershipId} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{m.customerName || '—'}</span><span className="fk-li-s">{m.planName || '—'} · {tx('people.mo.renews', { date: when(m.nextBillingAt) })}</span></div>{m.textOptedOut === true && !m.alreadyReminded ? <span className="fk-chip mut" data-testid="reminder-stop">{tx('people.mo.inAppOnlyStop')}</span> : null}<span className={'fk-chip ' + (m.alreadyReminded ? 'mut' : 'ok')}>{m.alreadyReminded ? tx('people.mo.alreadyReminded') : tx('people.mo.willBeReminded')}</span></li>)}</ul> : <Empty title={tx('pos.no_members_are_due_for_a_13zy')} />}
        <div className="fk-hint">{tx('people.mo.reminderRule')}</div>
      </>}
    </FitDialog>
  );
}

function DiscountsDialog({ canManage, onClose, onCreate, onPromotions }: { canManage: boolean; onClose: () => void; onCreate: () => void; onPromotions: () => void }) {
  const [d, setD] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { posMembershipsApi.discounts().then((r) => setD(r.items ?? [])).catch((e) => setErr(errText(e, tx('people.mo.loadFailed')))); }, []);
  return (
    <FitDialog wide title={tx('pos.manage_discounts')} subtitle={tx('people.mo.discountsSub')} onClose={onClose} testId="dlg-discounts"
      footer={<><button type="button" className="fk-btn ghost" onClick={onPromotions} data-testid="open-promotions">{tx('mos.openDiscounts')}</button>{canManage ? <button type="button" className="fk-btn ghost" onClick={onCreate}>{tx('pos.create_plan')}</button> : null}<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      {err ? <div className="fk-err">{err}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : d.length === 0 ? <Empty title={tx('people.mo.noBenefitsAny')} /> : <BenefitTable rows={d} withPlan />}
      <div className="fk-hint">{tx('people.mo.discountRule')}</div>
    </FitDialog>
  );
}

function ReportDialog({ ov, onClose, onPerformance }: { ov: Overview | null; onClose: () => void; onPerformance: () => void }) {
  const k = ov?.kpis;
  return (
    <FitDialog wide title={tx('pos.membership_report')} subtitle={tx('people.mo.reportSub')} onClose={onClose} testId="dlg-report"
      footer={<><button type="button" className="fk-btn ghost" onClick={onPerformance}>{tx('pos.plan_performance')}</button><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      {!ov || !k ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <dl className="fk-dl mo-dl">
          <dt>{tx('pos.total_members')}</dt><dd>{nf(k.totalMembers)} <span className="fk-muted">· {tx('people.mo.kpi.newThisMonth', { n: nf(k.newMembersThisMonth) })}</span></dd>
          <dt>{tx('pos.active_members')}</dt><dd>{nf(k.activeMembers)} <span className="fk-muted">· {k.totalMembers ? `${k.activePctOfTotal}%` : '—'}</span></dd>
          <dt>{tx('people.mo.kpi.revenue')}</dt><dd>{fmtMoney(k.membershipRevenueCents)} <span className="fk-muted">· {tx('people.mo.kpi.payments', { n: nf(k.membershipPaymentsThisMonth ?? 0) })}{k.revenueDeltaPct != null ? ` · ${k.revenueDeltaPct >= 0 ? '+' : ''}${k.revenueDeltaPct}% ${tx('pos.vs_last_month')}` : ''}</span></dd>
          <dt>{tx('pos.expiring_soon')}</dt><dd>{nf(k.expiringSoon)} <span className="fk-muted">· {tx('people.mo.kpi.nextDays', { n: String(k.expiringWindowDays) })}</span></dd>
          <dt>{tx('pos.canceled_this_month')}</dt><dd>{nf(k.canceledThisMonth)}</dd>
        </dl>
        <h3 className="fk-h3">{tx('pos.plan_distribution')}</h3>
        {ov.planDistribution.length === 0 ? <div className="fk-hint">{tx('pos.no_data_yet')}</div> : <table className="fk-table"><thead><tr><th>{tx('people.membership.csv.plan')}</th><th className="num">{tx('people.mo.members')}</th><th className="num">%</th><th className="num">{tx('people.mo.revenue')}</th></tr></thead><tbody>{ov.planDistribution.map((d, i) => <tr key={d.planName + i}><td>{d.planName}</td><td className="num">{nf(d.count)}</td><td className="num">{d.pct}%</td><td className="num">{fmtMoney(d.revenueCents)}</td></tr>)}</tbody></table>}
        <h3 className="fk-h3">{tx('pos.membership_status')}</h3>
        {ov.statusBreakdown.length === 0 ? <div className="fk-hint">{tx('pos.no_data_yet')}</div> : <table className="fk-table"><thead><tr><th>{tx('pos.status')}</th><th className="num">{tx('people.mo.members')}</th><th className="num">%</th></tr></thead><tbody>{ov.statusBreakdown.map((s) => <tr key={s.status}><td>{memberStatus(s.status)}</td><td className="num">{nf(s.count)}</td><td className="num">{s.pct}%</td></tr>)}</tbody></table>}
        <div className="fk-hint">{tx('people.mo.reportNote')}</div>
      </>}
    </FitDialog>
  );
}

function PerformanceDialog({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { posMembershipsApi.planPerformance().then(setD).catch((e) => setErr(errText(e, tx('people.mo.loadFailed')))); }, []);
  return (
    <FitDialog wide title={tx('pos.plan_performance')} subtitle={d ? tx('people.mo.perfSub', { tz: d.period.timeZone }) : undefined} onClose={onClose} testId="dlg-performance" footer={<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button>}>
      {err ? <div className="fk-err">{err}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : d.plans.length === 0 ? <Empty title={tx('people.mo.noPlans')} /> : (
        <table className="fk-table"><thead><tr><th>{tx('people.membership.csv.plan')}</th><th className="num">{tx('people.mo.activeNow')}</th><th className="num">{tx('people.mo.joinedMonth')}</th><th className="num">{tx('people.mo.canceledMonth')}</th><th className="num">{tx('people.mo.revenue')}</th><th className="num">{tx('people.mo.lastMonthCol')}</th><th className="num">{tx('people.mo.renewals')}</th><th className="num">{tx('people.mo.failedPayments')}</th><th className="num">{tx('people.mo.redemptions')}</th></tr></thead>
          <tbody>{d.plans.map((p: any) => <tr key={p.planId}><td><b>{p.name}</b></td><td className="num">{nf(p.mix?.active ?? 0)}</td><td className="num">{nf(p.joinedThisMonth)}</td><td className="num">{nf(p.canceledThisMonth)}</td><td className="num">{fmtMoney(p.revenueThisMonthCents)}</td><td className="num">{fmtMoney(p.revenueLastMonthCents)}</td><td className="num">{nf(p.renewalsThisMonth)}</td><td className="num">{nf(p.failedPaymentsThisMonth)}</td><td className="num">{nf(p.redemptionsThisMonth)}</td></tr>)}</tbody></table>
      )}
      <div className="fk-hint">{tx('people.mo.notTracked')}</div>
    </FitDialog>
  );
}
