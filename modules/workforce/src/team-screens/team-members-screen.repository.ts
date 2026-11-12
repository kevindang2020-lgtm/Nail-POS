// team-members-screen.repository.ts — the read model behind Team Management (/tenant/team/members, Team Management build
// guide 30 Oct 2026). Raw, parameterised SQL over the canonical tables; the tenant is the session's and literal in every
// statement; the branch is the session's. It REPLACES the screen's use of GET /pos/team/state (in-memory roster, a
// technicians join without the tenant, server-local weekday, every ticket line counted) — that route stays for its other
// caller. Read only: every write stays where it already is (technicians, shift overrides, approvals, payroll).
//
// Who is a member: every non-customer user of the salon (user-keyed; their technician record joined WITH the tenant),
// plus every technician record with no login in this salon. memberId = the user id, or the technician id when there is
// no login. Multi-role staff are ONE member: All Members counts each once; each role tab counts the members holding it.
//
// Definitions (on the screen, in the handoff and in the pgtests):
//   total team members  unique current members (not archived) in the branch scope
//   active today        current service providers scheduled today (date override › published shift › weekly template,
//                       minus approved time off) OR with a time-clock punch / clocked-in state today — NOT "account active"
//   on shift now        technician_workforce_state.shift_status = ON_SHIFT (the one live state, migration 579)
//   avg performance     verified reviews (1–5, not hidden, not spam) created in the period, with the review count
//   services completed  paid ticket service lines in the period (not add-on, not retail, not removed, ticket not voided)
//   commission earned   the compensation snapshot's earnings (+ approved non-tip adjustments) in the period — an amount
//                       EARNED, never called paid; commission paid = payroll_payouts status 'paid' with paid_at in the period
//   pending approvals   skill requests + pending time off + profile changes + membership requests
//   open positions      not configured (there is no recruiting record) — never an invented zero
//   department          DERIVED from the role (there is no department column) and labelled so
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { ROLE_PERMISSIONS, type Role } from '@aipowersalon/permissions';
import { N, iso, like, err, maskPhone, phoneDigits, paging, served, branchOf, teamPeriod, inPeriod, UUID, canAny, logGap, type TeamCtx, type TPeriod } from './screen-kit';
import { auditedExport, toCsv, type ExportFilters } from './report-export';
import { dateColumnYmd, addDays } from '@aipowersalon/date-time';

export const TM_TABS = ['all', 'stylists', 'nail_technicians', 'receptionists', 'assistants', 'managers'] as const;
export const TM_ROLES = ['owner', 'manager', 'receptionist', 'stylist', 'nail_technician', 'assistant', 'other'] as const;
export const TM_DEPTS = ['management', 'front_desk', 'hair_services', 'nail_services', 'support'] as const;
export const TM_STATUSES = ['available', 'in_service', 'assigned', 'on_break', 'on_shift', 'off', 'time_off', 'not_tracked'] as const;
export const TM_SHIFTS = ['scheduled', 'unscheduled', 'clocked_in', 'day_off'] as const;
export const TM_ACCOUNTS = ['current', 'active', 'inactive', 'archived', 'all'] as const;
export const TM_BASES = ['service', 'created'] as const;
export const TM_SORTS = ['newest', 'oldest', 'name'] as const;
export const TM_EXTRAS = ['missing_mapping', 'no_login', 'has_login', 'unrated'] as const;
export const ATTENDANCE_TOLERANCE_MIN = 15;
const TAB_ROLE: Record<string, string[]> = { stylists: ['stylist'], nail_technicians: ['nail_technician'], receptionists: ['receptionist'], assistants: ['assistant'], managers: ['manager', 'owner'] };
const CONTACT = ['technicians.edit', 'pos.technicians.edit'];
const PAY = ['technicians.view_pay', 'payroll.view'];
const ACCESS = ['roles.view', 'settings.view', 'audit.view'];
const SCHEDULE_EDIT = ['pos.technicians.schedule.edit'];
const ADJ_OK = ['posted', 'approved', 'applied'];
const ymd = (v: unknown) => dateColumnYmd(v);   // a Postgres DATE column (the driver's local-midnight Date) → its calendar day

export interface DirectoryFilters {
  q?: string; tab?: string; staffRole?: string; status?: string; shift?: string; department?: string; account?: string; extra?: string; basis?: string; sort?: string;
  preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown;
}

export class TeamMembersScreenRepository {
  constructor(private readonly db: Kysely<any>) {}
  period(ctx: TeamCtx, q: { preset?: unknown; from?: unknown; to?: unknown }, def = 'month') { return teamPeriod(this.db, ctx, q, def); }
  /** a paid, not removed, not voided ticket (alias t) */
  private paid() { return sql`t.paid_at is not null and t.removed_at is null and coalesce(t.payment_status, '') <> 'voided'`; }
  private brT(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(t.branch_id = ${b} or t.branch_id is null)` : sql`true`; }

  /** the roster: m0 (users + login-less technicians, branch scope) → m1 (roles) → m2 (live + today's shift parts) → m */
  roster(ctx: TeamCtx, today: TPeriod): RawBuilder<unknown> {
    const T = ctx.tenantId; const b = branchOf(ctx);
    const brU = b ? sql`(u.branch_id = ${b} or u.branch_id is null or te.branch_id = ${b} or exists (select 1 from user_branch_access ba where ba.tenant_id = ${T} and ba.user_id = u.id and ba.branch_id = ${b}))` : sql`true`;
    const brX = b ? sql`(tx.branch_id = ${b} or tx.branch_id is null)` : sql`true`;
    const sra = (re: string) => sql`exists (select 1 from staff_role_assignments sa where sa.tenant_id = ${T} and sa.user_id = r.user_id and lower(sa.template_key) ~ ${re})`;
    return sql`with m0 as (
        select 'user'::text as kind, u.id as member_id, u.id as user_id, te.id as technician_id,
          coalesce(nullif(u.full_name, ''), nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), nullif(te.full_name, ''), u.email, 'Team member') as name,
          coalesce(u.email, te.email) as email, coalesce(te.normalized_phone, u.normalized_phone) as phone_norm, te.phone_display, coalesce(u.avatar_url, te.avatar_url) as avatar_url,
          upper(coalesce(u.role, '')) as account_role, te.role_label, coalesce(u.status, 'active') as user_status, te.status as tech_status, te.archived_at,
          coalesce(u.created_at, te.created_at) as created_at, coalesce(u.branch_id, te.branch_id) as branch_id, u.last_login_at, u.mfa_enabled, greatest(u.updated_at, te.updated_at) as updated_at,
          (select sp.job_role from team_staff_profiles sp where sp.tenant_id = ${T} and sp.user_id = u.id) as job_role
        from users u left join lateral (select t2.id, t2.full_name, t2.email, t2.normalized_phone, t2.phone_display, t2.avatar_url, t2.role_label, t2.status, t2.archived_at, t2.created_at, t2.branch_id, t2.updated_at
            from technicians t2 where t2.tenant_id = ${T} and t2.user_id = u.id order by (t2.archived_at is null) desc, t2.created_at desc, t2.id desc limit 1) te on true
        where u.tenant_id = ${T} and upper(coalesce(u.role, '')) not in ('CUSTOMER', 'SUPER_ADMIN') and ${brU}
        union all
        select 'technician', tx.id, null::uuid, tx.id, coalesce(nullif(tx.full_name, ''), nullif(trim(coalesce(tx.first_name, '') || ' ' || coalesce(tx.last_name, '')), ''), 'Technician'),
          tx.email, tx.normalized_phone, tx.phone_display, tx.avatar_url, 'TECHNICIAN', tx.role_label, null, tx.status, tx.archived_at, tx.created_at, tx.branch_id, null::timestamptz, null::boolean, tx.updated_at,
          (select sp.job_role from team_staff_profiles sp where sp.tenant_id = ${T} and sp.technician_id = tx.id)
        from technicians tx where tx.tenant_id = ${T} and ${brX} and (tx.user_id is null or not exists (select 1 from users u3 where u3.tenant_id = ${T} and u3.id = tx.user_id))),
      m1 as (select r.*, lower(coalesce(r.role_label, '')) as rl, case when r.job_role in ('receptionist', 'assistant', 'manager', 'stylist', 'nail_technician') and r.account_role <> 'OWNER' then array[r.job_role]::text[] else array_remove(array[
          case when r.account_role = 'OWNER' then 'owner' end,
          case when r.account_role = 'MANAGER' or lower(coalesce(r.role_label, '')) ~ 'manager' or ${sra('manager')} then 'manager' end,
          case when r.account_role in ('FRONT_DESK', 'RECEPTION') or lower(coalesce(r.role_label, '')) ~ '(reception|front)' or ${sra('(reception|front)')} then 'receptionist' end,
          case when lower(coalesce(r.role_label, '')) ~ '(stylist|hair)' or ${sra('stylist')} then 'stylist' end,
          case when (r.technician_id is not null or r.account_role = 'TECHNICIAN') and not lower(coalesce(r.role_label, '')) ~ '(stylist|hair|reception|front|assistant|manager)' then 'nail_technician' end,
          case when lower(coalesce(r.role_label, '')) ~ 'assistant' or ${sra('assistant')} then 'assistant' end]::text[], null) end as roles0
        from m0 r),
      m2 as (select r.*, case when cardinality(r.roles0) = 0 then array['other']::text[] else r.roles0 end as roles,
          ws.queue_status, ws.shift_status, ws.clock_status, ws.manual_unavailable, ws.break_started_at, ws.updated_at as live_at,
          (select o.override_type from technician_shift_overrides o where o.tenant_id = ${T} and o.technician_id = r.technician_id and o.local_shift_date = ${today.today}::date and (${b}::uuid is null or o.branch_id = ${b}) order by o.updated_at desc limit 1) as ov_type,
          (select to_char(o.start_local_time, 'HH24:MI') || '–' || to_char(o.end_local_time, 'HH24:MI') from technician_shift_overrides o where o.tenant_id = ${T} and o.technician_id = r.technician_id and o.local_shift_date = ${today.today}::date
            and (${b}::uuid is null or o.branch_id = ${b}) and o.override_type = 'CUSTOM_SHIFT' order by o.updated_at desc limit 1) as ov_text,
          (select to_char(sh.start_time at time zone ${today.tz}, 'HH24:MI') || '–' || to_char(sh.end_time at time zone ${today.tz}, 'HH24:MI') from technician_shifts sh where sh.tenant_id = ${T} and sh.technician_id = r.technician_id
            and sh.shift_date = ${today.today}::date and sh.status = 'scheduled' order by sh.start_time limit 1) as pub_text,
          (select to_char(sc.start_time, 'HH24:MI') || '–' || to_char(sc.end_time, 'HH24:MI') from technician_schedules sc where sc.tenant_id = ${T} and sc.technician_id = r.technician_id and sc.day_of_week = ${today.dow} and sc.is_working
            and (${b}::uuid is null or sc.branch_id = ${b} or sc.branch_id is null) order by (sc.branch_id is null), sc.updated_at desc nulls last limit 1) as wk_text,
          exists (select 1 from technician_time_off tf where tf.tenant_id = ${T} and tf.technician_id = r.technician_id and tf.status = 'approved'
            and tf.starts_at < ((${today.today}::date + 1)::timestamp at time zone ${today.tz}) and tf.ends_at > ((${today.today}::date)::timestamp at time zone ${today.tz})) as off_today,
          exists (select 1 from technician_time_off tf where tf.tenant_id = ${T} and tf.technician_id = r.technician_id and tf.status = 'approved' and tf.starts_at <= now() and tf.ends_at > now()) as off_now,
          (exists (select 1 from technician_shifts p where p.tenant_id = ${T} and p.technician_id = r.technician_id and p.shift_date = ${today.today}::date and p.status in ('active', 'completed'))
            or coalesce(ws.clock_status, '') in ('CLOCKED_IN', 'ON_BREAK')) as clocked_today
        from m1 r left join technician_workforce_state ws on ws.tenant_id = ${T} and ws.technician_id = r.technician_id),
      m as (select r.*,
          case when 'owner' = any(r.roles) or 'manager' = any(r.roles) then 'management' when 'receptionist' = any(r.roles) then 'front_desk' when 'stylist' = any(r.roles) then 'hair_services'
            when 'nail_technician' = any(r.roles) then 'nail_services' else 'support' end as dept,
          coalesce(r.technician_id is not null and not r.off_today and (coalesce(r.ov_type, '') = 'CUSTOM_SHIFT' or (r.ov_type is null and (r.pub_text is not null or r.wk_text is not null))), false) as scheduled,
          case when r.technician_id is null then null when r.off_today then 'time_off' when r.ov_type = 'DAY_OFF' then 'override_off' when r.ov_type = 'CUSTOM_SHIFT' then 'override'
            when r.pub_text is not null then 'published' when r.wk_text is not null then 'weekly' else null end as shift_source,
          case when r.ov_type = 'CUSTOM_SHIFT' then r.ov_text when r.ov_type is null then coalesce(r.pub_text, r.wk_text) else null end as shift_text,
          case when r.technician_id is null then 'not_tracked' when r.queue_status = 'SERVING' then 'in_service' when r.queue_status = 'BREAK' or r.clock_status = 'ON_BREAK' then 'on_break'
            when r.queue_status = 'ASSIGNED' then 'assigned' when r.queue_status = 'AVAILABLE' and not coalesce(r.manual_unavailable, false) then 'available' when r.shift_status = 'ON_SHIFT' then 'on_shift'
            when r.off_now then 'time_off' else 'off' end as live,
          (r.archived_at is null and coalesce(r.tech_status, '') <> 'archived' and coalesce(r.user_status, '') not in ('archived', 'deleted')) as is_current,
          (r.archived_at is null and coalesce(r.tech_status, 'active') = 'active' and coalesce(r.user_status, 'active') = 'active') as is_active,
          'EMP-' || upper(right(r.member_id::text, 8)) as code
        from m2 r)`;
  }

  // ── KPIs + every panel ────────────────────────────────────────────────────────────────────────────────────────
  async dashboard(ctx: TeamCtx, q: { preset?: unknown; from?: unknown; to?: unknown }) {
    const T = ctx.tenantId; const per = await this.period(ctx, q, 'month'); const today = await this.period(ctx, { preset: 'today' });
    const pay = canAny(ctx, ...PAY); const errors: string[] = [];
    const safe = async <X>(name: string, fn: () => Promise<X>): Promise<X | null> => { try { return await fn(); } catch (e) { logGap(`team_members_kpi_${name}_failed`)(e); errors.push(name); return null; } };
    const R = this.roster(ctx, today);
    const team = await safe('team', async () => (await sql<any>`${R} select count(*) filter (where m.is_current)::int as team, count(*) filter (where m.is_active)::int as active,
        count(*) filter (where m.is_current and not m.is_active)::int as inactive, count(*) filter (where m.is_current and m.technician_id is not null)::int as providers,
        count(*) filter (where m.is_active and m.technician_id is not null and (m.scheduled or m.clocked_today))::int as active_today,
        count(*) filter (where m.is_active and m.scheduled)::int as scheduled, count(*) filter (where m.is_active and m.clocked_today)::int as clocked_today,
        count(*) filter (where m.is_current and m.shift_status = 'ON_SHIFT')::int as on_shift, count(*) filter (where m.is_current and m.clock_status in ('CLOCKED_IN', 'ON_BREAK'))::int as clocked_in,
        count(*) filter (where m.is_current and m.live = 'available')::int as available, count(*) filter (where m.is_current and m.live = 'in_service')::int as serving,
        count(*) filter (where m.is_current and m.live = 'assigned')::int as assigned, count(*) filter (where m.is_current and m.live = 'on_break')::int as on_break,
        count(*) filter (where m.is_current and m.live = 'on_shift')::int as on_shift_other, count(*) filter (where m.is_current and m.live = 'time_off')::int as time_off,
        count(*) filter (where m.is_current and m.live = 'off')::int as off, count(*) filter (where m.is_current and m.live = 'not_tracked')::int as not_tracked,
        count(*) filter (where m.is_current and m.technician_id is not null and not exists (select 1 from technician_services ts where ts.tenant_id = ${T} and ts.technician_id = m.technician_id))::int as unmapped
      from m`.execute(this.db)).rows[0]);
    const tabs = await safe('tabs', () => this.tabCounts(ctx, R, sql`m.is_current`));
    const rate = await safe('rating', async () => (await sql<any>`${R} select count(r.id)::int as n, avg(r.rating)::numeric(4,2) as avg, count(distinct r.technician_id)::int as rated
      from reviews r join m on m.technician_id = r.technician_id and m.is_current where r.tenant_id = ${T} and r.rating is not null and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false)
        and ${inPeriod(sql`r.created_at`, per)}`.execute(this.db)).rows[0]);
    const sales = (p: TPeriod) => safe('sales', async () => (await sql<any>`select count(distinct l.id) filter (where lower(coalesce(l.line_kind, 'service')) = 'service' and not coalesce(l.is_add_on, false))::int as services,
        coalesce(sum(l.line_total_cents) filter (where lower(coalesce(l.line_kind, 'service')) in ('service', 'add_on') or coalesce(l.is_add_on, false)), 0)::bigint as revenue
      from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.technician_id is not null and l.removed_at is null and ${this.paid()} and ${this.brT(ctx)} and ${inPeriod(sql`t.paid_at`, p)}`.execute(this.db)).rows[0]);
    const money = (p: TPeriod) => (pay ? safe('commission', () => this.moneyFor(ctx, p, null)) : Promise.resolve(null));
    const sp = await sales(per); const mp = await money(per);
    // the same length just before (period comparison for Team Productivity); none for "all"
    const prev = per.from && per.to ? (() => { const d = Math.round((Date.parse(per.to) - Date.parse(per.from)) / 86_400_000) + 1; const to = addDays(per.from, -1);
      const from = addDays(per.from, -d); return { ...per, preset: 'custom', from, to }; })() : null;
    const spPrev = prev ? await sales(prev) : null; const mpPrev = prev ? await money(prev) : null;
    const approvals = await safe('approvals', async () => (await sql<any>`select
        (select count(*) from technician_skill_change_requests sk where sk.tenant_id = ${T} and sk.status in ('submitted', 'pending', 'under_review', 'more_information_required'))::int as skills,
        (select count(*) from technician_time_off tf where tf.tenant_id = ${T} and tf.status = 'pending')::int as time_off,
        (select count(*) from tech_profile_change_requests pc where pc.requested_in_tenant_id = ${T} and pc.status = 'pending')::int as profile,
        (select count(*) from tech_salon_memberships ms where ms.tenant_id = ${T} and ms.status = 'pending_salon_approval')::int as membership`.execute(this.db)).rows[0]);
    const bands = await safe('bands', async () => (await sql<any>`${R} select count(*) filter (where x.avg >= 4.5)::int as excellent, count(*) filter (where x.avg >= 3.5 and x.avg < 4.5)::int as very_good,
        count(*) filter (where x.avg >= 2.5 and x.avg < 3.5)::int as good, count(*) filter (where x.avg < 2.5)::int as needs, count(*) filter (where x.avg is null)::int as unrated, count(*)::int as providers
      from (select m.technician_id, (select avg(r.rating) from reviews r where r.tenant_id = ${T} and r.technician_id = m.technician_id and r.rating is not null and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false)
          and ${inPeriod(sql`r.created_at`, per)}) as avg from m where m.is_current and m.technician_id is not null) x`.execute(this.db)).rows[0]);
    const top = await safe('top', async () => (await sql<any>`${R} select m.member_id, m.technician_id, m.name, m.avatar_url, rv.avg, rv.n from m join lateral (select avg(r.rating)::numeric(4,2) as avg, count(*)::int as n from reviews r
        where r.tenant_id = ${T} and r.technician_id = m.technician_id and r.rating is not null and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false) and ${inPeriod(sql`r.created_at`, per)}) rv on rv.n > 0
      where m.is_current order by rv.avg desc, rv.n desc, m.member_id limit 5`.execute(this.db)).rows);
    const shifts = await safe('shifts', async () => (await sql<any>`${R} select m.member_id, m.name, m.shift_text, m.shift_source, m.clocked_today, m.live from m
      where m.is_active and m.scheduled order by split_part(m.shift_text, '–', 1), m.name, m.member_id limit 8`.execute(this.db)).rows);
    const certs = await safe('certifications', async () => (await sql<any>`${R} select count(*) filter (where c.revoked_reason is null and (c.expires_at is null or c.expires_at >= ${today.today}::date))::int as valid,
        count(*) filter (where c.revoked_reason is null and c.expires_at >= ${today.today}::date and c.expires_at <= ${today.today}::date + 30)::int as expiring,
        count(*) filter (where c.revoked_reason is null and c.expires_at < ${today.today}::date)::int as expired, count(*) filter (where upper(coalesce(c.verification_status, '')) = 'VERIFIED')::int as verified,
        count(*) filter (where ${inPeriod(sql`c.created_at`, per)})::int as added
      from technician_certifications c join m on m.technician_id = c.technician_id and m.is_current where c.tenant_id = ${T}`.execute(this.db)).rows[0]);
    // extras TEAM MANAGEMENT 09 — sync freshness: the newest record each connected feed has written for this salon (branch
    // scope where the feed has a branch). Source timestamps only; null = that feed has never written anything here.
    const bq = branchOf(ctx);
    const sync = await safe('sync', async () => (await sql<any>`select
        (select max(qi.updated_at) from pos_queue_items qi where qi.tenant_id = ${T} and (${bq}::uuid is null or qi.branch_id = ${bq})) as queue_at,
        (select max(ap.updated_at) from pos_tech_appointments ap where ap.tenant_id = ${T} and (${bq}::uuid is null or ap.branch_id = ${bq})) as booking_at,
        (select max(sh.updated_at) from technician_shifts sh where sh.tenant_id = ${T} and (${bq}::uuid is null or sh.branch_id = ${bq})) as clock_at,
        (select max(ws.updated_at) from technician_workforce_state ws where ws.tenant_id = ${T} and (${bq}::uuid is null or ws.branch_id = ${bq} or ws.branch_id is null)) as status_at,
        (select max(se.last_seen_at) from sessions se join users us on us.id = se.user_id and us.tenant_id = ${T}
          where se.tenant_id = ${T} and us.role = 'TECHNICIAN' and se.client_app is null) as tech_app_at`.execute(this.db)).rows[0]);
    const ap = approvals; const pend = ap ? N(ap.skills) + N(ap.time_off) + N(ap.profile) + N(ap.membership) : null;
    const v = <X>(x: X | null, f: (y: X) => unknown) => (x == null ? null : f(x));
    return {
      period: per, today: today.today, tz: today.tz, asOf: new Date().toISOString(), errors, canPay: pay,
      kpis: {
        totalMembers: v(team, (t) => N(t.team)), activeAccounts: v(team, (t) => N(t.active)), inactiveAccounts: v(team, (t) => N(t.inactive)), providers: v(team, (t) => N(t.providers)),
        activeToday: v(team, (t) => N(t.active_today)), scheduledToday: v(team, (t) => N(t.scheduled)), clockedToday: v(team, (t) => N(t.clocked_today)),
        onShiftNow: v(team, (t) => N(t.on_shift)), clockedInNow: v(team, (t) => N(t.clocked_in)),
        avgRating: rate == null ? null : rate.avg == null ? null : Number(rate.avg), ratingCount: v(rate, (r) => N(r.n)), ratedMembers: v(rate, (r) => N(r.rated)),
        servicesCompleted: v(sp, (s) => N(s.services)),
        commissionEarnedCents: v(mp, (m) => m.earnedCents), commissionPaidCents: v(mp, (m) => m.paidCents),
        pendingApprovals: pend, approvals: ap ? { skills: N(ap.skills), timeOff: N(ap.time_off), profile: N(ap.profile), membership: N(ap.membership) } : null,
        openPositions: null as number | null, openPositionsReason: 'not_configured', missingServiceMapping: v(team, (t) => N(t.unmapped)),
      },
      tabs,
      attendance: team ? { available: N(team.available), inService: N(team.serving), assigned: N(team.assigned), onBreak: N(team.on_break), onShift: N(team.on_shift_other), timeOff: N(team.time_off),
        off: N(team.off), notTracked: N(team.not_tracked), scheduledToday: N(team.scheduled), clockedToday: N(team.clocked_today) } : null,
      bands: bands ? { excellent: N(bands.excellent), veryGood: N(bands.very_good), good: N(bands.good), needs: N(bands.needs), unrated: N(bands.unrated), providers: N(bands.providers) } : null,
      topPerformers: top ? top.map((r: any) => ({ memberId: String(r.member_id), technicianId: String(r.technician_id), name: String(r.name ?? ''), avatarUrl: r.avatar_url ?? null, rating: Number(r.avg), ratingCount: N(r.n), lowSample: N(r.n) < 5 })) : null,
      shiftOverview: shifts ? { scheduled: team ? N(team.scheduled) : null, onShiftNow: team ? N(team.on_shift) : null, clockedToday: team ? N(team.clocked_today) : null,
        items: shifts.map((r: any) => ({ memberId: String(r.member_id), name: String(r.name ?? ''), shift: r.shift_text ?? null, source: r.shift_source ?? null, clockedIn: !!r.clocked_today, live: String(r.live) })) } : null,
      productivity: sp ? { servicesCompleted: N(sp.services), revenueCents: pay ? N(sp.revenue) : null, commissionEarnedCents: mp?.earnedCents ?? null,
        previous: prev && spPrev ? { from: prev.from, to: prev.to, servicesCompleted: N(spPrev.services), revenueCents: pay ? N(spPrev.revenue) : null, commissionEarnedCents: mpPrev?.earnedCents ?? null } : null } : null,
      approvals: ap ? [{ type: 'skills', count: N(ap.skills) }, { type: 'time_off', count: N(ap.time_off) }, { type: 'profile', count: N(ap.profile) }, { type: 'membership', count: N(ap.membership) }] : null,
      certifications: certs ? { valid: N(certs.valid), expiringSoon: N(certs.expiring), expired: N(certs.expired), verified: N(certs.verified), addedInPeriod: N(certs.added) } : null,
      // round 2 (migration 727): the panels read /pos/team-training/summary and /pos/team-birthdays/upcoming; these flags say whether there is anything
      training: { configured: !!(await safe('training', async () => (await sql<any>`select 1 as x from team_training_courses c where c.tenant_id = ${T} and c.status = 'active' limit 1`.execute(this.db)).rows[0])) },
      syncFreshness: sync ? { queueAt: iso(sync.queue_at), bookingAt: iso(sync.booking_at), timeClockAt: iso(sync.clock_at), technicianStatusAt: iso(sync.status_at), technicianAppAt: iso(sync.tech_app_at) } : null,
      birthdays: { recorded: !!(await safe('birthdays', async () => (await sql<any>`select 1 as x from team_staff_profiles p where p.tenant_id = ${T} and p.birthday_month is not null limit 1`.execute(this.db)).rows[0])) },
    };
  }

  /** earned (snapshot + approved non-tip adjustments), tips, adjustments and PAID (payouts with status paid) for a period */
  private async moneyFor(ctx: TeamCtx, p: TPeriod, technicianId: string | null) {
    const T = ctx.tenantId; const b = branchOf(ctx);
    const brS = b ? sql`(s.branch_id = ${b} or s.branch_id is null)` : sql`true`; const brA = b ? sql`(a.branch_id = ${b} or a.branch_id is null)` : sql`true`; const brP = b ? sql`(p.branch_id = ${b} or p.branch_id is null)` : sql`true`;
    const tS = technicianId ? sql`s.technician_id = ${technicianId}` : sql`s.technician_id is not null`; const tA = technicianId ? sql`a.technician_id = ${technicianId}` : sql`a.technician_id is not null`;
    const tP = technicianId ? sql`p.technician_id = ${technicianId}` : sql`true`;
    const r = (await sql<any>`select
        (select coalesce(sum(coalesce(s.tech_service_earnings_cents, 0) + coalesce(s.retail_commission_cents, 0)), 0) from ticket_compensation_snapshots s where s.tenant_id = ${T} and ${brS} and ${tS} and ${inPeriod(sql`s.snapshot_at`, p)})::bigint as snap,
        (select coalesce(sum(coalesce(s.card_tip_cents, 0) + coalesce(s.cash_tip_cents, 0)), 0) from ticket_compensation_snapshots s where s.tenant_id = ${T} and ${brS} and ${tS} and ${inPeriod(sql`s.snapshot_at`, p)})::bigint as tips,
        (select coalesce(sum(a.amount_cents) filter (where a.category <> 'tip_correction'), 0) from compensation_adjustments a where a.tenant_id = ${T} and ${brA} and ${tA} and a.status = any(${ADJ_OK}) and ${inPeriod(sql`a.created_at`, p)})::bigint as adj,
        (select coalesce(sum(a.amount_cents) filter (where a.category = 'tip_correction'), 0) from compensation_adjustments a where a.tenant_id = ${T} and ${brA} and ${tA} and a.status = any(${ADJ_OK}) and ${inPeriod(sql`a.created_at`, p)})::bigint as tip_adj,
        (select coalesce(sum(p.amount_cents), 0) from payroll_payouts p where p.tenant_id = ${T} and ${brP} and ${tP} and p.status = 'paid' and ${inPeriod(sql`p.paid_at`, p)})::bigint as paid,
        (select coalesce(sum(p.amount_cents), 0) from payroll_payouts p where p.tenant_id = ${T} and ${brP} and ${tP} and p.status in ('pending', 'processing') and ${inPeriod(sql`p.created_at`, p)})::bigint as pending`.execute(this.db)).rows[0];
    const earned = N(r?.snap) + N(r?.adj); const tips = N(r?.tips) + N(r?.tip_adj);
    return { earnedCents: earned, snapshotCents: N(r?.snap), adjustmentsCents: N(r?.adj), tipsCents: tips, tipAdjustmentsCents: N(r?.tip_adj), payableCents: earned + tips, paidCents: N(r?.paid), pendingPayoutCents: N(r?.pending) };
  }

  private async tabCounts(ctx: TeamCtx, R: RawBuilder<unknown>, where: RawBuilder<unknown>) {
    const r = (await sql<any>`${R} select count(*)::int as all_n, count(*) filter (where 'stylist' = any(m.roles))::int as stylists, count(*) filter (where 'nail_technician' = any(m.roles))::int as nail_technicians,
        count(*) filter (where 'receptionist' = any(m.roles))::int as receptionists, count(*) filter (where 'assistant' = any(m.roles))::int as assistants,
        count(*) filter (where 'manager' = any(m.roles) or 'owner' = any(m.roles))::int as managers from m where ${where}`.execute(this.db)).rows[0];
    return TM_TABS.map((id) => ({ id, count: N(id === 'all' ? r?.all_n : r?.[id]) }));
  }

  // ── the directory: server search over the whole authorised set, filters, tabs, newest first, numbered pages ─────
  private directoryWhere(ctx: TeamCtx, f: DirectoryFilters, per: TPeriod, withTab: boolean) {
    const T = ctx.tenantId; const contact = canAny(ctx, ...CONTACT);
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const { d, phoneish } = phoneDigits(raw); const isId = UUID.test(raw); const low = raw.toLowerCase();
    const idPrefix = /^(emp-)?[0-9a-f]{4,8}$/i.test(raw) ? low.replace(/^emp-/, '') : null; const tn = raw.replace(/^#/, '');
    const account = (TM_ACCOUNTS as readonly string[]).includes(String(f.account)) ? String(f.account) : 'current';
    const status = (TM_STATUSES as readonly string[]).includes(String(f.status)) ? String(f.status) : null;
    const shift = (TM_SHIFTS as readonly string[]).includes(String(f.shift)) ? String(f.shift) : null;
    const dept = (TM_DEPTS as readonly string[]).includes(String(f.department)) ? String(f.department) : null;
    const wanted = String(f.staffRole ?? ''); const staffRole: string | null = TM_ROLES.find((x) => x === wanted) ?? null;   // a staff-role FILTER on the data, never an authorization decision
    const tabRoles = withTab && f.tab && TAB_ROLE[f.tab] ? TAB_ROLE[f.tab] : null;
    const extra = (TM_EXTRAS as readonly string[]).includes(String(f.extra)) ? String(f.extra) : null;
    const basis = f.basis === 'created' ? 'created' : 'service';
    const deptText = like(low.replace(/\s+/g, '_'));
    const verified = sql`r.rating is not null and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false)`;
    const hits = {
      id: sql`(${isId} and (m.member_id::text = ${low} or m.user_id::text = ${low} or m.technician_id::text = ${low})) or (${idPrefix ?? ''} <> '' and (lower(m.member_id::text) like ${(idPrefix ?? '') + '%'} or lower(coalesce(m.technician_id::text, '')) like ${(idPrefix ?? '') + '%'}
        or right(lower(m.member_id::text), 8) = ${idPrefix ?? ''}))`,
      email: contact ? sql`coalesce(m.email, '') ilike ${l}` : sql`lower(coalesce(m.email, '')) = ${low}`,
      phone: contact ? sql`(${phoneish} and right(regexp_replace(coalesce(m.phone_norm, m.phone_display, ''), '[^0-9]', '', 'g'), 10) like ${'%' + d + '%'})` : sql`false`,
      name: sql`m.name ilike ${l}`,
      role: sql`(array_to_string(m.roles, ' ') ilike ${deptText} or coalesce(m.role_label, '') ilike ${l})`,
      dept: sql`m.dept ilike ${deptText}`,
      service: sql`exists (select 1 from technician_services m3 join services s on s.id = m3.service_id and s.tenant_id = m3.tenant_id where m3.tenant_id = ${T} and m3.technician_id = m.technician_id and s.name ilike ${l})`,
      appointment: sql`(${isId} and exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.id::text = ${low} and a.technician_id = m.technician_id))
        or (${tn.length >= 3} and exists (select 1 from tickets tk join ticket_service_lines tl on tl.ticket_id = tk.id and tl.tenant_id = tk.tenant_id where tk.tenant_id = ${T} and tk.ticket_number = ${tn} and tl.technician_id = m.technician_id))`,
    };
    const w = sql`(${account} = 'all' or (${account} = 'current' and m.is_current) or (${account} = 'active' and m.is_active) or (${account} = 'inactive' and m.is_current and not m.is_active) or (${account} = 'archived' and not m.is_current))
      and (${status}::text is null or m.live = ${status})
      and (${shift}::text is null or (${shift} = 'scheduled' and m.scheduled) or (${shift} = 'unscheduled' and m.technician_id is not null and not m.scheduled) or (${shift} = 'clocked_in' and m.clocked_today)
        or (${shift} = 'day_off' and (m.ov_type = 'DAY_OFF' or m.off_today)))
      and (${dept}::text is null or m.dept = ${dept}) and (${staffRole}::text is null or ${staffRole} = any(m.roles))
      and (${tabRoles ? sql`m.roles && ${tabRoles}::text[]` : sql`true`})
      and (${extra}::text is null or (${extra} = 'missing_mapping' and m.technician_id is not null and not exists (select 1 from technician_services ts where ts.tenant_id = ${T} and ts.technician_id = m.technician_id))
        or (${extra} = 'no_login' and m.user_id is null) or (${extra} = 'has_login' and m.user_id is not null)
        or (${extra} = 'unrated' and m.technician_id is not null and not exists (select 1 from reviews r where r.tenant_id = ${T} and r.technician_id = m.technician_id and ${verified})))
      and (${basis} <> 'created' or ${inPeriod(sql`m.created_at`, per)})
      and (${raw} = '' or ${hits.id} or ${hits.email} or ${hits.phone} or ${hits.name} or ${hits.role} or ${hits.dept} or ${hits.service} or ${hits.appointment})`;
    const via = raw === '' ? sql`null::text` : sql`case when ${hits.id} then 'id' when ${hits.email} then 'email' when ${hits.phone} then 'phone' when ${hits.name} then 'name' when ${hits.role} then 'role'
      when ${hits.dept} then 'department' when ${hits.service} then 'service' else 'appointment' end`;
    const rank = raw === '' ? sql`0` : sql`case when ${hits.id} or lower(coalesce(m.email, '')) = ${low} then 0 when lower(m.name) = ${low} then 1 when m.name ilike ${like(raw).slice(1)} then 2 else 3 end`;
    return { w, via, rank, raw, l, basis, account };
  }

  async directory(ctx: TeamCtx, f: DirectoryFilters) {
    const asOf = new Date().toISOString();   // taken BEFORE the reads: the instant this answer reflects
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10);
    const per = await this.period(ctx, f, 'month'); const today = await this.period(ctx, { preset: 'today' });
    const R = this.roster(ctx, today); const { w, via, rank, raw, l, basis, account } = this.directoryWhere(ctx, f, per, true);
    const sort = (TM_SORTS as readonly string[]).includes(String(f.sort)) ? String(f.sort) : 'newest';
    const order = sort === 'oldest' ? sql`m.created_at asc nulls last, m.member_id asc` : sort === 'name' ? sql`lower(m.name) asc, m.member_id asc` : sql`m.created_at desc nulls last, m.member_id desc`;
    const total = N((await sql<any>`${R} select count(*)::int as n from m where ${w}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`${R} select m.*, ${via} as matched_via, b.name as branch_name from m left join branches b on b.id = m.branch_id and b.tenant_id = ${T}
      where ${w} order by ${raw ? sql`${rank} asc, ` : sql``}${order} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const tabs = await this.tabCounts(ctx, R, this.directoryWhere(ctx, f, per, false).w);
    const items = await this.decorate(ctx, rows, per, raw, l);
    // asOf: the read's server instant — the screen's live-update guard never lets an older answer replace a newer one (TM-05)
    return { period: per, basis, account, sort, tabs, items, page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages, asOf };
  }

  /** the page's figures (services / revenue / commission earned in the period, verified rating) — only for its own rows */
  private async decorate(ctx: TeamCtx, rows: any[], per: TPeriod, raw: string, l: string) {
    const T = ctx.tenantId; const contact = canAny(ctx, ...CONTACT); const pay = canAny(ctx, ...PAY);
    const tids = rows.map((r) => r.technician_id).filter(Boolean).map(String);
    const by = new Map<string, any>();
    if (tids.length) {
      const fig = (await sql<any>`select te.id as tid,
          (select count(distinct l.id) from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id where l.tenant_id = ${T} and l.technician_id = te.id and l.removed_at is null
            and lower(coalesce(l.line_kind, 'service')) = 'service' and not coalesce(l.is_add_on, false) and ${this.paid()} and ${this.brT(ctx)} and ${inPeriod(sql`t.paid_at`, per)})::int as services,
          (select coalesce(sum(l.line_total_cents), 0) from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id where l.tenant_id = ${T} and l.technician_id = te.id and l.removed_at is null
            and lower(coalesce(l.line_kind, 'service')) in ('service', 'add_on') and ${this.paid()} and ${this.brT(ctx)} and ${inPeriod(sql`t.paid_at`, per)})::bigint as revenue,
          (select coalesce(sum(coalesce(s.tech_service_earnings_cents, 0) + coalesce(s.retail_commission_cents, 0)), 0) from ticket_compensation_snapshots s where s.tenant_id = ${T} and s.technician_id = te.id and ${inPeriod(sql`s.snapshot_at`, per)})::bigint
            + (select coalesce(sum(a.amount_cents), 0) from compensation_adjustments a where a.tenant_id = ${T} and a.technician_id = te.id and a.category <> 'tip_correction' and a.status = any(${ADJ_OK}) and ${inPeriod(sql`a.created_at`, per)})::bigint as earned,
          (select avg(r.rating) from reviews r where r.tenant_id = ${T} and r.technician_id = te.id and r.rating is not null and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false))::numeric(4,2) as rating,
          (select count(*) from reviews r where r.tenant_id = ${T} and r.technician_id = te.id and r.rating is not null and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false))::int as rating_n,
          (select count(*) from technician_services ts where ts.tenant_id = ${T} and ts.technician_id = te.id)::int as mapped,
          (select string_agg(s.name, ', ' order by lower(s.name)) from technician_services m3 join services s on s.id = m3.service_id and s.tenant_id = m3.tenant_id where m3.tenant_id = ${T} and m3.technician_id = te.id and ${raw} <> '' and s.name ilike ${l}) as matched_services
        from technicians te where te.tenant_id = ${T} and te.id = any(${tids}::uuid[])`.execute(this.db)).rows;
      for (const x of fig) by.set(String(x.tid), x);
    }
    const band = (r: number | null) => (r == null ? 'unrated' : r >= 4.5 ? 'excellent' : r >= 3.5 ? 'very_good' : r >= 2.5 ? 'good' : 'needs');
    return rows.map((r: any) => {
      const x = r.technician_id ? by.get(String(r.technician_id)) : null; const rating = x?.rating == null ? null : Number(x.rating);
      const phone = r.phone_display ?? r.phone_norm ?? null;
      return { memberId: String(r.member_id), kind: String(r.kind), userId: r.user_id ? String(r.user_id) : null, technicianId: r.technician_id ? String(r.technician_id) : null, code: String(r.code),
        name: String(r.name ?? ''), avatarUrl: r.avatar_url ?? null, roles: (r.roles ?? []) as string[], roleLabel: r.role_label ?? null, accountRole: r.account_role || null,
        department: String(r.dept), departmentDerived: true, branchName: r.branch_name ?? null,
        email: contact ? r.email ?? null : null, phone: contact ? phone : maskPhone(phone), contactMasked: !contact,
        account: !r.is_current ? 'archived' : r.is_active ? 'active' : 'inactive', live: String(r.live), liveSince: iso(r.break_started_at ?? r.live_at),
        shift: r.shift_text ?? null, shiftSource: r.shift_source ?? null, scheduledToday: !!r.scheduled, clockedToday: !!r.clocked_today,
        isProvider: !!r.technician_id, rating, ratingCount: N(x?.rating_n), band: r.technician_id ? band(rating) : null, qualifiedServices: N(x?.mapped), missingMapping: !!r.technician_id && N(x?.mapped) === 0,
        servicesCompleted: r.technician_id ? N(x?.services) : null, revenueCents: r.technician_id && pay ? N(x?.revenue) : null, commissionEarnedCents: r.technician_id && pay ? N(x?.earned) : null,
        matchedVia: r.matched_via ?? null, matchedServices: x?.matched_services ? String(x.matched_services).split(', ').slice(0, 4) : [], createdAt: iso(r.created_at) };
    });
  }

  /** the audited server-built CSV of the directory with the SAME filters (no paging; capped at 2,000 rows) */
  exportCsv(ctx: TeamCtx, f: DirectoryFilters & { lang?: string }, requestId: string) {
    const ef: ExportFilters = { preset: typeof f.preset === 'string' ? f.preset : undefined, from: typeof f.from === 'string' ? f.from : undefined, to: typeof f.to === 'string' ? f.to : undefined, q: f.q, sort: f.sort, lang: f.lang };
    return auditedExport(this.db, ctx, 'TEAM_DIRECTORY', ef, requestId, async () => {
      const out: any[] = []; let per: TPeriod | null = null;
      for (let p = 1; p <= 20; p++) { const r = await this.directory(ctx, { ...f, page: p, pageSize: 100 }); per = r.period; out.push(...r.items); if (p >= r.totalPages) break; }
      const vi = f.lang === 'vi'; const pay = canAny(ctx, ...PAY);
      const H = vi ? ['Mã nhân viên', 'Tên', 'Vai trò', 'Bộ phận (suy ra)', 'Ca hôm nay', 'Trạng thái', 'Tài khoản', 'Đánh giá', 'Số đánh giá', 'Dịch vụ', 'Doanh thu', 'Hoa hồng đã kiếm', 'Email', 'Điện thoại', 'Ngày tạo']
        : ['Employee ID', 'Name', 'Roles', 'Department (derived)', 'Shift today', 'Status', 'Account', 'Rating', 'Reviews', 'Services', 'Revenue', 'Commission earned', 'Email', 'Phone', 'Created'];
      const d2 = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2));
      return { period: per, rows: out.length, filename: `team-members-${per?.from ?? 'all'}-${per?.to ?? 'all'}.csv`,
        csv: toCsv(H, out.map((r) => [r.code, r.name, r.roles.join(' + '), r.department, r.shift ?? '', r.live, r.account, r.rating ?? '', r.ratingCount, r.servicesCompleted ?? '',
          pay ? d2(r.revenueCents) : '', pay ? d2(r.commissionEarnedCents) : '', r.email ?? '', r.phone ?? '', r.createdAt ?? ''])) };
    });
  }

  /** live state of every current technician (Find Qualified & Available: "bookable later" vs "free right now") */
  async live(ctx: TeamCtx) {
    const today = await this.period(ctx, { preset: 'today' });
    const rows = (await sql<any>`${this.roster(ctx, today)} select m.technician_id, m.member_id, m.live, m.shift_text, m.shift_source, m.scheduled from m where m.is_current and m.technician_id is not null order by m.member_id limit 500`.execute(this.db)).rows;
    return { asOf: new Date().toISOString(), today: today.today, items: rows.map((r: any) => ({ technicianId: String(r.technician_id), memberId: String(r.member_id), live: String(r.live), shift: r.shift_text ?? null, shiftSource: r.shift_source ?? null, scheduledToday: !!r.scheduled })) };
  }

  // ── the Full Employee Profile (user-keyed; each tab loads lazily, by id) ────────────────────────────────────────
  async member(ctx: TeamCtx, id: string) {
    if (!UUID.test(String(id))) throw err(404, 'MEMBER_NOT_FOUND', 'That team member is not in this salon.');
    const today = await this.period(ctx, { preset: 'today' }); const T = ctx.tenantId;
    const r = (await sql<any>`${this.roster(ctx, today)} select m.*, b.name as branch_name from m left join branches b on b.id = m.branch_id and b.tenant_id = ${T}
      where m.member_id = ${id} or m.technician_id = ${id} order by (m.member_id = ${id}) desc limit 1`.execute(this.db)).rows[0];
    if (!r) throw err(404, 'MEMBER_NOT_FOUND', 'That team member is not in this salon.');
    return { r, today };
  }
  async profile(ctx: TeamCtx, id: string) {
    const { r, today } = await this.member(ctx, id); const T = ctx.tenantId; const contact = canAny(ctx, ...CONTACT); const access = canAny(ctx, ...ACCESS);
    const [item] = await this.decorate(ctx, [r], await this.period(ctx, { preset: 'month' }), '', '%');
    const hired = r.technician_id ? (await sql<any>`select e.occurred_at from technician_employment_events e where e.tenant_id = ${T} and e.technician_id = ${r.technician_id} and e.event_type in ('hired', 'joined', 'started')
      order by e.occurred_at asc limit 1`.execute(this.db)).rows[0] : null;
    return { ...item, today: today.today, tz: today.tz, branchName: r.branch_name ?? null,
      employmentStart: hired?.occurred_at ? { at: iso(hired.occurred_at), source: 'employment_event' } : { at: iso(r.created_at), source: 'record_created' }, lastUpdate: iso(r.updated_at),
      access: access ? { accountStatus: r.user_status ?? null, lastLoginAt: iso(r.last_login_at), mfaEnabled: r.user_id ? !!r.mfa_enabled : null } : null,
      bio: null as string | null,   // no staff bio field in this salon's records
      can: { contact, pay: canAny(ctx, ...PAY), access, editSchedule: canAny(ctx, ...SCHEDULE_EDIT), editMember: contact }, fullPhone: contact };
  }
  async accessTab(ctx: TeamCtx, id: string) {
    if (!canAny(ctx, ...ACCESS)) throw err(403, 'FORBIDDEN', 'You do not have permission to view roles and access.');
    const { r } = await this.member(ctx, id); const T = ctx.tenantId;
    const branches = r.user_id ? (await sql<any>`select ba.branch_id, b.name, ba.role, ba.access_level, ba.is_primary_owner, ba.created_at from user_branch_access ba left join branches b on b.id = ba.branch_id and b.tenant_id = ba.tenant_id
      where ba.tenant_id = ${T} and ba.user_id = ${r.user_id} order by lower(coalesce(b.name, '')), ba.branch_id`.execute(this.db)).rows : [];
    const templates = r.user_id ? (await sql<any>`select sa.template_key, sa.assigned_at, coalesce(nullif(u.full_name, ''), u.email) as by from staff_role_assignments sa left join users u on u.id = sa.assigned_by and u.tenant_id = sa.tenant_id
      where sa.tenant_id = ${T} and sa.user_id = ${r.user_id} order by sa.assigned_at desc nulls last`.execute(this.db)).rows : [];
    const role = (String(r.account_role || '') as Role); const perms: string[] = (ROLE_PERMISSIONS as Record<string, string[]>)[role] ?? [];
    const domains = new Map<string, number>(); for (const p of perms) { const k = p.replace(/^pos\./, '').split('.')[0]; domains.set(k, (domains.get(k) ?? 0) + 1); }
    return { memberId: String(r.member_id), accountRole: r.account_role || null, roles: r.roles, department: r.dept, departmentDerived: true, hasLogin: !!r.user_id,
      branches: branches.map((x: any) => ({ branchId: String(x.branch_id), name: x.name ?? null, role: x.role ?? null, accessLevel: x.access_level ?? null, primaryOwner: !!x.is_primary_owner, since: iso(x.created_at) })),
      allBranches: !!r.user_id && !branches.length && r.branch_id == null,
      templates: templates.map((x: any) => ({ key: String(x.template_key), assignedAt: iso(x.assigned_at), by: x.by ?? null })),
      permissions: { count: perms.length, domains: [...domains.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([k, n]) => ({ domain: k, count: n })) },
      rule: 'role changes go through Users & Roles; nothing here grants or escalates a role' };
  }
  private provider(r: any) { return r.technician_id ? String(r.technician_id) : null; }
  async schedule(ctx: TeamCtx, id: string) {
    const { r, today } = await this.member(ctx, id); const T = ctx.tenantId; const tid = this.provider(r); const b = branchOf(ctx);
    if (!tid) return { memberId: String(r.member_id), provider: false, today: today.today };
    const weekly = (await sql<any>`select sc.day_of_week, sc.is_working, to_char(sc.start_time, 'HH24:MI') as s, to_char(sc.end_time, 'HH24:MI') as e, to_char(sc.lunch_start_time, 'HH24:MI') as ls, to_char(sc.lunch_end_time, 'HH24:MI') as le
      from technician_schedules sc where sc.tenant_id = ${T} and sc.technician_id = ${tid} and (${b}::uuid is null or sc.branch_id = ${b} or sc.branch_id is null) order by sc.day_of_week, (sc.branch_id is null)`.execute(this.db)).rows;
    const days = new Map<number, any>(); for (const w of weekly) if (!days.has(N(w.day_of_week))) days.set(N(w.day_of_week), w);
    const overrides = (await sql<any>`select to_char(o.local_shift_date, 'YYYY-MM-DD') as d, o.override_type, to_char(o.start_local_time, 'HH24:MI') as s, to_char(o.end_local_time, 'HH24:MI') as e, o.ends_next_day, o.breaks_json, o.note, o.version
      from technician_shift_overrides o where o.tenant_id = ${T} and o.technician_id = ${tid} and (${b}::uuid is null or o.branch_id = ${b}) and o.local_shift_date between ${today.today}::date - 7 and ${today.today}::date + 60
      order by o.local_shift_date asc`.execute(this.db)).rows;
    const timeOff = (await sql<any>`select tf.id, tf.starts_at, tf.ends_at, tf.status, tf.kind from technician_time_off tf where tf.tenant_id = ${T} and tf.technician_id = ${tid} and tf.status in ('approved', 'pending') and tf.ends_at > now()
      order by tf.starts_at asc limit 10`.execute(this.db)).rows;
    const published = (await sql<any>`select to_char(sh.shift_date, 'YYYY-MM-DD') as d, to_char(sh.start_time at time zone ${today.tz}, 'HH24:MI') as s, to_char(sh.end_time at time zone ${today.tz}, 'HH24:MI') as e
      from technician_shifts sh where sh.tenant_id = ${T} and sh.technician_id = ${tid} and sh.status = 'scheduled' and sh.shift_date between ${today.today}::date and ${today.today}::date + 14 order by sh.shift_date, sh.start_time`.execute(this.db)).rows;
    // the next working day in the next 14 days: override › published shift › weekly template, minus approved time off
    let next: { date: string; shift: string; source: string } | null = null;
    for (let i = 0; i <= 14 && !next; i++) {
      const dt = new Date(Date.parse(today.today + 'T12:00:00Z') + i * 86_400_000); const dYmd = addDays(today.today, i); const dow = dt.getUTCDay();
      const off = timeOff.some((t: any) => t.status === 'approved' && Date.parse(t.starts_at) < Date.parse(dYmd + 'T23:59:59Z') && Date.parse(t.ends_at) > Date.parse(dYmd + 'T00:00:00Z'));
      if (off) continue;
      const o = overrides.find((x: any) => x.d === dYmd); const p = published.find((x: any) => x.d === dYmd); const w = days.get(dow);
      if (o) { if (o.override_type === 'CUSTOM_SHIFT') next = { date: dYmd, shift: `${o.s}–${o.e}`, source: 'override' }; continue; }
      if (p) { next = { date: dYmd, shift: `${p.s}–${p.e}`, source: 'published' }; continue; }
      if (w?.is_working && w.s && w.e) next = { date: dYmd, shift: `${w.s}–${w.e}`, source: 'weekly' };
    }
    return { memberId: String(r.member_id), technicianId: tid, provider: true, today: today.today, tz: today.tz, canEdit: canAny(ctx, ...SCHEDULE_EDIT), branchRequired: !b,
      weekly: [0, 1, 2, 3, 4, 5, 6].map((d) => { const w = days.get(d); return { dayOfWeek: d, working: w ? !!w.is_working : null, start: w?.s ?? null, end: w?.e ?? null, lunchStart: w?.ls ?? null, lunchEnd: w?.le ?? null }; }),
      overrides: overrides.map((o: any) => ({ date: o.d, type: String(o.override_type), start: o.s ?? null, end: o.e ?? null, endsNextDay: !!o.ends_next_day, breaks: Array.isArray(o.breaks_json) ? o.breaks_json : [], note: o.note ?? null, version: N(o.version) })),
      timeOff: timeOff.map((t: any) => ({ id: String(t.id), from: iso(t.starts_at), to: iso(t.ends_at), status: String(t.status), kind: t.kind ?? null })),
      published: published.map((p: any) => ({ date: p.d, start: p.s, end: p.e })), next,
      todayShift: { text: r.shift_text ?? null, source: r.shift_source ?? null } };
  }
  async attendance(ctx: TeamCtx, id: string, f: { preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const { r } = await this.member(ctx, id); const T = ctx.tenantId; const tid = this.provider(r); const { page, pageSize } = paging(f.page, f.pageSize, 8);
    const per = await this.period(ctx, f, 'month');
    if (!tid) return { memberId: String(r.member_id), provider: false, period: per, items: [], page: 1, pageSize, totalItems: 0, totalPages: 1, toleranceMinutes: ATTENDANCE_TOLERANCE_MIN };
    const w = sql`p.tenant_id = ${T} and p.technician_id = ${tid} and p.status <> 'scheduled' and ${inPeriod(sql`p.start_time`, per)}`;
    const total = N((await sql<any>`select count(*)::int as n from technician_shifts p where p.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select p.id, to_char(p.shift_date, 'YYYY-MM-DD') as d, p.start_time, p.end_time, p.status, extract(dow from p.shift_date)::int as dow,
        (select coalesce(sum(extract(epoch from (coalesce(bk.ended_at, now()) - bk.started_at)) / 60), 0) from technician_breaks bk where bk.tenant_id = ${T} and bk.technician_id = ${tid} and bk.shift_id = p.id)::int as break_min,
        (select count(*) from technician_breaks bk where bk.tenant_id = ${T} and bk.technician_id = ${tid} and bk.shift_id = p.id)::int as breaks,
        (select o.override_type || '|' || coalesce(to_char(o.start_local_time, 'HH24:MI'), '') from technician_shift_overrides o where o.tenant_id = ${T} and o.technician_id = ${tid} and o.local_shift_date = p.shift_date limit 1) as ov,
        (select to_char(sc.start_time, 'HH24:MI') from technician_schedules sc where sc.tenant_id = ${T} and sc.technician_id = ${tid} and sc.day_of_week = extract(dow from p.shift_date) and sc.is_working limit 1) as wk_start,
        to_char(p.start_time at time zone ${per.tz}, 'HH24:MI') as in_local, to_char(p.end_time at time zone ${per.tz}, 'HH24:MI') as out_local
      from technician_shifts p where p.tenant_id = ${T} and ${w} order by p.start_time desc, p.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const mins = (hm: string | null) => (hm && /^\d{2}:\d{2}$/.test(hm) ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)) : null);
    return { memberId: String(r.member_id), provider: true, period: per, toleranceMinutes: ATTENDANCE_TOLERANCE_MIN, items: rows.map((x: any) => {
      const [ovType, ovStart] = String(x.ov ?? '').split('|'); const planned = ovType === 'CUSTOM_SHIFT' ? ovStart || null : ovType === 'DAY_OFF' ? null : x.wk_start ?? null;
      const delta = planned && x.in_local ? (mins(x.in_local) ?? 0) - (mins(planned) ?? 0) : null;
      return { id: String(x.id), date: x.d, clockIn: iso(x.start_time), clockOut: iso(x.end_time), clockInLocal: x.in_local ?? null, clockOutLocal: x.out_local ?? null, status: String(x.status), breaks: N(x.breaks), breakMinutes: N(x.break_min),
        plannedStart: planned, plannedSource: ovType ? (ovType === 'DAY_OFF' ? 'override_off' : 'override') : x.wk_start ? 'weekly' : null, startDeltaMinutes: delta,
        exception: ovType === 'DAY_OFF' ? 'worked_day_off' : planned == null ? 'unscheduled' : delta != null && Math.abs(delta) > ATTENDANCE_TOLERANCE_MIN ? (delta > 0 ? 'late' : 'early') : null };
    }), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  async skills(ctx: TeamCtx, id: string) {
    const { r } = await this.member(ctx, id); const T = ctx.tenantId; const tid = this.provider(r); const today = await this.period(ctx, { preset: 'today' });
    if (!tid) return { memberId: String(r.member_id), provider: false, services: [], requests: [], certifications: [] };
    const services = (await sql<any>`select s.id, s.name, s.duration_minutes, s.status, s.required_certification, c.name as category, ts.proficiency, ts.granted_via, ts.created_at, b.name as branch_name
      from technician_services ts join services s on s.id = ts.service_id and s.tenant_id = ts.tenant_id left join service_categories c on c.id = s.category_id and c.tenant_id = s.tenant_id
        left join branches b on b.id = s.branch_id and b.tenant_id = s.tenant_id
      where ts.tenant_id = ${T} and ts.technician_id = ${tid} order by lower(coalesce(c.name, '')), lower(s.name), s.id`.execute(this.db)).rows;
    const requests = (await sql<any>`select k.id, k.status, k.request_type, k.created_at, s.name from technician_skill_change_requests k left join services s on s.id = k.service_id and s.tenant_id = k.tenant_id
      where k.tenant_id = ${T} and k.technician_id = ${tid} and k.status in ('submitted', 'pending', 'under_review', 'more_information_required') order by k.created_at desc limit 10`.execute(this.db)).rows;
    const performedUnmapped = (await sql<any>`select l.service_id, max(l.service_name_snapshot) as name, count(*)::int as n from ticket_service_lines l
      where l.tenant_id = ${T} and l.technician_id = ${tid} and l.service_id is not null and l.removed_at is null and lower(coalesce(l.line_kind, 'service')) = 'service'
        and not exists (select 1 from technician_services ts where ts.tenant_id = ${T} and ts.technician_id = ${tid} and ts.service_id = l.service_id) group by l.service_id order by count(*) desc limit 10`.execute(this.db)).rows;
    return { memberId: String(r.member_id), technicianId: tid, provider: true, missingMapping: services.length === 0,
      services: services.map((s: any) => ({ serviceId: String(s.id), name: String(s.name), category: s.category ?? null, durationMinutes: N(s.duration_minutes), active: s.status === 'active', proficiency: s.proficiency ?? null,
        grantedVia: s.granted_via ?? null, since: iso(s.created_at), branch: s.branch_name ?? null, requiredCertification: s.required_certification ?? null })),
      requests: requests.map((k: any) => ({ id: String(k.id), service: k.name ?? null, type: k.request_type ?? null, status: String(k.status), at: iso(k.created_at) })),
      performedWithoutMapping: performedUnmapped.map((p: any) => ({ serviceId: String(p.service_id), name: p.name ?? null, lines: N(p.n) })),
      certifications: await this.certRows(ctx, tid, today) };
  }
  private async certRows(ctx: TeamCtx, tid: string, today: TPeriod) {
    const rows = (await sql<any>`select c.id, c.name, c.issuer, c.issued_at, c.expires_at, c.verification_status, c.revoked_reason from technician_certifications c where c.tenant_id = ${ctx.tenantId} and c.technician_id = ${tid}
      order by c.expires_at asc nulls last, c.id`.execute(this.db)).rows;
    return rows.map((c: any) => { const exp = ymd(c.expires_at); const state = c.revoked_reason ? 'revoked' : exp && exp < today.today ? 'expired'
      : exp && Date.parse(exp) - Date.parse(today.today) <= 30 * 86_400_000 ? 'expiring' : 'valid';
      return { id: String(c.id), name: String(c.name ?? ''), issuer: c.issuer ?? null, issuedAt: ymd(c.issued_at), expiresAt: exp, verified: String(c.verification_status ?? '').toUpperCase() === 'VERIFIED', state }; });
  }
  async work(ctx: TeamCtx, id: string, f: { scope?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const { r, today } = await this.member(ctx, id); const T = ctx.tenantId; const tid = this.provider(r); const { page, pageSize } = paging(f.page, f.pageSize, 8);
    const scope = ['upcoming', 'past', 'services'].includes(String(f.scope)) ? String(f.scope) : 'upcoming'; const customers = canAny(ctx, 'customers.view'); const pay = canAny(ctx, ...PAY);
    if (!tid) return { memberId: String(r.member_id), provider: false, scope, counts: null, items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
    const per = await this.period(ctx, f, 'month');
    const counts = (await sql<any>`select count(*) filter (where a.appt_date >= ${today.today}::date and coalesce(a.status, '') not in ('cancelled', 'canceled', 'no_show', 'completed'))::int as upcoming,
        count(*) filter (where a.status in ('cancelled', 'canceled') and ${inPeriod(sql`a.updated_at`, per)})::int as cancelled, count(*) filter (where a.status = 'no_show' and ${inPeriod(sql`a.updated_at`, per)})::int as no_show
      from pos_tech_appointments a where a.tenant_id = ${T} and a.technician_id = ${tid}`.execute(this.db)).rows[0];
    if (scope === 'services') {
      const w = sql`l.tenant_id = ${T} and l.technician_id = ${tid} and l.removed_at is null and lower(coalesce(l.line_kind, 'service')) <> 'retail' and ${this.paid()} and ${inPeriod(sql`t.paid_at`, per)}`;
      const from = sql`from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id left join customers cu on cu.id = t.customer_id and cu.tenant_id = t.tenant_id`;
      const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
      const rows = (await sql<any>`select l.id, l.ticket_id, l.service_name_snapshot, l.is_add_on, l.line_total_cents, t.ticket_number, t.paid_at, cu.full_name,
          (select count(distinct l2.technician_id) from ticket_service_lines l2 where l2.tenant_id = ${T} and l2.ticket_id = l.ticket_id and l2.technician_id is not null)::int as techs ${from} where ${w}
        order by t.paid_at desc, l.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
      return { memberId: String(r.member_id), provider: true, scope, period: per, counts: { upcoming: N(counts?.upcoming), cancelled: N(counts?.cancelled), noShow: N(counts?.no_show), servicesInPeriod: total },
        items: rows.map((x: any) => ({ id: String(x.id), ticketId: String(x.ticket_id), ticketNumber: x.ticket_number ?? null, service: x.service_name_snapshot ?? null, addOn: !!x.is_add_on, at: iso(x.paid_at),
          customer: customers ? x.full_name ?? null : null, amountCents: pay ? N(x.line_total_cents) : null, techsOnTicket: N(x.techs) })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
    }
    const up = scope === 'upcoming';
    const w = sql`a.tenant_id = ${T} and a.technician_id = ${tid} and ${up ? sql`a.appt_date >= ${today.today}::date and coalesce(a.status, '') not in ('cancelled', 'canceled', 'no_show', 'completed')` : sql`(a.appt_date < ${today.today}::date or a.status in ('completed', 'cancelled', 'canceled', 'no_show'))`}`;
    const total = N((await sql<any>`select count(*)::int as n from pos_tech_appointments a where a.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select a.id, to_char(a.appt_date, 'YYYY-MM-DD') as d, a.start_time, a.end_time, a.duration_minutes, a.status, a.customer_name, a.services, a.source from pos_tech_appointments a where a.tenant_id = ${T} and ${w}
      order by ${up ? sql`a.appt_date asc, a.start_time asc, a.id asc` : sql`a.appt_date desc, a.start_time desc, a.id desc`} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { memberId: String(r.member_id), provider: true, scope, period: per, counts: { upcoming: N(counts?.upcoming), cancelled: N(counts?.cancelled), noShow: N(counts?.no_show), servicesInPeriod: null },
      items: rows.map((a: any) => ({ id: String(a.id), date: a.d, start: a.start_time ?? null, end: a.end_time ?? null, minutes: N(a.duration_minutes), status: String(a.status ?? ''), source: a.source ?? null,
        customer: customers ? a.customer_name ?? null : null, services: Array.isArray(a.services) ? a.services.map((s: any) => String(s?.name ?? s?.serviceName ?? '')).filter(Boolean) : [] })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  async performance(ctx: TeamCtx, id: string, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const { r } = await this.member(ctx, id); const T = ctx.tenantId; const tid = this.provider(r); const per = await this.period(ctx, f, 'month');
    if (!tid) return { memberId: String(r.member_id), provider: false, period: per };
    const v = sql`r.tenant_id = ${T} and r.technician_id = ${tid} and r.rating is not null and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false)`;
    const all = (await sql<any>`select avg(r.rating)::numeric(4,2) as avg, count(*)::int as n from reviews r where r.tenant_id = ${T} and ${v}`.execute(this.db)).rows[0];
    const inP = (await sql<any>`select avg(r.rating)::numeric(4,2) as avg, count(*)::int as n from reviews r where r.tenant_id = ${T} and ${v} and ${inPeriod(sql`r.created_at`, per)}`.execute(this.db)).rows[0];
    const recent = (await sql<any>`select r.id, r.rating, r.comment, r.created_at, r.source from reviews r where r.tenant_id = ${T} and ${v} order by r.created_at desc, r.id desc limit 5`.execute(this.db)).rows;
    const num = (x: any) => (x?.avg == null ? null : Number(x.avg));
    return { memberId: String(r.member_id), technicianId: tid, provider: true, period: per, scale: '0-5', source: 'verified_reviews',
      allTime: { rating: num(all), count: N(all?.n) }, inPeriod: { rating: num(inP), count: N(inP?.n) },
      recent: recent.map((x: any) => ({ id: String(x.id), rating: Number(x.rating), comment: x.comment ?? null, at: iso(x.created_at), source: x.source ?? null })),
      composite: { route: `/pos/team-performance-screen/technicians/${tid}/composite`, separate: true } };
  }
  async earnings(ctx: TeamCtx, id: string, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    if (!canAny(ctx, ...PAY)) throw err(403, 'FORBIDDEN', 'You do not have permission to view technician pay.');
    const { r } = await this.member(ctx, id); const tid = this.provider(r); const per = await this.period(ctx, f, 'month');
    if (!tid) return { memberId: String(r.member_id), provider: false, period: per };
    const m = await this.moneyFor(ctx, per, tid);
    const payouts = (await sql<any>`select p.id, p.amount_cents, p.status, p.method, p.paid_at, p.created_at, pp.label from payroll_payouts p left join payroll_periods pp on pp.id = p.period_id and pp.tenant_id = p.tenant_id
      where p.tenant_id = ${ctx.tenantId} and p.technician_id = ${tid} order by coalesce(p.paid_at, p.created_at) desc, p.id desc limit 5`.execute(this.db)).rows;
    return { memberId: String(r.member_id), technicianId: tid, provider: true, period: per, basis: { earned: 'paid_checkout', paid: 'payroll_paid_date' }, ...m,
      payouts: payouts.map((p: any) => ({ id: String(p.id), amountCents: N(p.amount_cents), status: String(p.status), method: p.method ?? null, paidAt: iso(p.paid_at), createdAt: iso(p.created_at), period: p.label ?? null })) };
  }
  async training(ctx: TeamCtx, id: string) {
    const { r } = await this.member(ctx, id); const tid = this.provider(r); const today = await this.period(ctx, { preset: 'today' });
    const conf = (await sql<any>`select 1 as x from team_training_courses c where c.tenant_id = ${ctx.tenantId} and c.status = 'active' limit 1`.execute(this.db)).rows[0];
    return { memberId: String(r.member_id), provider: !!tid, trainingConfigured: !!conf, records: '/pos/team-training/members/' + String(r.member_id), certifications: tid ? await this.certRows(ctx, tid, today) : [] };
  }
  async history(ctx: TeamCtx, id: string, f: { page?: unknown; pageSize?: unknown }) {
    const { r } = await this.member(ctx, id); const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 8);
    const tid = r.technician_id ?? null; const uid = r.user_id ?? null;
    const events = sql`select a.id, a.action as kind, a.metadata::text as detail, a.user_id as actor_id, a.created_at as at, 'technician_audit' as source from technician_audit_logs a where a.tenant_id = ${T} and a.technician_id = ${tid}
      union all select s.id, 'status:' || coalesce(s.old_status, '') || '→' || coalesce(s.new_status, ''), s.reason, s.changed_by_user_id, s.created_at, 'status' from technician_status_events s where s.tenant_id = ${T} and s.technician_id = ${tid}
      union all select e.id, e.event_type, coalesce(e.from_value, '') || case when e.to_value is not null then ' → ' || e.to_value else '' end || case when e.reason is not null then ' · ' || e.reason else '' end, e.actor_user_id, e.occurred_at, 'employment'
        from technician_employment_events e where e.tenant_id = ${T} and e.technician_id = ${tid}
      union all select ae.id, ae.action, ae.summary, ae.actor_user_id, ae.occurred_at, 'audit' from audit_events ae where ae.tenant_id = ${T} and ae.resource_id in (${String(uid ?? '-')}, ${String(tid ?? '-')})
        and ae.module <> 'reports'
      union all select null::uuid, 'role_template:' || sa.template_key, null, sa.assigned_by, sa.assigned_at, 'role' from staff_role_assignments sa where sa.tenant_id = ${T} and sa.user_id = ${uid}`;
    const total = N((await sql<any>`select count(*)::int as n from (${events}) x`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select x.*, coalesce(nullif(u.full_name, ''), u.email) as actor from (${events}) x left join users u on u.id = x.actor_id and u.tenant_id = ${T}
      order by x.at desc nulls last, x.id desc nulls last limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { memberId: String(r.member_id), items: rows.map((x: any, i: number) => ({ id: x.id ? String(x.id) : `${x.source}-${sp.offset + i}`, kind: String(x.kind ?? ''), detail: x.detail ? String(x.detail).slice(0, 300) : null,
      source: String(x.source), at: iso(x.at), actor: x.actor ?? null })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
}
