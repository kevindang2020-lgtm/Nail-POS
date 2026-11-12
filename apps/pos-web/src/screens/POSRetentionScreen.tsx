// POSRetentionScreen.tsx — Customers → Customer Retention (/tenant/customers/retention). Customer Retention mandate (Oct 29
// 2026) + the Complete Build Guide (Oct 30 2026). ONE full-screen page that fits the POS content area at 100 % zoom:
//   header        title · Refresh · Recovery & Trend · Campaign History · Settings · Export (permission) · Create Win-Back
//   KPI row       the five original cards + Never Visited · Recovered · Campaign Recoveries (each opens its cohort)
//   period row    Today / Week / Month / Year / Custom month calendar · "Filter list by" date basis · Priority · SMS · Visits
//   segment tabs  All | Returning | Approaching Risk | At Risk | Never Visited | Recovered (+ 90+ · 180+ · SMS-Eligible)
//   win-back list the six original columns + select · Segment · Priority (why) · SMS · Last contact · actions; numbered
//                 server pages (All = newest profile first; At Risk = Smart Priority)
//   selection bar Select page / Select all matching eligible / Clear / Preview bulk SMS
//
// Fixes the reported defect: a customer with NO completed visit is "Never Visited", never "At Risk", never scored and
// never a win-back recipient — the cohorts come from /pos/retention (settled tickets only, refunds netted), with the
// salon's own thresholds (Settings), not from account age.
// SMS: select → preview (server: consent · opt-out · phone · recently contacted · upcoming booking · never visited ·
// duplicates; the final body with the salon name + STOP line; sender; quiet hours) → explicit Confirm Send (one
// idempotency key per attempt) → one queued job per recipient → Campaign History with per-recipient outcomes (queued /
// sent / delivered / undelivered / blocked / failed — never a guessed delivery). Selection is customer ids, kept across
// pages; "all matching" is resolved by the server against the filters at preview time and snapshotted in the draft.
// Four-Module Completion Guide (Oct 30 2026):
//   CR-01  "As of date" → HistoryDialog: the STORED snapshot of a past salon day (counts, coverage, members, compare two
//          dates, rebuild history); a day without a stored snapshot is "Incomplete / unverifiable" — never recomputed here
//   CR-02  Branch selector: All authorized branches / one branch (server-checked); the scope label says "Tenant-wide
//          customer retention" or "Branch activity retention"; Unknown-branch visits are counted, never allocated
//   CR-03  the SMS preview's cost estimate ("Price unknown — cannot estimate" without a configured price, never $0);
//          the salon's SMS price is set in Settings (audited, effective-dated)
//   CR-04  "Book appointment" (row + customer overlay) opens the existing New Appointment flow with ?customerId= only
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posRetentionApi, type RetentionSelection } from '../api/posRetentionApi';
import { posServicesApi } from '../api/posServicesApi';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { posCustomersApi } from '../api/posCustomersApi';
import { posMessageTemplatesApi } from '../api/posMessageTemplatesApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, ErrorRetry, useFitRows, requestId, useDebounced, downloadText, type PageInfo } from '../components/FitKit';
import { PeriodBar, periodQuery, fmtYmdSafe, DateField, useFreshAt, FreshnessLine, type PeriodState, type ServerPeriod } from '../components/FinanceKit';
import { HealthDialog, AssistantDialog } from './RetentionWinBack';
import { useRealtime } from '../realtime/useRealtime';

type Segment = 'all' | 'returning' | 'approaching' | 'at_risk' | 'never' | 'recovered' | 'active' | 'at_risk_90' | 'at_risk_180' | 'returned' | 'contactable' | 'new_visitors' | 'rebooked' | 'contacted';
type SmsStatus = 'eligible' | 'no_phone' | 'invalid_phone' | 'no_consent' | 'opted_out' | 'recently_contacted' | 'upcoming_booking';
type Priority = { score: number; band: 'high' | 'medium' | 'low'; formulaVersion: string; components: { inactivity: number; frequency: number; spend: number }; topDriver: 'inactivity' | 'frequency' | 'spend'; explanation: string };
type Row = { customerId: string; customerName: string; avatarUrl: string | null; maskedPhone: string | null; phoneStatus: 'ok' | 'missing' | 'invalid'; smsStatus: SmsStatus;
  segment: 'never_visited' | 'active' | 'approaching' | 'at_risk'; returningInPeriod: boolean; recoveredInPeriod: boolean;
  lastVisitAt: string | null; firstVisitAt: string | null; daysAway: number | null; visits: number; lifetimeSpendCents: number; createdAt: string | null;
  lastOutreachAt: string | null; lastOutreachStatus: string | null; nextAppointmentDate: string | null; priority: Priority | null };
type Period = { preset: string; from: string; to: string; today: string; timeZone: string; riskDays: number; approachingDays: number; observationWindowDays: number; settingsVersion: number; segmentationVersion: string; priorityFormulaVersion: string };
type Scope = { mode: 'tenant' | 'branches'; label: 'tenant_wide' | 'branch_activity'; selectedBranchId: string | null; confined: boolean; branches: { branchId: string; name: string }[]; unknownBranchVisits?: number };
type Summary = { period: Period; scope?: Scope;
  kpis: { returningRatePercent: number | null; returningCustomers: number; visitedInPeriod: number; newThisMonth: number; newRegisteredThisMonth: number; atRisk: number; lapsedValueCents: number; neverVisited: number; recovered: number; campaignRecoveries: number;
    contacted?: number; rebooked?: number; delivered?: number | null; deliveryEvidence?: boolean };
  segments: Record<Segment, number>; priorityBands: { high: number; medium: number; low: number } };
type Paged<T> = PageInfo & { items: T[] };
type ListResp = Paged<Row> & { segment: Segment; sort: string; eligibleOnPage: number; eligibleMatching: number; period: Period };
type Readiness = { sender: { route: 'tenant_account' | 'shared' | 'simulated' | 'not_configured'; from: string | null; a2pStatus: string | null }; quietHours: { start: number | null; end: number | null; until: string | null }; canSend: boolean };

const TABS: Segment[] = ['all', 'returning', 'approaching', 'at_risk', 'never', 'recovered', 'rebooked', 'contacted'];
const MORE: Segment[] = ['at_risk_90', 'at_risk_180', 'contactable'];
const SORTS = ['priority', 'created_desc', 'oldest_visit', 'newest_visit', 'name', 'spend', 'visits'] as const;
const BASES = ['none', 'last_visit', 'first_visit', 'created', 'campaign', 'recovery'] as const;
const WINBACK = new Set<Segment>(['at_risk', 'at_risk_90', 'at_risk_180', 'contactable']);
const nf = (n: number) => fmtNumber(n || 0);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const whenTime = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const segLabel = (s: string, p?: Period | null) => (s === 'at_risk' ? tx('rt2.seg.at_risk', { d: String(p?.riskDays ?? 60) }) : s === 'approaching' ? tx('rt2.seg.approaching', { a: String(p?.approachingDays ?? 45), d: String((p?.riskDays ?? 60) - 1) })
  : ['returning', 'recovered', 'never_visited', 'new_visitors'].includes(s) ? tx('rt2.seg.' + s) : s === 'rebooked' || s === 'contacted' ? tx('wb.seg.' + s) : codeLabel(`people.retention.segment.${s}`, s));
const smsLabel = (s: string) => (s === 'upcoming_booking' || s === 'never_visited' || s === 'has_visited' ? tx('rt2.sms.' + s) : codeLabel(`people.retention.sms.${s}`, s));
const recipLabel = (s: string) => codeLabel(`people.retention.recipient.${s}`, s);
const campaignLabel = (s: string) => codeLabel(`people.retention.campaign.${s}`, s);
const sortLabel = (s: string) => (s === 'priority' || s === 'created_desc' ? tx('rt2.sort.' + s) : codeLabel(`people.retention.sort.${s}`, s));
// a 403 always reads as a permission message (EN / VI), whatever words the error carries
const errText = (e: any, fb: string) => (e && (e.status === 403 || e.code === 'PERMISSION_DENIED') ? tx('errors.PERMISSION_DENIED') : errorTextOf(e, fb));
const errDetails = (e: any): Record<string, any> => e?.details?.error?.details ?? e?.details?.details ?? e?.details ?? {};
const SMS_TONE: Record<string, string> = { eligible: 'ok', recently_contacted: 'warn', upcoming_booking: 'info', no_consent: 'mut', opted_out: 'bad', no_phone: 'mut', invalid_phone: 'bad' };
// Customer Retention extras #12: the SMS outcome is never colour alone — a shape (✓ can text · ⏸ wait · ✕ cannot) sits before the
// words, hidden from screen readers (the words already say it)
const SMS_ICON: Record<string, string> = { eligible: '✓', recently_contacted: '⏸', upcoming_booking: '⏸', no_consent: '✕', opted_out: '✕', no_phone: '✕', invalid_phone: '✕' };
const smsIcon = (s: string) => <span aria-hidden="true" data-testid="rt-sms-icon" style={{ marginRight: 3 }}>{SMS_ICON[s] ?? '•'}</span>;
const RECIP_TONE: Record<string, string> = { delivered: 'ok', sent: 'info', simulated: 'info', queued: 'warn', submitting: 'warn', excluded: 'mut', blocked: 'mut', failed: 'bad', undelivered: 'bad', unknown: 'warn' };
const SEG_TONE: Record<string, string> = { at_risk: 'bad', approaching: 'warn', active: 'ok', never_visited: 'mut' };
const BAND_TONE: Record<string, string> = { high: 'bad', medium: 'warn', low: 'mut' };
/** the localized "Why high priority?" line, built from the server's components (the English one is the export's) */
export const whyText = (p: Priority, r: { daysAway: number | null; visits: number; lifetimeSpendCents: number }) =>
  tx('rt2.why.' + p.topDriver, { d: nf(r.daysAway ?? 0), v: nf(r.visits), s: fmtMoney(r.lifetimeSpendCents) });
const serverPeriod = (p?: Period | null): ServerPeriod | null => (p ? { preset: p.preset as ServerPeriod['preset'], from: p.from, to: p.to, tz: p.timeZone, today: p.today } : null);

type Filters = { basis: string; band: string; sms: string; minVisits: number; inactivity: string; customDays: string; email: string; future: string; scope: string; category: string; technician: string; spend: string };
const NO_FILTERS: Filters = { basis: 'none', band: '', sms: '', minVisits: 0, inactivity: '', customDays: '', email: '', future: '', scope: '', category: '', technician: '', spend: '' };
/** Win-Back guide §06: 30 / 60 / 90 / 120 or a custom number of salon days; '' = not filtered */
const minDaysOf = (f: Filters): number | undefined => { const n = Math.trunc(Number(f.inactivity === 'custom' ? f.customDays : f.inactivity)); return Number.isFinite(n) && n >= 1 && n <= 3650 ? n : undefined; };
type Selection = { mode: 'ids'; ids: Map<string, Row> } | { mode: 'matching'; filter: RetentionSelection; segment: Segment; total: number; excludeIds: Set<string> };
const EMPTY_SEL: Selection = { mode: 'ids', ids: new Map() };

/** a segment count from the summary, or null when the server did not send it */
const segVal = (segs: unknown, k: string): number | null => { const v = segs && typeof segs === 'object' ? (segs as Record<string, unknown>)[k] : null; return typeof v === 'number' ? v : null; };

export function POSRetentionScreen() {
  const nav = useNavigate();
  const can = useCan();
  const canViewCampaigns = can('marketing.view');
  const canExport = can('customers.export');
  const canEditSettings = can('settings.edit');
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' });
  const [branch, setBranch] = useState('');   // '' = all authorized branches (CR-02)
  const pq = { ...periodQuery(period), ...(branch ? { branch } : {}) };
  const pKey = JSON.stringify(pq);
  const [sum, setSum] = useState<Summary | null>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const freshAt = useFreshAt(sum);   // data freshness: only after a successful summary read
  const [ready, setReady] = useState<Readiness | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const sumSeq = useRef(0);
  const loadSummary = useCallback(() => {
    const my = ++sumSeq.current; setSumErr(null);
    posRetentionApi.summary(JSON.parse(pKey)).then((d) => { if (my === sumSeq.current) setSum(d); }).catch((e) => { if (my === sumSeq.current) setSumErr(errText(e, tx('people.retention.loadFailed'))); });
  }, [pKey]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { posRetentionApi.readiness().then(setReady).catch(() => setReady(null)); }, []);

  const [segment, setSegment] = useState<Segment>('at_risk');
  const [sort, setSort] = useState<string>('');
  const [flt, setFlt] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState(''); const q = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const fit = useFitRows<HTMLDivElement>(45, { min: 3, max: 14, reserve: 48 });   // 44 px rows + 1 px rule; the sticky header row
  const [list, setList] = useState<ListResp | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const seq = useRef(0);
  const query = useMemo(() => ({ segment, ...JSON.parse(pKey), q: q.trim() || undefined, sort: sort || undefined, basis: flt.basis !== 'none' ? flt.basis : undefined,
    band: flt.band || undefined, sms: flt.sms || undefined, minVisits: flt.minVisits || undefined, minDays: minDaysOf(flt), email: flt.email || undefined, future: flt.future || undefined,
    scope: flt.scope || undefined, category: flt.category || undefined, technician: flt.technician || undefined, spend: flt.spend || undefined }), [segment, pKey, q, sort, flt]);
  useEffect(() => {
    const my = ++seq.current; setListErr(null);
    posRetentionApi.customers({ ...query, page, pageSize: fit.rows })
      .then((d: ListResp) => { if (my !== seq.current) return; setList(d); if (d.page !== page) setPage(d.page); })
      .catch((e) => { if (my === seq.current) setListErr(errText(e, tx('people.retention.loadFailed'))); });
  }, [query, page, fit.rows, reload]);
  useEffect(() => { setPage(1); }, [q, pKey, flt]);

  // selection (customer ids; kept across pages; cleared when the cohort / filters change — never carried into another list)
  const [sel, setSel] = useState<Selection>(EMPTY_SEL);
  // A19 Nov 6: filter lists (real categories / technicians) and Add to eligible audience (an unsent draft for Campaign Center)
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]); const [techs, setTechs] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    posServicesApi.categories().then((x: any) => setCats((Array.isArray(x) ? x : x?.items ?? x?.categories ?? []).map((c: any) => ({ id: String(c.id ?? c.categoryId), name: String(c.name) })))).catch(() => setCats([]));
    posTechniciansApi.list({ pageSize: 100, status: 'active' }).then((x: any) => setTechs((Array.isArray(x) ? x : x?.items ?? x?.technicians ?? []).map((t: any) => ({ id: String(t.id ?? t.technicianId), name: String(t.fullName ?? t.name ?? t.full_name ?? '') })))).catch(() => setTechs([]));
  }, []);
  const [adding, setAdding] = useState(false); const pickKey = useRef(requestId());
  const addPicked = async () => {
    if (sel.mode !== 'ids' || !sel.ids.size) return;
    setAdding(true);
    try {
      const d = await posRetentionApi.winbackPicked({ customerIds: [...sel.ids.keys()], channel: 'sms', idempotencyKey: pickKey.current });
      pickKey.current = requestId();
      setNote({ tone: 'ok', text: tx('wb.picked.saved', { e: String(d.eligible), s: String(d.selected) }) });
    } catch (e) { setNote({ tone: 'bad', text: errText(e, tx('people.retention.loadFailed')) }); } finally { setAdding(false); }
  };
  const clearSelIfAny = () => { if (sel.mode === 'matching' || (sel.mode === 'ids' && sel.ids.size)) { setSel(EMPTY_SEL); setNote({ tone: 'ok', text: tx('people.retention.selectionCleared') }); } };
  const pickSegment = (s: Segment, srt = '') => { setSegment(s); setSort(srt); setPage(1); if (!WINBACK.has(s)) setFlt((f) => ({ ...f, band: '' })); clearSelIfAny(); };
  const setFilter = (patch: Partial<Filters>) => { setFlt((f) => ({ ...f, ...patch })); clearSelIfAny(); };
  const changePeriod = (p: PeriodState) => { setPeriod(p); clearSelIfAny(); };
  // C5 gap (Nov 5 2026): on the Never Visited tab, customers can be picked for a First Visit Invitation (the server checks consent)
  const canPick = (r: Row) => (r.smsStatus === 'eligible' && r.segment === 'at_risk') || (segment === 'never' && r.segment === 'never_visited');
  const isSelected = (r: Row) => (sel.mode === 'ids' ? sel.ids.has(r.customerId) : canPick(r) && !sel.excludeIds.has(r.customerId));
  const toggle = (r: Row) => {
    if (sel.mode === 'matching') { const ex = new Set(sel.excludeIds); if (ex.has(r.customerId)) ex.delete(r.customerId); else ex.add(r.customerId); setSel({ ...sel, excludeIds: ex }); return; }
    const ids = new Map(sel.ids); if (ids.has(r.customerId)) ids.delete(r.customerId); else ids.set(r.customerId, r); setSel({ mode: 'ids', ids });
  };
  const rows = list?.items ?? [];
  const eligibleOnPage = rows.filter(canPick);
  const pageAllOn = eligibleOnPage.length > 0 && eligibleOnPage.every(isSelected);
  const selectPage = () => {
    if (sel.mode === 'matching') return;
    const ids = new Map(sel.ids);
    if (pageAllOn) eligibleOnPage.forEach((r) => ids.delete(r.customerId)); else eligibleOnPage.forEach((r) => ids.set(r.customerId, r));
    setSel({ mode: 'ids', ids });
    if (!pageAllOn) setNote({ tone: 'ok', text: tx('people.retention.pageSelected', { n: nf(eligibleOnPage.length), skipped: nf(rows.length - eligibleOnPage.length) }) });
  };
  const [askAll, setAskAll] = useState(false);
  const eligibleMatching = list?.eligibleMatching ?? 0;
  const selectedCount = sel.mode === 'ids' ? sel.ids.size : Math.max(0, sel.total - sel.excludeIds.size);
  const selectedEligible = sel.mode === 'ids' ? [...sel.ids.values()].filter(canPick).length : null;
  const smsBlocked = ready ? (!ready.canSend ? 'perm' : ready.sender.route === 'not_configured' ? 'config' : null) : 'loading';
  const selectAllMatching = () => {
    // only eligible At Risk customers of the CURRENT filters; the server resolves the ids again at preview time
    const { segment: _s, ...rest } = query; void _s;
    setSel({ mode: 'matching', segment, filter: { ...rest, segment: WINBACK.has(segment) ? segment : 'at_risk', sms: 'eligible' }, total: eligibleMatching, excludeIds: new Set() }); setAskAll(false);
  };
  const createWinBack = () => { pickSegment('at_risk'); setFlt((f) => ({ ...f, sms: 'eligible' })); setNote({ tone: 'ok', text: tx('rt2.createWinBackNote') }); };

  const [dlg, setDlg] = useState<null | { kind: 'compose'; single?: Row } | { kind: 'customer'; id: string } | { kind: 'campaigns' } | { kind: 'campaign'; id: string } | { kind: 'recovery' } | { kind: 'settings' } | { kind: 'history' } | { kind: 'health' } | { kind: 'assistant' }>(null);
  // CR-04: the existing New Appointment flow, the customer preselected by id only (no name / phone in the URL); the booking
  // screen loads the customer from the server and saves nothing until its own explicit submit
  const book = (id: string) => nav(`/booking/new?customerId=${encodeURIComponent(id)}&from=retention`);
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try { const csv = await posRetentionApi.exportCsv(query); downloadText(`customer-retention-${segment}-${sum?.period.from ?? ''}-to-${sum?.period.to ?? ''}.csv`, csv); setNote({ tone: 'ok', text: tx('rt2.exported') }); }
    catch (e) { setNote({ tone: 'bad', text: errText(e, tx('rt2.exportFailed')) }); } finally { setExporting(false); }
  };
  const refresh = () => { loadSummary(); setReload((n) => n + 1); };
  // C2 gap (Nov 5 2026): win-back texts' delivery reports refresh the screen live; a 60 s safety sync otherwise
  useRealtime(['retention'], () => refresh(), { intervalMs: 60_000 });
  const k = sum?.kpis; const segs = sum?.segments; const per = sum?.period ?? list?.period ?? null;
  const defaultSort = WINBACK.has(segment) ? 'priority' : segment === 'all' || segment === 'never' ? 'created_desc' : segment === 'approaching' ? 'oldest_visit' : 'newest_visit';
  const currentSort = list?.sort ?? (sort || defaultSort);
  const isWinBack = WINBACK.has(segment);
  const periodWord = tx('rt2.inPeriod');
  const scope = sum?.scope;
  const branchName = scope?.selectedBranchId ? scope.branches.find((b) => b.branchId === scope.selectedBranchId)?.name ?? '' : '';
  const scopeText = !scope ? '' : scope.label === 'tenant_wide' ? tx('rt3.scope.tenant_wide') : branchName ? tx('rt3.scope.branchNamed', { b: branchName }) : tx('rt3.scope.branch_activity');
  const changeBranch = (b: string) => { setBranch(b); setPage(1); clearSelIfAny(); };

  return (
    <div className="work fit rt rt2" data-testid="retention-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.customer_retention')}</h1>
<div className="sub">{tx('rt2.subtitle')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn ghost" onClick={refresh} data-testid="rt-refresh">{tx('rt2.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'health' })} data-testid="open-health">{tx('wb.health.open')}</button>
          {canViewCampaigns ? <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'assistant' })} data-testid="open-assistant">{tx('wb.ai.open')}</button> : null}
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'history' })} data-testid="open-history">{tx('rt3.asOf.open')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'recovery' })} data-testid="open-recovery">{tx('rt2.recovery')}</button>
          {canViewCampaigns ? <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'campaigns' })} data-testid="open-campaigns">{tx('people.retention.campaignHistory')}</button> : null}
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'settings' })} data-testid="open-settings" title={per ? tx('rt2.settingsTitle', { d: String(per.riskDays), a: String(per.approachingDays) }) : undefined}>{tx('rt2.settings')}</button>
          {canExport ? <button type="button" className="fk-btn ghost" onClick={doExport} disabled={exporting} data-testid="rt-export">{exporting ? tx('pos.loading') : tx('rt2.export')}</button> : null}
          {canViewCampaigns && sel.mode === 'ids' && sel.ids.size ? <button type="button" className="fk-btn ghost" onClick={addPicked} disabled={adding} data-testid="add-picked">{tx('wb.picked.add', { n: String(sel.ids.size) })}</button> : null}
          <button type="button" className="fk-btn primary" onClick={createWinBack} data-testid="create-winback">{tx('rt2.createWinBack')}</button>
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <FreshnessLine at={freshAt} error={sumErr} testId="retention-fresh" />
      <div className="fk-kpis eight" data-testid="retention-kpis">
        {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSummary} /> : <>
          <KpiCard testId="kpi-rate" label={tx('pos.returning_rate')} loading={!k} tone="gold" value={k ? (k.returningRatePercent == null ? tx('rt2.na') : `${k.returningRatePercent}%`) : ''}
            sub={k ? (k.returningRatePercent == null ? tx('rt2.kpi.noVisits') : tx('rt2.kpi.rateSub', { r: nf(k.returningCustomers), v: nf(k.visitedInPeriod) })) : ''} onClick={() => pickSegment('returning')} />
          <KpiCard testId="kpi-returning" label={tx('pos.returning')} loading={!k} value={k ? nf(k.returningCustomers) : ''} sub={tx('rt2.kpi.returningSub')} onClick={() => pickSegment('returning')} />
          <KpiCard testId="kpi-new" label={tx('rt2.kpi.new')} loading={!k} value={k ? nf(k.newThisMonth) : ''} sub={k ? tx('rt2.kpi.newSub', { n: nf(k.newRegisteredThisMonth) }) : ''} onClick={() => pickSegment('new_visitors')} />
          <KpiCard testId="kpi-at-risk" label={tx('pos.at_risk')} loading={!k} tone={k && k.atRisk > 0 ? 'bad' : undefined} value={k ? nf(k.atRisk) : ''} sub={per ? tx('people.retention.kpi.atRiskSub', { d: String(per.riskDays) }) : ''} onClick={() => pickSegment('at_risk')} />
          <KpiCard testId="kpi-lapsed" label={tx('pos.lapsed_value')} loading={!k} value={k ? fmtMoney(k.lapsedValueCents) : ''} sub={tx('rt2.kpi.lapsedSub')} onClick={() => pickSegment('at_risk', 'spend')} />
          <KpiCard testId="kpi-never" label={tx('rt2.seg.never_visited')} loading={!k} value={k ? nf(k.neverVisited) : ''} sub={tx('rt2.kpi.neverSub')} onClick={() => pickSegment('never')} />
          <KpiCard testId="kpi-recovered" label={tx('rt2.seg.recovered')} loading={!k} tone={k && k.recovered > 0 ? 'ok' : undefined} value={k ? nf(k.recovered) : ''} sub={per ? tx('rt2.kpi.recoveredSub', { d: String(per.riskDays) }) : ''} onClick={() => pickSegment('recovered')} />
          <KpiCard testId="kpi-campaign-recoveries" label={tx('rt2.kpi.campaignRecoveries')} loading={!k} value={k ? nf(k.campaignRecoveries) : ''} sub={per ? tx('rt2.kpi.campaignSub', { d: String(per.observationWindowDays) }) : ''} onClick={() => setDlg({ kind: 'recovery' })} />
        </>}
      </div>
      {k ? <div className="wb-strip" data-testid="wb-strip">
        <button type="button" className="fk-link" onClick={() => pickSegment('contacted')}>{tx('wb.strip.contacted', { n: nf(k.contacted ?? 0) })}</button>
        <span data-testid="wb-delivered">{k.delivered == null ? tx('wb.strip.deliveredUnknown') : tx('wb.strip.delivered', { n: nf(k.delivered) })}</span>
        <button type="button" className="fk-link" onClick={() => pickSegment('rebooked')}>{tx('wb.strip.rebooked', { n: nf(k.rebooked ?? 0) })}</button>
      </div> : null}

      <div className="rt-filters rt-periodrow" role="toolbar" aria-label={tx('rt2.filters')}>
        <PeriodBar compact value={period} onChange={changePeriod} server={serverPeriod(per)} basis={flt.basis} onBasis={(b) => setFilter({ basis: b })}
          basisOptions={BASES.map((b) => ({ value: b, label: tx('rt2.basis.' + b) }))} />
        <span className="rt-selspace" />
        <select className="fk-select" aria-label={tx('rt2.priority')} value={flt.band} disabled={!isWinBack} onChange={(e) => setFilter({ band: e.target.value })} data-testid="flt-band"
          title={!isWinBack ? tx('rt2.priorityOnlyAtRisk') : undefined}>
          <option value="">{tx('rt2.band.any')}</option>
          {(['high', 'medium', 'low'] as const).map((b) => <option key={b} value={b}>{tx('rt2.band.' + b)}{sum ? ` (${nf(sum.priorityBands[b])})` : ''}</option>)}
        </select>
        <select className="fk-select" aria-label={tx('rt2.smsFilter')} value={flt.sms} onChange={(e) => setFilter({ sms: e.target.value })} data-testid="flt-sms">
          <option value="">{tx('rt2.sms.any')}</option><option value="eligible">{tx('rt2.sms.onlyEligible')}</option><option value="not_eligible">{tx('rt2.sms.notEligible')}</option>
        </select>
        <select className="fk-select" aria-label={tx('rt2.visitsFilter')} value={String(flt.minVisits)} onChange={(e) => setFilter({ minVisits: Number(e.target.value) })} data-testid="flt-visits">
          {[0, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n === 0 ? tx('rt2.visits.any') : tx('rt2.visits.min', { n: String(n) })}</option>)}
        </select>
        <select className="fk-select" aria-label={tx('wb.flt.inactivity')} value={flt.inactivity} onChange={(e) => setFilter({ inactivity: e.target.value })} data-testid="flt-inactivity">
          <option value="">{tx('wb.flt.inactivity.any')}</option>{[30, 60, 90, 120].map((n) => <option key={n} value={String(n)}>{tx('wb.flt.inactivity.n', { n: String(n) })}</option>)}
          <option value="custom">{tx('wb.flt.inactivity.custom')}</option>
        </select>
        {flt.inactivity === 'custom' ? <input className="fk-input rt-days" type="number" min={1} max={3650} inputMode="numeric" aria-label={tx('wb.flt.inactivity.customLabel')} value={flt.customDays}
          onChange={(e) => setFilter({ customDays: e.target.value })} data-testid="flt-days" /> : null}
        <select className="fk-select" aria-label={tx('wb.flt.email')} value={flt.email} onChange={(e) => setFilter({ email: e.target.value })} data-testid="flt-email">
          <option value="">{tx('wb.flt.email.any')}</option>{(['eligible', 'not_eligible', 'opted_out'] as const).map((v) => <option key={v} value={v}>{tx('wb.flt.email.' + v)}</option>)}
        </select>
        {/* A19 Nov 6: service category / technician (a settled visit with it) and lifetime-spend band */}
        {cats.length ? <select className="fk-select" aria-label={tx('wb.flt.category')} value={flt.category} onChange={(e) => setFilter({ category: e.target.value })} data-testid="flt-category">
          <option value="">{tx('wb.flt.category.any')}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : null}
        {techs.length ? <select className="fk-select" aria-label={tx('wb.flt.technician')} value={flt.technician} onChange={(e) => setFilter({ technician: e.target.value })} data-testid="flt-technician">
          <option value="">{tx('wb.flt.technician.any')}</option>{techs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : null}
        <select className="fk-select" aria-label={tx('wb.flt.spend')} value={flt.spend} onChange={(e) => setFilter({ spend: e.target.value })} data-testid="flt-spend">
          <option value="">{tx('wb.flt.spend.any')}</option>{['low', 'mid', 'high'].map((v) => <option key={v} value={v}>{tx('wb.flt.spend.' + v)}</option>)}</select>
        <select className="fk-select" aria-label={tx('wb.flt.future')} value={flt.future} onChange={(e) => setFilter({ future: e.target.value })} data-testid="flt-future">
          <option value="">{tx('wb.flt.future.any')}</option><option value="yes">{tx('wb.flt.future.yes')}</option><option value="no">{tx('wb.flt.future.no')}</option>
        </select>
        {(flt.basis !== 'none' || flt.band || flt.sms || flt.minVisits || flt.inactivity || flt.email || flt.future || flt.category || flt.technician || flt.spend || flt.scope || search) ? <button type="button" className="fk-link" onClick={() => { setFlt(NO_FILTERS); setSearch(''); clearSelIfAny(); }} data-testid="flt-clear">{tx('pos.clear_all')}</button> : null}
      </div>

      <div className="rt-filters" role="tablist" aria-label={tx('people.retention.segments')}>
        <div className="rt-chips">
          {[...TABS, ...MORE].map((s) => (
            <button type="button" role="tab" key={s} className={'rt-chip' + (MORE.includes(s) ? ' more' : '') + (segment === s ? ' on' : '')} aria-selected={segment === s} onClick={() => pickSegment(s)} data-testid={'seg-' + s}>
              {segLabel(s, per)} <span className="rt-chip-n">{segs ? nf(segs[s]) : '…'}</span>
            </button>
          ))}
          {segment === 'new_visitors' || segment === 'active' ? <span className="rt-chip on" aria-current="true">{segLabel(segment, per)} <span className="rt-chip-n">{segs ? nf(segs[segment]) : '…'}</span></span> : null}
        </div>
      </div>

      <FitPanel testId="panel-winback" className="rt-table-panel" title={<>{segLabel(segment, per)} <span className="rt-sortnote">· {sortLabel(currentSort)}{segment === 'returning' || segment === 'recovered' || segment === 'new_visitors' ? ' · ' + periodWord : ''}</span>
          {scopeText ? <span className={'rt3-scope ' + (scope?.label ?? '')} data-testid="rt-scope" title={scopeText}>{scopeText}</span> : null}
          {scope?.unknownBranchVisits ? <span className="rt3-unknown" data-testid="rt-unknown-branch" title={tx('rt3.scope.unknown', { n: nf(scope.unknownBranchVisits) })}>{tx('rt3.scope.unknownShort', { n: nf(scope.unknownBranchVisits) })}</span> : null}</>} bodyRef={fit.ref}
        actions={<>
          <select className="fk-select rt3-branch" aria-label={tx('rt3.branch.label')} value={branch} onChange={(e) => changeBranch(e.target.value)} data-testid="flt-branch" title={scopeText}>
            <option value="">{tx('rt3.branch.all')}</option>
            {(scope?.branches ?? []).map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
          </select>
          <select className="fk-select" aria-label={tx('wb.scope.label')} value={flt.scope} onChange={(e) => setFilter({ scope: e.target.value })} data-testid="flt-scope">
            {['', 'name', 'phone', 'email', 'service', 'id'].map((v) => <option key={v} value={v}>{tx('wb.scope.' + (v || 'all'))}</option>)}
          </select>
          <input type="search" className="fk-search" aria-label={tx('rt2.search')} placeholder={tx('rt2.search')} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="rt-search" />
          <select className="fk-select" aria-label={tx('people.retention.sortBy')} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} data-testid="rt-sort">
            <option value="">{tx('people.retention.sortDefault', { s: sortLabel(defaultSort) })}</option>
            {SORTS.filter((s) => s !== 'priority' || isWinBack).map((s) => <option key={s} value={s}>{sortLabel(s)}</option>)}
          </select>
        </>}
        footer={<Pager info={list} onPage={setPage} />}>
        {listErr ? <ErrorRetry message={listErr} onRetry={() => setReload((n) => n + 1)} /> : !list ? <div className="fk-loading">{tx('pos.loading')}</div> : rows.length === 0 ? (
          q || flt.band || flt.sms || flt.minVisits || flt.basis !== 'none' ? <Empty title={tx('people.fit.noMatch')}><button type="button" className="fk-btn ghost" onClick={() => { setSearch(''); setFlt(NO_FILTERS); }}>{tx('pos.clear_all')}</button></Empty>
            : <Empty title={['returning', 'approaching', 'recovered'].includes(segment) ? tx('rt2.empty.' + segment) : segment === 'at_risk' ? tx('rt2.empty.at_risk', { d: String(per?.riskDays ?? 60) }) : tx(`people.retention.empty.${['never', 'contactable'].includes(segment) ? segment : 'other'}`)}>
              {/* Customer Retention extras #10: zero at-risk customers is good news — say what that means and offer the next
                  useful views (approaching risk, never visited, recovered) with their live counts, instead of a dead end */}
              {segment === 'at_risk' ? <div data-testid="rt-empty-actions" style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
                <div className="fk-hint">{tx('rt2.emptyAtRisk.explain', { d: String(per?.riskDays ?? 60) })}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {(['approaching', 'never', 'recovered'] as const).map((sg) => <button key={sg} type="button" className="fk-btn ghost sm" data-testid={'rt-empty-go-' + sg} onClick={() => pickSegment(sg)}>{tx('rt2.emptyAtRisk.go.' + sg, { n: segVal(segs, sg) != null ? nf(segVal(segs, sg) as number) : '—' })}</button>)}
                </div>
              </div> : null}
            </Empty>
        ) : (
          <table className="fk-table rt-table">
            <colgroup><col style={{ width: 44 }} /><col /><col style={{ width: '11%' }} /><col style={{ width: '9%' }} /><col style={{ width: 58 }} /><col style={{ width: 54 }} /><col style={{ width: '8%' }} />
              <col style={{ width: '9%' }} /><col style={{ width: 92 }} /><col style={{ width: '10%' }} /><col className="t-opt" style={{ width: '8%' }} /><col style={{ width: 178 }} /></colgroup>
            <thead><tr>
              <th><label className="rt-cbwrap"><input type="checkbox" className="rt-cb" aria-label={tx('people.retention.selectPage')} checked={pageAllOn} disabled={sel.mode === 'matching' || eligibleOnPage.length === 0} onChange={selectPage} /></label></th>
              <th>{tx('pos.customer')}</th><th>{tx('pos.phone')}</th><th>{tx('pos.last_visit_3')}</th><th className="num">{tx('rt2.days')}</th><th className="num">{tx('pos.visits')}</th><th className="num">{tx('pos.lifetime')}</th>
              <th>{tx('rt2.segment')}</th><th>{tx('rt2.priority')}</th><th>{tx('people.retention.smsStatus')}</th><th className="t-opt">{tx('rt2.lastContact')}</th><th>{tx('people.retention.actions')}</th>
            </tr></thead>
            <tbody>{rows.map((r) => {
              const on = isSelected(r); const pickable = canPick(r);
              return (
                <tr key={r.customerId} className={on ? 'sel' : ''} data-testid="rt-row">
                  <td><label className="rt-cbwrap"><input type="checkbox" className="rt-cb" checked={on} disabled={!pickable && !on} onChange={() => toggle(r)} aria-label={tx('people.retention.selectRow', { name: r.customerName || '—' })}
                    title={!pickable ? (r.segment !== 'at_risk' ? tx('rt2.onlyAtRiskSelectable') : smsLabel(r.smsStatus)) : undefined} /></label></td>
                  <td><span className="rt-name"><ProfileAvatarWithPreview name={r.customerName || '—'} url={r.avatarUrl ?? undefined} size={26} type="customer" />
                    <button type="button" className="fk-li-t link" onClick={() => setDlg({ kind: 'customer', id: r.customerId })}>{r.customerName || '—'}</button></span></td>
                  <td>{r.maskedPhone ?? <span className="fk-muted">{tx('people.retention.phoneMissing')}</span>}{r.phoneStatus === 'invalid' ? <span className="fk-muted"> · {tx('people.retention.phoneInvalid')}</span> : null}</td>
                  <td>{r.lastVisitAt ? when(r.lastVisitAt) : <span className="fk-muted">{tx('people.retention.never')}</span>}</td>
                  <td className="num"><b className={r.segment === 'at_risk' ? 'rt-away' : ''}>{r.daysAway == null ? '—' : nf(r.daysAway)}</b></td>
                  <td className="num">{nf(r.visits)}</td>
                  <td className="num">{fmtMoney(r.lifetimeSpendCents)}</td>
                  <td><span className={'fk-chip ' + (SEG_TONE[r.segment] ?? 'mut')}>{segLabel(r.segment === 'never_visited' ? 'never_visited' : r.segment, per)}</span></td>
                  <td>{r.priority ? <button type="button" className={'rt-prio ' + BAND_TONE[r.priority.band]} title={tx('rt2.whyTitle') + ' ' + whyText(r.priority, r)} aria-label={tx('rt2.priorityAria', { n: String(r.priority.score), b: tx('rt2.band.' + r.priority.band) })}
                      onClick={() => setDlg({ kind: 'customer', id: r.customerId })} data-testid="rt-prio"><b>{r.priority.score}</b> {tx('rt2.band.' + r.priority.band)}</button> : <span className="fk-muted">—</span>}</td>
                  <td><span className={'fk-chip ' + (SMS_TONE[r.smsStatus] ?? 'mut')} title={r.nextAppointmentDate ? tx('rt2.bookedFor', { date: fmtYmdSafe(r.nextAppointmentDate) }) : undefined}>{smsIcon(r.smsStatus)}{smsLabel(r.smsStatus)}</span></td>
                  <td className="t-opt">{r.lastOutreachAt ? when(r.lastOutreachAt) : <span className="fk-muted">—</span>}</td>
                  <td><span className="fk-li-acts">
                    <button type="button" className="fk-ibtn" aria-label={tx('pos.open_profile')} title={tx('pos.open_profile')} onClick={() => nav(`/customers?customerId=${encodeURIComponent(r.customerId)}&q=${encodeURIComponent(r.customerName)}`)}>👤</button>
                    <button type="button" className="fk-ibtn" aria-label={tx('people.retention.viewHistory')} title={tx('people.retention.viewHistory')} onClick={() => setDlg({ kind: 'customer', id: r.customerId })}>≡</button>
                    <button type="button" className="fk-ibtn" aria-label={tx('rt3.book.row')} title={tx('rt3.book.row')} onClick={() => book(r.customerId)} data-testid="rt-row-book">📅</button>
                    <button type="button" className="fk-ibtn" aria-label={tx('people.retention.textOne')} title={pickable ? tx('people.retention.textOne') : r.segment !== 'at_risk' ? tx('rt2.onlyAtRiskSelectable') : smsLabel(r.smsStatus)} disabled={!pickable || !!smsBlocked} onClick={() => setDlg({ kind: 'compose', single: r })}>✉</button>
                  </span></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </FitPanel>

      <div className="rt-selbar" data-testid="selection-bar" aria-live="polite">
        <button type="button" className="fk-btn ghost" onClick={selectPage} disabled={sel.mode === 'matching' || eligibleOnPage.length === 0}>{pageAllOn ? tx('people.retention.unselectPage') : tx('people.retention.selectPageN', { n: nf(eligibleOnPage.length) })}</button>
        {sel.mode === 'ids' ? <button type="button" className="fk-btn ghost" disabled={!list || eligibleMatching === 0} onClick={() => setAskAll(true)} data-testid="select-all-matching">{tx('rt2.selectAllEligible', { n: nf(eligibleMatching) })}</button> : null}
        <span className="rt-selcount">
          {sel.mode === 'matching'
            ? tx('people.retention.selectedMatching', { n: nf(selectedCount), seg: segLabel(sel.segment, per) })
            : selectedCount === 0 ? tx('people.retention.noneSelected') : tx('people.retention.selectedN', { n: nf(selectedCount), e: nf(selectedEligible ?? 0) })}
        </span>
        {(sel.mode === 'matching' || selectedCount > 0) ? <button type="button" className="fk-link" onClick={() => setSel(EMPTY_SEL)}>{tx('people.retention.clear')}</button> : null}
        <span className="rt-selspace" />
        {smsBlocked === 'config' ? <span className="fk-hint rt-block">{tx('people.retention.smsNotConfigured')}</span> : smsBlocked === 'perm' ? <span className="fk-hint rt-block">{tx('people.retention.smsNoPermission')}</span> : null}
        <button type="button" className="fk-btn primary" data-testid="send-sms" disabled={!!smsBlocked || selectedCount === 0 || (sel.mode === 'ids' && (selectedEligible ?? 0) === 0)} onClick={() => setDlg({ kind: 'compose' })}>{tx('rt2.previewBulk')}</button>
      </div>

      {askAll && list ? (
        <FitDialog title={tx('people.retention.selectAllMatching')} onClose={() => setAskAll(false)} testId="dlg-select-all"
          footer={<><button type="button" className="fk-btn ghost" onClick={() => setAskAll(false)}>{tx('pos.cancel')}</button>
            <button type="button" className="fk-btn primary" onClick={selectAllMatching} data-testid="select-all-confirm">{tx('people.retention.selectAllConfirm', { n: nf(eligibleMatching) })}</button></>}>
          <p className="rt-p">{tx('rt2.selectAllExplain', { n: nf(eligibleMatching), seg: segLabel(WINBACK.has(segment) ? segment : 'at_risk', per) })}</p>
          {q.trim() ? <p className="fk-hint">{tx('people.retention.selectAllSearch', { q: q.trim() })}</p> : null}
          <p className="fk-hint">{tx('people.retention.selectAllRule')}</p>
        </FitDialog>
      ) : null}
      {dlg?.kind === 'compose' ? <ComposeDialog ready={ready} sel={dlg.single ? { mode: 'ids', ids: new Map([[dlg.single.customerId, dlg.single]]) } : sel} onClose={() => setDlg(null)}
        audience={(dlg.single ? dlg.single.segment === 'never_visited' : segment === 'never') ? 'first_visit' : 'win_back'}
        onQueued={(r) => { setDlg(canViewCampaigns ? { kind: 'campaign', id: r.campaignId } : null); if (!dlg.single) setSel(EMPTY_SEL); setNote({ tone: 'ok', text: r.duplicate ? tx('people.retention.alreadyQueued') : tx('people.retention.queuedNote', { n: nf(r.queued) }) }); setReload((n) => n + 1); }} /> : null}
      {dlg?.kind === 'customer' ? <CustomerDialog id={dlg.id} onClose={() => setDlg(null)} openProfile={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)}
        book={book} canText={!smsBlocked} canNote={can('pos.customers.notes.edit')} onText={(r) => setDlg({ kind: 'compose', single: r })}
        openCampaign={canViewCampaigns ? (id) => setDlg({ kind: 'campaign', id }) : undefined} /> : null}
      {dlg?.kind === 'campaigns' ? <CampaignsDialog onClose={() => setDlg(null)} onOpen={(id) => setDlg({ kind: 'campaign', id })} /> : null}
      {dlg?.kind === 'campaign' ? <CampaignDialog id={dlg.id} canCancel={can('marketing.manage')} onClose={() => setDlg(null)} onBack={() => setDlg({ kind: 'campaigns' })} /> : null}
      {dlg?.kind === 'recovery' ? <RecoveryDialog period={pq} onClose={() => setDlg(null)} openCustomer={(id) => setDlg({ kind: 'customer', id })} openCampaign={canViewCampaigns ? (id) => setDlg({ kind: 'campaign', id }) : undefined} /> : null}
      {dlg?.kind === 'health' ? <HealthDialog onClose={() => setDlg(null)} openCustomer={(id) => setDlg({ kind: 'customer', id })} /> : null}
      {dlg?.kind === 'assistant' ? <AssistantDialog onClose={() => setDlg(null)} canManage={can('marketing.manage')} /> : null}
      {dlg?.kind === 'history' ? <HistoryDialog onClose={() => setDlg(null)} canBackfill={canEditSettings} openCustomer={(id) => setDlg({ kind: 'customer', id })} branches={scope?.branches ?? []} /> : null}
      {dlg?.kind === 'settings' ? <SettingsDialog canPricing={canViewCampaigns} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); setNote({ tone: 'ok', text: tx('rt2.settingsSaved') }); refresh(); }} /> : null}
    </div>
  );
}

// ── compose → preview → confirm ────────────────────────────────────────────────────────────────────────────────────────
type Preview = { previewId: string; finalBody: string; segments: { segments: number; encoding: string; characters: number }; selected: number; eligible: number; excluded: number; excludedReasons: Record<string, number>;
  sender: Readiness['sender']; canSend: boolean; blockedReason: string | null; quietHours: { deferredUntil: string; start: number; end: number } | null; estimatedSegments: number; costEstimateCents: number | null; estimate?: Estimate;
  roster: { customerId: string; customerName: string; maskedPhone: string | null; eligibility: string }[]; expiresInMinutes: number };

function ComposeDialog({ ready, sel, onClose, onQueued, audience = 'win_back' }: { ready: Readiness | null; sel: Selection; onClose: () => void; onQueued: (r: { campaignId: string; queued: number; duplicate: boolean }) => void; audience?: 'win_back' | 'first_visit' }) {
  const [body, setBody] = useState(''); const [label, setLabel] = useState('');
  // C5 audit (Nov 4 2026) §12.2: start from one of the salon's active SMS templates (follow-up / promotions / general). A
  // {placeholder} must be replaced before preview — a campaign sends the same words to everyone (the server refuses it).
  const [tpls, setTpls] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => { posMessageTemplatesApi.list({ channel: 'sms', status: 'active', page: 1, pageSize: 50 })
    .then((r) => setTpls((r.items ?? []).filter((x) => ['customer_follow_up', 'promotions', 'general'].includes(String(x.category))).map((x) => ({ id: x.id, name: x.name }))), () => setTpls([])); }, []);
  const applyTemplate = async (id: string) => { if (!id) return; try { const d = await posMessageTemplatesApi.detail(id); setBody(String(d.template.body ?? '').replace(/\{\{?\s*salon_?name\s*\}?\}/gi, '').trim()); } catch { /* the message stays as typed */ } };
  const placeholders = /\{\{?\s*[a-z_][a-z0-9_.]*\s*\}?\}/i.test(body);
  const [pv, setPv] = useState<Preview | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [changed, setChanged] = useState<{ noLongerEligible: number; stillEligible: number; reasons: Record<string, number> } | null>(null);
  const [showRoster, setShowRoster] = useState(false);
  const key = useRef(requestId());
  const count = sel.mode === 'ids' ? sel.ids.size : Math.max(0, sel.total - sel.excludeIds.size);
  const doPreview = async () => {
    setBusy(true); setErr(null); setChanged(null);
    try {
      const p = await posRetentionApi.preview(sel.mode === 'ids' ? { customerIds: [...sel.ids.keys()], body, label: label.trim() || undefined, audience }
        : { selection: { ...sel.filter, excludeIds: [...sel.excludeIds] }, body, label: label.trim() || undefined, audience });
      setPv(p); key.current = requestId();
    } catch (e) { setErr(errText(e, tx('people.retention.previewFailed'))); } finally { setBusy(false); }
  };
  const doConfirm = async (acceptChanges = false) => {
    if (!pv || busy) return; setBusy(true); setErr(null);
    try { const r = await posRetentionApi.confirm({ previewId: pv.previewId, idempotencyKey: key.current, acceptChanges, label: label.trim() || undefined }); onQueued({ campaignId: r.campaignId, queued: Number(r.queued || 0), duplicate: !!r.duplicate }); }
    catch (e: any) {
      if (e?.code === 'SMS_AUDIENCE_CHANGED') { const d = errDetails(e); setChanged({ noLongerEligible: Number(d.noLongerEligible || 0), stillEligible: Number(d.stillEligible || 0), reasons: d.reasons || {} }); }
      else if (e?.code === 'SMS_PREVIEW_EXPIRED') { setPv(null); setErr(tx('people.retention.previewExpired')); }
      else setErr(errText(e, tx('people.retention.sendFailed')));
      key.current = requestId();
    } finally { setBusy(false); }
  };
  const sender = pv?.sender ?? ready?.sender;
  const senderText = !sender ? '…' : sender.route === 'tenant_account' ? tx('people.retention.sender.tenant', { from: sender.from ?? '' }) : sender.route === 'shared' ? tx('people.retention.sender.shared', { from: sender.from ?? '' })
    : sender.route === 'simulated' ? tx('people.retention.sender.simulated') : tx('people.retention.smsNotConfigured');
  const len = body.trim().length;
  return (
    <FitDialog wide title={audience === 'first_visit' ? tx('rt2.fv.title') : tx('people.retention.composeTitle')} subtitle={<>{pv ? tx('people.retention.previewCounts', { s: nf(pv.selected), e: nf(pv.eligible), x: nf(pv.excluded) }) : tx('people.retention.composeCount', { n: nf(count) })} · {senderText}</>}
      onClose={onClose} busy={busy} testId="dlg-compose"
      footer={<>
        <span className="rt-steps" aria-hidden>{['select', 'preview', 'confirm', 'queue', 'results'].map((s, i) => <span key={s} className={i <= (pv ? 2 : 1) ? 'on' : ''}>{i + 1}. {tx(`people.retention.step.${s}`)}</span>)}</span>
        <button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        {!pv ? <button type="button" className="fk-btn primary" disabled={busy || len < 5 || placeholders} onClick={doPreview} data-testid="sms-preview">{busy ? tx('pos.loading') : tx('people.retention.preview')}</button> : <>
          <button type="button" className="fk-btn ghost" disabled={busy} onClick={() => setPv(null)}>{tx('people.retention.editMessage')}</button>
          {changed ? <button type="button" className="fk-btn primary" disabled={busy || changed.stillEligible === 0} onClick={() => doConfirm(true)} data-testid="sms-confirm-changed">{tx('people.retention.confirmChanged', { n: nf(changed.stillEligible) })}</button>
            : <button type="button" className="fk-btn primary" disabled={busy || !pv.canSend} onClick={() => doConfirm(false)} data-testid="sms-confirm">{busy ? tx('pos.saving_2') : tx('people.retention.confirmSend', { n: nf(pv.eligible) })}</button>}
        </>}
      </>}>
      {audience === 'first_visit' ? <div className="fk-note info" data-testid="fv-note"><span>{tx('rt2.fv.note')}</span></div> : null}
      {!pv ? <>
        {tpls && tpls.length ? <label className="fk-field"><span>{tx('rt5.template')}</span><select defaultValue="" onChange={(e) => void applyTemplate(e.target.value)} data-testid="rt-template"><option value="">{tx('rt5.templateNone')}</option>{tpls.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label> : null}
        <label className="fk-field"><span>{tx('people.retention.message')}</span><textarea data-autofocus value={body} maxLength={560} onChange={(e) => setBody(e.target.value)} placeholder={tx('people.retention.messagePlaceholder')} /></label>
        {placeholders ? <div className="fk-err" role="note" data-testid="rt-placeholders">{tx('rt5.placeholders')}</div> : null}
        <div className="fk-hint">{tx('people.retention.messageRules', { n: String(len) })}</div>
        <label className="fk-field"><span>{tx('people.retention.label')}</span><input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder={tx('people.retention.labelPlaceholder')} /></label>
        <div className="fk-hint">{tx('people.retention.composeSafety')}</div>
      </> : <>
        <div className="rt-final"><div className="rt-final-h">{tx('people.retention.finalText')}</div><div className="rt-bubble">{pv.finalBody}</div>
          <div className="fk-hint">{tx('people.retention.segmentsInfo', { c: nf(pv.segments.characters), s: nf(pv.segments.segments), enc: pv.segments.encoding, total: nf(pv.estimatedSegments) })}</div></div>
        <EstimateBlock e={pv.estimate} />
        <div className="rt-counts">
          <div><b>{nf(pv.selected)}</b><span>{tx('people.retention.c.selected')}</span></div>
          <div className="ok"><b>{nf(pv.eligible)}</b><span>{tx('people.retention.c.eligible')}</span></div>
          <div className="mut"><b>{nf(pv.excluded)}</b><span>{tx('people.retention.c.excluded')}</span></div>
        </div>
        {Object.keys(pv.excludedReasons).length ? <ul className="rt-reasons">{Object.entries(pv.excludedReasons).map(([k2, n]) => <li key={k2}><span>{smsLabel(k2)}</span><b>{nf(n)}</b></li>)}</ul> : null}
        {pv.quietHours ? <div className="fk-preview">{tx('people.retention.quietDeferred', { at: whenTime(pv.quietHours.deferredUntil) })}</div> : null}
        {pv.sender.route === 'simulated' ? <div className="fk-preview">{tx('people.retention.simulatedNote')}</div> : null}
        {!pv.canSend ? <div className="fk-err">{pv.blockedReason === 'SMS_NOT_CONFIGURED' ? tx('people.retention.smsNotConfigured') : tx('people.retention.nobodyEligible')}</div> : null}
        {changed ? <div className="fk-err" role="alert">{tx('people.retention.audienceChanged', { n: nf(changed.noLongerEligible), still: nf(changed.stillEligible) })}{Object.keys(changed.reasons).length ? ' (' + Object.entries(changed.reasons).map(([r, n]) => `${smsLabel(r)}: ${n}`).join(', ') + ')' : ''}</div> : null}
        <button type="button" className="fk-link" onClick={() => setShowRoster((v) => !v)} aria-expanded={showRoster}>{showRoster ? tx('people.retention.hideRoster') : tx('people.retention.showRoster')}</button>
        {showRoster ? <ul className="fk-list dense rt-roster">{pv.roster.map((r) => <li key={r.customerId} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{r.customerName || '—'}</span><span className="fk-li-s">{r.maskedPhone ?? tx('people.retention.phoneMissing')}</span></div><span className={'fk-chip ' + (r.eligibility === 'eligible' ? 'ok' : 'mut')}>{smsLabel(r.eligibility)}</span></li>)}
          {pv.selected > pv.roster.length ? <li className="fk-hint">{tx('people.retention.rosterMore', { n: nf(pv.selected - pv.roster.length) })}</li> : null}</ul> : null}
        <div className="fk-hint">{tx('people.retention.confirmRule', { m: String(pv.expiresInMinutes) })}</div>
      </>}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

// ── one customer's retention snapshot (guide §14): why the segment · visit evidence · upcoming bookings · consent · outreach
function CustomerDialog({ id, onClose, openProfile, book, canText, canNote = false, onText, openCampaign }: { id: string; onClose: () => void; openProfile: (id: string, name: string) => void; book: (id: string) => void;
  canText: boolean; canNote?: boolean; onText: (r: Row) => void; openCampaign?: (id: string) => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  // C5 audit (Nov 4 2026) §14 Add Note: a dated line appended to the customer's salon notes (the same notes the profile shows)
  const [noteOpen, setNoteOpen] = useState(false); const [noteText, setNoteText] = useState(''); const [noteBusy, setNoteBusy] = useState(false); const [noteMsg, setNoteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saveNote = async () => {
    const text = noteText.trim(); if (!text || !d) return;
    setNoteBusy(true); setNoteMsg(null);
    try {
      const cur = (await posCustomersApi.getNotes(d.customerId)) || {};
      const line = `${new Date().toISOString().slice(0, 10)} · ${tx('rt5.noteSource')}: ${text}`;
      await posCustomersApi.setNotes(d.customerId, { ...cur, salonNotes: cur.salonNotes ? `${String(cur.salonNotes).trimEnd()}\n${line}` : line });
      setNoteText(''); setNoteOpen(false); setNoteMsg({ ok: true, text: tx('rt5.noteSaved') });
    } catch (e) { setNoteMsg({ ok: false, text: errText(e, tx('rt5.noteFailed')) }); } finally { setNoteBusy(false); }
  };
  useEffect(() => { posRetentionApi.customer(id).then(setD).catch((e) => setErr(errText(e, tx('people.retention.loadFailed')))); }, [id]);
  const p = d ? { riskDays: d.thresholds?.riskDays ?? 60, approachingDays: d.thresholds?.approachingDays ?? 45 } as Period : null;
  const textable = d && d.smsStatus === 'eligible' && d.segment === 'at_risk';
  return (
    <FitDialog wide title={d?.customerName || tx('pos.customer')} subtitle={d ? <>{segLabel(d.segment, p)} · {tx('rt2.asOf', { date: fmtYmdSafe(d.asOf) })} · {tx('rt2.idShort', { id: String(d.customerId).slice(0, 8) })}</> : undefined} onClose={onClose} testId="dlg-customer"
      footer={<>{d ? <>
        <button type="button" className="fk-btn ghost" onClick={() => openProfile(d.customerId, d.customerName)}>{tx('pos.open_profile')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => book(d.customerId)} data-testid="rt-book">{tx('rt2.book')}</button>
        {canNote ? <button type="button" className="fk-btn ghost" onClick={() => setNoteOpen((v) => !v)} data-testid="rt-add-note">{tx('rt5.addNote')}</button> : null}
        <button type="button" className="fk-btn ghost" disabled={!textable || !canText} title={!textable ? (d.segment !== 'at_risk' ? tx('rt2.onlyAtRiskSelectable') : smsLabel(d.smsStatus)) : undefined} onClick={() => onText(d as Row)} data-testid="rt-text-one">{tx('people.retention.textOne')}</button>
      </> : null}<button type="button" className="fk-btn primary" onClick={onClose} data-testid="rt-customer-close">{tx('pos.close')}</button></>}>
      {noteOpen ? <div className="fk-row" data-testid="rt-note-form"><textarea className="fk-in" rows={2} maxLength={1000} value={noteText} onChange={(e) => setNoteText(e.target.value)} aria-label={tx('rt5.addNote')} placeholder={tx('rt5.notePh')} data-testid="rt-note-text" />
        <button type="button" className="fk-btn primary sm" disabled={noteBusy || !noteText.trim()} onClick={() => void saveNote()} data-testid="rt-note-save">{tx('rt5.noteSave')}</button></div> : null}
      {noteMsg ? <div className={noteMsg.ok ? 'fk-ok' : 'fk-err'} role="status">{noteMsg.text}</div> : null}
      {err ? <div className="fk-err">{err}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : <div className="rt-cust">
        <section>
          <div className={'rt-why ' + (SEG_TONE[d.segment] ?? '')} data-testid="rt-segment-reason"><b>{segLabel(d.segment, p)}</b> — {tx('rt2.reason.' + d.segmentReason.code, { d: nf(d.daysAway ?? 0), r: String(d.thresholds.riskDays), a: String(d.thresholds.approachingDays) })}</div>
          {d.priority ? <div className="rt-why" data-testid="rt-priority-why"><b>{tx('rt2.whyTitle')}</b> {d.priority.score} · {tx('rt2.band.' + d.priority.band)} — {whyText(d.priority, d)}
            <div className="fk-hint">{tx('rt2.priorityParts', { i: String(d.priority.components.inactivity), f: String(d.priority.components.frequency), s: String(d.priority.components.spend), v: d.priority.formulaVersion })}</div></div> : null}
          <dl className="fk-dl">
            <dt>{tx('rt2.firstVisit')}</dt><dd>{d.firstVisitAt ? when(d.firstVisitAt) : tx('people.retention.never')}</dd>
            <dt>{tx('pos.last_visit_3')}</dt><dd>{d.lastVisitAt ? when(d.lastVisitAt) : tx('people.retention.never')}</dd>
            <dt>{tx('people.retention.daysAway')}</dt><dd>{d.daysAway == null ? '—' : nf(d.daysAway)}</dd>
            <dt>{tx('rt2.completedVisits')}</dt><dd>{nf(d.visits)}</dd>
            <dt>{tx('pos.lifetime')}</dt><dd>{fmtMoney(d.lifetimeSpendCents)} <span className="fk-muted">· {tx('people.retention.netRefunds')}</span></dd>
            <dt>{tx('pos.phone')}</dt><dd>{d.maskedPhone ?? tx('people.retention.phoneMissing')}</dd>
            <dt>{tx('people.retention.consent')}</dt><dd>{d.marketingSmsConsent ? tx('people.retention.consentYes', { date: when(d.consentUpdatedAt) }) : tx('people.retention.consentNo')}</dd>
            <dt>{tx('people.retention.smsStatus')}</dt><dd><span className={'fk-chip ' + (SMS_TONE[d.smsStatus] ?? 'mut')}>{smsIcon(d.smsStatus)}{smsLabel(d.smsStatus)}</span></dd>
            <dt>{tx('rt2.lastBooking')}</dt><dd>{d.lastBooking ? `${fmtYmdSafe(d.lastBooking.date)} · ${tx('rt2.appt.' + d.lastBooking.status)}` : '—'}</dd>
            <dt>{tx('wb.ov.emailConsent')}</dt><dd data-testid="rt-email-consent">{d.marketingEmailConsent ? tx('wb.yes') : tx('wb.no')}{d.maskedEmail ? ` · ${d.maskedEmail}` : ''}</dd>
            {d.refunds ? <><dt>{tx('wb.ov.refunds')}</dt><dd>{tx('wb.ov.refundsVal', { n: nf(d.refunds.count), c: fmtMoney(d.refunds.cents) })}</dd></> : null}
          </dl>
          <h3 className="fk-h3">{tx('rt2.upcoming')}</h3>
          {d.upcomingBookings.length === 0 ? <div className="fk-hint">{tx('rt2.noUpcoming')}</div> : <ul className="fk-list dense" data-testid="rt-upcoming">{d.upcomingBookings.map((a: any) => (
            <li key={a.appointmentId} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{fmtYmdSafe(a.date)} · {a.startTime}</span><span className="fk-li-s">{a.services || '—'}</span></div><span className="fk-chip info">{tx('rt2.appt.' + a.status)}</span></li>))}</ul>}
        </section>
        <section>
          <h3 className="fk-h3">{tx('rt2.visitEvidence')}</h3>
          {d.visitEvidence.length === 0 ? <div className="fk-hint">{tx('rt2.noVisits')}</div> : <ul className="fk-list dense" data-testid="rt-visits">{d.visitEvidence.map((v: any) => (
            <li key={v.ticketId} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{when(v.at)}{v.ticketNumber ? ` · #${v.ticketNumber}` : ''}</span><span className="fk-li-s">{v.services || '—'}</span></div><b>{fmtMoney(v.totalCents)}</b></li>))}</ul>}
          <h3 className="fk-h3">{tx('wb.ov.comms')}</h3>
          {!d.communications?.length ? <div className="fk-hint">{tx('wb.ov.noComms')}</div> : <ul className="fk-list dense" data-testid="rt-comms">{d.communications.map((c: any) => (
            <li key={c.id} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{String(c.channel).toUpperCase()}{c.purpose ? ` · ${c.purpose}` : ''}</span><span className="fk-li-s">{whenTime(c.at)}{c.failure ? ` · ${c.failure}` : ''}</span></div>
              <span className={'fk-chip ' + (c.state === 'delivered' ? 'ok' : c.state === 'failed' ? 'bad' : c.state === 'skipped' ? 'mut' : 'info')}>{tx('wb.ov.state.' + c.state)}</span></li>))}</ul>}
          <h3 className="fk-h3">{tx('people.retention.outreach')}</h3>
          {d.outreach.length === 0 ? <div className="fk-hint">{tx('people.retention.noOutreach')}</div> : <ul className="fk-list dense">{d.outreach.map((o: any, i: number) => (
            <li key={o.campaignId + i} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{whenTime(o.at)}</span>{o.label ? <span className="fk-li-s">{o.label}</span> : null}</div><span className={'fk-chip ' + (RECIP_TONE[o.status] ?? 'mut')}>{recipLabel(o.status)}</span>
              {openCampaign ? <button type="button" className="fk-link" onClick={() => openCampaign(o.campaignId)}>{tx('people.loyalty.details')}</button> : null}</li>
          ))}</ul>}
        </section>
      </div>}
    </FitDialog>
  );
}

// ── Recovery tracking + Retention trend (guide §13): observed returns, never claimed as caused by a text ─────────────────
function RecoveryDialog({ period, onClose, openCustomer, openCampaign }: { period: { preset: string; from?: string; to?: string }; onClose: () => void; openCustomer: (id: string) => void; openCampaign?: (id: string) => void }) {
  const [page, setPage] = useState(1); const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(period);
  useEffect(() => { let alive = true; setErr(null); posRetentionApi.recovery({ ...JSON.parse(key), page, pageSize: 6 }).then((r) => alive && setD(r)).catch((e) => alive && setErr(errText(e, tx('people.retention.loadFailed')))); return () => { alive = false; }; }, [key, page]);
  const t = d?.totals; const per: Period | undefined = d?.period;
  const maxV = Math.max(1, ...((d?.trend ?? []) as Array<{ visited: number }>).map((m) => m.visited));
  return (
    <FitDialog wide title={tx('rt2.recovery')} subtitle={per ? tx('rt2.periodLine', { from: fmtYmdSafe(per.from), to: fmtYmdSafe(per.to), d: String(per.riskDays), w: String(per.observationWindowDays) }) : undefined} onClose={onClose} testId="dlg-recovery"
      footer={<><Pager info={d?.returns} onPage={setPage} /><button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></>}>
      {err ? <div className="fk-err">{err}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="rt-counts four" data-testid="rt-recovery-totals">
          <div className="ok"><b>{nf(t.recoveredCustomers)}</b><span>{tx('rt2.rec.customers')}</span></div>
          <div><b>{nf(t.returnVisits)}</b><span>{tx('rt2.rec.visits')}</span></div>
          <div><b>{fmtMoney(t.observedReturnRevenueCents)}</b><span>{tx('rt2.rec.revenue')}</span></div>
          <div><b>{nf(t.campaignObserved.customers)}</b><span>{tx('rt2.rec.campaign', { s: fmtMoney(t.campaignObserved.revenueCents) })}</span></div>
        </div>
        <div className="fk-hint">{tx('rt2.rec.def', { d: String(per!.riskDays), w: String(per!.observationWindowDays) })} {t.campaignObserved.avgDaysToReturn != null ? tx('rt2.rec.avgDays', { n: String(t.campaignObserved.avgDaysToReturn) }) : ''} {tx('rt2.rec.unmessaged', { n: nf(t.unmessagedRecovered) })}</div>
        <div className="rt-two">
          <section>
            <h3 className="fk-h3">{tx('rt2.trend')}</h3>
            <table className="fk-table rt-trend" data-testid="rt-trend"><thead><tr><th>{tx('rt2.month')}</th><th>{tx('rt2.visitedBar')}</th><th className="num">{tx('pos.returning_rate')}</th><th className="num">{tx('rt2.seg.recovered')}</th></tr></thead>
              <tbody>{d.trend.map((m: any) => <tr key={m.month}><td>{fmtYmdSafe(m.month + '-01').replace(/\s\d+,/, '')}</td>
                <td><span className="rt-bar" aria-hidden><i style={{ width: `${(m.visited / maxV) * 100}%` }} /><i className="ret" style={{ width: `${(m.returning / maxV) * 100}%` }} /></span> <span className="fk-muted">{nf(m.returning)}/{nf(m.visited)}</span></td>
                <td className="num">{m.returningRatePercent == null ? tx('rt2.na') : `${m.returningRatePercent}%`}</td><td className="num">{nf(m.recovered)}</td></tr>)}</tbody></table>
          </section>
          <section>
            <h3 className="fk-h3">{tx('rt2.byCampaign')}</h3>
            {d.campaigns.length === 0 ? <div className="fk-hint">{tx('rt2.noCampaignsInPeriod')}</div> : <table className="fk-table" data-testid="rt-rec-campaigns"><thead><tr><th>{tx('people.retention.campaign')}</th><th className="num">{tx('people.retention.c.sent')}</th><th className="num">{tx('people.retention.c.delivered')}</th><th className="num">{tx('rt2.bookedAfter')}</th><th className="num">{tx('rt2.returned')}</th><th className="num">{tx('rt2.rec.revenueShort')}</th></tr></thead>
              <tbody>{d.campaigns.map((c: any) => <tr key={c.campaignId}><td>{openCampaign ? <button type="button" className="fk-link" onClick={() => openCampaign(c.campaignId)}>{c.label || tx('people.retention.campaignN', { id: c.campaignId.slice(0, 8) })}</button> : (c.label || c.campaignId.slice(0, 8))}<div className="fk-muted">{when(c.confirmedAt)}</div></td>
                <td className="num">{nf(c.sent)}</td><td className="num">{nf(c.delivered)}</td><td className="num">{nf(c.bookedAfterContact)}</td><td className="num">{nf(c.returnedCustomers)}</td><td className="num">{fmtMoney(c.returnRevenueCents)}</td></tr>)}</tbody></table>}
          </section>
        </div>
        <h3 className="fk-h3">{tx('rt2.returnVisits')}</h3>
        {d.returns.items.length === 0 ? <Empty title={tx('rt2.empty.recovered')} /> : <table className="fk-table" data-testid="rt-returns"><thead><tr><th>{tx('pos.customer')}</th><th>{tx('rt2.returnedOn')}</th><th className="num">{tx('rt2.awayBefore')}</th><th className="num">{tx('rt2.rec.revenueShort')}</th><th>{tx('rt2.afterText')}</th></tr></thead>
          <tbody>{d.returns.items.map((x: any) => <tr key={x.ticketId}><td><button type="button" className="fk-link" onClick={() => openCustomer(x.customerId)}>{x.customerName || '—'}</button></td><td>{when(x.returnedAt)}{x.ticketNumber ? ` · #${x.ticketNumber}` : ''}</td>
            <td className="num">{nf(x.daysAwayBefore)}</td><td className="num">{fmtMoney(x.netCents)}</td><td>{x.campaignId ? tx('rt2.afterTextYes', { date: when(x.messageSentAt) }) : <span className="fk-muted">{tx('rt2.afterTextNo')}</span>}</td></tr>)}</tbody></table>}
      </>}
    </FitDialog>
  );
}

// ── the salon's thresholds (guide §05): audited, versioned; only pos.settings.edit may change them ────────────────────────
function SettingsDialog({ onClose, onSaved, canPricing }: { onClose: () => void; onSaved: () => void; canPricing: boolean }) {
  const [s, setS] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [risk, setRisk] = useState(''); const [appr, setAppr] = useState(''); const [obs, setObs] = useState('');
  const load = useCallback(() => { setErr(null); posRetentionApi.settings().then((r) => { setS(r); setRisk(String(r.riskDays)); setAppr(String(r.approachingDays)); setObs(String(r.observationWindowDays)); }).catch((e) => setErr(errText(e, tx('people.retention.loadFailed')))); }, []);
  useEffect(() => { load(); }, [load]);
  const r = Number(risk), a = Number(appr), o = Number(obs);
  const invalid = !Number.isInteger(r) || r < 14 || r > 730 ? 'risk' : !Number.isInteger(a) || a < 7 || a >= r ? 'approaching' : !Number.isInteger(o) || o < 1 || o > 180 ? 'window' : null;
  const save = async () => {
    if (!s || invalid || busy) return; setBusy(true); setErr(null);
    try { await posRetentionApi.saveSettings({ riskDays: r, approachingDays: a, observationWindowDays: o, expectedVersion: s.version }); onSaved(); }
    catch (e: any) { if (e?.code === 'SETTINGS_VERSION_CONFLICT') { setErr(tx('rt2.settingsConflict')); load(); } else setErr(errText(e, tx('rt2.settingsFailed'))); } finally { setBusy(false); }
  };
  const ro = !s?.canEdit;
  return (
    <FitDialog title={tx('rt2.settings')} subtitle={s ? (s.isDefault ? tx('rt2.settingsDefault') : tx('rt2.settingsVersion', { v: String(s.version), date: when(s.updatedAt) })) : undefined} onClose={onClose} busy={busy} testId="dlg-settings"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        {!ro ? <button type="button" className="fk-btn primary" onClick={save} disabled={!s || !!invalid || busy} data-testid="settings-save">{busy ? tx('pos.saving_2') : tx('pos.save')}</button> : null}</>}>
      {!s && !err ? <div className="fk-loading">{tx('pos.loading')}</div> : null}
      {s ? <>
        <label className="fk-field"><span>{tx('rt2.set.risk')}</span><input type="number" inputMode="numeric" min={14} max={730} value={risk} disabled={ro} onChange={(e) => setRisk(e.target.value)} data-testid="set-risk" /></label>
        <label className="fk-field"><span>{tx('rt2.set.approaching')}</span><input type="number" inputMode="numeric" min={7} max={729} value={appr} disabled={ro} onChange={(e) => setAppr(e.target.value)} data-testid="set-approaching" /></label>
        <label className="fk-field"><span>{tx('rt2.set.window')}</span><input type="number" inputMode="numeric" min={1} max={180} value={obs} disabled={ro} onChange={(e) => setObs(e.target.value)} data-testid="set-window" /></label>
        {invalid ? <div className="fk-err" role="alert">{tx('rt2.set.invalid.' + invalid)}</div> : null}
        <div className="fk-hint">{tx('rt2.set.help')}</div>
        {ro ? <div className="fk-hint warn">{tx('rt2.set.readOnly')}</div> : null}
      </> : null}
      {canPricing ? <PricingSection /> : null}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function CampaignsDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1); const [d, setD] = useState<Paged<any> | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let alive = true; posRetentionApi.campaigns({ page, pageSize: 8 }).then((r) => alive && setD(r)).catch((e) => alive && setErr(errText(e, tx('people.retention.loadFailed')))); return () => { alive = false; }; }, [page]);
  return (
    <FitDialog wide title={tx('people.retention.campaignHistory')} subtitle={tx('people.retention.campaignsSub')} onClose={onClose} testId="dlg-campaigns"
      footer={<><Pager info={d} onPage={setPage} /><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      {err ? <div className="fk-err">{err}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : d.items.length === 0 ? <Empty title={tx('people.retention.noCampaigns')} /> : (
        <table className="fk-table"><thead><tr><th>{tx('people.loyalty.when')}</th><th>{tx('people.retention.campaign')}</th><th>{tx('pos.status')}</th><th className="num">{tx('people.retention.c.queued')}</th><th className="num">{tx('people.retention.c.sent')}</th><th className="num">{tx('people.retention.c.delivered')}</th><th className="num">{tx('people.retention.c.failed')}</th><th /></tr></thead>
          <tbody>{d.items.map((c: any) => <tr key={c.id}><td>{whenTime(c.confirmedAt ?? c.createdAt)}</td><td>{c.label || `#${c.id.slice(0, 8)}`}</td><td><span className="fk-chip info">{campaignLabel(c.status)}</span></td>
            <td className="num">{nf(c.queued)}</td><td className="num">{nf((c.counts.sent || 0) + (c.counts.simulated || 0))}</td><td className="num">{nf(c.counts.delivered || 0)}</td><td className="num">{nf((c.counts.failed || 0) + (c.counts.undelivered || 0) + (c.counts.blocked || 0))}</td>
            <td><button type="button" className="fk-link" onClick={() => onOpen(c.id)}>{tx('people.loyalty.details')}</button></td></tr>)}</tbody></table>
      )}
    </FitDialog>
  );
}

function CampaignDialog({ id, canCancel = false, onClose, onBack }: { id: string; canCancel?: boolean; onClose: () => void; onBack: () => void }) {
  // C5 audit (Nov 4 2026): Cancel Campaign — a reason, then every unsent text stops (sent texts stay sent)
  const [cancelOpen, setCancelOpen] = useState(false); const [why, setWhy] = useState(''); const [cancelBusy, setCancelBusy] = useState(false); const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [page, setPage] = useState(1); const [status, setStatus] = useState(''); const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [tick, setTick] = useState(0);
  useEffect(() => { let alive = true; setErr(null); posRetentionApi.campaign(id, { page, pageSize: 8, status: status || undefined }).then((r) => alive && setD(r)).catch((e) => alive && setErr(errText(e, tx('people.retention.loadFailed')))); return () => { alive = false; }; }, [id, page, status, tick]);
  const c = d?.campaign; const counts: Record<string, number> = c?.counts ?? {};
  const live = c && ['queued', 'sending'].includes(c.status);
  useEffect(() => { if (!live) return; const t = setTimeout(() => setTick((n) => n + 1), 5000); return () => clearTimeout(t); }, [live, tick]);
  const STAT = useMemo(() => ['queued', 'sent', 'delivered', 'undelivered', 'blocked', 'failed', 'unknown', 'excluded'], []);
  return (
    <FitDialog wide title={c ? (c.label || tx('people.retention.campaignN', { id: c.id.slice(0, 8) })) : tx('people.retention.campaign')} subtitle={c ? `${campaignLabel(c.status)} · ${whenTime(c.confirmedAt ?? c.createdAt)}${c.senderFrom ? ' · ' + tx('people.retention.fromNumber', { from: c.senderFrom }) : ''}` : undefined} onClose={onClose} testId="dlg-campaign"
      footer={<><Pager info={d?.recipients} onPage={setPage} /><button type="button" className="fk-btn ghost" onClick={onBack}>{tx('people.retention.allCampaigns')}</button><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      {err ? <div className="fk-err">{err}</div> : !c ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="rt-bubble small">{c.body}</div>
        <div className="rt-stat-row">
          <button type="button" className={'rt-stat' + (!status ? ' on' : '')} onClick={() => { setStatus(''); setPage(1); }}><b>{nf(c.selected)}</b><span>{tx('people.retention.c.selected')}</span></button>
          {STAT.map((s) => <button type="button" key={s} className={'rt-stat ' + (RECIP_TONE[s] ?? '') + (status === s ? ' on' : '')} onClick={() => { setStatus(s); setPage(1); }}><b>{nf(counts[s] || 0)}</b><span>{recipLabel(s)}</span></button>)}
        </div>
        {live ? <div className="fk-hint">{tx('people.retention.liveNote')}</div> : null}
        {live && canCancel ? (!cancelOpen ? <button type="button" className="fk-btn ghost sm" onClick={() => setCancelOpen(true)} data-testid="campaign-cancel">{tx('rt5.cancel')}</button> : (
          <div className="fk-row" data-testid="campaign-cancel-form">
            <input className="fk-in" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={tx('rt5.cancelReason')} aria-label={tx('rt5.cancelReason')} maxLength={300} data-testid="campaign-cancel-reason" />
            <button type="button" className="fk-btn danger sm" disabled={cancelBusy || why.trim().length < 3} data-testid="campaign-cancel-confirm"
              onClick={async () => { setCancelBusy(true); setCancelErr(null); try { await posRetentionApi.cancelCampaign(c.id, why.trim()); setCancelOpen(false); setWhy(''); setTick((n) => n + 1); } catch (e) { setCancelErr(errText(e, tx('rt5.cancelFailed'))); } finally { setCancelBusy(false); } }}>{tx('rt5.cancelConfirm')}</button>
            <button type="button" className="fk-btn ghost sm" onClick={() => setCancelOpen(false)}>{tx('pos.cancel')}</button>
          </div>))
          : null}
        {cancelErr ? <div className="fk-err">{cancelErr}</div> : null}
        <div className="fk-hint">{tx('people.retention.statusRule')}</div>
        {d.recipients.items.length === 0 ? <Empty title={tx('people.fit.noMatch')} /> : (
          <table className="fk-table"><thead><tr><th>{tx('pos.customer')}</th><th>{tx('pos.phone')}</th><th>{tx('pos.status')}</th><th>{tx('people.retention.detail')}</th><th>{tx('people.retention.sentAt')}</th></tr></thead>
            <tbody>{d.recipients.items.map((r: any) => <tr key={r.id}><td>{r.customerName || '—'}</td><td>{r.maskedPhone ?? '—'}</td>
              <td><span className={'fk-chip ' + (RECIP_TONE[r.status] ?? 'mut')}>{recipLabel(r.status)}</span></td>
              <td className="fk-muted">{r.status === 'excluded' ? smsLabel(r.eligibility) : r.error ? smsLabel(r.error) : r.providerId ?? '—'}</td>
              <td>{r.deliveredAt ? whenTime(r.deliveredAt) : r.sentAt ? whenTime(r.sentAt) : r.queuedAt ? whenTime(r.queuedAt) : '—'}</td></tr>)}</tbody></table>
        )}
      </>}
    </FitDialog>
  );
}

// ── CR-03 the SMS cost estimate (server-computed; never a guessed $0) ────────────────────────────────────────────────────
type Estimate = { status: 'estimated' | 'price_unknown'; recipients: number; segmentsPerMessage: number; encoding: string; totalSegments: number; currency: string | null; unitPrice: string | null;
  pricingEffectiveFrom: string | null; subtotalCents: number | null; carrierFeesCents: number | null; carrierFeesKnown: boolean; taxCents: number | null; taxKnown: boolean; totalCents: number | null; totalIsLowerBound: boolean };
export function EstimateBlock({ e }: { e?: Estimate }) {
  if (!e) return null;
  const line = tx('rt3.est.line', { r: nf(e.recipients), s: nf(e.segmentsPerMessage), t: nf(e.totalSegments), enc: e.encoding });
  if (e.status === 'price_unknown') return (
    <div className="rt3-est unknown" data-testid="sms-estimate"><b>{tx('rt3.est.unknown')}</b><div className="fk-hint">{line}</div><div className="fk-hint">{tx('rt3.est.unknownHelp')}</div></div>);
  const money = (c: number | null) => (c == null ? '—' : `${fmtMoney(c)}${e.currency && e.currency !== 'USD' ? ' ' + e.currency : ''}`);
  return (
    <div className="rt3-est" data-testid="sms-estimate">
      <div className="rt3-est-h"><b>{tx('rt3.est.title')}</b> <span className="fk-hint">{line}</span></div>
      <dl className="fk-dl rt3-est-dl">
        <dt>{tx('rt3.est.unitLabel')}</dt><dd>{tx('rt3.est.unit', { p: e.unitPrice ?? '', c: e.currency ?? '', date: fmtYmdSafe((e.pricingEffectiveFrom ?? '').slice(0, 10)) })}</dd>
        <dt>{tx('rt3.est.subtotal')}</dt><dd>{money(e.subtotalCents)}</dd>
        <dt>{tx('rt3.est.fees')}</dt><dd>{e.carrierFeesKnown ? money(e.carrierFeesCents) : <span className="fk-muted">{tx('rt3.est.notIncluded')}</span>}</dd>
        <dt>{tx('rt3.est.tax')}</dt><dd>{e.taxKnown ? money(e.taxCents) : <span className="fk-muted">{tx('rt3.est.notIncluded')}</span>}</dd>
        <dt>{tx('rt3.est.total')}</dt><dd data-testid="sms-estimate-total"><b>{e.totalIsLowerBound ? tx('rt3.est.atLeast', { v: money(e.totalCents) }) : money(e.totalCents)}</b></dd>
      </dl>
      <div className="fk-hint">{tx('rt3.est.note')}{e.encoding === 'UCS-2' ? ' ' + tx('rt3.est.ucs2') : ''}</div>
    </div>
  );
}

/** the salon's SMS price for estimates (effective-dated, append-only on the server; pos.settings.edit to change) */
function PricingSection() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false);
  const [retail, setRetail] = useState(''); const [fee, setFee] = useState(''); const [tax, setTax] = useState('');
  const load = useCallback(() => { posRetentionApi.smsPricing().then((r) => { setD(r); if (r.current) { setRetail(r.current.retailPricePerSegment); setFee(r.current.carrierFeePerSegment ?? ''); setTax(r.current.taxRatePercent ?? ''); } }).catch((e) => setErr(errText(e, tx('people.retention.loadFailed')))); }, []);
  useEffect(() => { load(); }, [load]);
  const num = (v: string) => v.trim() === '' || /^\d+(\.\d{1,5})?$/.test(v.trim());
  const invalid = !/^\d+(\.\d{1,5})?$/.test(retail.trim()) || !num(fee) || !num(tax);
  const save = async () => {
    if (invalid || busy) return; setBusy(true); setErr(null); setOk(false);
    try { await posRetentionApi.setSmsPricing({ retailPricePerSegment: retail.trim(), carrierFeePerSegment: fee.trim() || null, taxRatePercent: tax.trim() || null, currency: 'USD' }); setOk(true); load(); }
    catch (e) { setErr(errText(e, tx('rt3.price.failed'))); } finally { setBusy(false); }
  };
  const cur = d?.current; const ro = d && !d.canEdit;
  return (
    <section className="rt3-price" data-testid="sms-pricing">
      <h3 className="fk-h3">{tx('rt3.price.title')}</h3>
      {!d && !err ? <div className="fk-loading">{tx('pos.loading')}</div> : null}
      {d ? <>
        <div className="fk-hint" data-testid="sms-pricing-current">{cur ? tx('rt3.price.current', { p: cur.retailPricePerSegment, c: cur.currency, date: fmtYmdSafe(String(cur.effectiveFrom).slice(0, 10)) }) : tx('rt3.price.none')}</div>
        {(d.upcoming ?? []).map((u: any) => <div key={u.pricingId} className="fk-hint">{tx('rt3.price.upcoming', { p: u.retailPricePerSegment, c: u.currency, date: fmtYmdSafe(String(u.effectiveFrom).slice(0, 10)) })}</div>)}
        <div className="rt3-price-row">
          <label className="fk-field"><span>{tx('rt3.price.retail')}</span><input inputMode="decimal" value={retail} disabled={ro} onChange={(e) => setRetail(e.target.value)} placeholder="0.035" data-testid="price-retail" /></label>
          <label className="fk-field"><span>{tx('rt3.price.fee')}</span><input inputMode="decimal" value={fee} disabled={ro} onChange={(e) => setFee(e.target.value)} data-testid="price-fee" /></label>
          <label className="fk-field"><span>{tx('rt3.price.tax')}</span><input inputMode="decimal" value={tax} disabled={ro} onChange={(e) => setTax(e.target.value)} data-testid="price-tax" /></label>
        </div>
        <div className="fk-hint">{tx('rt3.price.help')}</div>
        {ro ? <div className="fk-hint warn">{tx('rt3.price.readOnly')}</div>
          : <button type="button" className="fk-btn ghost" onClick={save} disabled={invalid || busy} data-testid="price-save">{busy ? tx('pos.saving_2') : tx('rt3.price.save')}</button>}
        {ok ? <div className="fk-hint" role="status">{tx('rt3.price.saved')}</div> : null}
      </> : null}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </section>
  );
}

// ── CR-01 history: a STORED snapshot of a past salon day (nothing is recomputed in the browser or in the GET) ─────────────
const HSEGS = ['never_visited', 'active', 'approaching', 'at_risk'] as const;
const HTONE: Record<string, string> = { at_risk: 'bad', approaching: 'warn', active: 'ok', never_visited: 'mut', not_a_customer: 'mut' };
const hSeg = (s: string) => tx('rt3.seg.' + s);
function HistoryDialog({ onClose, canBackfill, openCustomer, branches = [] }: { onClose: () => void; canBackfill: boolean; openCustomer: (id: string) => void; branches?: { branchId: string; name: string }[] }) {
  const [today, setToday] = useState('');
  // C3/C5 gap (Nov 5 2026): one location's history (customers by their last visit's location that day)
  const [hBranch, setHBranch] = useState('');
  const [date, setDate] = useState(''); const [cmp, setCmp] = useState('');
  const [day, setDay] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [tick, setTick] = useState(0);
  const [seg, setSeg] = useState<string>('at_risk'); const [page, setPage] = useState(1); const [mem, setMem] = useState<any>(null);
  const [comp, setComp] = useState<any>(null);
  const [runs, setRuns] = useState<any>(null); const [runPage, setRunPage] = useState(1);
  const [bf, setBf] = useState({ from: '', to: '' }); const [bfBusy, setBfBusy] = useState(false); const [bfNote, setBfNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  // the first read names the salon's today; the default date is yesterday (the latest completed salon day)
  useEffect(() => {
    if (date) return;
    posRetentionApi.snapshotRuns({ page: 1, pageSize: 1 }).then((r) => { const t = String(r.to); setToday(t); const y = ymdAdd(t, -1); setDate(y); setBf({ from: ymdAdd(t, -30), to: y }); })
      .catch((e) => setErr(errText(e, tx('people.retention.loadFailed'))));
  }, [date]);
  useEffect(() => { if (!date) return; let alive = true; setErr(null); posRetentionApi.snapshotDay(date, hBranch || undefined).then((r) => alive && setDay(r)).catch((e) => alive && setErr(errText(e, tx('people.retention.loadFailed')))); return () => { alive = false; }; }, [date, tick, hBranch]);
  useEffect(() => { if (!date || day?.state !== 'available') { setMem(null); return; } let alive = true;
    posRetentionApi.snapshotMembers({ date, segment: seg || undefined, branch: hBranch || undefined, page, pageSize: 6 }).then((r) => alive && setMem(r)).catch((e) => alive && setErr(errText(e, tx('people.retention.loadFailed')))); return () => { alive = false; }; }, [date, day?.state, seg, page, tick, hBranch]);
  useEffect(() => { if (!date || !cmp) { setComp(null); return; } let alive = true; posRetentionApi.snapshotCompare(cmp, date, hBranch || undefined).then((r) => alive && setComp(r)).catch((e) => alive && setErr(errText(e, tx('people.retention.loadFailed')))); return () => { alive = false; }; }, [date, cmp, tick, hBranch]);
  useEffect(() => { if (!today) return; let alive = true; posRetentionApi.snapshotRuns({ from: ymdAdd(today, -60), to: today, page: runPage, pageSize: 5 }).then((r) => alive && setRuns(r)).catch((e) => alive && setErr(errText(e, tx('people.retention.loadFailed')))); return () => { alive = false; }; }, [today, runPage, tick]);
  const backfill = async () => {
    setBfBusy(true); setBfNote(null);
    try { const r = await posRetentionApi.backfill(bf); setBfNote({ tone: 'ok', text: tx('rt3.hist.backfillQueued', { n: nf(r.days) }) }); setTimeout(() => setTick((n) => n + 1), 4000); }
    catch (e) { setBfNote({ tone: 'bad', text: errText(e, tx('rt3.hist.backfillFailed')) }); } finally { setBfBusy(false); }
  };
  const run = day?.run; const c = day?.counts;
  const stateText = !day ? '' : day.state === 'available' ? tx('rt3.hist.state.available', { date: fmtYmdSafe(day.date), cov: tx('rt3.cov.' + run.coverage), d: String(run.riskDays), a: String(run.approachingDays), v: run.definitionVersion })
    : day.state === 'incomplete' ? tx('rt3.hist.state.incomplete', { date: fmtYmdSafe(day.date), reason: tx('rt3.reason.' + (run?.coverageReason ?? 'no_ticket_history')) })
    : day.state === 'failed' ? tx('rt3.hist.state.failed', { date: fmtYmdSafe(day.date), error: run?.lastError ?? '' }) : tx('rt3.hist.state.' + day.state, { date: fmtYmdSafe(day.date) });
  return (
    <FitDialog wide title={tx('rt3.hist.title')} subtitle={tx('rt3.hist.sub')} onClose={onClose} testId="dlg-history"
      footer={<><Pager info={mem} onPage={setPage} /><button type="button" className="fk-btn primary" onClick={onClose} data-testid="hist-close">{tx('pos.close')}</button></>}>
      <div className="rt3-hist-bar">
        {today ? <DateField label={tx('rt3.hist.date')} value={date} onChange={(v) => { setDate(v); setPage(1); }} today={today} max={ymdAdd(today, -1)} testId="hist-date" /> : null}
        {today ? <DateField label={tx('rt3.hist.compare')} value={cmp} onChange={setCmp} today={today} max={ymdAdd(today, -1)} testId="hist-compare" /> : null}
        {cmp ? <button type="button" className="fk-link" onClick={() => setCmp('')}>{tx('rt3.hist.compareClear')}</button> : null}
        {branches.length > 1 ? <select className="fk-select" value={hBranch} onChange={(e) => { setHBranch(e.target.value); setPage(1); }} aria-label={tx('rt3.hist.branch')} data-testid="hist-branch">
          <option value="">{tx('rt3.hist.allBranches')}</option>{branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}</select> : null}
        <span className="fk-hint">{hBranch ? tx('rt3.hist.branchRule') : tx('rt3.hist.tenantOnly')}</span>
      </div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
      {day ? <div className={'rt3-state ' + (day.unverifiable ? 'warn' : 'ok')} data-testid="hist-state" data-state={day.state}>
        <b>{day.unverifiable ? tx('rt3.hist.unverifiable') : tx('rt3.hist.verified')}</b> {stateText}{run?.finishedAt && day.state === 'available' ? ' · ' + tx('rt3.hist.calculated', { at: whenTime(run.finishedAt) }) : ''}</div> : null}
      {c ? <div className="rt-counts five" data-testid="hist-counts">
        <button type="button" className={'rt3-tile' + (seg === '' ? ' on' : '')} onClick={() => { setSeg(''); setPage(1); }}><b>{nf(c.total)}</b><span>{tx('rt3.c.total')}</span></button>
        {HSEGS.map((s2) => <button type="button" key={s2} className={'rt3-tile ' + HTONE[s2] + (seg === s2 ? ' on' : '')} onClick={() => { setSeg(s2); setPage(1); }} data-testid={'hist-seg-' + s2}><b>{nf(c[s2])}</b><span>{hSeg(s2)}</span></button>)}
      </div> : null}
      <div className="rt-two">
        <section>
          {comp ? <>
            <h3 className="fk-h3">{tx('rt3.hist.compareTitle', { a: fmtYmdSafe(comp.a.date), b: fmtYmdSafe(comp.b.date) })}</h3>
            {!comp.comparable ? <div className="fk-hint warn" data-testid="hist-compare-na">{tx('rt3.hist.notComparable')}</div> : <>
              <table className="fk-table" data-testid="hist-compare-table"><thead><tr><th>{tx('rt2.segment')}</th><th className="num">{fmtYmdSafe(comp.a.date)}</th><th className="num">{fmtYmdSafe(comp.b.date)}</th><th className="num">{tx('rt3.hist.delta')}</th></tr></thead>
                <tbody>{(['total', ...HSEGS] as const).map((k2) => <tr key={k2}><td>{k2 === 'total' ? tx('rt3.c.total') : hSeg(k2)}</td><td className="num">{nf(comp.a.counts[k2])}</td><td className="num">{nf(comp.b.counts[k2])}</td>
                  <td className="num"><b>{comp.delta[k2] > 0 ? '+' : ''}{nf(comp.delta[k2])}</b></td></tr>)}</tbody></table>
              {comp.definitionChanged ? <div className="fk-hint warn">{tx('rt3.hist.defChanged', { a: comp.a.run.definitionVersion, b: comp.b.run.definitionVersion })}</div> : null}
              <h3 className="fk-h3">{tx('rt3.hist.moved')}</h3>
              {comp.transitions.length === 0 ? <div className="fk-hint">{tx('rt3.hist.noMoves')}</div> : <ul className="fk-list dense" data-testid="hist-moves">{comp.transitions.map((t2: any) => (
                <li key={t2.from + t2.to} className="fk-li"><span className="fk-li-t"><span className={'fk-chip ' + HTONE[t2.from]}>{hSeg(t2.from)}</span> → <span className={'fk-chip ' + HTONE[t2.to]}>{hSeg(t2.to)}</span></span><b>{nf(t2.customers)}</b></li>))}</ul>}
            </>}
          </> : <>
            <h3 className="fk-h3">{seg ? tx('rt3.hist.members', { seg: hSeg(seg), date: fmtYmdSafe(date) }) : tx('rt3.hist.membersAll', { date: fmtYmdSafe(date) })}</h3>
            {!mem ? (day && day.state !== 'available' ? <div className="fk-hint">{tx('rt3.hist.noData')}</div> : <div className="fk-loading">{tx('pos.loading')}</div>) : mem.items.length === 0 ? <Empty title={tx('rt3.hist.noMembers')} /> : (
              <table className="fk-table" data-testid="hist-members"><thead><tr><th>{tx('pos.customer')}</th><th>{tx('rt2.segment')}</th><th>{tx('pos.last_visit_3')}</th><th className="num">{tx('rt2.days')}</th><th className="num">{tx('pos.visits')}</th><th className="num">{tx('rt3.col.net')}</th></tr></thead>
                <tbody>{mem.items.map((m: any) => <tr key={m.customerId} data-testid="hist-member"><td><button type="button" className="fk-link" onClick={() => openCustomer(m.customerId)}>{m.customerName || '—'}</button></td>
                  <td><span className={'fk-chip ' + HTONE[m.segment]}>{hSeg(m.segment)}</span></td><td>{m.lastVisitAt ? when(m.lastVisitAt) : <span className="fk-muted">{tx('people.retention.never')}</span>}</td>
                  <td className="num">{m.daysAway == null ? '—' : nf(m.daysAway)}</td><td className="num">{nf(m.visits)}</td><td className="num">{fmtMoney(m.netLifetimeValueCents)}</td></tr>)}</tbody></table>)}
          </>}
        </section>
        <section>
          <h3 className="fk-h3">{tx('rt3.hist.runs')}</h3>
          {!runs ? <div className="fk-loading">{tx('pos.loading')}</div> : runs.items.length === 0 ? <div className="fk-hint">{tx('rt3.hist.noRuns')}</div> : <ul className="fk-list dense" data-testid="hist-runs">{runs.items.map((r: any) => (
            <li key={r.runId} className="fk-li"><div className="fk-li-main"><button type="button" className="fk-link" onClick={() => { setDate(r.date); setPage(1); }}>{fmtYmdSafe(r.date)}</button>
              <span className="fk-li-s">{tx('rt3.run.' + r.status)}{r.coverage ? ' · ' + tx('rt3.cov.' + r.coverage) : ''}{r.status === 'failed' && r.lastError ? ' · ' + r.lastError : ''}</span></div><span className="fk-muted">{r.definitionVersion}</span></li>))}</ul>}
          {runs && runs.totalPages > 1 ? <Pager info={runs} onPage={setRunPage} /> : null}
          {canBackfill && today ? <div className="rt3-backfill">
            <h3 className="fk-h3">{tx('rt3.hist.backfill')}</h3>
            <div className="rt3-hist-bar">
              <DateField label={tx('rt3.hist.from')} value={bf.from} onChange={(v) => setBf((b) => ({ ...b, from: v }))} today={today} max={ymdAdd(today, -1)} testId="bf-from" />
              <DateField label={tx('rt3.hist.to')} value={bf.to} onChange={(v) => setBf((b) => ({ ...b, to: v }))} today={today} max={ymdAdd(today, -1)} testId="bf-to" />
              <button type="button" className="fk-btn ghost" disabled={bfBusy || !bf.from || !bf.to || bf.from > bf.to} onClick={backfill} data-testid="hist-backfill">{bfBusy ? tx('pos.loading') : tx('rt3.hist.backfillGo')}</button>
            </div>
            <div className="fk-hint">{tx('rt3.hist.backfillHelp')}</div>
            {bfNote ? <div className={bfNote.tone === 'ok' ? 'fk-hint' : 'fk-err'} role="status" data-testid="hist-backfill-note">{bfNote.text}</div> : null}
          </div> : null}
        </section>
      </div>
    </FitDialog>
  );
}
/** 'YYYY-MM-DD' ± n calendar days (UTC arithmetic on a date-only value — no time-zone drift) */
function ymdAdd(d: string, n: number): string { const t = Date.parse(d + 'T00:00:00Z'); if (Number.isNaN(t)) return d; return new Date(t + n * 86400_000).toISOString().slice(0, 10); }
