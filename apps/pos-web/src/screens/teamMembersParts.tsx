// teamMembersParts.tsx — the four priority workflows of Team Management (/tenant/team/members, 30 Oct 2026):
//   EmployeeProfileOverlay  ANY staff member by permanent id (user or technician): header (avatar, name, id, roles,
//                           department — derived —, branch, live status) and lazy tabs Overview · Roles & Access ·
//                           Schedule · Attendance · Skills · Appointments & Work · Performance · Earnings (pay permission) ·
//                           Training · History. Close / Esc returns to the same search, filters and page.
//   TeamAvailableFinder     service(s) + date + desired start (or earliest) → the BOOKING ENGINE's openings and slots
//                           (mapping, shift, breaks, time off, bookings, the full duration) + the live state "right now";
//                           ranked, with reasons; Open Booking hands over to the existing booking flow (it re-checks).
//   DateShiftLauncher       Edit Selected Date Shift for a chosen employee → the existing DateShiftEditor (one date only).
//   TeamDataAlertsPanel     Run Check · the persisted alerts · the slide-over review (assign / investigate / note /
//                           resolve / dismiss / reopen) — workflow only; nothing is fixed automatically.
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posTeamMembersScreenApi, posTeamDataAlertsApi, posTeamPerformanceScreenApi } from '../api/posTeamScreensApi';
import { posBookingApi } from '../api/posBookingApi';
import { posCatalogApi } from '../api/posCatalogApi';
import { fmtMoney } from '../i18n/format';
import { FitDialog, FitPanel, Pager, Empty, useDebounced } from '../components/FitKit';
import { useLoad, StateBlock, isForbidden, fmtYmdSafe } from '../components/FinanceKit';
import { codeLabel } from '../components/peopleLabels';
import { DateShiftEditor } from './dateShiftEditor';
import { pageOf, whenTime } from './technicianScreenParts';
import { PreferredPicker, PreferredVerdict } from './teamPreferredParts';
import { nf, hm12 } from './teamShared';
import { MemberTraining, MemberBirthday } from './teamStaffParts';

export const LIVE_TONE: Record<string, string> = { available: 'ok', in_service: 'info', assigned: 'info', on_break: 'warn', on_shift: 'ok', off: 'mut', time_off: 'info', not_tracked: 'mut' };
export const roleName = (r: string) => tx('tmm.role.' + r);
export const deptName = (d: string) => tx('tmm.dept.' + d);
export const liveName = (s: string) => tx('tmm.live.' + s);
const money = (c: number | null | undefined) => (c == null ? '—' : fmtMoney(c));
const addMin = (hhmm: string, mins: number) => { const [h, m] = hhmm.split(':').map(Number); const t = h * 60 + m + mins; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
/** "09:00–17:00" → "9:00 AM – 5:00 PM" in the user's clock */
export const rangeText = (r: string | null | undefined) => (r ? r.split('–').map((x) => hm12(x)).join(' – ') : null);

type PTab = 'overview' | 'access' | 'schedule' | 'attendance' | 'skills' | 'work' | 'performance' | 'earnings' | 'training' | 'history';
export function EmployeeProfileOverlay({ memberId, initialTab, today, onClose, onFinder }: { memberId: string; initialTab?: PTab; today: string; onClose: () => void; onFinder: () => void }) {
  const nav = useNavigate();
  const [t, setT] = useState<PTab>(initialTab ?? 'overview');
  const [ap, setAp] = useState(1); const [scope, setScope] = useState<'upcoming' | 'past' | 'services'>('upcoming'); const [atp, setAtp] = useState(1); const [atPreset, setAtPreset] = useState('month'); const [hp, setHp] = useState(1);
  const [shiftOpen, setShiftOpen] = useState(false); const [tick, setTick] = useState(0);
  const head = useLoad(() => posTeamMembersScreenApi.profile(memberId), [memberId]);
  const p: any = head.data;
  const lazy = (k: PTab, fn: () => Promise<any>, deps: unknown[] = []) => useLoad(() => (t === k ? fn() : Promise.resolve(null)), [memberId, t, ...deps]);   // eslint-disable-line react-hooks/rules-of-hooks
  const access = lazy('access', () => posTeamMembersScreenApi.access(memberId));
  const sched = lazy('schedule', () => posTeamMembersScreenApi.schedule(memberId), [tick]);
  const att = lazy('attendance', () => posTeamMembersScreenApi.attendance(memberId, { preset: atPreset, page: atp, pageSize: 8 }), [atPreset, atp]);
  const skills = lazy('skills', () => posTeamMembersScreenApi.skills(memberId));
  const work = lazy('work', () => posTeamMembersScreenApi.work(memberId, { scope, page: ap, pageSize: 8, preset: 'month' }), [scope, ap]);
  const perf = lazy('performance', () => posTeamMembersScreenApi.performance(memberId, { preset: 'month' }));
  const comp = useLoad(() => (t === 'performance' && p?.technicianId ? posTeamPerformanceScreenApi.composite(p.technicianId, { preset: 'month' }) : Promise.resolve(null)), [memberId, t, p?.technicianId]);
  const earn = lazy('earnings', () => posTeamMembersScreenApi.earnings(memberId, { preset: 'month' }));
  const train = lazy('training', () => posTeamMembersScreenApi.training(memberId));
  const hist = lazy('history', () => posTeamMembersScreenApi.history(memberId, { page: hp, pageSize: 8 }), [hp]);
  const tabs: PTab[] = ['overview', ...(p?.can?.access ? ['access' as const] : []), 'schedule', 'attendance', 'skills', 'work', 'performance', ...(p?.can?.pay ? ['earnings' as const] : []), 'training', 'history'];
  const notProvider = <Empty title={tx('tmm.p.notProvider')}><span className="fk-hint">{tx('tmm.p.notProviderWhy')}</span></Empty>;
  const body = (x: { data: any; error: unknown; reload: () => void }, render: (d: any) => ReactNode) => (x.error ? <StateBlock error={x.error} onRetry={x.reload} /> : !x.data ? <div className="fk-loading">{tx('pos.loading')}</div> : render(x.data));
  return (
    <FitDialog wide title={p?.name ?? tx('tmm.p.title')} onClose={onClose} testId="dlg-member-profile"
      subtitle={p ? <span className="tmm-phead" data-testid="profile-head">
        <ProfileAvatarWithPreview name={p.name} url={p.avatarUrl} size={40} type={p.isProvider ? 'technician' : 'staff'} />
        <span><b className="mos-mono" data-testid="profile-code">{p.code}</b> · {p.roles.map(roleName).join(' + ')} · {deptName(p.department)} <span className="fk-li-s">({tx('tmm.derived')})</span>{p.branchName ? ` · ${p.branchName}` : ''}</span>
        <span className={'fk-chip ' + (LIVE_TONE[p.live] ?? 'mut')} data-testid="profile-live">{liveName(p.live)}</span>
        {p.account !== 'active' ? <span className="fk-chip warn">{tx('tmm.account.' + p.account)}</span> : null}</span> : undefined}
      footer={<>
        {p?.isProvider ? <button type="button" className="fk-btn ghost" onClick={onFinder} data-testid="profile-finder">{tx('tmm.finder')}</button> : null}
        {p?.can?.editMember ? <button type="button" className="fk-btn ghost" onClick={() => nav(p.technicianId ? `/technicians/${encodeURIComponent(p.technicianId)}` : '/tenant/account/users-roles')} data-testid="profile-edit">{tx('pos.edit')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose} data-testid="profile-close">{tx('pos.close')}</button></>}>
      {head.error ? <StateBlock error={head.error} onRetry={head.reload} /> : !p ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fk-seg mos-dtabs tmm-tabs" role="tablist" aria-label={tx('tmm.p.title')}>
          {tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={t === k} className={t === k ? 'on' : ''} onClick={() => setT(k)} data-testid={'mt-' + k}>{tx('tmm.ptab.' + k)}</button>)}
        </div>
        <div data-testid={'mt-' + t + '-body'}>
        {t === 'overview' ? <dl className="fk-dl mo-dl">
          <dt>{tx('tmm.f.id')}</dt><dd className="mos-mono">{p.memberId}{p.technicianId && p.technicianId !== p.memberId ? <span className="fk-li-s">{tx('tmm.f.techId', { id: p.technicianId })}</span> : null}</dd>
          <dt>{tx('tmm.f.roles')}</dt><dd>{p.roles.map(roleName).join(' + ')}{p.roleLabel ? <span className="fk-li-s">{p.roleLabel}</span> : null}</dd>
          <dt>{tx('pos.department')}</dt><dd>{deptName(p.department)} <span className="fk-li-s">{tx('tmm.deptRule')}</span></dd>
          <dt>{tx('tmm.f.now')}</dt><dd>{liveName(p.live)}{p.liveSince ? <span className="fk-li-s">{tx('tmm.since', { at: whenTime(p.liveSince) })}</span> : null}</dd>
          <dt>{tx('tmm.f.shiftToday')}</dt><dd>{rangeText(p.shift) ?? (p.isProvider ? tx('tmm.noShift') : '—')}{p.shiftSource ? <span className="fk-li-s">{tx('tmm.src.' + p.shiftSource)}</span> : null}</dd>
          <dt>{tx('tmm.f.contact')}</dt><dd>{p.phone ?? '—'}{p.email ? ` · ${p.email}` : ''}{p.contactMasked ? <span className="fk-li-s">{tx('tmm.contactMasked')}</span> : null}</dd>
          <dt>{tx('tmm.f.start')}</dt><dd>{whenTime(p.employmentStart?.at)}<span className="fk-li-s">{tx('tmm.start.' + p.employmentStart?.source)}</span></dd>
          <dt>{tx('tmm.f.updated')}</dt><dd>{whenTime(p.lastUpdate)}</dd>
          <dt>{tx('tmm.f.bio')}</dt><dd>{p.bio ?? <span className="fk-hint">{tx('tmm.noBio')}</span>}</dd>
          <dt>{tx('tms.bd.label')}</dt><dd><MemberBirthday memberId={p.memberId} /></dd>
          {p.access ? <><dt>{tx('tmm.f.login')}</dt><dd>{p.userId ? `${whenTime(p.access.lastLoginAt)} · ${p.access.mfaEnabled ? tx('tmm.mfaOn') : tx('tmm.mfaOff')}` : tx('tmm.noLogin')}</dd></> : null}
        </dl> : null}
        {t === 'access' ? body(access, (a) => <>
          <dl className="fk-dl mo-dl"><dt>{tx('tmm.a.account')}</dt><dd>{a.accountRole ? roleName(({ OWNER: 'owner', MANAGER: 'manager', FRONT_DESK: 'receptionist', RECEPTION: 'receptionist', TECHNICIAN: 'nail_technician' } as Record<string, string>)[a.accountRole] ?? 'other') : '—'}{!a.hasLogin ? ` · ${tx('tmm.noLogin')}` : ''}</dd>
            <dt>{tx('tmm.a.branches')}</dt><dd>{a.allBranches ? tx('tmm.a.allBranches') : a.branches.length ? a.branches.map((b: any) => `${b.name ?? '—'}${b.accessLevel ? ` (${b.accessLevel})` : ''}`).join(', ') : tx('tmm.a.homeOnly')}</dd>
            <dt>{tx('tmm.a.templates')}</dt><dd>{a.templates.length ? a.templates.map((x: any) => x.key).join(', ') : '—'}</dd>
            <dt>{tx('tmm.a.perms')}</dt><dd>{tx('tmm.a.permsN', { n: nf(a.permissions.count) })}<span className="fk-li-s">{a.permissions.domains.map((d: any) => `${d.domain} ${d.count}`).join(' · ')}</span></dd></dl>
          <p className="fk-hint">{tx('tmm.a.rule')}</p></>) : null}
        {t === 'schedule' ? body(sched, (s) => !s.provider ? notProvider : <>
          <table className="fk-table fn-table cg-table" data-testid="weekly-table"><thead><tr><th>{tx('tmm.s.day')}</th><th>{tx('tmm.s.weekly')}</th><th>{tx('tmm.s.lunch')}</th></tr></thead>
            <tbody>{s.weekly.map((w: any) => <tr key={w.dayOfWeek}><td>{tx('tmm.dow.' + w.dayOfWeek)}</td><td>{w.working == null ? tx('tmm.s.notSet') : w.working ? `${hm12(w.start)} – ${hm12(w.end)}` : tx('tmm.s.off')}</td>
              <td>{w.lunchStart ? `${hm12(w.lunchStart)} – ${hm12(w.lunchEnd)}` : '—'}</td></tr>)}</tbody></table>
          <dl className="fk-dl mo-dl"><dt>{tx('tmm.s.today')}</dt><dd>{rangeText(s.todayShift.text) ?? tx('tmm.noShift')}{s.todayShift.source ? <span className="fk-li-s">{tx('tmm.src.' + s.todayShift.source)}</span> : null}</dd>
            <dt>{tx('tmm.s.next')}</dt><dd data-testid="next-shift">{s.next ? `${fmtYmdSafe(s.next.date)} · ${rangeText(s.next.shift)}` : tx('tmm.s.noNext')}{s.next ? <span className="fk-li-s">{tx('tmm.src.' + s.next.source)}</span> : null}</dd></dl>
          <h3 className="fk-h3">{tx('tmm.s.overrides')}</h3>
          {s.overrides.length === 0 ? <p className="fk-hint">{tx('tmm.s.noOverrides')}</p> : <ul className="fk-list dense" data-testid="override-list">{s.overrides.map((o: any) => <li key={o.date} className="fk-li"><span className="fk-li-t">{fmtYmdSafe(o.date)} · {o.type === 'DAY_OFF' ? tx('tmm.s.off') : `${hm12(o.start)} – ${hm12(o.end)}`}<span className="fk-li-s">{tx('tmm.s.version', { v: String(o.version) })}{o.note ? ` · ${o.note}` : ''}</span></span></li>)}</ul>}
          <h3 className="fk-h3">{tx('tmm.s.timeOff')}</h3>
          {s.timeOff.length === 0 ? <p className="fk-hint">{tx('tmm.s.noTimeOff')}</p> : <ul className="fk-list dense">{s.timeOff.map((o: any) => <li key={o.id} className="fk-li"><span className="fk-li-t">{whenTime(o.from)} – {whenTime(o.to)}<span className="fk-li-s">{tx('tmm.to.' + o.status)}</span></span></li>)}</ul>}
          <div className="cg-acts">
            {s.branchRequired ? <span className="fk-hint">{tx('tmm.s.branchFirst')}</span> : <button type="button" className="fk-btn primary" onClick={() => setShiftOpen(true)} data-testid="profile-edit-date-shift">{tx('tmm.editDateShift')}</button>}
            <button type="button" className="fk-btn ghost" onClick={() => nav('/technicians/schedule')}>{tx('tmm.openSchedule')}</button></div>
          {shiftOpen ? <DateShiftEditor technicianId={s.technicianId} technicianName={p.name} initialDate={today} today={today} canEdit={!!s.canEdit} onClose={() => setShiftOpen(false)} onSaved={() => setTick((n) => n + 1)} /> : null}
        </>) : null}
        {t === 'attendance' ? <>
          <div className="fk-seg" role="group" aria-label={tx('tmm.at.period')}>{['today', 'week', 'month', 'year'].map((k) => <button key={k} type="button" className={atPreset === k ? 'on' : ''} aria-pressed={atPreset === k} onClick={() => { setAtPreset(k); setAtp(1); }}>{tx('finance.period.' + k)}</button>)}</div>
          {body(att, (a) => !a.provider ? notProvider : a.items.length === 0 ? <Empty title={tx('tmm.at.none')} /> : <>
            <table className="fk-table fn-table cg-table" data-testid="attendance-table"><thead><tr><th>{tx('tmm.at.date')}</th><th>{tx('tmm.at.in')}</th><th>{tx('tmm.at.out')}</th><th>{tx('tmm.at.planned')}</th><th className="num">{tx('tmm.at.breaks')}</th><th>{tx('tmm.at.exception')}</th></tr></thead>
              <tbody>{a.items.map((x: any) => <tr key={x.id} data-testid="attendance-row"><td>{fmtYmdSafe(x.date)}</td><td>{hm12(x.clockInLocal)}</td><td>{x.clockOutLocal ? hm12(x.clockOutLocal) : tx('tmm.at.open')}</td>
                <td>{x.plannedStart ? hm12(x.plannedStart) : '—'}{x.plannedSource ? <span className="fk-li-s">{tx('tmm.src.' + x.plannedSource)}</span> : null}</td><td className="num">{nf(x.breaks)}{x.breakMinutes ? ` · ${tx('cg.min', { n: nf(x.breakMinutes) })}` : ''}</td>
                <td>{x.exception ? <span className={'fk-chip ' + (x.exception === 'late' || x.exception === 'worked_day_off' ? 'warn' : 'mut')}>{tx('tmm.ex.' + x.exception, { n: String(Math.abs(x.startDeltaMinutes ?? 0)) })}</span> : <span className="fk-chip ok">{tx('tmm.ex.ok')}</span>}</td></tr>)}</tbody></table>
            <Pager info={pageOf(a)} onPage={setAtp} compact /><p className="fk-hint">{tx('tmm.at.rule', { n: String(a.toleranceMinutes) })}</p></>)}
        </> : null}
        {t === 'skills' ? body(skills, (s) => !s.provider ? notProvider : <>
          {s.services.length === 0 ? <div className="fk-note warn" role="status"><span>{tx('tmm.sk.noMapping')}</span></div> : <table className="fk-table fn-table cg-table" data-testid="skills-table"><thead><tr><th>{tx('pos.service_3')}</th><th>{tx('pos.category')}</th><th className="num">{tx('pos.duration')}</th><th>{tx('tmm.sk.via')}</th></tr></thead>
            <tbody>{s.services.map((x: any) => <tr key={x.serviceId}><td>{x.name}{!x.active ? <span className="fk-li-s">{tx('cg.status.inactive')}</span> : null}</td><td>{x.category ?? '—'}</td><td className="num">{tx('cg.min', { n: nf(x.durationMinutes) })}</td><td>{x.grantedVia ?? '—'}{x.proficiency ? ` · ${x.proficiency}` : ''}</td></tr>)}</tbody></table>}
          {s.performedWithoutMapping.length ? <div className="fk-note warn" data-testid="performed-unmapped"><span>{tx('tmm.sk.performedUnmapped')} {s.performedWithoutMapping.map((x: any) => `${x.name ?? '—'} (${nf(x.lines)})`).join(', ')}</span></div> : null}
          {s.requests.length ? <><h3 className="fk-h3">{tx('tmm.sk.requests')}</h3><ul className="fk-list dense">{s.requests.map((r: any) => <li key={r.id} className="fk-li"><span className="fk-li-t">{r.service ?? '—'}<span className="fk-li-s">{codeLabel('tmm.req.' + r.status, r.status)} · {whenTime(r.at)}</span></span></li>)}</ul></> : null}
          <CertList rows={s.certifications} />
          <div className="cg-acts"><button type="button" className="fk-btn ghost" onClick={() => nav('/technicians')}>{tx('tmm.sk.manage')}</button></div></>) : null}
        {t === 'work' ? <>
          <div className="fk-seg" role="tablist">{(['upcoming', 'past', 'services'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} onClick={() => { setScope(k); setAp(1); }} data-testid={'work-' + k}>{tx('tmm.w.' + k)}</button>)}</div>
          {body(work, (w) => !w.provider ? notProvider : <>
            {w.counts ? <p className="fk-hint" data-testid="work-counts">{tx('tmm.w.counts', { u: nf(w.counts.upcoming), c: nf(w.counts.cancelled), n: nf(w.counts.noShow) })}</p> : null}
            {w.items.length === 0 ? <Empty title={tx('tmm.w.none')} /> : w.scope === 'services'
              ? <table className="fk-table fn-table cg-table" data-testid="work-table"><thead><tr><th>{tx('tc.col.when')}</th><th>{tx('pos.service_3')}</th><th>{tx('tc.col.ticket')}</th><th className="num">{tx('tc.col.amount')}</th></tr></thead>
                <tbody>{w.items.map((x: any) => <tr key={x.id}><td>{whenTime(x.at)}</td><td>{x.service ?? '—'}{x.addOn ? <span className="fk-li-s">{tx('cg.kind.add_on')}</span> : null}{x.techsOnTicket > 1 ? <span className="fk-li-s">{tx('tmm.w.shared', { n: nf(x.techsOnTicket) })}</span> : null}</td><td>{x.ticketNumber ? '#' + x.ticketNumber : '—'}</td><td className="num">{money(x.amountCents)}</td></tr>)}</tbody></table>
              : <table className="fk-table fn-table cg-table" data-testid="work-table"><thead><tr><th>{tx('tc.col.when')}</th><th>{tx('tc.col.services')}</th><th>{tx('tc.col.customer')}</th><th>{tx('pos.status')}</th></tr></thead>
                <tbody>{w.items.map((x: any) => <tr key={x.id}><td>{fmtYmdSafe(x.date)} · {hm12(x.start)}<span className="fk-li-s mos-mono">{x.id.slice(0, 8)}</span></td><td>{x.services.join(', ') || '—'}</td><td>{x.customer ?? '—'}</td><td>{codeLabel('tc.apptStatus.' + x.status, x.status)}</td></tr>)}</tbody></table>}
            <Pager info={pageOf(w)} onPage={setAp} compact /></>)}
        </> : null}
        {t === 'performance' ? body(perf, (f) => !f.provider ? notProvider : <>
          <dl className="fk-dl mo-dl" data-testid="performance-stars"><dt>{tx('tmm.pf.allTime')}</dt><dd>{f.allTime.rating == null ? tx('tmm.unrated') : tx('tmm.pf.stars', { r: f.allTime.rating.toFixed(1), n: nf(f.allTime.count) })}</dd>
            <dt>{tx('tmm.pf.period')}</dt><dd>{f.inPeriod.rating == null ? tx('tmm.pf.noneInPeriod') : tx('tmm.pf.stars', { r: f.inPeriod.rating.toFixed(1), n: nf(f.inPeriod.count) })}</dd></dl>
          {f.recent.length ? <ul className="fk-list dense">{f.recent.map((v: any) => <li key={v.id} className="fk-li"><span className="fk-li-t">{'★'.repeat(Math.round(v.rating))}<span className="fk-li-s">{v.comment ?? ''} · {whenTime(v.at)}</span></span></li>)}</ul> : null}
          <h3 className="fk-h3">{tx('tmm.pf.composite')}</h3>
          {comp.error ? <StateBlock error={comp.error} onRetry={comp.reload} /> : !comp.data ? <div className="fk-loading">{tx('pos.loading')}</div>
            : <p data-testid="composite-value">{comp.data.available ? tx('tmm.pf.pts', { s: String(comp.data.score) }) : tx('tmm.pf.insufficient')}<span className="fk-li-s">{tx('tmm.pf.compositeRule')}</span></p>}</>) : null}
        {t === 'earnings' ? body(earn, (e) => !e.provider ? notProvider : <>
          <dl className="fk-dl mo-dl" data-testid="earnings-body"><dt>{tx('tmm.e.earned')}</dt><dd>{money(e.earnedCents)}<span className="fk-li-s">{tx('tmm.e.earnedRule')}</span></dd>
            <dt>{tx('tmm.e.tips')}</dt><dd>{money(e.tipsCents)}</dd><dt>{tx('tmm.e.adjustments')}</dt><dd>{money(e.adjustmentsCents)}</dd>
            <dt>{tx('tmm.e.payable')}</dt><dd>{money(e.payableCents)}<span className="fk-li-s">{tx('tmm.e.payableRule')}</span></dd>
            <dt>{tx('tmm.e.paid')}</dt><dd><b>{money(e.paidCents)}</b><span className="fk-li-s">{tx('tmm.e.paidRule')}</span></dd><dt>{tx('tmm.e.pending')}</dt><dd>{money(e.pendingPayoutCents)}</dd></dl>
          {e.payouts.length ? <ul className="fk-list dense">{e.payouts.map((x: any) => <li key={x.id} className="fk-li"><span className="fk-li-t">{money(x.amountCents)} · {codeLabel('tmm.payout.' + x.status, x.status)}<span className="fk-li-s">{x.period ?? '—'} · {whenTime(x.paidAt ?? x.createdAt)}</span></span></li>)}</ul> : <p className="fk-hint">{tx('tmm.e.noPayouts')}</p>}
          <div className="cg-acts"><button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/reports/commission')}>{tx('tc.openCommission')}</button></div></>) : null}
        {t === 'training' ? body(train, () => <MemberTraining memberId={p.memberId} today={today} />) : null}
        {t === 'history' ? body(hist, (h) => h.items.length === 0 ? <Empty title={tx('tmm.h.none')} /> : <>
          <table className="fk-table fn-table cg-table" data-testid="member-history"><thead><tr><th>{tx('tc.col.when')}</th><th>{tx('tc.col.event')}</th><th>{tx('tc.col.detail')}</th><th>{tx('tc.col.by')}</th></tr></thead>
            <tbody>{h.items.map((x: any) => <tr key={x.id}><td>{whenTime(x.at)}</td><td>{codeLabel('tc.event.' + x.kind.toLowerCase(), x.kind)}<span className="fk-li-s">{tx('tmm.hsrc.' + x.source)}</span></td><td className="cg-reason">{x.detail ?? '—'}</td><td>{x.actor ?? '—'}</td></tr>)}</tbody></table>
          <Pager info={pageOf(h)} onPage={setHp} compact /></>) : null}
        </div>
      </>}
    </FitDialog>
  );
}
function CertList({ rows }: { rows: any[] }) {
  return <><h3 className="fk-h3">{tx('tmm.certs')}</h3>{rows.length === 0 ? <p className="fk-hint">{tx('tmm.noCerts')}</p>
    : <ul className="fk-list dense" data-testid="cert-list">{rows.map((c) => <li key={c.id} className="fk-li"><span className="fk-li-t">{c.name}<span className="fk-li-s">{c.issuer ?? '—'} · {c.expiresAt ? tx('tmm.expires', { d: fmtYmdSafe(c.expiresAt) }) : tx('tmm.noExpiry')}{c.verified ? ` · ${tx('tmm.verified')}` : ''}</span></span>
      <span className={'fk-chip ' + (c.state === 'valid' ? 'ok' : c.state === 'expiring' ? 'warn' : 'bad')}>{tx('tmm.cert.' + c.state)}</span></li>)}</ul>}</>;
}

/** Find Qualified & Available Staff — the booking engine's openings + slots, the live state, ranked with reasons. */
export function TeamAvailableFinder({ today, onClose, onOpenMember }: { today: string; onClose: () => void; onOpenMember: (memberId: string) => void }) {
  const nav = useNavigate();
  const [find, setFind] = useState(''); const fq = useDebounced(find.trim(), 250);
  const [picked, setPicked] = useState<{ serviceId: string; name: string; durationMinutes: number }[]>([]);
  const [date, setDate] = useState(today); const [time, setTime] = useState(''); const [preferred, setPreferred] = useState('');   // TM-04: optional preferred technician
  const svc = useLoad(() => posCatalogApi.services({ q: fq || undefined, status: 'active', sort: 'name', pageSize: 8 }), [fq]);
  const ids = picked.map((p) => p.serviceId);
  const res = useLoad(() => (ids.length ? Promise.all([posBookingApi.openings({ date, serviceIds: ids, limit: 50 }), posBookingApi.availability({ date, serviceIds: ids }), date === today ? posTeamMembersScreenApi.live() : Promise.resolve(null)])
    : Promise.resolve(null)), [ids.join(','), date]);
  type Found = [{ openings: any[]; durationMinutes: number; eligibleCount: number; withOpenings: number } | null, { technicianId: string; slots: string[] }[] | null, { items: any[] } | null];
  const [o, slots, live]: Found = (res.data as Found | null) ?? [null, null, null];
  const liveBy = new Map<string, any>((live?.items ?? []).map((x: any) => [x.technicianId, x]));
  const slotBy = new Map<string, string[]>((Array.isArray(slots) ? slots : []).map((x: any) => [x.technicianId, x.slots ?? []]));
  const rows = (o?.openings ?? []).map((r: any) => {
    const all = slotBy.get(r.technicianId) ?? []; const pick = time ? all.find((s) => s >= time) ?? null : r.time;
    return { ...r, start: pick, exact: !!time && pick === time, live: liveBy.get(r.technicianId) };
  }).filter((r: any) => r.start && r.technicianId !== preferred).sort((a: any, b: any) => (Number(b.exact) - Number(a.exact)) || String(a.start).localeCompare(String(b.start)) || b.openSlots - a.openSlots || a.rank - b.rank);
  const dur = o?.durationMinutes ?? 0;
  const nextDay = () => { const n = new Date(date + 'T12:00:00Z'); n.setUTCDate(n.getUTCDate() + 1); setDate(n.toISOString().slice(0, 10)); };
  return (
    <FitDialog wide title={tx('tmm.finder')} subtitle={tx('tmm.fd.sub')} onClose={onClose} testId="dlg-team-finder" footer={<button type="button" className="fk-btn primary" onClick={onClose} data-testid="finder-close">{tx('pos.close')}</button>}>
      <div className="cg-form four">
        <label className="fk-field">{tx('tc.findService')}<input type="search" value={find} onChange={(e) => setFind(e.target.value)} data-testid="tf-search" /></label>
        <label className="fk-field">{tx('tc.date')}<input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value || today)} data-testid="tf-date" /></label>
        <label className="fk-field">{tx('tmm.fd.time')}<input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} data-testid="tf-time" /></label>
        <PreferredPicker value={preferred} onChange={setPreferred} />
      </div>
      <div className="cg-pick">{(svc.data?.items ?? []).map((s: any) => { const on = ids.includes(s.serviceId); return <button key={s.serviceId} type="button" className={'fk-btn sm ' + (on ? 'primary' : 'ghost')} aria-pressed={on} data-testid="tf-pick"
        onClick={() => setPicked((x) => on ? x.filter((p) => p.serviceId !== s.serviceId) : [...x, { serviceId: s.serviceId, name: s.name, durationMinutes: s.durationMinutes }])}>{on ? '✓ ' : '+ '}{s.name} · {tx('cg.min', { n: nf(s.durationMinutes) })}</button>; })}</div>
      {!ids.length ? <div className="fk-hint" data-testid="tf-prompt">{tx('tc.finderPick')}</div> : res.error ? <StateBlock error={res.error} onRetry={res.reload} /> : !o ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        {preferred ? <PreferredVerdict technicianId={preferred} date={date} time={time} serviceIds={ids} engineSlots={Array.isArray(slots) ? slotBy : null} onOpenMember={(id) => onOpenMember(liveBy.get(id)?.memberId ?? id)}
          onBook={(tid, start) => nav(`/booking/new?technicianId=${encodeURIComponent(tid)}&date=${date}&time=${encodeURIComponent(start)}&serviceId=${encodeURIComponent(ids[0])}`)} /> : null}
        <div className="fk-note ok" data-testid="tf-summary"><span>{tx('tc.finderSummary', { d: nf(dur), e: nf(o.eligibleCount), w: nf(o.withOpenings) })}{time ? ' ' + tx('tmm.fd.fromTime', { t: hm12(time) }) : ''}</span></div>
        {rows.length === 0 ? <Empty title={tx('tmm.fd.none')}>
          <p className="fk-hint" data-testid="tf-why">{o.eligibleCount === 0 ? tx('tmm.fd.whyNoMapping') : o.withOpenings === 0 ? tx('tmm.fd.whyNoGap', { e: nf(o.eligibleCount), d: nf(dur) }) : tx('tmm.fd.whyAfter', { t: hm12(time) })}</p>
          <button type="button" className="fk-btn" onClick={nextDay} data-testid="tf-next-day">{tx('tc.tryNextDay')}</button>{time ? <button type="button" className="fk-btn ghost" onClick={() => setTime('')}>{tx('tmm.fd.anyTime')}</button> : null}</Empty>
          : <table className="fk-table fn-table cg-table" data-testid="tf-table"><thead><tr><th>#</th><th>{tx('tc.col.technician')}</th><th>{tx('tmm.fd.start')}</th><th>{tx('tmm.fd.why')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{rows.map((r: any, i: number) => <tr key={r.technicianId} data-testid="tf-row"><td>{i + 1}</td>
              <td><button type="button" className="fk-link" onClick={() => onOpenMember(r.live?.memberId ?? r.technicianId)}>{r.name}</button></td>
              <td><b>{hm12(r.start)}</b> – {hm12(addMin(r.start, dur))}</td>
              <td><ul className="tm-reasons" data-testid="tf-reasons"><li>{tx('tmm.fd.r.qualified', { n: nf(ids.length) })}</li><li>{tx('tmm.fd.r.gap', { d: nf(dur), t: hm12(r.start) })}</li><li>{tx('tmm.fd.r.left', { n: nf(r.openSlots) })}</li>
                {r.exact ? <li>{tx('tmm.fd.r.exact')}</li> : null}{r.live ? <li>{tx('tmm.fd.r.now', { s: liveName(r.live.live) })}{r.live.live === 'in_service' || r.live.live === 'on_break' ? ' ' + tx('tmm.fd.r.notNow') : ''}</li> : null}</ul></td>
              <td className="fn-acts"><button type="button" className="fk-btn sm primary" data-testid="tf-open-booking" onClick={() => nav(`/booking/new?technicianId=${encodeURIComponent(r.technicianId)}&date=${date}&time=${encodeURIComponent(r.start)}&serviceId=${encodeURIComponent(ids[0])}`)}>{tx('tmm.fd.openBooking')}</button></td></tr>)}</tbody></table>}
        <div className="fk-hint">{tx('tc.finderRule')}</div>
      </>}
    </FitDialog>
  );
}

/** Edit Selected Date Shift from the header: choose the employee, then the existing one-date editor (date picked on its calendar). */
export function DateShiftLauncher({ today, canEdit, onClose, onSaved }: { today: string; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q.trim(), 250); const [who, setWho] = useState<{ technicianId: string; name: string } | null>(null); const [nonProvider, setNonProvider] = useState<string | null>(null);
  const list = useLoad(() => posTeamMembersScreenApi.directory({ q: dq || undefined, pageSize: 8, sort: 'name' }), [dq]);
  if (who) return <DateShiftEditor technicianId={who.technicianId} technicianName={who.name} initialDate={today} today={today} canEdit={canEdit} onClose={onClose} onSaved={onSaved} />;
  return (
    <FitDialog title={tx('tmm.editDateShift')} subtitle={tx('tmm.ds.sub')} onClose={onClose} testId="dlg-date-shift-pick" footer={<button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button>}>
      <label className="fk-field wide">{tx('tmm.ds.find')}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} data-testid="ds-search" /></label>
      {nonProvider ? <div className="fk-note warn" role="status" data-testid="ds-not-provider"><span>{tx('tmm.ds.notProvider', { n: nonProvider })}</span></div> : null}
      {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div> : list.data.items.length === 0 ? <Empty title={tx('pos.no_matching_team_members')} />
        : <ul className="fk-list dense" data-testid="ds-list">{list.data.items.map((m: any) => <li key={m.memberId} className="fk-li"><span className="fk-li-t">{m.name}<span className="fk-li-s">{m.roles.map(roleName).join(' + ')} · {rangeText(m.shift) ?? '—'}</span></span>
          <button type="button" className="fk-btn sm" data-testid="ds-pick" onClick={() => (m.technicianId ? setWho({ technicianId: m.technicianId, name: m.name }) : setNonProvider(m.name))}>{tx('tmm.ds.choose')}</button></li>)}</ul>}
      <p className="fk-hint">{tx('tmm.ds.rule')}</p>
    </FitDialog>
  );
}

// ── Data Accuracy Alerts ──────────────────────────────────────────────────────────────────────────────────────────
const ALERT_TABS = ['open_all', 'OPEN', 'ASSIGNED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED', 'all'] as const;
const ALERT_TYPES = ['', 'SHIFT_STATUS_MISMATCH', 'MISSING_SERVICE_MAPPING', 'COMMISSION_PAID_MISMATCH', 'ATTENDANCE_DISAGREEMENT', 'DUPLICATE_CONTACT', 'STALE_USER_LINK', 'ORPHANED_ASSIGNMENT', 'MISSING_BRANCH_ASSOCIATION', 'DATA_CHECK_JOB_FAILED'];
const statusTone = (s: string) => (s === 'RESOLVED' ? 'ok' : s === 'DISMISSED' ? 'mut' : s === 'INVESTIGATING' ? 'warn' : s === 'ASSIGNED' ? 'info' : 'bad');
const alertErr = (e: unknown) => { const x = e as { status?: number; message?: string } | null; return x?.status === 409 ? tx('cr.err.conflict') : x?.status === 403 ? tx('tmm.al.forbidden') : x?.message || tx('cr.err.generic'); };
export function TeamDataAlertsPanel({ onOpenMember, onCounts }: { onOpenMember: (memberId: string, tab?: PTab) => void; onCounts?: (open: number | null) => void }) {
  const [status, setStatus] = useState<string>('open_all'); const [type, setType] = useState(''); const [page, setPage] = useState(1); const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null); const [running, setRunning] = useState(false); const [runMsg, setRunMsg] = useState<any | null>(null); const [runErr, setRunErr] = useState<string | null>(null);
  useEffect(() => setPage(1), [status, type]);
  const list = useLoad(() => posTeamDataAlertsApi.list({ status, type: type || undefined, page, pageSize: 5 }), [status, type, page, tick]);
  const d: any = list.data;
  useEffect(() => { if (d?.counts) onCounts?.((d.counts.OPEN ?? 0) + (d.counts.ASSIGNED ?? 0) + (d.counts.INVESTIGATING ?? 0)); else if (list.error) onCounts?.(null); }, [d, list.error]);   // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => { setRunning(true); setRunErr(null); setRunMsg(null); try { setRunMsg(await posTeamDataAlertsApi.runCheck()); setTick((n) => n + 1); } catch (e) { setRunErr(alertErr(e)); } finally { setRunning(false); } };
  if (isForbidden(list.error)) return <FitPanel testId="data-alerts" title={tx('tmm.al.title')}><StateBlock error={list.error} onRetry={list.reload} /></FitPanel>;
  return (
    <FitPanel testId="data-alerts" className="tmm-alerts" title={<>{tx('tmm.al.title')}{d ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(d.totalItems) })}</span> : null}</>}
      actions={d?.canReview ? <button type="button" className="fk-btn" onClick={run} disabled={running} aria-busy={running} data-testid="alerts-run-check">{running ? tx('cr.running') : tx('cr.runCheck')}</button> : null}
      footer={<Pager info={pageOf(d)} onPage={setPage} label={tx('tmm.al.title')} compact />}>
      <div className="cr-meta" data-testid="alerts-last-run">{d?.lastRun ? <span>{tx('tmm.al.lastRun', { at: whenTime(d.lastRun.finishedAt ?? d.lastRun.startedAt), who: d.lastRun.actor ?? '—' })}{d.lastRun.status === 'failed' ? <span className="fk-chip bad">{tx('cr.runFailed')}</span> : null}
        {d.lastRun.nightly ? <span className="fk-li-s" data-testid="alerts-nightly">{tx('tms.al.nightly', { d: fmtYmdSafe(d.lastRun.nightly.runDate), s: tx('tms.nightly.' + d.lastRun.nightly.status) })}{d.lastRun.nightly.escalated ? ` · ${tx('tms.al.escalated')}` : ''}</span> : null}</span> : <span>{tx('cr.neverRun')}</span>}</div>
      {runErr ? <div className="fk-note bad" role="alert"><span>{runErr}</span></div> : null}
      {runMsg ? <div className="fk-note ok" role="status" data-testid="alerts-run-result"><span>{tx('tmm.al.runResult', { n: nf(runMsg.detected), k: nf(runMsg.alreadyKnown) })}</span></div> : null}
      <div className="fk-tabs" role="tablist" aria-label={tx('tmm.al.title')}>{ALERT_TABS.map((s) => <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)} data-testid={'al-tab-' + s}>
        {tx('cr.st.' + s)}{d?.counts && s !== 'all' && s !== 'open_all' ? <span className="tq-n">{d.counts[s] ?? 0}</span> : null}</button>)}</div>
      <div className="mos-tools"><select className="fk-select" value={type} onChange={(e) => setType(e.target.value)} aria-label={tx('cr.type')} data-testid="al-type">{ALERT_TYPES.map((x) => <option key={x} value={x}>{x ? tx('tmm.al.t.' + x) : tx('cr.allTypes')}</option>)}</select></div>
      {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : d.items.length === 0 ? <Empty title={d.lastRun ? tx('tmm.al.none') : tx('tmm.al.noneYet')} />
        : <ul className="fk-list dense" data-testid="alert-list">{d.items.map((a: any) => <li key={a.id} className="fk-li" data-testid="alert-row">
          <span className={'fk-chip ' + (a.severity === 'high' ? 'bad' : a.severity === 'medium' ? 'warn' : 'mut')}>{tx('cr.sev.' + a.severity)}</span>
          <span className="fk-li-t">{tx('tmm.al.t.' + a.type)} · {a.member ?? '—'}<span className="fk-li-s">{whenTime(a.detectedAt)} · <span className={'fk-chip ' + statusTone(a.status)}>{tx('cr.st.' + a.status)}</span>{a.assignee ? ` · ${a.assignee}` : ''}</span></span>
          <button type="button" className="fk-btn ghost sm" onClick={() => setOpen(a.id)} data-testid="alert-open">{tx('cr.review')}</button></li>)}</ul>}
      <p className="fk-hint">{tx('tmm.al.rule')}</p>
      {open ? <AlertSlideOver id={open} onClose={() => setOpen(null)} onChanged={() => setTick((n) => n + 1)} onOpenMember={onOpenMember} /> : null}
    </FitPanel>
  );
}
type Act = 'assign' | 'investigate' | 'note' | 'resolve' | 'dismiss' | 'reopen';
function AlertSlideOver({ id, onClose, onChanged, onOpenMember }: { id: string; onClose: () => void; onChanged: () => void; onOpenMember: (memberId: string, tab?: PTab) => void }) {
  const nav = useNavigate();
  const [hp, setHp] = useState(1); const [tick, setTick] = useState(0);
  const r = useLoad(() => posTeamDataAlertsApi.detail(id, { page: hp, pageSize: 6 }), [id, hp, tick]); const x: any = r.data;
  const [act, setAct] = useState<Act | null>(null); const [note, setNote] = useState(''); const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const people = useLoad(() => (act === 'assign' ? posTeamDataAlertsApi.assignees() : Promise.resolve(null)), [act]);
  useEffect(() => { setNote(''); setAssignee(''); setErr(null); }, [act]);
  const submit = async () => {
    if (!x || !act) return; setBusy(true); setErr(null); setDone(null); const v = x.version;
    try {
      if (act === 'assign') await posTeamDataAlertsApi.assign(id, { assigneeUserId: assignee, expectedVersion: v, ...(note ? { note } : {}) });
      else if (act === 'investigate') await posTeamDataAlertsApi.investigate(id, { expectedVersion: v, ...(note ? { note } : {}) });
      else if (act === 'note') await posTeamDataAlertsApi.note(id, { expectedVersion: v, note });
      else if (act === 'resolve') await posTeamDataAlertsApi.resolve(id, { expectedVersion: v, note });
      else if (act === 'dismiss') await posTeamDataAlertsApi.dismiss(id, { expectedVersion: v, reason: note });
      else await posTeamDataAlertsApi.reopen(id, { expectedVersion: v, reason: note });
      setDone(tx('cr.saved.' + act)); setAct(null); setTick((n) => n + 1); onChanged();
    } catch (e) { setErr(alertErr(e)); if ((e as { status?: number })?.status === 409) setTick((n) => n + 1); } finally { setBusy(false); }
  };
  const valid = act === 'assign' ? !!assignee : act === 'resolve' || act === 'dismiss' || act === 'reopen' ? note.trim().length >= 5 : act === 'note' ? note.trim().length > 0 : true;
  const ev = x?.evidence ?? {};
  const link = (k: string) => k === 'schedule' ? () => nav('/technicians/schedule') : k === 'commission' ? () => nav('/tenant/reports/commission') : k === 'payroll' ? () => nav('/tenant/team/payroll') : k === 'users' ? () => nav('/tenant/account/users-roles')
    : x?.memberId ? () => onOpenMember(x.memberId, k === 'skills' ? 'skills' : k === 'attendance' ? 'attendance' : 'overview') : null;
  const evRows: [string, unknown][] = Object.entries(ev).filter(([k, v]) => v != null && typeof v !== 'object' && !['name', 'basis', 'note'].includes(k)) as [string, unknown][];
  return (
    <FitDialog side title={x ? tx('tmm.al.t.' + x.type) : tx('tmm.al.title')} busy={busy} onClose={onClose} testId="alert-panel"
      subtitle={x ? <><span className={'fk-chip ' + statusTone(x.status)} data-testid="alert-status">{tx('cr.st.' + x.status)}</span> · {tx('cr.detected', { at: whenTime(x.detectedAt) })} · {tx('cr.version', { v: String(x.version) })}</> : null}
      footer={<button type="button" className="fk-btn primary" onClick={onClose} disabled={busy} data-testid="alert-close">{tx('pos.close')}</button>}>
      {r.error ? <StateBlock error={r.error} onRetry={r.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <p className="cr-summary">{x.summary}</p>
        {x.category ? <p className="fk-hint" data-testid="alert-remediation">{tx('tms.al.fix.' + x.type)}</p> : null}
        <dl className="fk-dl mo-dl" data-testid="alert-evidence"><dt>{tx('tmm.al.member')}</dt><dd>{x.member ?? '—'}</dd><dt>{tx('cr.severity')}</dt><dd>{tx('cr.sev.' + x.severity)}</dd>
          {x.category ? <><dt>{tx('tms.al.category')}</dt><dd>{tx('tms.al.cat.' + x.category)}</dd><dt>{tx('tms.al.seen')}</dt><dd data-testid="alert-seen">{tx('tms.al.seenText', { f: whenTime(x.firstSeenAt), l: whenTime(x.lastSeenAt), n: nf(x.seenCount) })}</dd></> : null}
          {x.date ? <><dt>{tx('tmm.at.date')}</dt><dd>{fmtYmdSafe(x.date)}</dd></> : null}
          {evRows.map(([k, v]) => <Fragment key={k}><dt>{codeLabel('tmm.ev.' + k, k)}</dt><dd>{/Cents$/.test(k) ? money(Number(v)) : String(v)}</dd></Fragment>)}
          {Array.isArray(ev.members) ? <><dt>{tx('tmm.ev.members')}</dt><dd>{ev.members.map((m: any) => m.name ?? m.memberId).join(' · ')}</dd></> : null}</dl>
        {x.amountsHidden ? <p className="fk-hint">{tx('tmm.al.amountsHidden')}</p> : null}
        <div className="cr-links">{x.links.map((k: string) => { const f = link(k); return f ? <button key={k} type="button" className="fk-btn ghost sm" onClick={f} data-testid={'alert-link-' + k}>{tx('tmm.al.link.' + k)}</button> : null; })}<span className="fk-hint">{tx('tmm.al.noFix')}</span></div>
        <div className="cr-who"><span>{tx('cr.assignee')}: <b>{x.assignee ?? '—'}</b></span>
          {x.resolutionNote ? <span>{tx('tmm.al.resolved')}: {x.resolutionNote}{x.resolvedBy ? ` (${x.resolvedBy}, ${whenTime(x.resolvedAt)})` : ''}</span> : null}
          {x.dismissReason ? <span>{tx('cr.dismissed')}: {x.dismissReason}{x.dismissedBy ? ` (${x.dismissedBy}, ${whenTime(x.dismissedAt)})` : ''}</span> : null}</div>
        {done ? <div className="fk-note ok" role="status" data-testid="alert-done"><span>{done}</span></div> : null}
        {err ? <div className="fk-note bad" role="alert" data-testid="alert-error"><span>{err}</span></div> : null}
        {x.canAct ? <div className="cr-actions" role="group" aria-label={tx('finance.actions')}>{x.actions.map((a: Act) => <button key={a} type="button" className={'fk-btn' + (act === a ? ' primary' : '')} aria-pressed={act === a} onClick={() => setAct(act === a ? null : a)} disabled={busy} data-testid={'al-act-' + a}>{tx('cr.a.' + a)}</button>)}</div>
          : <p className="fk-hint">{tx('tmm.al.readOnly')}</p>}
        {act ? <div className="cr-form" data-testid="alert-form">
          {act === 'assign' ? <label className="fk-field"><span>{tx('cr.assignTo')} *</span><select className="fk-select" value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="al-assignee">
            {[<option key="" value="">{people.data ? tx('cr.choose') : tx('pos.loading')}</option>, ...(((people.data as { items?: { userId: string; name: string | null }[] } | null)?.items) ?? []).map((u) => <option key={u.userId} value={u.userId}>{u.name ?? u.userId}</option>)]}</select></label> : null}
          <label className="fk-field"><span>{tx(act === 'note' ? 'cr.noteL' : act === 'resolve' || act === 'dismiss' || act === 'reopen' ? 'cr.reasonL' : 'cr.noteOpt')}{act === 'assign' || act === 'investigate' ? '' : ' *'}</span>
            <textarea className="fk-input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="al-note" /></label>
          <div className="cr-form-foot"><button type="button" className="fk-btn" onClick={() => setAct(null)} disabled={busy}>{tx('pos.cancel')}</button>
            <button type="button" className="fk-btn primary" onClick={submit} disabled={busy || !valid} aria-busy={busy} data-testid="al-submit">{busy ? tx('cr.saving') : tx('cr.confirm.' + act)}</button></div></div> : null}
        <h3 className="cr-h">{tx('cr.timeline')}</h3>
        {x.history.items.length === 0 ? <Empty title={tx('cr.noHistory')} /> : <ol className="cr-timeline" data-testid="alert-history">{x.history.items.map((h: any) => <li key={h.id} data-testid="alert-history-row">
          <b>{tx('cr.e.' + h.type)}</b>{h.from && h.to && h.from !== h.to ? <span className="fk-li-s">{tx('cr.st.' + h.from)} → {tx('cr.st.' + h.to)}</span> : null}
          <span className="fk-li-s">{whenTime(h.at)} · {h.actor ?? tx('cr.system')}</span>{h.reason ? <p>{h.reason}</p> : null}</li>)}</ol>}
        <Pager info={pageOf(x.history)} onPage={setHp} compact />
      </>}
    </FitDialog>
  );
}
export type { PTab };
