// team-data-alerts.repository.ts — Team Management Data Accuracy Alerts (build guide §13, 30 Oct 2026). The persisted,
// reviewable alert pattern of commission-review.repository.ts applied to the team's own records (migration 722).
//
//   Run Check  runs every detector (bounded, stable order) and UPSERTS one alert per finding by its stable fingerprint — a
//              rescan never recreates an alert and never touches a reviewer's decision (ON CONFLICT only refreshes
//              last_seen_at). Detectors, all data-backed:
//     SHIFT_STATUS_MISMATCH    on shift / clocked in now with no date override, published shift or weekly template today
//                              (a DAY_OFF override or approved time off today makes it high); stale live state is called so
//     MISSING_SERVICE_MAPPING  a technician booked (upcoming appointment, by the catalog name) or paid for (last 30 days) a
//                              service without an approved technician_services mapping
//     COMMISSION_PAID_MISMATCH a PAID payroll period where a technician's ledger (snapshot earnings + tips + approved
//                              adjustments over the period's dates) and the payouts recorded as paid differ by more than
//                              $1.00 — the ledgers are read, nothing is recalculated or moved
//     ATTENDANCE_DISAGREEMENT  the first clock-in of a day vs the planned start (override › published › weekly) differs by
//                              more than 15 minutes, in the last 14 days; days off (DAY_OFF override) and approved time off
//                              are excluded
//     DUPLICATE_CONTACT        two current staff records with the same phone (last 10 digits) or e-mail — never merged
//     STALE_USER_LINK          a current technician whose user link points to an inactive / suspended login or to no login
//                              of this salon
//     ORPHANED_ASSIGNMENT      (round 2, guide §10.2) an upcoming appointment assigned to a technician record that is archived,
//                              inactive or not in this salon; a role-template assignment whose login is gone / ended
//     MISSING_BRANCH_ASSOCIATION a staff record pointing at a branch that is not this salon's, or (salons with 2+ branches) a
//                              current service provider / front-desk login associated with no branch at all
//   Nightly    the same scan runs per tenant from the durable job queue (team-data-nightly.ts: one run per salon-local date,
//              staggered, retried with backoff, recorded in team_data_nightly_runs; repeated failures escalate to a
//              DATA_CHECK_JOB_FAILED alert). A rescan refreshes last_seen_at / seen_count / last_run_id only.
//   Workflow   OPEN → ASSIGNED → INVESTIGATING → RESOLVED; dismiss from any open state; reopen from RESOLVED / DISMISSED;
//              notes any time. Each action: row lock, expectedVersion (409), server-side transition check (422), the alert
//              update + an append-only event + the central audit row in ONE transaction. A denied attempt is audited.
//   Never      changes payroll, a commission, a tip, an employee's status, a rating, an approval, a shift or a link.
import { dateColumnYmd } from '@aipowersalon/date-time';
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { N, iso, like, paging, served, branchOf, teamPeriod, UUID, actorOf, err, canAny, logGap, maskPhone, type TeamCtx } from './screen-kit';
import { writeAuditRow } from './audit-rows';
import { canMoveToSql } from '@aipowersalon/database';
import { TEAM_DATA_ALERT, TEAM_DATA_ALERT_RUN } from '../workforce-lifecycles';
import { TeamMembersScreenRepository, ATTENDANCE_TOLERANCE_MIN } from './team-members-screen.repository';

/** the alert columns view() / detail() map — never the whole row */
const ALERT_COLS = sql`a.id, a.tenant_id, a.branch_id, a.alert_type, a.status, a.severity, a.summary, a.user_id, a.technician_id, a.related_user_id, a.related_technician_id,
  a.subject_date, a.evidence_json, a.assigned_to_user_id, a.assigned_at, a.investigating_at, a.resolution_note, a.resolved_at, a.dismiss_reason, a.dismissed_at,
  a.detected_at, a.last_seen_at, a.seen_count, a.last_run_id, a.updated_at, a.version`;

export const ALERT_STATUSES = ['OPEN', 'ASSIGNED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'] as const;
export const ALERT_TYPES = ['SHIFT_STATUS_MISMATCH', 'MISSING_SERVICE_MAPPING', 'COMMISSION_PAID_MISMATCH', 'ATTENDANCE_DISAGREEMENT', 'DUPLICATE_CONTACT', 'STALE_USER_LINK',
  'ORPHANED_ASSIGNMENT', 'MISSING_BRANCH_ASSOCIATION', 'DATA_CHECK_JOB_FAILED'] as const;
export type AlertAction = 'assign' | 'investigate' | 'note' | 'resolve' | 'dismiss' | 'reopen';
type Status = typeof ALERT_STATUSES[number]; type AlertType = typeof ALERT_TYPES[number];
export const COMMISSION_TOLERANCE_CENTS = 100;
const LIMIT = 500;
const VIEW = ['roles.view', 'payroll.view', 'audit.view', 'technicians.edit'];
const REVIEW = ['roles.manage', 'payroll.manage', 'technicians.edit'];
const PAY = ['technicians.view_pay', 'payroll.view'];
export const ALERT_TRANSITIONS: Record<AlertAction, { from: Status[]; to: (c: Status) => Status }> = {
  assign: { from: ['OPEN', 'ASSIGNED', 'INVESTIGATING'], to: (c) => (c === 'INVESTIGATING' ? 'INVESTIGATING' : 'ASSIGNED') },
  investigate: { from: ['OPEN', 'ASSIGNED'], to: () => 'INVESTIGATING' },
  note: { from: ['OPEN', 'ASSIGNED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'], to: (c) => c },
  resolve: { from: ['OPEN', 'ASSIGNED', 'INVESTIGATING'], to: () => 'RESOLVED' },
  dismiss: { from: ['OPEN', 'ASSIGNED', 'INVESTIGATING'], to: () => 'DISMISSED' },
  reopen: { from: ['RESOLVED', 'DISMISSED'], to: () => 'OPEN' },
};
export function alertActions(s: Status): AlertAction[] { return (Object.keys(ALERT_TRANSITIONS) as AlertAction[]).filter((a) => ALERT_TRANSITIONS[a].from.includes(s)); }
const EVENT_OF: Record<AlertAction, string> = { assign: 'ASSIGNED', investigate: 'INVESTIGATION_STARTED', note: 'NOTE_ADDED', resolve: 'RESOLVED', dismiss: 'DISMISSED', reopen: 'REOPENED' };
const SUMMARY: Record<AlertType, string> = {
  SHIFT_STATUS_MISMATCH: 'On shift or clocked in with no shift for today (no date override, published shift or weekly template).',
  MISSING_SERVICE_MAPPING: 'Booked or performed a service without an approved service mapping.',
  COMMISSION_PAID_MISMATCH: 'For a paid payroll period, the commission + tip ledger and the payouts recorded as paid do not match.',
  ATTENDANCE_DISAGREEMENT: `Clock-in differs from the planned start by more than ${ATTENDANCE_TOLERANCE_MIN} minutes.`,
  DUPLICATE_CONTACT: 'Two current staff records share the same phone number or e-mail.',
  STALE_USER_LINK: 'A technician record is linked to a login that is inactive, suspended or not in this salon.',
  ORPHANED_ASSIGNMENT: 'Work or a role is assigned to a staff record that is archived, inactive or no longer in this salon.',
  MISSING_BRANCH_ASSOCIATION: 'A staff record is not associated with any branch of this salon (or points at a branch that is not this salon\'s).',
  DATA_CHECK_JOB_FAILED: 'The nightly team data check failed repeatedly — findings may be out of date.',
};
/** category · remediation (what a reviewer does — never done automatically) per type */
export const ALERT_META: Record<AlertType, { category: string; remediation: string }> = {
  SHIFT_STATUS_MISMATCH: { category: 'schedule', remediation: 'Check the time clock and the schedule for today; correct the shift or the clock-in in their own screens.' },
  MISSING_SERVICE_MAPPING: { category: 'skills', remediation: 'Approve the service for the technician (Skills) or reassign the booking.' },
  COMMISSION_PAID_MISMATCH: { category: 'payroll', remediation: 'Reconcile the payroll period with the commission ledger; record an adjustment through Payroll if one is owed.' },
  ATTENDANCE_DISAGREEMENT: { category: 'attendance', remediation: 'Confirm the planned start with the employee; fix the punch or the date shift in Time Clock / Schedule.' },
  DUPLICATE_CONTACT: { category: 'identity', remediation: 'Confirm whether the two records are the same person; merge or correct contact details by hand.' },
  STALE_USER_LINK: { category: 'access', remediation: 'Re-link the technician to the right login or end the employment in Users & Roles.' },
  ORPHANED_ASSIGNMENT: { category: 'assignments', remediation: 'Reassign the upcoming appointment, or remove the role assignment in Users & Roles.' },
  MISSING_BRANCH_ASSOCIATION: { category: 'branch', remediation: 'Give the staff member a home branch or branch access in Users & Roles / the technician profile.' },
  DATA_CHECK_JOB_FAILED: { category: 'job', remediation: 'Run Check by hand; if it fails too, contact support with the run id.' },
};
const LINKS: Record<AlertType, string[]> = {
  SHIFT_STATUS_MISMATCH: ['schedule', 'employee'], MISSING_SERVICE_MAPPING: ['skills', 'employee'], COMMISSION_PAID_MISMATCH: ['commission', 'payroll', 'employee'],
  ATTENDANCE_DISAGREEMENT: ['attendance', 'schedule', 'employee'], DUPLICATE_CONTACT: ['employee'], STALE_USER_LINK: ['employee', 'users'],
  ORPHANED_ASSIGNMENT: ['employee', 'appointments', 'users'], MISSING_BRANCH_ASSOCIATION: ['employee', 'users'], DATA_CHECK_JOB_FAILED: [],
};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const h12 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
const ymdOf = (v: unknown) => dateColumnYmd(v);   // DATE columns are selected as text (to_char) — right for node-postgres and PGlite alike
const maskEmail = (e: string) => { const [a, d] = e.split('@'); return d ? `${a.slice(0, 1)}•••@${d}` : '•••'; };
export interface Finding { type: AlertType; fingerprint: string; severity: 'low' | 'medium' | 'high'; userId: string | null; technicianId: string | null; relatedUserId?: string | null; relatedTechnicianId?: string | null;
  date?: string | null; periodRef?: string | null; summary?: string; branchId?: string | null; evidence: Record<string, unknown> }
export interface ScanOptions { trigger: 'manual' | 'nightly'; runDate?: string | null }
export interface AlertActionBody { expectedVersion?: unknown; assigneeUserId?: unknown; note?: unknown; reason?: unknown }

export class TeamDataAlertsRepository {
  private readonly team: TeamMembersScreenRepository;
  constructor(private readonly db: Kysely<any>) { this.team = new TeamMembersScreenRepository(db); }
  private mustView(ctx: TeamCtx) { if (!canAny(ctx, ...VIEW)) throw err(403, 'FORBIDDEN', 'You do not have permission to view team data alerts.'); }
  private brA(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(a.branch_id = ${b} or a.branch_id is null)` : sql`true`; }

  // ── Run Check ────────────────────────────────────────────────────────────────────────────────────────────────
  async runCheck(ctx: TeamCtx, requestId: string) {
    if (!canAny(ctx, ...REVIEW)) throw err(403, 'FORBIDDEN', 'You do not have permission to run the team data check.');
    return this.scan(ctx, requestId, { trigger: 'manual' });
  }
  /** the scan itself — Run Check (permission checked above) and the nightly job (system context, whole salon) */
  async scan(ctx: TeamCtx, requestId: string, opts: ScanOptions) {
    const T = ctx.tenantId; const today = await teamPeriod(this.db, ctx, { preset: 'today' });
    const actor = ctx.userId && UUID.test(ctx.userId) ? ctx.userId : null;
    const run = (await sql<any>`insert into team_data_alert_runs (tenant_id, branch_id, actor_user_id, request_id, run_trigger, run_date)
      values (${T}, ${branchOf(ctx)}, ${actor}, ${requestId}, ${opts.trigger}, ${opts.runDate ?? today.today}::date) returning id`.execute(this.db)).rows[0];
    const summary = { detected: 0, alreadyKnown: 0, byType: {} as Record<string, number>, checked: {} as Record<string, number>, toleranceMinutes: ATTENDANCE_TOLERANCE_MIN, commissionToleranceCents: COMMISSION_TOLERANCE_CENTS };
    try {
      const R = this.team.roster(ctx, today);
      const findings: Finding[] = [];
      // 1 · shift / status mismatch
      const live = (await sql<any>`${R} select m.member_id, m.user_id, m.technician_id, m.name, m.shift_status, m.clock_status, m.queue_status, m.ov_type, m.off_today, m.live_at,
          exists (select 1 from technician_shifts p where p.tenant_id = ${T} and p.technician_id = m.technician_id and p.end_time is null and p.status = 'active') as open_punch
        from m where m.is_current and m.technician_id is not null and (m.shift_status = 'ON_SHIFT' or m.clock_status in ('CLOCKED_IN', 'ON_BREAK')) and not m.scheduled
        order by m.member_id limit ${LIMIT}`.execute(this.db)).rows;
      summary.checked.SHIFT_STATUS_MISMATCH = live.length;
      for (const r of live) {
        const stale = !r.open_punch && r.live_at && Date.now() - Date.parse(r.live_at) > 12 * 3_600_000;
        findings.push({ type: 'SHIFT_STATUS_MISMATCH', fingerprint: `SHIFT_STATUS_MISMATCH|${r.technician_id}|${today.today}`, severity: r.ov_type === 'DAY_OFF' || r.off_today ? 'high' : 'medium',
          userId: r.user_id ? String(r.user_id) : null, technicianId: String(r.technician_id), date: today.today,
          summary: stale ? 'Live state says on shift, but there is no open time-clock punch and the state has not changed for over 12 hours (stale).' : undefined,
          evidence: { liveShift: r.shift_status ?? null, clock: r.clock_status ?? null, queue: r.queue_status ?? null, openPunch: !!r.open_punch, liveUpdatedAt: iso(r.live_at), stale: !!stale,
            dateOverride: r.ov_type ?? null, approvedTimeOffToday: !!r.off_today, date: today.today, name: r.name } });
      }
      // 2 · missing service mapping — paid lines in the last 30 days, and upcoming bookings by catalog name
      const lines = (await sql<any>`select l.technician_id, l.service_id, max(l.service_name_snapshot) as name, count(*)::int as n, max(t.paid_at) as last_at, te.user_id
        from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id join technicians te on te.id = l.technician_id and te.tenant_id = l.tenant_id
        where l.tenant_id = ${T} and l.service_id is not null and l.removed_at is null and lower(coalesce(l.line_kind, 'service')) = 'service' and t.paid_at >= now() - interval '30 days' and te.archived_at is null
          and (${branchOf(ctx)}::uuid is null or t.branch_id = ${branchOf(ctx)} or t.branch_id is null)
          and not exists (select 1 from technician_services ts where ts.tenant_id = ${T} and ts.technician_id = l.technician_id and ts.service_id = l.service_id)
        group by l.technician_id, l.service_id, te.user_id order by l.technician_id, l.service_id limit ${LIMIT}`.execute(this.db)).rows;
      const booked = (await sql<any>`select a.technician_id, s.id as service_id, s.name, count(distinct a.id)::int as n, min(a.appt_date) as first_d, te.user_id
        from pos_tech_appointments a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) e
          join services s on s.tenant_id = a.tenant_id and lower(s.name) = lower(coalesce(e->>'name', e->>'serviceName', '')) and s.status <> 'archived'
          join technicians te on te.id = a.technician_id and te.tenant_id = a.tenant_id
        where a.tenant_id = ${T} and ${this.brA(ctx)} and a.appt_date >= ${today.today}::date and coalesce(a.status, '') not in ('cancelled', 'canceled', 'no_show', 'completed') and te.archived_at is null
          and not exists (select 1 from technician_services ts where ts.tenant_id = ${T} and ts.technician_id = a.technician_id and ts.service_id = s.id)
        group by a.technician_id, s.id, s.name, te.user_id order by a.technician_id, s.id limit ${LIMIT}`.execute(this.db)).rows;
      summary.checked.MISSING_SERVICE_MAPPING = lines.length + booked.length;
      const seenMap = new Set<string>();
      for (const r of [...booked.map((x: any) => ({ ...x, via: 'booking' })), ...lines.map((x: any) => ({ ...x, via: 'paid_line' }))]) {
        const fp = `MISSING_SERVICE_MAPPING|${r.technician_id}|${r.service_id}`; if (seenMap.has(fp)) continue; seenMap.add(fp);
        findings.push({ type: 'MISSING_SERVICE_MAPPING', fingerprint: fp, severity: r.via === 'booking' ? 'medium' : 'low', userId: r.user_id ? String(r.user_id) : null, technicianId: String(r.technician_id),
          evidence: { via: r.via, serviceId: String(r.service_id), service: r.name ?? null, count: N(r.n), firstBookedDate: r.first_d ? String(iso(r.first_d)).slice(0, 10) : null, lastPaidAt: iso(r.last_at) } });
      }
      // 3 · commission earned + tips vs paid, for PAID payroll periods ending in the last 180 days
      const money = (await sql<any>`with pp as (select pp.id, pp.label, pp.period_start, pp.period_end from payroll_periods pp where pp.tenant_id = ${T} and pp.status = 'paid'
            and pp.period_end >= ${today.today}::date - 180 and (${branchOf(ctx)}::uuid is null or pp.branch_id = ${branchOf(ctx)} or pp.branch_id is null) order by pp.period_end desc limit 26),
          lo as (select pp.id as pid, (pp.period_start::timestamp at time zone ${today.tz}) as a, ((pp.period_end + 1)::timestamp at time zone ${today.tz}) as b from pp),
          te as (select distinct p.period_id as pid, p.technician_id as tid from payroll_payouts p join pp on pp.id = p.period_id where p.tenant_id = ${T} and p.technician_id is not null
            union select lo.pid, s.technician_id from ticket_compensation_snapshots s join lo on s.snapshot_at >= lo.a and s.snapshot_at < lo.b where s.tenant_id = ${T} and s.technician_id is not null)
        select te.pid, te.tid, pp.label, to_char(pp.period_start, 'YYYY-MM-DD') as ps, to_char(pp.period_end, 'YYYY-MM-DD') as pe, tt.user_id,
          (select coalesce(sum(coalesce(s.tech_service_earnings_cents, 0) + coalesce(s.retail_commission_cents, 0)), 0) from ticket_compensation_snapshots s where s.tenant_id = ${T} and s.technician_id = te.tid and s.snapshot_at >= lo.a and s.snapshot_at < lo.b)::bigint as earned,
          (select coalesce(sum(coalesce(s.card_tip_cents, 0) + coalesce(s.cash_tip_cents, 0)), 0) from ticket_compensation_snapshots s where s.tenant_id = ${T} and s.technician_id = te.tid and s.snapshot_at >= lo.a and s.snapshot_at < lo.b)::bigint as tips,
          (select coalesce(sum(ca.amount_cents), 0) from compensation_adjustments ca where ca.tenant_id = ${T} and ca.technician_id = te.tid and ca.status in ('posted', 'approved', 'applied') and (ca.period_id = te.pid or (ca.period_id is null and ca.created_at >= lo.a and ca.created_at < lo.b)))::bigint as adj,
          (select coalesce(sum(p.amount_cents), 0) from payroll_payouts p where p.tenant_id = ${T} and p.period_id = te.pid and p.technician_id = te.tid and p.status = 'paid')::bigint as paid
        from te join pp on pp.id = te.pid join lo on lo.pid = te.pid left join technicians tt on tt.id = te.tid and tt.tenant_id = ${T} order by pp.period_end desc, te.tid limit ${LIMIT}`.execute(this.db)).rows;
      summary.checked.COMMISSION_PAID_MISMATCH = money.length;
      for (const r of money) {
        const expected = N(r.earned) + N(r.tips) + N(r.adj); const paid = N(r.paid); const diff = paid - expected;
        if (Math.abs(diff) <= COMMISSION_TOLERANCE_CENTS) continue;
        findings.push({ type: 'COMMISSION_PAID_MISMATCH', fingerprint: `COMMISSION_PAID_MISMATCH|${r.pid}|${r.tid}`, severity: Math.abs(diff) >= 5000 ? 'high' : 'medium', userId: r.user_id ? String(r.user_id) : null,
          technicianId: String(r.tid), periodRef: String(r.pid),
          evidence: { periodId: String(r.pid), period: r.label ?? null, from: r.ps, to: r.pe, earnedCents: N(r.earned), tipsCents: N(r.tips), adjustmentsCents: N(r.adj), expectedCents: expected, paidCents: paid, differenceCents: diff,
            toleranceCents: COMMISSION_TOLERANCE_CENTS, basis: 'snapshot_at within the period dates (salon time); payouts linked to the period with status paid' } });
      }
      // 4 · attendance disagreement — first clock-in vs planned start, last 14 days, off days and time off excluded
      const att = (await sql<any>`with d as (select p.technician_id as tid, p.shift_date as d, min(p.start_time) as first_in from technician_shifts p
            where p.tenant_id = ${T} and p.status in ('active', 'completed') and p.shift_date between ${today.today}::date - 14 and ${today.today}::date
              and (${branchOf(ctx)}::uuid is null or p.branch_id = ${branchOf(ctx)} or p.branch_id is null) group by p.technician_id, p.shift_date)
        select d.tid, to_char(d.d, 'YYYY-MM-DD') as day, to_char(d.first_in at time zone ${today.tz}, 'HH24:MI') as clock_in, te.user_id,
          (select o.override_type from technician_shift_overrides o where o.tenant_id = ${T} and o.technician_id = d.tid and o.local_shift_date = d.d order by o.updated_at desc limit 1) as ov_type,
          (select to_char(o.start_local_time, 'HH24:MI') from technician_shift_overrides o where o.tenant_id = ${T} and o.technician_id = d.tid and o.local_shift_date = d.d order by o.updated_at desc limit 1) as ov_start,
          (select to_char(sh.start_time at time zone ${today.tz}, 'HH24:MI') from technician_shifts sh where sh.tenant_id = ${T} and sh.technician_id = d.tid and sh.shift_date = d.d and sh.status = 'scheduled' order by sh.start_time limit 1) as pub_start,
          (select to_char(sc.start_time, 'HH24:MI') from technician_schedules sc where sc.tenant_id = ${T} and sc.technician_id = d.tid and sc.day_of_week = extract(dow from d.d) and sc.is_working order by (sc.branch_id is null) limit 1) as wk_start,
          exists (select 1 from technician_time_off tf where tf.tenant_id = ${T} and tf.technician_id = d.tid and tf.status = 'approved' and tf.starts_at < ((d.d + 1)::timestamp at time zone ${today.tz}) and tf.ends_at > (d.d::timestamp at time zone ${today.tz})) as off
        from d join technicians te on te.id = d.tid and te.tenant_id = ${T} where te.archived_at is null order by d.d desc, d.tid limit ${LIMIT}`.execute(this.db)).rows;
      summary.checked.ATTENDANCE_DISAGREEMENT = att.length;
      const m = (hm: string | null) => (hm ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) : null);
      for (const r of att) {
        if (r.off || r.ov_type === 'DAY_OFF') continue;
        const planned = r.ov_type === 'CUSTOM_SHIFT' ? r.ov_start : r.pub_start ?? r.wk_start; const source = r.ov_type === 'CUSTOM_SHIFT' ? 'override' : r.pub_start ? 'published' : r.wk_start ? 'weekly' : null;
        if (!planned || !r.clock_in) continue;
        const delta = (m(r.clock_in) ?? 0) - (m(planned) ?? 0); if (Math.abs(delta) <= ATTENDANCE_TOLERANCE_MIN) continue;
        findings.push({ type: 'ATTENDANCE_DISAGREEMENT', fingerprint: `ATTENDANCE_DISAGREEMENT|${r.tid}|${r.day}`, severity: Math.abs(delta) > 60 ? 'medium' : 'low', userId: r.user_id ? String(r.user_id) : null,
          technicianId: String(r.tid), date: r.day, evidence: { date: r.day, clockIn: r.clock_in, plannedStart: planned, plannedSource: source, deltaMinutes: delta, toleranceMinutes: ATTENDANCE_TOLERANCE_MIN } });
      }
      // 5 · duplicate contacts among current members (a login and its own technician record are one member)
      const dup = (await sql<any>`${R} , k as (select m.member_id, m.user_id, m.technician_id, m.name, right(regexp_replace(coalesce(m.phone_norm, m.phone_display, ''), '[^0-9]', '', 'g'), 10) as ph, lower(nullif(trim(coalesce(m.email, '')), '')) as em from m where m.is_current)
        select 'phone' as kind, k.ph as v, array_agg(k.member_id::text order by k.member_id) as ids, array_agg(k.name order by k.member_id) as names, array_agg(coalesce(k.user_id::text, '') order by k.member_id) as users,
          array_agg(coalesce(k.technician_id::text, '') order by k.member_id) as techs from k where length(k.ph) = 10 group by k.ph having count(*) > 1
        union all select 'email', k.em, array_agg(k.member_id::text order by k.member_id), array_agg(k.name order by k.member_id), array_agg(coalesce(k.user_id::text, '') order by k.member_id),
          array_agg(coalesce(k.technician_id::text, '') order by k.member_id) from k where k.em is not null group by k.em having count(*) > 1 limit ${LIMIT}`.execute(this.db)).rows;
      summary.checked.DUPLICATE_CONTACT = dup.length;
      for (const r of dup) {
        const ids = (r.ids ?? []) as string[]; const users = (r.users ?? []) as string[]; const techs = (r.techs ?? []) as string[];
        findings.push({ type: 'DUPLICATE_CONTACT', fingerprint: `DUPLICATE_CONTACT|${r.kind}|${h12(String(r.v))}|${ids.join(',')}`, severity: 'medium',
          userId: users[0] || null, technicianId: techs[0] || null, relatedUserId: users[1] || null, relatedTechnicianId: techs[1] || null,
          evidence: { field: r.kind, value: r.kind === 'phone' ? maskPhone(String(r.v)) : maskEmail(String(r.v)), members: ids.map((x, i) => ({ memberId: x, name: (r.names ?? [])[i] ?? null })), note: 'Never merged automatically.' } });
      }
      // 6 · stale / dangling user links
      const stale = (await sql<any>`select te.id, te.full_name, te.user_id, u.status as user_status, u.id is null as missing from technicians te left join users u on u.id = te.user_id and u.tenant_id = ${T}
        where te.tenant_id = ${T} and te.archived_at is null and coalesce(te.status, '') <> 'archived' and te.user_id is not null and (${branchOf(ctx)}::uuid is null or te.branch_id = ${branchOf(ctx)} or te.branch_id is null)
          and (u.id is null or coalesce(u.status, 'active') in ('inactive', 'suspended')) order by te.id limit ${LIMIT}`.execute(this.db)).rows;
      summary.checked.STALE_USER_LINK = stale.length;
      for (const r of stale) findings.push({ type: 'STALE_USER_LINK', fingerprint: `STALE_USER_LINK|${r.id}|${r.user_id}`, severity: r.missing ? 'high' : 'medium', userId: r.missing ? null : String(r.user_id), technicianId: String(r.id),
        evidence: { linkedUserId: String(r.user_id), userStatus: r.missing ? null : r.user_status ?? null, notInThisSalon: !!r.missing, technician: r.full_name ?? null } });
      // 7 · orphaned assignments — upcoming appointments on a gone technician record; role templates on a gone login
      const orphans = await this.orphaned(ctx, today.today); findings.push(...orphans); summary.checked.ORPHANED_ASSIGNMENT = orphans.length;
      // 8 · missing / dangling branch association
      const nobranch = await this.missingBranch(ctx); findings.push(...nobranch); summary.checked.MISSING_BRANCH_ASSOCIATION = nobranch.length;

      for (const f of findings) {
        const inserted = await this.upsert(ctx, f, String(run.id), requestId);
        summary.byType[f.type] = (summary.byType[f.type] ?? 0) + 1; if (inserted) summary.detected++; else summary.alreadyKnown++;
      }
      await sql`update team_data_alert_runs r set status = 'succeeded', finished_at = now(), summary_json = ${JSON.stringify(summary)}::jsonb where r.tenant_id = ${T} and r.id = ${run.id} and ${canMoveToSql(TEAM_DATA_ALERT_RUN, 'succeeded', 'r')}`.execute(this.db);
      await writeAuditRow(this.db, ctx, { module: 'workforce', action: opts.trigger === 'nightly' ? 'team.data_alert.scan.nightly' : 'team.data_alert.scan', resourceType: 'team_data_alert_run', resourceId: String(run.id),
        summary: `Team data check (${opts.trigger}): ${summary.detected} new, ${summary.alreadyKnown} already known`, metadata: { ...summary, trigger: opts.trigger }, requestId });
      return { runId: String(run.id), today: today.today, trigger: opts.trigger, ...summary };
    } catch (e: any) {
      await sql`update team_data_alert_runs r set status = 'failed', finished_at = now(), summary_json = ${JSON.stringify({ ...summary, error: String(e?.code ?? 'SCAN_FAILED') })}::jsonb where r.tenant_id = ${T} and r.id = ${run.id} and ${canMoveToSql(TEAM_DATA_ALERT_RUN, 'failed', 'r')}`.execute(this.db).catch(logGap('team_data_scan_failure_not_recorded'));
      throw e;
    }
  }
  /** one alert per fingerprint: a new finding is inserted (+ DETECTED event); a known one only refreshes last_seen_at,
   *  seen_count and last_run_id — its status, reviewer and decision are never touched */
  async upsert(ctx: TeamCtx, f: Finding, runId: string | null, requestId: string): Promise<boolean> {
    const T = ctx.tenantId; const br = f.branchId && UUID.test(f.branchId) ? f.branchId : branchOf(ctx);
    const actor = ctx.userId && UUID.test(ctx.userId) ? ctx.userId : null;
    return this.db.transaction().execute(async (trx) => {
      const r = (await sql<any>`insert into team_data_alerts (tenant_id, branch_id, fingerprint, alert_type, severity, user_id, technician_id, related_user_id, related_technician_id, subject_date, period_ref, summary, evidence_json, run_id, last_run_id)
        values (${T}, ${br}, ${f.fingerprint.slice(0, 300)}, ${f.type}, ${f.severity}, ${f.userId}, ${f.technicianId}, ${f.relatedUserId ?? null}, ${f.relatedTechnicianId ?? null}, ${f.date ?? null}::date, ${f.periodRef ?? null},
          ${(f.summary ?? SUMMARY[f.type]).slice(0, 500)}, ${JSON.stringify(f.evidence)}::jsonb, ${runId}, ${runId})
        on conflict (tenant_id, fingerprint) do update set last_seen_at = now(), seen_count = team_data_alerts.seen_count + 1, last_run_id = excluded.last_run_id
        returning id, (xmax = 0) as inserted`.execute(trx)).rows[0];
      if (r?.inserted) await sql`insert into team_data_alert_events (tenant_id, branch_id, alert_id, actor_user_id, event_type, new_status, safe_metadata_json, request_id)
          values (${T}, ${br}, ${r.id}, ${actor}, 'DETECTED', 'OPEN', ${JSON.stringify({ runId, type: f.type })}::jsonb, ${requestId})`.execute(trx);
      return !!r?.inserted;
    });
  }

  private async orphaned(ctx: TeamCtx, today: string): Promise<Finding[]> {
    const T = ctx.tenantId; const out: Finding[] = [];
    const appts = (await sql<any>`select a.id, a.technician_id, a.branch_id, to_char(a.appt_date, 'YYYY-MM-DD') as d, a.status, te.id is null as missing, te.status as tech_status, te.archived_at, te.user_id, te.full_name
      from pos_tech_appointments a left join technicians te on te.id = a.technician_id and te.tenant_id = ${T}
      where a.tenant_id = ${T} and ${this.brA(ctx)} and a.technician_id is not null and a.appt_date >= ${today}::date and coalesce(a.status, '') not in ('cancelled', 'canceled', 'no_show', 'completed')
        and (te.id is null or te.archived_at is not null or coalesce(te.status, 'active') in ('archived', 'inactive', 'terminated', 'suspended'))
      order by a.appt_date, a.id limit ${LIMIT}`.execute(this.db)).rows;
    for (const r of appts) out.push({ type: 'ORPHANED_ASSIGNMENT', fingerprint: `ORPHANED_ASSIGNMENT|appointment|${r.id}|${r.technician_id}`, severity: r.missing ? 'high' : 'medium',
      userId: r.user_id ? String(r.user_id) : null, technicianId: r.missing ? null : String(r.technician_id), date: r.d, branchId: r.branch_id ? String(r.branch_id) : null,
      evidence: { kind: 'appointment', appointmentId: String(r.id), date: r.d, appointmentStatus: r.status ?? null, technicianId: String(r.technician_id), technicianStatus: r.missing ? null : r.tech_status ?? null,
        archived: !!r.archived_at, notInThisSalon: !!r.missing, technician: r.full_name ?? null } });
    const roles = (await sql<any>`select sa.user_id, sa.template_key, sa.assigned_at, u.id is null as missing, u.status as user_status, u.full_name
      from staff_role_assignments sa left join users u on u.id = sa.user_id and u.tenant_id = ${T}
      where sa.tenant_id = ${T} and (u.id is null or coalesce(u.status, 'active') in ('inactive', 'suspended', 'archived', 'deleted'))
      order by sa.user_id limit ${LIMIT}`.execute(this.db)).rows;
    for (const r of roles) out.push({ type: 'ORPHANED_ASSIGNMENT', fingerprint: `ORPHANED_ASSIGNMENT|role|${r.user_id}|${h12(String(r.template_key))}`, severity: r.missing ? 'medium' : 'low',
      userId: r.missing ? null : String(r.user_id), technicianId: null,
      evidence: { kind: 'role_template', userId: String(r.user_id), templateKey: String(r.template_key), assignedAt: iso(r.assigned_at), userStatus: r.missing ? null : r.user_status ?? null, notInThisSalon: !!r.missing, name: r.full_name ?? null } });
    return out;
  }
  private async missingBranch(ctx: TeamCtx): Promise<Finding[]> {
    const T = ctx.tenantId; const b = branchOf(ctx); const out: Finding[] = [];
    const nb = (await sql<any>`select count(*)::int as n from branches br where br.tenant_id = ${T} and coalesce(br.status, 'active') = 'active'`.execute(this.db)).rows[0];
    // dangling: a staff record pointing at a branch id that is not one of this salon's branches
    const dangling = (await sql<any>`select 'technician' as kind, te.id, te.user_id, te.branch_id, te.full_name as name from technicians te
        where te.tenant_id = ${T} and te.archived_at is null and coalesce(te.status, '') <> 'archived' and te.branch_id is not null
          and not exists (select 1 from branches br where br.tenant_id = ${T} and br.id = te.branch_id)
      union all select 'user', u.id, u.id, u.branch_id, coalesce(nullif(u.full_name, ''), u.email) from users u
        where u.tenant_id = ${T} and upper(coalesce(u.role, '')) not in ('CUSTOMER', 'SUPER_ADMIN') and coalesce(u.status, 'active') not in ('archived', 'deleted') and u.branch_id is not null
          and not exists (select 1 from branches br where br.tenant_id = ${T} and br.id = u.branch_id)
      union all select 'branch_access', ba.user_id, ba.user_id, ba.branch_id, coalesce(nullif(u2.full_name, ''), u2.email) from user_branch_access ba left join users u2 on u2.id = ba.user_id and u2.tenant_id = ${T}
        where ba.tenant_id = ${T} and not exists (select 1 from branches br where br.tenant_id = ${T} and br.id = ba.branch_id)
      order by 1, 2 limit ${LIMIT}`.execute(this.db)).rows;
    for (const r of dangling) out.push({ type: 'MISSING_BRANCH_ASSOCIATION', fingerprint: `MISSING_BRANCH_ASSOCIATION|dangling|${r.kind}|${r.id}|${r.branch_id}`, severity: 'high',
      userId: r.user_id ? String(r.user_id) : null, technicianId: r.kind === 'technician' ? String(r.id) : null,
      evidence: { kind: r.kind, branchId: String(r.branch_id), notThisSalonsBranch: true, name: r.name ?? null } });
    // none: in a salon with 2+ branches, a current provider / front-desk login with no branch at all (owners and managers may be salon-wide)
    if (N(nb?.n) >= 2 && !b) {
      const none = (await sql<any>`select 'technician' as kind, te.id, te.user_id, te.full_name as name from technicians te
          where te.tenant_id = ${T} and te.archived_at is null and coalesce(te.status, 'active') = 'active' and te.branch_id is null
            and (te.user_id is null or not exists (select 1 from user_branch_access ba where ba.tenant_id = ${T} and ba.user_id = te.user_id))
            and (te.user_id is null or not exists (select 1 from users u where u.tenant_id = ${T} and u.id = te.user_id and u.branch_id is not null))
        union all select 'user', u.id, u.id, coalesce(nullif(u.full_name, ''), u.email) from users u
          where u.tenant_id = ${T} and upper(coalesce(u.role, '')) in ('FRONT_DESK', 'RECEPTION', 'TECHNICIAN') and coalesce(u.status, 'active') in ('active', 'invited') and u.branch_id is null
            and not exists (select 1 from user_branch_access ba where ba.tenant_id = ${T} and ba.user_id = u.id)
            and not exists (select 1 from technicians t3 where t3.tenant_id = ${T} and t3.user_id = u.id)
        order by 1, 2 limit ${LIMIT}`.execute(this.db)).rows;
      for (const r of none) out.push({ type: 'MISSING_BRANCH_ASSOCIATION', fingerprint: `MISSING_BRANCH_ASSOCIATION|none|${r.kind}|${r.id}`, severity: 'medium',
        userId: r.user_id ? String(r.user_id) : null, technicianId: r.kind === 'technician' ? String(r.id) : null,
        evidence: { kind: r.kind, branches: N(nb?.n), name: r.name ?? null, note: 'Not shown in any branch schedule or branch report.' } });
    }
    return out;
  }

  // ── list / detail ─────────────────────────────────────────────────────────────────────────────────────────────
  private view(ctx: TeamCtx, r: any) {
    const pay = canAny(ctx, ...PAY); const ev = { ...(r.evidence_json ?? {}) };
    if (r.alert_type === 'COMMISSION_PAID_MISMATCH' && !pay) for (const k of ['earnedCents', 'tipsCents', 'adjustmentsCents', 'expectedCents', 'paidCents', 'differenceCents']) ev[k] = null;
    const meta = ALERT_META[String(r.alert_type) as AlertType];
    return { id: String(r.id), type: String(r.alert_type), status: String(r.status), severity: String(r.severity), summary: String(r.summary), userId: r.user_id ? String(r.user_id) : null,
      tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null, category: meta?.category ?? 'other', remediation: meta?.remediation ?? null,
      firstSeenAt: iso(r.detected_at), seenCount: N(r.seen_count) || 1, lastRunId: r.last_run_id ? String(r.last_run_id) : null,
      evidencePointers: Object.entries(ev).filter(([k, v]) => /Id$/.test(k) && typeof v === 'string').map(([k, v]) => ({ kind: k.replace(/Id$/, ''), id: v as string })),
      technicianId: r.technician_id ? String(r.technician_id) : null, memberId: r.user_id ? String(r.user_id) : r.technician_id ? String(r.technician_id) : null, member: r.member ?? null,
      relatedMemberId: r.related_user_id ? String(r.related_user_id) : r.related_technician_id ? String(r.related_technician_id) : null,
      date: r.subject_date ? String(iso(r.subject_date)).slice(0, 10) : null, evidence: ev, amountsHidden: r.alert_type === 'COMMISSION_PAID_MISMATCH' && !pay,
      assigneeUserId: r.assigned_to_user_id ? String(r.assigned_to_user_id) : null, assignee: r.assignee ?? null, detectedAt: iso(r.detected_at), lastSeenAt: iso(r.last_seen_at), updatedAt: iso(r.updated_at),
      version: N(r.version), actions: alertActions(String(r.status) as Status), links: LINKS[String(r.alert_type) as AlertType] ?? ['employee'] };
  }
  private base(ctx: TeamCtx) {
    const T = ctx.tenantId;
    return sql`from team_data_alerts a left join users au on au.id = a.assigned_to_user_id and au.tenant_id = a.tenant_id
      left join users mu on mu.id = a.user_id and mu.tenant_id = a.tenant_id left join technicians mt on mt.id = a.technician_id and mt.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and ${this.brA(ctx)}`;
  }
  async list(ctx: TeamCtx, f: { status?: string; type?: string; severity?: string; q?: string; memberId?: string; page?: unknown; pageSize?: unknown }) {
    this.mustView(ctx); const { page, pageSize } = paging(f.page, f.pageSize, 6);
    const st = (ALERT_STATUSES as readonly string[]).includes(String(f.status)) ? String(f.status) : f.status === 'all' ? 'all' : 'open_all';
    const type = (ALERT_TYPES as readonly string[]).includes(String(f.type)) ? String(f.type) : null; const sev = ['low', 'medium', 'high'].includes(String(f.severity)) ? String(f.severity) : null;
    const mid = f.memberId && UUID.test(f.memberId) ? f.memberId : null;
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw);
    const w = sql`(${st} = 'all' or (${st} = 'open_all' and a.status in ('OPEN', 'ASSIGNED', 'INVESTIGATING')) or a.status = ${st}) and (${type}::text is null or a.alert_type = ${type}) and (${sev}::text is null or a.severity = ${sev})
      and (${mid}::uuid is null or a.user_id = ${mid} or a.technician_id = ${mid} or a.related_user_id = ${mid} or a.related_technician_id = ${mid})
      and (${raw} = '' or a.summary ilike ${l} or coalesce(mu.full_name, mt.full_name, '') ilike ${l})`;
    const counts = (await sql<any>`select a.status, count(*)::int as n ${this.base(ctx)} group by a.status`.execute(this.db)).rows;
    const total = N((await sql<any>`select count(*)::int as n ${this.base(ctx)} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select ${ALERT_COLS}, coalesce(nullif(au.full_name, ''), au.email) as assignee, coalesce(nullif(mu.full_name, ''), mt.full_name) as member ${this.base(ctx)} and ${w}
      order by a.detected_at desc, a.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { counts: Object.fromEntries(ALERT_STATUSES.map((s) => [s, N(counts.find((c: any) => c.status === s)?.n)])), lastRun: await this.lastRun(ctx), canReview: canAny(ctx, ...REVIEW),
      items: rows.map((r: any) => this.view(ctx, r)), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  async lastRun(ctx: TeamCtx) {
    const r = (await sql<any>`select a.id, a.status, a.started_at, a.finished_at, a.summary_json, a.run_trigger, coalesce(nullif(u.full_name, ''), u.email) as actor from team_data_alert_runs a left join users u on u.id = a.actor_user_id and u.tenant_id = a.tenant_id
      where a.tenant_id = ${ctx.tenantId} and ${this.brA(ctx)} order by a.started_at desc, a.id desc limit 1`.execute(this.db)).rows[0];
    const n = (await sql<any>`select to_char(a.run_date, 'YYYY-MM-DD') as run_date, a.status, a.attempts, a.last_error, a.finished_at, a.escalated_at from team_data_nightly_runs a where a.tenant_id = ${ctx.tenantId} order by a.run_date desc limit 1`.execute(this.db)).rows[0];
    const nightly = n ? { runDate: ymdOf(n.run_date), status: String(n.status), attempts: N(n.attempts), lastError: n.last_error ?? null, finishedAt: iso(n.finished_at), escalated: !!n.escalated_at } : null;
    return r ? { id: String(r.id), status: String(r.status), trigger: String(r.run_trigger ?? 'manual'), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), actor: r.actor ?? null, summary: r.summary_json ?? {}, nightly }
      : nightly ? { id: null, status: nightly.status, trigger: 'nightly', startedAt: null, finishedAt: nightly.finishedAt, actor: null, summary: {}, nightly } : null;
  }
  async detail(ctx: TeamCtx, id: string, f: { page?: unknown; pageSize?: unknown } = {}) {
    this.mustView(ctx); const T = ctx.tenantId;
    if (!UUID.test(String(id))) throw err(404, 'ALERT_NOT_FOUND', 'That alert is not in this salon.');
    const r = (await sql<any>`select ${ALERT_COLS}, coalesce(nullif(au.full_name, ''), au.email) as assignee, coalesce(nullif(mu.full_name, ''), mt.full_name) as member,
        (select coalesce(nullif(x.full_name, ''), x.email) from users x where x.tenant_id = a.tenant_id and x.id = a.resolved_by) as resolver,
        (select coalesce(nullif(x.full_name, ''), x.email) from users x where x.tenant_id = a.tenant_id and x.id = a.dismissed_by) as dismisser
      ${this.base(ctx)} and a.id = ${id}`.execute(this.db)).rows[0];
    if (!r) throw err(404, 'ALERT_NOT_FOUND', 'That alert is not in this salon.');
    const { page, pageSize } = paging(f.page, f.pageSize, 6);
    const total = N((await sql<any>`select count(*)::int as n from team_data_alert_events e where e.tenant_id = ${T} and e.alert_id = ${id}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const ev = (await sql<any>`select e.id, e.event_type, e.old_status, e.new_status, e.reason, e.created_at, coalesce(nullif(u.full_name, ''), u.email) as actor from team_data_alert_events e
      left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id where e.tenant_id = ${T} and e.alert_id = ${id} order by e.created_at desc, e.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { ...this.view(ctx, r), assignedAt: iso(r.assigned_at), investigatingAt: iso(r.investigating_at), resolutionNote: r.resolution_note ?? null, resolvedAt: iso(r.resolved_at), resolvedBy: r.resolver ?? null,
      dismissReason: r.dismiss_reason ?? null, dismissedAt: iso(r.dismissed_at), dismissedBy: r.dismisser ?? null, canAct: canAny(ctx, ...REVIEW),
      history: { items: ev.map((e: any) => ({ id: String(e.id), type: String(e.event_type), from: e.old_status ?? null, to: e.new_status ?? null, reason: e.reason ?? null, at: iso(e.created_at), actor: e.actor ?? null })),
        page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages } };
  }
  async assignees(ctx: TeamCtx, q?: string) {
    if (!canAny(ctx, ...REVIEW)) throw err(403, 'FORBIDDEN', 'You do not have permission to assign team data alerts.');
    const raw = String(q ?? '').trim().slice(0, 100); const l = like(raw);
    const rows = (await sql<any>`select u.id, coalesce(nullif(u.full_name, ''), u.email) as name from users u where u.tenant_id = ${ctx.tenantId} and coalesce(u.status, 'active') = 'active' and upper(coalesce(u.role, '')) <> 'CUSTOMER'
      and (${raw} = '' or coalesce(u.full_name, '') ilike ${l} or coalesce(u.email, '') ilike ${l}) order by lower(coalesce(nullif(u.full_name, ''), u.email, '')), u.id limit 25`.execute(this.db)).rows;
    return { items: rows.map((r: any) => ({ userId: String(r.id), name: r.name ?? null })) };
  }

  // ── workflow ──────────────────────────────────────────────────────────────────────────────────────────────────
  async act(ctx: TeamCtx, id: string, action: AlertAction, b: AlertActionBody, requestId: string) {
    const T = ctx.tenantId;
    if (!canAny(ctx, ...REVIEW)) {
      await writeAuditRow(this.db, ctx, { module: 'workforce', action: `team.data_alert.${action}.denied`, resourceType: 'team_data_alert', resourceId: UUID.test(String(id)) ? id : 'invalid', status: 'denied', severity: 'warning',
        summary: 'Denied: no permission to review team data alerts', metadata: { attempted: action }, requestId }).catch(logGap('team_data_alert_denial_not_recorded'));
      throw err(403, 'FORBIDDEN', 'You do not have permission to review team data alerts.');
    }
    if (!UUID.test(String(id))) throw err(404, 'ALERT_NOT_FOUND', 'That alert is not in this salon.');
    const expected = Number(b.expectedVersion);
    if (!Number.isInteger(expected) || expected < 1) throw err(400, 'EXPECTED_VERSION_REQUIRED', 'Reload the alert and try again.');
    const note = text(b.note ?? b.reason, 2000);
    if ((action === 'resolve' || action === 'dismiss' || action === 'reopen') && note.length < 5) throw err(422, 'REASON_REQUIRED', 'Write an explanation (at least 5 characters).');
    if (action === 'note' && !note) throw err(422, 'NOTE_REQUIRED', 'Write the note.');
    let assignee: string | null = null;
    if (action === 'assign') {
      assignee = typeof b.assigneeUserId === 'string' && UUID.test(b.assigneeUserId) ? b.assigneeUserId : null;
      if (!assignee) throw err(422, 'ASSIGNEE_REQUIRED', 'Choose who reviews this alert.');
      const u = (await sql<any>`select 1 as x from users u where u.tenant_id = ${T} and u.id = ${assignee} and coalesce(u.status, 'active') = 'active'`.execute(this.db)).rows[0];
      if (!u) throw err(422, 'ASSIGNEE_NOT_IN_SALON', 'That person is not an active user of this salon.');
    }
    const out = await this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select a.id, a.branch_id, a.alert_type, a.status, a.version, a.assigned_to_user_id from team_data_alerts a where a.tenant_id = ${T} and ${this.brA(ctx)} and a.id = ${id} for update`.execute(trx)).rows[0];
      if (!cur) throw err(404, 'ALERT_NOT_FOUND', 'That alert is not in this salon.');
      if (N(cur.version) !== expected) throw err(409, 'VERSION_CONFLICT', 'Someone else changed this alert. Reload to see the latest.', { currentVersion: N(cur.version), currentStatus: String(cur.status) });
      const from = String(cur.status) as Status; const t = ALERT_TRANSITIONS[action];
      if (!t.from.includes(from)) throw err(422, 'INVALID_TRANSITION', `A ${from.toLowerCase()} alert cannot do that.`, { status: from, allowed: alertActions(from) });
      const to = t.to(from); const v = expected + 1;
      let moved: { numAffectedRows?: bigint } | null = null;   // the row is locked; 0 rows here means the machine refused the move
      if (action === 'assign') moved = await sql`update team_data_alerts a set status = ${to}, assigned_to_user_id = ${assignee}, assigned_at = now(), version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${id} and ${canMoveToSql(TEAM_DATA_ALERT, to, 'a')}`.execute(trx);
      else if (action === 'investigate') moved = await sql`update team_data_alerts a set status = ${to}, investigating_at = now(), assigned_to_user_id = coalesce(a.assigned_to_user_id, ${ctx.userId ?? null}), version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${id} and ${canMoveToSql(TEAM_DATA_ALERT, to, 'a')}`.execute(trx);
      else if (action === 'resolve') moved = await sql`update team_data_alerts a set status = ${to}, resolution_note = ${note}, resolved_at = now(), resolved_by = ${ctx.userId ?? null}, version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${id} and ${canMoveToSql(TEAM_DATA_ALERT, to, 'a')}`.execute(trx);
      else if (action === 'dismiss') moved = await sql`update team_data_alerts a set status = ${to}, dismiss_reason = ${note}, dismissed_at = now(), dismissed_by = ${ctx.userId ?? null}, version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${id} and ${canMoveToSql(TEAM_DATA_ALERT, to, 'a')}`.execute(trx);
      // reopen keeps the previous resolution / dismissal (and its events): the old disposition is never erased
      else if (action === 'reopen') moved = await sql`update team_data_alerts a set status = ${to}, assigned_to_user_id = null, assigned_at = null, investigating_at = null, version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${id} and ${canMoveToSql(TEAM_DATA_ALERT, to, 'a')}`.execute(trx);
      else await sql`update team_data_alerts a set version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${id}`.execute(trx);
      if (moved && moved.numAffectedRows === 0n) throw err(409, 'INVALID_STATE_TRANSITION', `A ${from.toLowerCase()} alert cannot move to ${to.toLowerCase()}.`, { status: from, allowed: alertActions(from) });
      const meta = { ...(assignee ? { assigneeUserId: assignee, previousAssigneeUserId: cur.assigned_to_user_id ?? null } : {}), version: v, alertType: String(cur.alert_type) };
      await sql`insert into team_data_alert_events (tenant_id, branch_id, alert_id, actor_user_id, event_type, old_status, new_status, reason, safe_metadata_json, request_id)
        values (${T}, ${cur.branch_id ?? null}, ${id}, ${ctx.userId ?? null}, ${EVENT_OF[action]}, ${from}, ${to}, ${note || null}, ${JSON.stringify(meta)}::jsonb, ${requestId})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: `team.data_alert.${action}`, resourceType: 'team_data_alert', resourceId: id, summary: `Team data alert ${from} → ${to}`,
        before: { status: from, version: expected }, after: { status: to, version: v }, reason: note || null, metadata: meta, requestId });
      return { id };
    });
    return this.detail(ctx, out.id);
  }
}
