// POSTechnicianProfileScreen.tsx — Technician Profile mandate §8 / §9 / §10 / §12 / §141: the manager's Technician
// Profile PAGE (route /technicians/:technicianId). Overview = compact cards; every section below is a detailed module
// behind "View all" (the existing screen that owns it) — no second copy of any business logic. Data sources are the
// routes that already exist: GET /pos/technicians/:id (detail: row + schedule/skills/services/commission/payroll/app
// access/permissions/audit, pay fields projected by technicians.view_pay), /pos/workforce-status/:id (the SIX separate
// statuses — §10), /pos/tech-appointments (today, this technician), /pos/tech-queue/state (current customer), the
// employment history (§128) and the portable profile (rating, portfolio & reviews moderation — the drawer).
// Permission-gated sections hide (the server still enforces); honest empty / error states; no fake controls.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { posWorkforceApi, type TechnicianWorkforceStateView } from '../api/posWorkforceApi';
import { posTechAppointmentsApi } from '../api/posTechAppointmentsApi';
import { posTechQueueApi } from '../api/posTechQueueApi';
import { TechnicianWorkforcePanel, workforceLabel } from '../components/TechnicianWorkforcePanel';
import { TechnicianAccessPanel } from '../components/TechnicianAccessPanel';
import { EmploymentHistoryPanel } from '../components/EmploymentHistoryPanel';
import { TechnicianProfileDrawer } from '../components/TechnicianProfileDrawer';
import { useCan } from '../components/usePermissions';
import { useRealtime } from '../realtime/useRealtime';
import { formatCentsOrDash } from '@aipowersalon/money';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';
import { WeeklyDaysOffPanel, TechnicianSkillsPanel } from '../components/TechnicianDaysOffSkills';
import { fmtInZone } from '../i18n/format';   // the location's clock (not the device's)

const money = (c: number | null | undefined) => formatCentsOrDash(c == null ? null : Number(c));
const tm = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DOW = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const pillTone = (v: string) => (['active', 'CLOCKED_IN', 'ON_SHIFT', 'AVAILABLE', 'online', 'IDLE'].includes(v) ? 'ok' : ['ON_BREAK', 'BREAK', 'ASSIGNED', 'SERVING', 'PAUSED'].includes(v) ? 'warn' : '');

function SectionShell({ open, title, onToggle, onViewAll, gate, children }: { open: boolean; title: string; onToggle: () => void; onViewAll?: () => void; gate: boolean; children: React.ReactNode }) {
  if (!gate) return null;
  return (
    <section className="panel" style={{ marginBottom: 10, padding: '10px 14px' }} aria-label={title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn ghost" style={{ fontWeight: 800, fontSize: 13, padding: '2px 6px' }} aria-expanded={open} onClick={onToggle}>{open ? '▾' : '▸'} {title}</button>
        {onViewAll ? <button className="btn ghost" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={onViewAll}>{t('pos.view_all_5')}</button> : null}
      </div>
      {open ? <div style={{ marginTop: 8 }}>{children}</div> : null}
    </section>
  );
}

type Section = 'employment' | 'branches' | 'schedule' | 'skills' | 'queue' | 'appointments' | 'performance' | 'pay' | 'timeclock' | 'portfolio' | 'certs' | 'documents' | 'permissions' | 'audit';

export function POSTechnicianProfileScreen() {
  const { technicianId = '' } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const [d, setD] = useState<any | null>(null);
  const [wf, setWf] = useState<TechnicianWorkforceStateView | null>(null);
  const [wfErr, setWfErr] = useState(false);
  const [appts, setAppts] = useState<any[] | null>(null);
  const [lane, setLane] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<Section, boolean>>({ employment: false, branches: false, schedule: false, skills: false, queue: false, appointments: false, performance: false, pay: false, timeclock: false, portfolio: false, certs: false, documents: false, permissions: false, audit: false });
  const [drawer, setDrawer] = useState(false);

  const load = useCallback(() => {
    posTechniciansApi.detail(technicianId).then((r) => { setD(r); setError(null); }).catch((e: any) => setError(e?.message || t('pos.could_not_load_this_technician')));
    posWorkforceApi.state(technicianId).then((s) => { setWf(s); setWfErr(false); }).catch(() => setWfErr(true));
    posTechAppointmentsApi.appointments({ technicianId, date: todayIso() }).then((a) => setAppts(Array.isArray(a) ? a : [])).catch(() => setAppts((p) => p ?? []));
    posTechQueueApi.state({ technicianId }).then((s: any) => setLane((s?.technicianRows || []).find((r: any) => r.technicianId === technicianId) ?? null)).catch(() => {});
    posTechniciansApi.techProfile(technicianId).then((p) => setProfile(p)).catch(() => setProfile((p: any) => p ?? { hasProfile: false }));
  }, [technicianId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['technicians', 'tech-queue', 'appointments'], load);

  if (error && !d) return <div className="work"><div className="vh"><h1>{t('pos.technician')}</h1></div><div className="err" style={{ marginTop: 12 }}>{error}</div><button className="btn ghost" style={{ marginTop: 10 }} onClick={() => nav('/technicians')}>{t('pos.back_to_technicians')}</button></div>;
  if (!d) return <div className="work"><div className="state">{t('pos.loading_technician')}</div></div>;

  const viewPay = can('technicians.view_pay');
  const upcoming = (appts || []).filter((a) => !['completed', 'cancelled', 'no_show', 'checked_out'].includes(String(a.status || '').toLowerCase()) && new Date(a.startTime).getTime() >= Date.now()).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const next = upcoming[0] ?? null;
  const today = (d.schedule?.weekly ?? {})[DOW[(new Date().getDay() + 6) % 7]];
  const toggle = (k: Section) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const card = (l: string, v: React.ReactNode, note?: React.ReactNode) => <div className="kpi" key={l}><div className="l">{l}</div><div className="v" style={{ fontSize: 16 }}>{v}</div>{note ? <div className="s" style={{ marginTop: 2 }}>{note}</div> : null}</div>;

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 14 }}>
        <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => nav('/technicians')}>{t('pos.technicians_4')}</button>
        <ProfileAvatarWithPreview name={d.displayName} url={d.avatarUrl || profile?.profile?.avatarUrl} size={48} type="technician" />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>{d.displayName}</h1>
          <div className="sub">{profile?.profile?.title || d.role || t('pos.technician')}{d.globalTechCode ? ` · ${d.globalTechCode}` : ''}{profile?.profile?.publicProfileStatus ? t('pos.public_profile_v0', { v0: String(String(profile.profile.publicProfileStatus).toLowerCase()) }) : ''}</div>
        </div>
        {/* §10: six SEPARATE statuses — never one vague word */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }} aria-label={t('pos.operational_status')}>
          <span className={'pill ' + pillTone(d.status)} title={t('pos.employment')}>{workforceLabel(d.status)}</span>
          {wf ? (<>
            <span className={'pill ' + pillTone(wf.clock)} title={t('pos.clock')}>{workforceLabel(wf.clock)}</span>
            <span className={'pill ' + pillTone(wf.shift)} title={t('pos.shift')}>{workforceLabel(wf.shift)}</span>
            <span className={'pill ' + pillTone(wf.queue)} title={t('pos.queue')}>{workforceLabel(wf.queue)}</span>
            <span className={'pill ' + pillTone(wf.service)} title={t('pos.service_3')}>{workforceLabel(wf.service)}</span>
            <span className={'pill ' + pillTone(wf.presence)} title={t('pos.app_presence_connected_clocked_in')}>{wf.presence === 'online' ? t('pos.app_online') : t('pos.app_offline')}</span>
          </>) : wfErr ? <span className="pill" title={t('pos.live_status')}>{t('pos.live_status_unavailable')}</span> : null}
        </div>
      </div>

      {/* §9 Overview — compact cards */}
      <div className="kpis" aria-label={t('pos.overview')}>
        {card(t('people.techProfile.primaryBranch'), d.branchName || '—', d.appAccess?.allowedBranches?.length > 1 ? t('pos.length_branches', { length: String(d.appAccess.allowedBranches.length) }) : undefined)}
        {card(t('people.techProfile.currentCustomer'), lane?.currentServiceCustomer || (wf?.currentTicketId ? t('pos.in_service') : '—'), lane?.currentServiceName || undefined)}
        {card(t('pos.next_appointment'), next ? tm(next.startTime) : '—', next ? `${next.customerName}${next.services?.length ? ` · ${next.services.map((s: any) => s.serviceName || s.name).filter(Boolean).join(', ')}` : ''}` : t('pos.nothing_more_today'))}
        {card(t('people.techProfile.appointmentsToday'), appts ? String(appts.length) : '…')}
        {card(t('pos.rating'), d.rating != null ? `${Number(d.rating).toFixed(1)}★` : profile?.profile?.overallRating ? `${profile.profile.overallRating}★` : '—', profile?.profile?.ratingCount ? t('pos.ratingcount_reviews', { ratingCount: String(profile.profile.ratingCount) }) : undefined)}
        {card(t('pos.skills'), d.skills?.skillGroups?.length ? String(d.skills.skillGroups.length) : '0', d.skills?.skillGroups?.slice(0, 3).join(' · ') || t('pos.v0_services', { v0: String(d.servicesCount ?? 0) }))}
        {viewPay ? card(t('people.techProfile.todayRevenue'), money(d.todaySalesCents)) : null}
        {viewPay ? card(t('people.techProfile.todayTips'), money(d.todayTipsCents)) : null}
      </div>

      <SectionShell open={open.employment} onToggle={() => toggle('employment')} title={t('pos.employment')} gate={true}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, fontSize: 12.5, marginBottom: 10 }}>
          <div><div className="muted">{t('pos.status')}</div><b>{workforceLabel(d.status)}</b></div>
          <div><div className="muted">{t('pos.role_2')}</div><b>{d.role || t('pos.technician')}</b></div>
          <div><div className="muted">{t('pos.phone')}</div><b>{d.phone || '—'}</b></div>
          <div><div className="muted">{t('pos.email')}</div><b>{d.email || '—'}</b></div>
          <div><div className="muted">{t('pos.tech_app')}</div><b>{d.techAppEnabled ? t('pos.enabled') : t('pos.off')}</b></div>
          <div><div className="muted">{t('pos.membership_2')}</div><b>{profile?.membershipHereStatus || d.membershipStatus || '—'}</b></div>
          <div><div className="muted">{t('pos.added')}</div><b>{d.createdAt ? fmtInZone(d.createdAt, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</b></div>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>{t('pos.lifecycle_actions_suspend_deactivate_archive_reactivate_1yqe')}</div>
        <div style={{ fontWeight: 800, fontSize: 12, margin: '8px 0 4px' }}>{t('pos.employment_history_this_salon')}</div>
        <EmploymentHistoryPanel technicianId={technicianId} />
      </SectionShell>

      <SectionShell open={open.branches} onToggle={() => toggle('branches')} title={t('pos.branches')} gate={true}>
        {d.appAccess?.allowedBranches?.length ? (
          <div style={{ fontSize: 12.5 }}>{d.appAccess.allowedBranches.map((b: string) => <span key={b} className={'pill ' + (b === d.branchId ? 'ok' : '')} style={{ marginRight: 6 }} title={b}>{b === d.branchId ? t('pos.primary') : ''}{d.branchNames?.[b] ?? '—'}</span>)}</div>
        ) : <div className="muted" style={{ fontSize: 12 }}>{t('pos.primary_branch_only')}{d.branchName || '—'}{t('pos.branch_access_is_granted_under_team_18bw')}</div>}
        <button className="btn ghost" style={{ marginTop: 8, fontSize: 11 }} onClick={() => nav('/tenant/team/permissions')}>{t('pos.manage_branch_access')}</button>
      </SectionShell>

      <SectionShell open={open.schedule} onToggle={() => toggle('schedule')} title={t('pos.schedule')} onViewAll={() => nav('/technicians/schedule')} gate={true}>
        {d.schedule?.weekly ? (
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>{t('pos.day')}</th><th>{t('pos.hours')}</th><th>{t('pos.lunch')}</th></tr></thead>
            <tbody>{DOW.map((k) => { const day = d.schedule.weekly[k]; return <tr key={k}><td style={{ textTransform: 'capitalize' }}>{k}</td><td>{day?.isWorking ? `${day.startTime}–${day.endTime}` : t('pos.off')}</td><td>{day?.lunchStart ? `${day.lunchStart}–${day.lunchEnd}` : '—'}</td></tr>; })}</tbody>
          </table>
        ) : <div className="muted" style={{ fontSize: 12 }}>{t('pos.no_weekly_schedule_set')}</div>}
        {today ? <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{t('pos.today_4')}{' '}{today.isWorking ? `${today.startTime}–${today.endTime}` : t('people.techProfile.off')}{d.schedule?.unavailableDates?.length ? ` · ${t('people.techProfile.unavailableDates', { count: String(d.schedule.unavailableDates.length) })}` : ''}</div> : null}
        <WeeklyDaysOffPanel technicianId={technicianId} canEdit={can('pos.technicians.schedule.edit')} />
      </SectionShell>

      <SectionShell open={open.skills} onToggle={() => toggle('skills')} title={t('pos.skills_services')} onViewAll={() => nav('/technicians/skill-requests')} gate={true}>
        <div style={{ fontSize: 12.5, marginBottom: 6 }}>{d.skills?.skillGroups?.length ? d.skills.skillGroups.map((g: string) => <span key={g} className="pill ok" style={{ marginRight: 6 }}>{g}</span>) : <span className="muted">{t('pos.no_skill_groups_yet')}</span>}</div>
        <div className="muted" style={{ fontSize: 12 }}>{d.servicesCount ?? d.services?.serviceIds?.length ?? 0} {t('pos.approved_services_booking_and_queue_eligibility_ipd9')}</div>
        <TechnicianSkillsPanel technicianId={technicianId} canEdit={can('pos.technicians.skills.edit')} />
      </SectionShell>

      <SectionShell open={open.queue} onToggle={() => toggle('queue')} title={t('pos.queue_current_service')} onViewAll={() => nav('/tech-queue')} gate={true}>
        {lane ? (
          <div style={{ fontSize: 12.5, display: 'grid', gap: 4 }}>
            <div><span className="muted">{t('pos.queue_status_2')}{' '}</span><b>{workforceLabel(wf?.queue) }</b></div>
            {lane.currentServiceCustomer ? <div><span className="muted">{t('pos.current_customer')}{' '}</span><b>{lane.currentServiceCustomer}</b>{lane.currentServiceName ? <span> · {lane.currentServiceName}</span> : null}</div> : <div className="muted">{t('pos.not_serving_anyone_right_now')}</div>}
            {lane.nextAvailableLabel ? <div><span className="muted">{t('pos.next_available')}{' '}</span>{lane.nextAvailableLabel}</div> : null}
            {lane.utilizationPercent != null ? <div><span className="muted">{t('pos.utilization_today')}{' '}</span>{lane.utilizationPercent}%</div> : null}
          </div>
        ) : <div className="muted" style={{ fontSize: 12 }}>{t('pos.not_in_today_s_queue_rotation')}</div>}
      </SectionShell>

      <SectionShell open={open.appointments} onToggle={() => toggle('appointments')} title={t('pos.appointments_today_v0', { v0: String(appts ? ` (${appts.length})` : '') })} onViewAll={() => nav('/tech-appointments')} gate={true}>
        {!appts ? <div className="muted" style={{ fontSize: 12 }}>{t('pos.loading')}</div> : appts.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>{t('pos.no_appointments_today')}</div> : (
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>{t('pos.time')}</th><th>{t('pos.customer')}</th><th>{t('pos.services')}</th><th>{t('pos.status')}</th></tr></thead>
            <tbody>{appts.slice(0, 12).map((a) => <tr key={a.appointmentId}><td>{tm(a.startTime)}–{tm(a.endTime)}</td><td>{a.customerName}</td><td>{(a.services || []).map((s: any) => s.serviceName || s.name).filter(Boolean).join(', ') || '—'}</td><td>{statusLabel('appointment', a.status)}</td></tr>)}</tbody>
          </table>
        )}
      </SectionShell>

      <SectionShell open={open.performance} onToggle={() => toggle('performance')} title={t('pos.performance')} onViewAll={() => nav('/tenant/team/performance')} gate={true}>
        <div className="muted" style={{ fontSize: 12 }}>{t('pos.services_revenue_rebooking_rating_and_utilization_uehi')}{' '}{d.servicesCount ?? 0} {t('pos.services_mapped')}{lane?.utilizationPercent != null ? t('pos.utilizationpercent_utilization', { utilizationPercent: String(lane.utilizationPercent) }) : ''}{d.rating != null ? ` · ${Number(d.rating).toFixed(1)}★` : ''}.</div>
      </SectionShell>

      <SectionShell open={open.pay} onToggle={() => toggle('pay')} title={t('pos.commission_tips_earnings')} onViewAll={() => nav('/tenant/team/payroll')} gate={viewPay}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, fontSize: 12.5 }}>
          <div><div className="muted">{d.payroll?.periodLabel || t('pos.this_period')} {t('pos.sales_2')}</div><b>{money(d.payroll?.salesCents)}</b></div>
          <div><div className="muted">{t('pos.tips')}</div><b>{money(d.payroll?.tipsCents)}</b></div>
          <div><div className="muted">{t('pos.commission')}</div><b>{money(d.payroll?.commissionCents)}</b></div>
          <div><div className="muted">{t('pos.estimated_today')}</div><b>{money(d.payroll?.estimatedTodayCents)}</b></div>
          <div><div className="muted">{t('pos.default_rate')}</div><b>{d.commission?.defaultPercent != null ? `${d.commission.defaultPercent}%` : '—'}</b></div>
          <div><div className="muted">{t('pos.tip_handling')}</div><b>{d.commission?.tipHandling || '—'}</b></div>
          <div><div className="muted">{t('pos.pay_period')}</div><b>{d.commission?.payrollPeriod || '—'}</b></div>
          <div><div className="muted">{t('pos.period')}</div><b>{d.payroll?.closed ? t('pos.closed') : t('pos.open')}</b></div>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{t('pos.rate_changes_need_the_commission_admin_ljlf')}</div>
      </SectionShell>

      <SectionShell open={open.timeclock} onToggle={() => toggle('timeclock')} title={t('pos.time_clock_time_off_certifications')} onViewAll={() => nav('/tenant/team/time-clock')} gate={true}>
        <TechnicianWorkforcePanel technicianId={technicianId} />
      </SectionShell>

      <SectionShell open={open.portfolio} onToggle={() => toggle('portfolio')} title={t('pos.portfolio_ratings_reviews')} gate={true}>
        {profile?.hasProfile ? (
          <div style={{ fontSize: 12.5 }}>
            <div>{profile.profile.displayName} · {profile.profile.overallRating}★ ({profile.profile.ratingCount}) · {profile.photos?.length ?? 0} {t('pos.portfolio_photos')}{' '}{profile.profile.completionPercent}{t('pos.complete')}</div>
            <button className="btn ghost" style={{ marginTop: 8, fontSize: 11 }} onClick={() => setDrawer(true)}>{t('pos.open_portfolio_review_moderation')}</button>
          </div>
        ) : <div className="muted" style={{ fontSize: 12 }}>{profile?.message || t('pos.no_portable_profile_linked_yet')}</div>}
      </SectionShell>

      <SectionShell open={open.documents} onToggle={() => toggle('documents')} title={t('pos.documents')} gate={true}>
        <div className="muted" style={{ fontSize: 12 }}>{t('pos.licenses_and_certifications_with_their_documents_s12d')}</div>
      </SectionShell>

      <SectionShell open={open.permissions} onToggle={() => toggle('permissions')} title={t('pos.app_access_permissions_commission_settings')} gate={can('pos.technicians.view')}>
        <TechnicianAccessPanel technicianId={technicianId} displayName={d.displayName} />
      </SectionShell>

      <SectionShell open={open.audit} onToggle={() => toggle('audit')} title={t('pos.audit')} gate={true}>
        {d.auditSummary?.length ? (
          <table className="tbl" style={{ fontSize: 12 }}><thead><tr><th>{t('pos.when')}</th><th>{t('pos.action')}</th><th>{t('pos.by_2')}</th></tr></thead>
            <tbody>{d.auditSummary.map((a: any, i: number) => <tr key={i}><td>{a.lastAt ? fmtInZone(a.lastAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td><td>{a.lastAction}</td><td>{a.lastActorRole}</td></tr>)}</tbody></table>
        ) : <div className="muted" style={{ fontSize: 12 }}>{t('pos.no_audited_actions_yet')}</div>}
      </SectionShell>

      {drawer ? <TechnicianProfileDrawer technicianId={technicianId} displayName={d.displayName} onClose={() => { setDrawer(false); load(); }} /> : null}
    </div>
  );
}
