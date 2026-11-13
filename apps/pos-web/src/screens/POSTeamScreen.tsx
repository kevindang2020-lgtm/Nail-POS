// POSTeamScreen.tsx — Team > All Team Members > Team Management (/tenant/team/members). Rebuilt 30 Oct 2026 to the owner's
// Team Management build guide on the server read model /pos/team-members-screen (tenant + branch from the session; the old
// /pos/team/state stays for its other caller). One vertical scroll that keeps every module of both photographed views:
//   header (Refresh · Find Qualified & Available Staff · Edit Selected Date Shift · Data Accuracy Alerts · Export ·
//   + Add Team Member) · ONE server search (name · phone in any format and e-mail where permitted · ID · role ·
//   department · service skill · linked appointment / ticket) · Today / Week / Month / Year / Custom (monthly calendar)
//   with an explicit date basis · the eight KPIs (4 + 4), each with its definition, period, source and state (loading ·
//   value · not configured · error) — Commission is EARNED, Paid comes only from payroll payouts · the Employee Directory:
//   role tabs counting unique members, Role / Status / Shift / Department + More Filters (account, extra, sort), every
//   original column, newest first, numbered server pages · Team Attendance Today · Performance Overview (+ Unrated) · Top
//   Performers · Today's Shift Overview · Team Productivity (period comparison) · Pending Approvals · Upcoming Birthdays
//   (optional month/day, privacy-aware — teamStaffParts) · Training & Certifications (catalog-backed counts or Not configured)
//   and the four workflows: Full Employee Profile Overlay · Find Qualified & Available Staff · One-Day Shift Editor ·
//   Data Accuracy Alerts.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx, getLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { posTeamMembersScreenApi, posTeamDataAlertsApi } from '../api/posTeamScreensApi';
import { useCan } from '../components/usePermissions';
import { fmtMoney } from '../i18n/format';
import { FitPanel, KpiCard, Pager, Empty, useDebounced, downloadText, requestId } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { pageOf, whenTime } from './technicianScreenParts';
import { nf } from './teamShared';
import { DateShiftEditor } from './dateShiftEditor';
import { useTeamUrlState, clearedTeamUrl, teamCreatedPath, TEAM_SIZES, type TeamUrl } from './teamUrlState';
import { useTeamLive, useNewest, TeamLiveBadge } from './teamLive';
import { CustomerLinkedStaff } from './teamCustomerSearch';
import { EmployeeProfileOverlay, TeamAvailableFinder, DateShiftLauncher, TeamDataAlertsPanel, LIVE_TONE, roleName, deptName, liveName, rangeText, type PTab } from './teamMembersParts';
import { AddTeamMemberDialog, TeamBirthdaysPanel, TeamTrainingPanel, TeamTrainingCatalog } from './teamStaffParts';   // round 2: TM-06 · TM-08 · TM-09

const TABS = ['all', 'stylists', 'nail_technicians', 'receptionists', 'assistants', 'managers'] as const;
import { deviceToday } from '../lib/deviceToday';
import { SystemCheckButton } from '../components/SystemCheck';   // extras TM-08 / TM-14: the read-only team health check + its evidence report
const ROLES = ['owner', 'manager', 'receptionist', 'stylist', 'nail_technician', 'assistant', 'other'];
const STATUSES = ['available', 'in_service', 'assigned', 'on_break', 'on_shift', 'off', 'time_off', 'not_tracked'];
const SHIFTS = ['scheduled', 'unscheduled', 'clocked_in', 'day_off'];
const DEPTS = ['management', 'front_desk', 'hair_services', 'nail_services', 'support'];
const ACCOUNTS = ['current', 'active', 'inactive', 'archived', 'all'];
const EXTRAS = ['', 'missing_mapping', 'no_login', 'has_login', 'unrated'];
const SORTS = ['newest', 'oldest', 'name'];
const BANDS = ['excellent', 'very_good', 'good', 'needs', 'unrated'] as const;
const money = (c: number | null | undefined) => (c == null ? '—' : fmtMoney(c));
const PALETTE = ['#2E7D32', '#2C6BB0', '#6E59C7', '#E8852B', '#3F8F7F', '#8A6FB0', '#8A8F98', '#B9A88F'];

function Donut({ items }: { items: { key: string; label: string; count: number }[] }) {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <Empty title={tx('tmm.att.none')} />;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div className="tmm-donut">
      <svg viewBox="0 0 140 140" aria-hidden>{items.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={it.key} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="15" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
        <circle cx="70" cy="70" r="36" fill="var(--card, #fff)" /></svg>
      <ul className="fk-list dense">{items.map((it, i) => <li key={it.key} className="fk-li"><span className="tmm-dot" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="fk-li-t">{it.label}</span><b data-testid={'att-' + it.key}>{nf(it.count)}</b></li>)}</ul>
    </div>
  );
}
export function POSTeamScreen() {
  const nav = useNavigate(); const can = useCan();
  // TM-02: the directory's non-sensitive state is the URL (Back / Forward / refresh restore it); the search text is not
  const [u, setU] = useTeamUrlState();
  const { tab, role, status, shift, department, account, extra, sort, basis, period, size: pageSize, mode } = u;
  const setPeriod = (p: PeriodState) => setU({ period: p }); const setBasis = (v: string) => setU({ basis: v });
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const setTab = (v: string) => setU({ tab: v }); const setRole = (v: string) => setU({ role: v }); const setStatus = (v: string) => setU({ status: v }); const setShift = (v: string) => setU({ shift: v });
  const setDepartment = (v: string) => setU({ department: v }); const setAccount = (v: string) => setU({ account: v }); const setExtra = (v: string) => setU({ extra: v }); const setSort = (v: string) => setU({ sort: v });
  const [moreOpen, setMoreOpen] = useState(false);
  // while a search is typed the page lives in memory only (the URL never carries the search, so it must not carry its page)
  const [memPage, setMemPage] = useState(1); const page = q ? memPage : u.page;
  const setPage = (p: number) => (q ? setMemPage(p) : setU({ page: p }));
  const [tick, setTick] = useState(0);
  const live = useTeamLive();   // TM-05: live updates on the existing stream + fallback polling; filters / page / overlay untouched
  const [profile, setProfile] = useState<{ id: string; tab?: PTab } | null>(null); const [finder, setFinder] = useState(false); const [dateShift, setDateShift] = useState<{ technicianId: string; name: string } | 'pick' | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false); const [openAlerts, setOpenAlerts] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false); const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false); const [catalogOpen, setCatalogOpen] = useState(false);
  // 200-Technician 08 — Quick Bulk Staff Actions: pick rows, then review only them (the server filters by id, so More Filters
  // such as 'no login' / 'missing mapping' show the exceptions AMONG the selection), print them, or export them (the audited CSV,
  // after a confirm). Nothing is assigned, notified or changed.
  const [sel, setSel] = useState<string[]>([]); const [selOnly, setSelOnly] = useState(false); const [bulkAsk, setBulkAsk] = useState<null | 'export'>(null); const [printOpen, setPrintOpen] = useState<any[] | null>(null);
  const toggleSel = (id: string) => setSel((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : xs.length >= 100 ? xs : [...xs, id]));
  const pq = periodQuery(period);
  useEffect(() => setMemPage(1), [q, tab, role, status, shift, department, account, extra, sort, basis, period.preset, period.from, period.to, pageSize]);
  const dash = useLoad(() => posTeamMembersScreenApi.dashboard(pq), [JSON.stringify(pq), tick, live.tick]);
  const fq = { ...pq, q: mode === 'staff' ? q || undefined : undefined, tab: tab === 'all' ? undefined : tab, role: role || undefined, status: status || undefined, shift: shift || undefined, department: department || undefined,
    account: account === 'current' ? undefined : account, extra: extra || undefined, sort: sort === 'newest' ? undefined : sort, basis: basis === 'service' ? undefined : basis, ...(selOnly && sel.length ? { ids: sel.join(',') } : {}) };
  const dirKey = JSON.stringify(fq) + '|' + page + '|' + pageSize;
  const dir = useLoad(() => posTeamMembersScreenApi.directory({ ...fq, page, pageSize }).then((r: any) => ({ ...r, reqKey: dirKey })), [dirKey, tick, live.tick]);
  const dirD: any = useNewest(dir.data as { asOf?: string | null } | null, dirKey);   // an older answer never replaces a newer one
  const alertCount = useLoad(() => posTeamDataAlertsApi.list({ status: 'open_all', pageSize: 1 }), [tick, live.tick]);
  const alertsAllowed = !isForbidden(alertCount.error);
  useEffect(() => { const c: any = alertCount.data?.counts; if (c) setOpenAlerts((c.OPEN ?? 0) + (c.ASSIGNED ?? 0) + (c.INVESTIGATING ?? 0)); }, [alertCount.data]);
  const d: any = dash.data; const k = d?.kpis; const today = d?.today ?? deviceToday();
  const canEditSchedule = can('pos.technicians.schedule.edit') || can('technicians.edit');
  const clearAll = () => { setSearch(''); setU((c: TeamUrl) => clearedTeamUrl(c)); };
  const toDir = (p: { status?: string; shift?: string; extra?: string }) => { setSearch(''); setU((c: TeamUrl) => ({ ...clearedTeamUrl(c), mode: 'staff', status: p.status ?? '', shift: p.shift ?? '', extra: p.extra ?? '' })); document.querySelector('[data-testid="directory"]')?.scrollIntoView({ block: 'start' }); };
  // TM-02: a page past the end is clamped by the server — write the served page back (replace: no extra history entry)
  useEffect(() => { if (!q && dirD && dirD.reqKey === dirKey && u.page > Math.max(1, dirD.totalPages)) setU({ page: Math.max(1, dirD.totalPages) }, { replace: true }); }, [dirD?.reqKey, dirD?.totalPages, u.page, q]);   // eslint-disable-line react-hooks/exhaustive-deps
  // TM-03: back from a creation flow with ?created=<id> → page 1, newest first (created_at DESC, id DESC), the row highlighted;
  // when the current filters hide the new person: View new employee / Clear filters (never a silently widened filter)
  const created = u.created;
  useEffect(() => { if (created && (u.page !== 1 || u.sort !== 'newest' || u.mode !== 'staff')) setU({ page: 1, sort: 'newest', mode: 'staff' }, { replace: true }); }, [created]);   // eslint-disable-line react-hooks/exhaustive-deps
  const isNew = (m: any) => !!created && (m.memberId === created || m.technicianId === created || m.userId === created);
  const newOnPage = !!created && !!dirD && page === 1 && dirD.items.some(isNew);
  const newName = useLoad(() => (created ? posTeamMembersScreenApi.profile(created) : Promise.resolve(null)), [created]);
  const doExport = async (selected = false) => {
    setExporting(true); setNote(null); setBulkAsk(null);
    try {
      const csv = await posTeamMembersScreenApi.exportCsv({ ...fq, ...(selected ? { ids: sel.join(',') } : {}), lang: getLanguage() === 'vi' ? 'vi' : 'en', requestId: requestId() });
      downloadText(`team-members-${d?.period?.from ?? 'all'}-${d?.period?.to ?? 'all'}.csv`, String(csv ?? '')); setNote({ tone: 'ok', text: tx('tmm.exported') });
    } catch (e) { setNote({ tone: 'bad', text: isForbidden(e) ? tx('tmm.exportForbidden') : (e as Error)?.message || tx('tmm.exportFailed') }); }
    finally { setExporting(false); }
  };
  const kv = (v: unknown, f: () => string) => (dash.error ? '—' : !d ? '' : v == null ? '—' : f());
  const failed = (name: string) => !!d?.errors?.includes(name);
  const state = (name: string, sub: string) => (dash.error ? tx('tmm.kpi.error') : failed(name) ? tx('tmm.kpi.error') : sub);
  const a = d?.attendance; const b = d?.bands; const pr = d?.productivity; const so = d?.shiftOverview; const ce = d?.certifications;
  const delta = (cur: number | null | undefined, prev: number | null | undefined) => (cur == null || prev == null ? null : prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10);
  const dl = (n: number | null) => (n == null ? null : <span className={'tmm-delta ' + (n >= 0 ? 'up' : 'down')}>{n >= 0 ? '▲' : '▼'} {Math.abs(n)}%</span>);
  return (
    <div className="work mos tmm" data-testid="team-members-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.team_management')}</h1><div className="sub">{tx('pos.manage_your_team_roles_performance_and_voax')}</div></div>
        <div className="fk-head-actions">
          <TeamLiveBadge mode={live.mode} lastAt={live.lastAt} />
          <button type="button" className="fk-btn" onClick={() => setTick((n) => n + 1)} aria-busy={dash.loading || dir.loading} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setFinder(true)} data-testid="open-finder">{tx('tmm.finder')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDateShift('pick')} data-testid="open-date-shift">{tx('tmm.editDateShift')}</button>
          {alertsAllowed ? <button type="button" className={'fk-btn ' + (alertsOpen ? '' : 'ghost')} aria-expanded={alertsOpen} onClick={() => setAlertsOpen((v) => !v)} data-testid="open-alerts">{tx('tmm.al.title')}{openAlerts ? <span className="tq-n">{nf(openAlerts)}</span> : null}</button> : null}
          <SystemCheckButton domain="technicians" testId="syschk-team" />
          <button type="button" className="fk-btn ghost" onClick={() => void doExport()} disabled={exporting} aria-busy={exporting} data-testid="export">{exporting ? tx('tmm.exporting') : tx('pos.export')}</button>
          <button type="button" className="fk-btn primary" title={tx('tms.add.rule')} onClick={() => setAddOpen(true)} data-testid="add-member">{tx('pos.add_team_member')}</button>
        </div>
      </header>
      <div className="sr-only" role="status" aria-live="polite">{dash.loading || dir.loading ? tx('pos.loading') : ''}</div>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      {created && dirD ? <div className={'fk-note ' + (newOnPage ? 'ok' : 'warn') + ' tm2-created'} role="status" data-testid="created-note">
        <span>{newOnPage ? tx('tm2.new.shown', { n: (newName.data as { name?: string } | null)?.name ?? '' }) : tx('tm2.new.hidden', { n: (newName.data as { name?: string } | null)?.name ?? '' })}</span>
        {!newOnPage ? <><button type="button" className="fk-btn sm" onClick={() => setProfile({ id: created })} data-testid="created-view">{tx('tm2.new.view')}</button>
          <button type="button" className="fk-btn sm ghost" onClick={clearAll} data-testid="created-clear">{tx('tm2.new.clear')}</button></> : null}
        <button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setU({ created: null }, { replace: true })} data-testid="created-dismiss">✕</button></div> : null}
      {alertsOpen && alertsAllowed ? <TeamDataAlertsPanel onOpenMember={(id, t) => setProfile({ id, tab: t })} onCounts={(n) => setOpenAlerts(n)} /> : null}

      <div className="mos-tools" data-testid="toolbar">
        <div className="fk-seg tm2-mode" role="group" aria-label={tx('tm2.mode.label')}>{(['staff', 'customer'] as const).map((x) => <button key={x} type="button" aria-pressed={mode === x} className={mode === x ? 'on' : ''}
          onClick={() => { if (x !== mode) { setSearch(''); setU({ mode: x }); } }} data-testid={'mode-' + x}>{tx('tm2.mode.' + x)}</button>)}</div>
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={mode === 'customer' ? tx('tm2.cl.ph') : tx('tmm.searchPh')} aria-label={mode === 'customer' ? tx('tm2.cl.ph') : tx('tmm.searchPh')} data-testid="search" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        {dirD && mode === 'staff' ? <span className="fk-muted" data-testid="result-count">{tx('cg.matching', { n: nf(dirD.totalItems) })}</span> : null}
      </div>
      <div className="fn-tabsrow dsc-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={d?.period} compact basis={basis} onBasis={setBasis}
          basisOptions={[{ value: 'service', label: tx('tmm.basis.service') }, { value: 'created', label: tx('tmm.basis.created') }]} />
      </div>
      <div className="fk-hint mos-scope" data-testid="period-rule">{tx('tmm.periodRule', { tz: d?.tz ?? '' })}</div>

      <div className="fk-kpis cg-kpis" data-testid="kpis">
        {dash.error && !isForbidden(dash.error) ? <StateBlock error={dash.error} onRetry={dash.reload} /> : null}
        <KpiCard testId="kpi-team" label={tx('pos.total_team_members')} loading={!d && !dash.error} value={kv(k?.totalMembers, () => nf(k.totalMembers))} sub={state('team', k ? tx('tmm.kpi.teamSub', { a: nf(k.activeAccounts), i: nf(k.inactiveAccounts) }) : '')} onClick={clearAll} />
        <KpiCard testId="kpi-active-today" label={tx('pos.active_today')} loading={!d && !dash.error} value={kv(k?.activeToday, () => nf(k.activeToday))} sub={state('team', k ? tx('tmm.kpi.activeSub', { s: nf(k.scheduledToday), c: nf(k.clockedToday) }) : '')} onClick={() => toDir({ shift: 'scheduled' })} />
        <KpiCard testId="kpi-on-shift" tone="ok" label={tx('pos.on_shift_now')} loading={!d && !dash.error} value={kv(k?.onShiftNow, () => nf(k.onShiftNow))} sub={state('team', k ? tx('tmm.kpi.onShiftSub', { c: nf(k.clockedInNow) }) : '')} onClick={() => toDir({ status: 'on_shift' })} />
        <KpiCard testId="kpi-rating" tone="gold" label={tx('pos.avg_performance_score')} loading={!d && !dash.error} value={kv(k?.ratingCount, () => (k.avgRating == null ? '—' : `${k.avgRating.toFixed(1)} / 5`))} sub={state('rating', k ? (k.ratingCount ? tx('tmm.kpi.ratingSub', { n: nf(k.ratingCount), m: nf(k.ratedMembers) }) : tx('tmm.kpi.noRatings')) : '')} />
      </div>
      <div className="fk-kpis cg-kpis" data-testid="kpis-2">
        <KpiCard testId="kpi-services" label={tx('pos.total_services_completed')} loading={!d && !dash.error} value={kv(k?.servicesCompleted, () => nf(k.servicesCompleted))} sub={state('sales', tx('tmm.kpi.servicesSub'))} />
        <KpiCard testId="kpi-commission" label={tx('tmm.kpi.commission')} loading={!d && !dash.error} value={!d?.canPay && d ? '—' : kv(k?.commissionEarnedCents, () => money(k.commissionEarnedCents))}
          sub={!d ? '' : !d.canPay ? tx('tmm.kpi.noPay') : state('commission', tx('tmm.kpi.commissionSub', { p: money(k?.commissionPaidCents) }))} onClick={d?.canPay ? () => nav('/tenant/reports/commission') : undefined} />
        <KpiCard testId="kpi-approvals" tone={k?.pendingApprovals ? 'warn' : undefined} label={tx('pos.pending_approvals')} loading={!d && !dash.error} value={kv(k?.pendingApprovals, () => nf(k.pendingApprovals))}
          sub={state('approvals', k?.approvals ? tx('tmm.kpi.approvalsSub', { s: nf(k.approvals.skills), t: nf(k.approvals.timeOff), p: nf(k.approvals.profile + k.approvals.membership) }) : '')} onClick={() => document.querySelector('[data-testid="approvals"]')?.scrollIntoView({ block: 'center' })} />
        <KpiCard testId="kpi-positions" label={tx('pos.open_positions')} loading={!d && !dash.error} value={d ? tx('tmm.notConfigured') : ''} sub={tx('tmm.kpi.positionsSub')} />
      </div>
      <p className="fk-hint" data-testid="kpi-defs">{tx('tmm.kpi.defs')}</p>
      {d?.syncFreshness ? <p className="fk-hint" data-testid="sync-freshness" title={tx('tmm.sync.def')}>{tx('tmm.sync.title')}{' '}
        {(['queueAt', 'bookingAt', 'timeClockAt', 'technicianStatusAt', 'technicianAppAt'] as const).map((key) => `${tx('tmm.sync.' + key)} ${d.syncFreshness[key] ? whenTime(d.syncFreshness[key]) : tx('tmm.sync.none')}`).join(' · ')}</p> : null}

      {mode === 'customer' ? <CustomerLinkedStaff q={q} tick={tick + live.tick} onOpenMember={(id) => setProfile({ id })} /> :
      <FitPanel testId="directory" className="tmm-dir" title={<>{tx('tmm.directory')}{dirD ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(dirD.totalItems) })}</span> : null}</>}
        footer={<Pager info={pageOf(dirD)} onPage={setPage} label={tx('tmm.directory')} />}>
        <div className="fk-seg tc-roles" role="tablist" aria-label={tx('tmm.roles')}>
          {TABS.map((id) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={'tab-' + id}>
            {tx('tmm.tab.' + id)} <span className="tq-n">{nf(dirD?.tabs?.find((t: any) => t.id === id)?.count)}</span></button>)}
        </div>
        <div className="mos-tools">
          <select className="fk-select" value={role} onChange={(e) => setRole(e.target.value)} aria-label={tx('pos.all_roles_2')} data-testid="role"><option value="">{tx('pos.all_roles_2')}</option>{ROLES.map((x) => <option key={x} value={x}>{roleName(x)}</option>)}</select>
          <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.all_status')} data-testid="status"><option value="">{tx('pos.all_status')}</option>{STATUSES.map((x) => <option key={x} value={x}>{liveName(x)}</option>)}</select>
          <select className="fk-select" value={shift} onChange={(e) => setShift(e.target.value)} aria-label={tx('pos.all_shifts')} data-testid="shift"><option value="">{tx('pos.all_shifts')}</option>{SHIFTS.map((x) => <option key={x} value={x}>{tx('tmm.shiftF.' + x)}</option>)}</select>
          <select className="fk-select" value={department} onChange={(e) => setDepartment(e.target.value)} aria-label={tx('pos.all_departments')} data-testid="department"><option value="">{tx('pos.all_departments')}</option>{DEPTS.map((x) => <option key={x} value={x}>{deptName(x)}</option>)}</select>
          <button type="button" className={'fk-btn ' + (moreOpen ? '' : 'ghost')} aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)} data-testid="more-filters">{tx('pos.more_filters_2')}</button>
          <button type="button" className="fk-btn ghost" onClick={clearAll} data-testid="clear-all">{tx('pos.clear_all')}</button>
          <label className="tm2-size">{tx('tm2.perPage')}<select className="fk-select" value={pageSize} onChange={(e) => setU({ size: Number(e.target.value) })} data-testid="page-size">{TEAM_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        </div>
        {moreOpen ? <div className="mos-tools tmm-more" data-testid="more-panel">
          <label className="fk-field">{tx('tmm.f.account')}<select className="fk-select" value={account} onChange={(e) => setAccount(e.target.value)} data-testid="account">{ACCOUNTS.map((x) => <option key={x} value={x}>{tx('tmm.accountF.' + x)}</option>)}</select></label>
          <label className="fk-field">{tx('tmm.f.extra')}<select className="fk-select" value={extra} onChange={(e) => setExtra(e.target.value)} data-testid="extra">{EXTRAS.map((x) => <option key={x} value={x}>{tx('tmm.extra.' + (x || 'none'))}</option>)}</select></label>
          <label className="fk-field">{tx('tmm.f.sort')}<select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} data-testid="sort">{SORTS.map((x) => <option key={x} value={x}>{tx('tmm.sort.' + x)}</option>)}</select></label>
        </div> : null}
        {dir.error ? <StateBlock error={dir.error} onRetry={dir.reload}><span className="fk-hint">{tx('tmm.searchKept')}</span></StateBlock> : !dirD ? <div className="fk-loading">{tx('pos.loading')}</div> : dirD.items.length === 0 ? <Empty title={tx('pos.no_matching_team_members')}>{q || role || status || shift || department || extra || tab !== 'all' ? <button type="button" className="fk-btn" onClick={clearAll}>{tx('pos.clear_all')}</button> : null}</Empty> :
          <div className="tmm-scroll">
          {sel.length ? <div className="mos-tools" data-testid="bulk-bar" role="toolbar" aria-label={tx('tmm.bulk.aria')}>
            <b data-testid="bulk-count">{tx('tmm.bulk.count', { n: String(sel.length) })}</b>
            <button type="button" className="fk-btn ghost sm" aria-pressed={selOnly} onClick={() => setSelOnly((v) => !v)} data-testid="bulk-review">{selOnly ? tx('tmm.bulk.showAll') : tx('tmm.bulk.review')}</button>
            <button type="button" className="fk-btn ghost sm" onClick={() => setPrintOpen(dirD.items.filter((m: any) => sel.includes(m.memberId)))} data-testid="bulk-print">{tx('tmm.bulk.print')}</button>
            {bulkAsk === 'export' ? <span data-testid="bulk-confirm">{tx('tmm.bulk.confirmExport', { n: String(sel.length) })} <button type="button" className="fk-btn sm" onClick={() => void doExport(true)} disabled={exporting} data-testid="bulk-export-yes">{tx('tmm.bulk.exportYes')}</button> <button type="button" className="fk-btn ghost sm" onClick={() => setBulkAsk(null)}>{tx('pos.cancel')}</button></span>
              : <button type="button" className="fk-btn ghost sm" onClick={() => setBulkAsk('export')} disabled={exporting} data-testid="bulk-export">{tx('tmm.bulk.export')}</button>}
            <button type="button" className="fk-link" onClick={() => { setSel([]); setSelOnly(false); setBulkAsk(null); }} data-testid="bulk-clear">{tx('tmm.bulk.clear')}</button>
            <span className="fk-hint">{tx('tmm.bulk.rule')}</span>
          </div> : null}
          <table className="fk-table fn-table cg-table tmm-table" data-testid="member-table">
            <thead><tr><th><input type="checkbox" aria-label={tx('tmm.bulk.selectPage')} data-testid="bulk-select-page" checked={dirD.items.length > 0 && dirD.items.every((m: any) => sel.includes(m.memberId))} onChange={(e) => { const ids = dirD.items.map((m: any) => m.memberId as string); setSel((xs) => (e.target.checked ? [...new Set([...xs, ...ids])].slice(0, 100) : xs.filter((x) => !ids.includes(x)))); }} /></th><th>{tx('pos.team_member')}</th><th>{tx('pos.role_2')}</th><th className="t-opt2">{tx('pos.department')}</th><th>{tx('pos.shift')}</th><th>{tx('pos.status')}</th><th>{tx('pos.performance')}</th>
              <th className="num">{tx('pos.services')}</th><th className="num t-opt">{tx('pos.revenue')}</th><th className="num">{tx('tmm.col.commission')}</th><th aria-label={tx('pos.actions')}>{tx('pos.actions')}</th></tr></thead>
            <tbody>{dirD.items.map((m: any) => <tr key={m.memberId} data-testid="member-row" className={isNew(m) ? 'tm2-new' : undefined} data-new={isNew(m) ? '1' : undefined}>
              <td><input type="checkbox" aria-label={tx('tmm.bulk.selectRow', { name: m.name })} checked={sel.includes(m.memberId)} onChange={() => toggleSel(m.memberId)} data-testid="bulk-select-row" /></td>
              <td><div className="tc-who"><ProfileAvatarWithPreview name={m.name} url={m.avatarUrl} size={34} type={m.isProvider ? 'technician' : 'staff'} />
                <span><button type="button" className="fk-link tmm-name" onClick={() => setProfile({ id: m.memberId })} title={tx('pos.open_profile')} data-testid="row-name">{m.name}</button>
                  <span className="fk-li-s"><span className="mos-mono">{m.code}</span>{m.email ? ` · ${m.email}` : ''}{m.phone ? ` · ${m.phone}` : ''}</span>
                  {m.matchedVia ? <span className="fk-li-s">{tx('tmm.matched.' + m.matchedVia)}{m.matchedServices.length ? `: ${m.matchedServices.join(', ')}` : ''}</span> : null}</span></div></td>
              <td>{m.roles.map(roleName).join(' + ')}{m.roleLabel && !m.roles.includes('other') ? <span className="fk-li-s">{m.roleLabel}</span> : null}</td>
              <td className="t-opt2">{deptName(m.department)}</td>
              <td>{m.shift ? rangeText(m.shift) : m.isProvider ? <span className="fk-muted">{m.shiftSource === 'override_off' || m.shiftSource === 'time_off' ? tx('tmm.src.' + m.shiftSource) : tx('tmm.noShift')}</span> : '—'}
                {m.shift && m.shiftSource ? <span className="fk-li-s">{tx('tmm.src.' + m.shiftSource)}</span> : null}</td>
              <td><span className={'fk-chip ' + (LIVE_TONE[m.live] ?? 'mut')}>{liveName(m.live)}</span>{m.account !== 'active' ? <span className="fk-li-s">{tx('tmm.account.' + m.account)}</span> : null}</td>
              <td>{!m.isProvider ? '—' : m.rating == null ? <span className="fk-muted">{tx('tmm.unrated')}</span> : <><b>{m.rating.toFixed(1)} ★</b><span className="fk-li-s">{tx('tmm.reviewsN', { n: nf(m.ratingCount) })}</span></>}</td>
              <td className="num">{m.servicesCompleted == null ? '—' : nf(m.servicesCompleted)}</td>
              <td className="num t-opt">{m.isProvider ? money(m.revenueCents) : '—'}</td>
              <td className="num">{m.isProvider ? money(m.commissionEarnedCents) : '—'}</td>
              <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => setProfile({ id: m.memberId })} data-testid="row-profile">{tx('pos.profile_2')}</button>
                {m.isProvider ? <button type="button" className="fk-btn ghost sm t-opt3" onClick={() => setDateShift({ technicianId: m.technicianId, name: m.name })} data-testid="row-date-shift" aria-label={tx('tmm.editDateShift')}>{tx('tmm.dateShortcut')}</button> : null}
                <button type="button" className="fk-btn ghost sm t-opt" onClick={() => nav('/messages')} aria-label={tx('pos.message')}>✉</button></td>
            </tr>)}</tbody></table></div>}
        <p className="fk-hint">{tx('tmm.dirRule')}</p>
        {printOpen ? <div className="co-overlay" role="dialog" aria-modal="true" aria-label={tx('tmm.bulk.printTitle')} data-testid="bulk-print-view"><div className="co-card">
          <h2>{tx('tmm.bulk.printTitle')}</h2>
          <table className="fk-table"><thead><tr><th>{tx('pos.team_member')}</th><th>{tx('pos.role_2')}</th><th>{tx('pos.shift')}</th><th>{tx('pos.status')}</th></tr></thead>
            <tbody>{printOpen.map((m: any) => <tr key={m.memberId} data-testid="bulk-print-row"><td>{m.name} <span className="mos-mono">{m.code}</span></td><td>{m.roles.map(roleName).join(' + ')}</td><td>{m.shift ? rangeText(m.shift) : '—'}</td><td>{liveName(m.live)}</td></tr>)}</tbody></table>
          <div className="mos-tools"><button type="button" className="fk-btn" onClick={() => window.print()} data-testid="bulk-print-go">{tx('tmm.bulk.printGo')}</button><button type="button" className="fk-btn ghost" onClick={() => setPrintOpen(null)}>{tx('pos.close')}</button></div>
        </div></div> : null}
      </FitPanel>}

      <div className="mos-row two cg-row">
        <FitPanel testId="attendance" title={tx('pos.team_attendance_today')} actions={<button type="button" className="fk-btn ghost sm" onClick={() => nav('/tenant/team/time-clock')} data-testid="view-attendance">{tx('pos.view_full_attendance')}</button>}>
          {!a ? (dash.error || failed('team') ? <StateBlock error={dash.error ?? new Error(tx('tmm.kpi.error'))} onRetry={dash.reload} /> : <div className="fk-loading">{tx('pos.loading')}</div>)
            : <Donut items={[['available', a.available], ['in_service', a.inService + a.assigned], ['on_shift', a.onShift], ['on_break', a.onBreak], ['time_off', a.timeOff], ['off', a.off], ['not_tracked', a.notTracked]]
              .map(([key, n]) => ({ key: String(key), label: liveName(String(key)), count: Number(n) }))} />}
          {a ? <div className="fk-hint">{tx('tmm.att.rule', { s: nf(a.scheduledToday), c: nf(a.clockedToday), at: whenTime(d?.asOf) })}</div> : null}
        </FitPanel>
        <FitPanel testId="performance" title={tx('pos.performance_overview')} actions={<span className="fk-muted">{tx('tmm.inPeriod')}</span>}>
          {!b ? <div className="fk-loading">{tx('pos.loading')}</div> : <ul className="fk-list dense">{BANDS.map((x) => <li key={x} className="fk-li"><span className="fk-li-t">{tx('tc.band.' + x)}</span>
            <button type="button" className={'fk-chip ' + (x === 'needs' ? 'warn' : x === 'unrated' ? 'mut' : 'ok')} onClick={() => (x === 'unrated' ? toDir({ extra: 'unrated' }) : nav('/tenant/team/performance'))} data-testid={'band-' + x}>{nf(b[x === 'very_good' ? 'veryGood' : x])}</button></li>)}</ul>}
          <div className="fk-hint">{tx('tmm.bandRule')}</div>
        </FitPanel>
      </div>
      <div className="mos-row two cg-row">
        <FitPanel testId="top-performers" title={tx('pos.top_performers')} actions={<button type="button" className="fk-btn ghost sm" onClick={() => nav('/tenant/team/performance')}>{tx('pos.view_all_4')}</button>}>
          {!d ? <div className="fk-loading">{tx('pos.loading')}</div> : !d.topPerformers?.length ? <Empty title={tx('tc.noTop')} />
            : <ul className="fk-list dense" data-testid="top-list">{d.topPerformers.map((t: any, i: number) => <li key={t.memberId} className="fk-li"><span className="fk-li-t">{i + 1}. {t.name}<span className="fk-li-s">{tx('tmm.pf.stars', { r: t.rating.toFixed(1), n: nf(t.ratingCount) })}{t.lowSample ? ` · ${tx('tmm.lowSample')}` : ''}</span></span>
              <button type="button" className="fk-btn ghost sm" onClick={() => setProfile({ id: t.memberId, tab: 'performance' })}>{tx('pos.profile_2')}</button></li>)}</ul>}
          <div className="fk-hint">{tx('tmm.topRule')}</div>
        </FitPanel>
        <FitPanel testId="shift-overview" title={tx('pos.today_s_shift_overview')} actions={<button type="button" className="fk-btn ghost sm" onClick={() => nav('/technicians/schedule')} data-testid="view-shifts">{tx('pos.view_all_shifts')}</button>}>
          {!so ? <div className="fk-loading">{tx('pos.loading')}</div> : so.items.length === 0 ? <Empty title={tx('tmm.so.none')} />
            : <ul className="fk-list dense" data-testid="shift-list">{so.items.map((x: any) => <li key={x.memberId} className="fk-li"><span className="fk-li-t">{x.name}<span className="fk-li-s">{rangeText(x.shift) ?? '—'} · {tx('tmm.src.' + x.source)}</span></span>
              <span className={'fk-chip ' + (x.clockedIn ? 'ok' : 'mut')}>{x.clockedIn ? tx('tmm.so.clockedIn') : tx('tmm.so.notClockedIn')}</span></li>)}</ul>}
          {so ? <div className="fk-hint" data-testid="shift-rule">{tx('tmm.so.rule', { s: nf(so.scheduled), o: nf(so.onShiftNow), c: nf(so.clockedToday) })}</div> : null}
        </FitPanel>
      </div>
      <div className="mos-row two cg-row">
        <FitPanel testId="productivity" title={tx('pos.team_productivity')} actions={<span className="fk-muted">{tx('tmm.inPeriod')}</span>}>
          {!pr ? <div className="fk-loading">{tx('pos.loading')}</div> : <dl className="fk-dl mo-dl">
            <dt>{tx('pos.services_completed')}</dt><dd>{nf(pr.servicesCompleted)} {dl(delta(pr.servicesCompleted, pr.previous?.servicesCompleted))}</dd>
            <dt>{tx('pos.revenue_generated')}</dt><dd>{money(pr.revenueCents)} {dl(delta(pr.revenueCents, pr.previous?.revenueCents))}</dd>
            <dt>{tx('pos.commission_earned')}</dt><dd>{money(pr.commissionEarnedCents)} {dl(delta(pr.commissionEarnedCents, pr.previous?.commissionEarnedCents))}</dd></dl>}
          <div className="fk-hint">{pr?.previous ? tx('tmm.prod.vs', { f: pr.previous.from, t: pr.previous.to }) : tx('tmm.prod.rule')}</div>
        </FitPanel>
        <FitPanel testId="approvals" title={tx('pos.pending_approvals')} actions={<button type="button" className="fk-btn ghost sm" onClick={() => nav('/technicians/skill-requests')} data-testid="view-approvals">{tx('pos.view_all_4')}</button>}>
          {!d ? <div className="fk-loading">{tx('pos.loading')}</div> : !d.approvals ? <StateBlock error={new Error(tx('tmm.kpi.error'))} onRetry={dash.reload} /> : d.approvals.every((x: any) => !x.count) ? <Empty title={tx('tmm.ap.none')} />
            : <ul className="fk-list dense" data-testid="approval-list">{d.approvals.filter((x: any) => x.count).map((x: any) => <li key={x.type} className="fk-li"><span className="fk-li-t">{tx('tmm.ap.' + x.type)}</span>
              <button type="button" className="fk-chip warn" onClick={() => nav(x.type === 'skills' ? '/technicians/skill-requests' : x.type === 'time_off' ? '/technicians' : '/approvals')}>{nf(x.count)}</button></li>)}</ul>}
          <div className="fk-hint">{tx('tmm.ap.rule')}</div>
        </FitPanel>
      </div>
      <div className="mos-row two cg-row">
        <TeamBirthdaysPanel tick={tick} onOpenMember={(id) => setProfile({ id })} />
        <TeamTrainingPanel tick={tick} certs={ce} onCatalog={() => setCatalogOpen(true)} />
      </div>

      {profile ? <EmployeeProfileOverlay key={profile.id + (profile.tab ?? '')} memberId={profile.id} initialTab={profile.tab} today={today} onClose={() => setProfile(null)} onFinder={() => { setProfile(null); setFinder(true); }} /> : null}
      {addOpen ? <AddTeamMemberDialog onClose={() => setAddOpen(false)} onOpenMember={(id) => { setAddOpen(false); setProfile({ id }); }}
        onCreated={(id) => { setAddOpen(false); setTick((n) => n + 1); nav(teamCreatedPath(id, window.location.search)); /* TM-03: filters kept, page 1, highlighted */ }} /> : null}
      {catalogOpen ? <TeamTrainingCatalog onClose={() => setCatalogOpen(false)} onChanged={() => setTick((n) => n + 1)} /> : null}
      {finder ? <TeamAvailableFinder today={today} onClose={() => setFinder(false)} onOpenMember={(id) => { setFinder(false); setProfile({ id }); }} /> : null}
      {dateShift === 'pick' ? <DateShiftLauncher today={today} canEdit={canEditSchedule} onClose={() => setDateShift(null)} onSaved={() => setTick((n) => n + 1)} /> : null}
      {dateShift && dateShift !== 'pick' ? <DateShiftEditor technicianId={dateShift.technicianId} technicianName={dateShift.name} initialDate={today} today={today} canEdit={canEditSchedule} onClose={() => setDateShift(null)} onSaved={() => setTick((n) => n + 1)} /> : null}
    </div>
  );
}
