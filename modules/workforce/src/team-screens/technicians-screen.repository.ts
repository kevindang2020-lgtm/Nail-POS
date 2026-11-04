// technicians-screen.repository.ts — the read model behind the rebuilt Technicians Management Center (/technicians, Oct 30
// 2026). Raw, parameterised SQL over the canonical tables; the tenant is the session's and literal in every statement.
// Writes stay where they already are (TechniciansController: create / edit / lifecycle / services mapping / commission).
//
// Definitions (on the screen and in the tests) — the photo's "3 Active Today vs 2 Off Today" was two different things:
//   team             technicians not archived
//   active accounts  status 'active' and is_active (an enabled account — NOT "working today")
//   scheduled today  an active account with a published shift today or a weekly working day today, and no approved time
//                    off covering now
//   on shift now     technician_workforce_state.shift_status = ON_SHIFT (the one operational state, migration 579)
//   available now    queue_status AVAILABLE and not manually unavailable · in service = SERVING · on break = BREAK /
//                    ON_BREAK · off today = an active account that is not on shift
//   rating           reviews (1–5) not hidden and not spam; shown with its sample size; no reviews = Unrated
//   services done    paid ticket service lines (not add-on, not retail, not removed) with a technician, in the period
//   commission est.  each line's commission snapshot (percent of the line, or a fixed amount) — an estimate until payroll
//                    finalises it; payroll_lines is never recalculated here
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { N, iso, like, err, maskPhone, phoneDigits, paging, served, branchOf, teamPeriod, inPeriod, UUID, type TeamCtx, type TPeriod, canAny } from './screen-kit';
import { dateColumnYmd } from '@aipowersalon/date-time';

export const TECH_STATUSES = ['current', 'active', 'inactive', 'suspended', 'archived', 'all'] as const;
export const TECH_SHIFTS = ['available', 'in_service', 'on_break', 'on_shift', 'off', 'scheduled', 'all'] as const;
export const TECH_SORTS = ['newest', 'oldest', 'name', 'rating', 'services'] as const;
export const TECH_BANDS = ['excellent', 'very_good', 'good', 'needs', 'unrated'] as const;
const ORDER: Record<string, RawBuilder<unknown>> = {
  newest: sql`x.created_at desc, x.id desc`, oldest: sql`x.created_at asc, x.id asc`, name: sql`lower(x.name) asc, x.id asc`,
  rating: sql`x.rating_avg desc nulls last, x.rating_count desc, x.id asc`, services: sql`x.done desc, x.id asc`,
};
const can = canAny;

export class TechniciansScreenRepository {
  constructor(private readonly db: Kysely<any>) {}
  period(ctx: TeamCtx, q: { preset?: unknown; from?: unknown; to?: unknown }, def = 'today') { return teamPeriod(this.db, ctx, q, def); }
  private br(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(te.branch_id = ${b} or te.branch_id is null)` : sql`true`; }
  private paid() { return sql`t.paid_at is not null and t.removed_at is null and coalesce(t.payment_status, '') <> 'voided'`; }
  /** the per-line commission estimate (cents) from the line's own snapshot */
  private commissionOf() {
    return sql`(case when lower(coalesce(l.commission_type_snapshot, '')) in ('percent', 'percentage') then round(l.line_total_cents * coalesce(l.commission_value_snapshot, 0) / 100.0)
      when lower(coalesce(l.commission_type_snapshot, '')) in ('fixed', 'flat', 'amount') then coalesce(l.commission_value_snapshot, 0) * coalesce(l.quantity, 1) else 0 end)`;
  }
  /** scheduled today: a published shift today, or a weekly working day, and no approved time off over now */
  private scheduledToday(T: string, p: TPeriod) {
    return sql`((exists (select 1 from technician_shifts sh where sh.tenant_id = ${T} and sh.technician_id = te.id and sh.shift_date = ${p.today}::date and coalesce(sh.status, 'scheduled') not in ('cancelled', 'canceled')))
        or (not exists (select 1 from technician_shifts sh2 where sh2.tenant_id = ${T} and sh2.technician_id = te.id and sh2.shift_date = ${p.today}::date)
          and exists (select 1 from technician_schedules sc where sc.tenant_id = ${T} and sc.technician_id = te.id and sc.day_of_week = ${p.dow} and sc.is_working)))
      and not exists (select 1 from technician_time_off tf where tf.tenant_id = ${T} and tf.technician_id = te.id and tf.status = 'approved' and tf.starts_at <= now() and tf.ends_at > now())`;
  }

  // ── the eight KPIs · the four overview panels · the four lower panels ───────────────────────────────────────────────
  async dashboard(ctx: TeamCtx, q: { preset?: unknown; from?: unknown; to?: unknown }) {
    const T = ctx.tenantId; const per = await this.period(ctx, q, 'today'); const today = await this.period(ctx, { preset: 'today' });
    const team = (await sql<any>`select count(*)::int as team, count(*) filter (where te.status = 'active' and coalesce(te.is_active, true))::int as active,
        count(*) filter (where te.status = 'active' and coalesce(te.is_active, true) and ${this.scheduledToday(T, today)})::int as scheduled,
        count(*) filter (where ws.shift_status = 'ON_SHIFT')::int as on_shift, count(*) filter (where ws.clock_status in ('CLOCKED_IN', 'ON_BREAK'))::int as clocked_in,
        count(*) filter (where ws.queue_status = 'AVAILABLE' and not coalesce(ws.manual_unavailable, false))::int as available,
        count(*) filter (where ws.queue_status = 'SERVING')::int as serving, count(*) filter (where ws.queue_status = 'ASSIGNED')::int as assigned,
        count(*) filter (where ws.queue_status = 'BREAK' or ws.clock_status = 'ON_BREAK')::int as on_break,
        count(*) filter (where te.status = 'active' and coalesce(te.is_active, true) and coalesce(ws.shift_status, 'OFF_SHIFT') <> 'ON_SHIFT')::int as off_today,
        count(*) filter (where te.status = 'active' and not exists (select 1 from technician_services ts where ts.tenant_id = ${T} and ts.technician_id = te.id))::int as unmapped
      from technicians te left join technician_workforce_state ws on ws.technician_id = te.id and ws.tenant_id = te.tenant_id
      where te.tenant_id = ${T} and te.archived_at is null and coalesce(te.status, '') <> 'archived' and ${this.br(ctx)}`.execute(this.db)).rows[0];
    const rate = (await sql<any>`select count(*)::int as n, avg(r.rating)::numeric(4,2) as avg, count(distinct r.technician_id)::int as rated from reviews r join technicians te on te.id = r.technician_id and te.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and r.rating is not null and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false) and te.archived_at is null and ${this.br(ctx)}`.execute(this.db)).rows[0];
    const sales = async (p: TPeriod) => (await sql<any>`select count(distinct l.id) filter (where lower(coalesce(l.line_kind, 'service')) = 'service' and not coalesce(l.is_add_on, false))::int as services,
        coalesce(sum(l.line_total_cents) filter (where lower(coalesce(l.line_kind, 'service')) in ('service', 'add_on') or coalesce(l.is_add_on, false)), 0)::bigint as revenue,
        coalesce(sum(${this.commissionOf()}) filter (where lower(coalesce(l.line_kind, 'service')) <> 'retail'), 0)::bigint as commission,
        count(*) filter (where l.commission_type_snapshot is null and lower(coalesce(l.line_kind, 'service')) <> 'retail')::int as no_snapshot
      from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id join technicians te on te.id = l.technician_id and te.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.removed_at is null and ${this.paid()} and ${inPeriod(sql`t.paid_at`, p)} and ${this.br(ctx)}`.execute(this.db)).rows[0];
    const tips = async (p: TPeriod) => N((await sql<any>`select coalesce(sum(a.tip_cents), 0)::bigint as c from ticket_tip_allocations a join tickets t on t.id = a.ticket_id and t.tenant_id = a.tenant_id
      join technicians te on te.id = a.technician_id and te.tenant_id = a.tenant_id where a.tenant_id = ${T} and ${this.paid()} and ${inPeriod(sql`t.paid_at`, p)} and ${this.br(ctx)}`.execute(this.db)).rows[0]?.c);
    const sp = await sales(per); const st = per.preset === 'today' ? sp : await sales(today);
    const approvals = (await sql<any>`select
        (select count(*) from technician_skill_change_requests sk where sk.tenant_id = ${T} and sk.status in ('submitted', 'pending', 'under_review', 'more_information_required'))::int as skills,
        (select count(*) from technician_time_off tf where tf.tenant_id = ${T} and tf.status = 'pending')::int as time_off,
        (select count(*) from tech_profile_change_requests pc where pc.requested_in_tenant_id = ${T} and pc.status = 'pending')::int as profile,
        (select count(*) from tech_salon_memberships ms where ms.tenant_id = ${T} and ms.status = 'pending_salon_approval')::int as membership`.execute(this.db)).rows[0];
    const bands = (await sql<any>`select count(*) filter (where x.avg >= 4.5)::int as excellent, count(*) filter (where x.avg >= 3.5 and x.avg < 4.5)::int as very_good,
        count(*) filter (where x.avg >= 2.5 and x.avg < 3.5)::int as good, count(*) filter (where x.avg < 2.5)::int as needs, count(*) filter (where x.avg is null)::int as unrated
      from (select te.id, (select avg(r.rating) from reviews r where r.tenant_id = ${T} and r.technician_id = te.id and r.rating is not null and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false)) as avg
        from technicians te where te.tenant_id = ${T} and te.archived_at is null and coalesce(te.status, '') <> 'archived' and ${this.br(ctx)}) x`.execute(this.db)).rows[0];
    const top = (await sql<any>`select te.id, coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) as name, te.avatar_url, r.avg, r.n,
        (select count(distinct l.id) from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id where l.tenant_id = ${T} and l.technician_id = te.id and l.removed_at is null
          and lower(coalesce(l.line_kind, 'service')) = 'service' and not coalesce(l.is_add_on, false) and ${this.paid()} and ${inPeriod(sql`t.paid_at`, per)})::int as done
      from technicians te join lateral (select avg(r.rating)::numeric(4,2) as avg, count(*)::int as n from reviews r where r.tenant_id = ${T} and r.technician_id = te.id and r.rating is not null
        and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false)) r on r.n > 0
      where te.tenant_id = ${T} and te.archived_at is null and ${this.br(ctx)} order by r.avg desc, r.n desc, te.id limit 5`.execute(this.db)).rows;
    const certs = (await sql<any>`select count(*) filter (where c.revoked_reason is null and (c.expires_at is null or c.expires_at >= ${today.today}::date))::int as valid,
        count(*) filter (where c.revoked_reason is null and c.expires_at >= ${today.today}::date and c.expires_at <= ${today.today}::date + 30)::int as expiring,
        count(*) filter (where c.revoked_reason is null and c.expires_at < ${today.today}::date)::int as expired, count(*) filter (where upper(coalesce(c.verification_status, '')) = 'VERIFIED')::int as verified
      from technician_certifications c join technicians te on te.id = c.technician_id and te.tenant_id = c.tenant_id where c.tenant_id = ${T} and te.archived_at is null and ${this.br(ctx)}`.execute(this.db)).rows[0];
    const coverage = (await sql<any>`select count(*)::int as n from staffing_coverage_recommendations s where s.tenant_id = ${T} and s.status = 'review_required' and s.date >= ${today.today}::date`.execute(this.db)).rows[0];
    const pay = can(ctx, 'technicians.view_pay', 'payroll.view');
    const k = {
      totalTeam: N(team?.team), activeAccounts: N(team?.active), scheduledToday: N(team?.scheduled), onShiftNow: N(team?.on_shift), clockedIn: N(team?.clocked_in),
      availableNow: N(team?.available), inService: N(team?.serving), assigned: N(team?.assigned), onBreak: N(team?.on_break), offToday: N(team?.off_today),
      avgRating: rate?.avg == null ? null : Number(rate.avg), ratingCount: N(rate?.n), ratedTechnicians: N(rate?.rated),
      servicesCompleted: N(sp?.services), commissionEstCents: pay ? N(sp?.commission) : null, commissionLinesWithoutSnapshot: N(sp?.no_snapshot),
      pendingApprovals: N(approvals?.skills) + N(approvals?.time_off) + N(approvals?.profile) + N(approvals?.membership),
      approvals: { skills: N(approvals?.skills), timeOff: N(approvals?.time_off), profile: N(approvals?.profile), membership: N(approvals?.membership) },
      openPositions: null as number | null, openPositionsReason: 'not_configured', missingServiceMapping: N(team?.unmapped),
    };
    // rules over the numbers above — never an automatic change to a shift, a status or pay
    const insights: Array<{ kind: string; severity: 'warn' | 'info'; n: number; action: string }> = [];
    if (k.scheduledToday > k.onShiftNow) insights.push({ kind: 'not_on_shift', severity: 'warn', n: k.scheduledToday - k.onShiftNow, action: 'shift' });
    if (N(coverage?.n)) insights.push({ kind: 'coverage', severity: 'warn', n: N(coverage?.n), action: 'schedule' });
    if (k.missingServiceMapping) insights.push({ kind: 'unmapped', severity: 'warn', n: k.missingServiceMapping, action: 'mapping' });
    if (N(certs?.expiring)) insights.push({ kind: 'cert_expiring', severity: 'info', n: N(certs?.expiring), action: 'certs' });
    if (k.pendingApprovals) insights.push({ kind: 'approvals', severity: 'info', n: k.pendingApprovals, action: 'approvals' });
    if (N(bands?.unrated)) insights.push({ kind: 'unrated', severity: 'info', n: N(bands?.unrated), action: 'unrated' });
    return {
      period: per, kpis: k, insights,
      attendance: { availableNow: k.availableNow, inService: k.inService, assigned: k.assigned, onBreak: k.onBreak, offToday: k.offToday, scheduledToday: k.scheduledToday, clockedIn: k.clockedIn },
      bands: { excellent: N(bands?.excellent), veryGood: N(bands?.very_good), good: N(bands?.good), needs: N(bands?.needs), unrated: N(bands?.unrated) },
      topPerformers: top.map((r: any) => ({ technicianId: String(r.id), name: String(r.name || ''), avatarUrl: r.avatar_url ?? null, rating: Number(r.avg), ratingCount: N(r.n), servicesCompleted: N(r.done) })),
      productivityToday: { servicesCompleted: N(st?.services), revenueCents: pay ? N(st?.revenue) : null, commissionEstCents: pay ? N(st?.commission) : null, tipsCents: pay ? await tips(today) : null },
      shiftOverview: { onShift: k.onShiftNow, onBreak: k.onBreak, offOrNotClockedIn: Math.max(0, k.activeAccounts - k.onShiftNow), scheduledToday: k.scheduledToday, clockedIn: k.clockedIn },
      certifications: { valid: N(certs?.valid), expiringSoon: N(certs?.expiring), expired: N(certs?.expired), verified: N(certs?.verified) },
      // birthdays are not part of a technician record; nothing is guessed
      birthdays: { recorded: false },
    };
  }

  // ── the Technician Directory ───────────────────────────────────────────────────────────────────────────────────────
  async directory(ctx: TeamCtx, f: { q?: string; status?: string; shift?: string; missingMapping?: string; role?: string; band?: string; serviceId?: string; sort?: string;
    dateField?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f, 'all'); const today = await this.period(ctx, { preset: 'today' });
    const status = (TECH_STATUSES as readonly string[]).includes(String(f.status)) ? String(f.status) : 'current';
    const shift = (TECH_SHIFTS as readonly string[]).includes(String(f.shift)) ? String(f.shift) : 'all';
    const sort = ORDER[String(f.sort)] ? String(f.sort) : 'newest';
    const band = (TECH_BANDS as readonly string[]).includes(String(f.band)) ? String(f.band) : null;
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const { d, phoneish } = phoneDigits(raw); const isId = UUID.test(raw);
    const sid = f.serviceId && UUID.test(f.serviceId) ? f.serviceId : null;
    const dateCol = f.dateField === 'updated' ? sql`te.updated_at` : sql`te.created_at`;
    const contact = can(ctx, 'technicians.edit', 'pos.technicians.edit');
    const w = sql`te.tenant_id = ${T} and ${this.br(ctx)} and ${inPeriod(dateCol, per)}
      and (${status} <> 'current' or (te.archived_at is null and coalesce(te.status, '') <> 'archived'))
      and (${status} not in ('active', 'inactive', 'suspended') or te.status = ${status}) and (${status} <> 'archived' or te.archived_at is not null or te.status = 'archived')
      and (${shift} = 'all' or (${shift} = 'available' and ws.queue_status = 'AVAILABLE' and not coalesce(ws.manual_unavailable, false)) or (${shift} = 'in_service' and ws.queue_status = 'SERVING')
        or (${shift} = 'on_break' and (ws.queue_status = 'BREAK' or ws.clock_status = 'ON_BREAK')) or (${shift} = 'on_shift' and ws.shift_status = 'ON_SHIFT')
        or (${shift} = 'off' and te.status = 'active' and coalesce(ws.shift_status, 'OFF_SHIFT') <> 'ON_SHIFT') or (${shift} = 'scheduled' and te.status = 'active' and ${this.scheduledToday(T, today)}))
      and (${f.missingMapping === '1' || f.missingMapping === 'true'} = false or not exists (select 1 from technician_services m where m.tenant_id = ${T} and m.technician_id = te.id))
      and (${f.role ?? ''} = '' or coalesce(nullif(te.role_label, ''), 'Technician') = ${f.role ?? ''})
      and (${sid}::uuid is null or exists (select 1 from technician_services m2 where m2.tenant_id = ${T} and m2.technician_id = te.id and m2.service_id = ${sid}))
      and (${raw} = '' or te.full_name ilike ${l} or (coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, '')) ilike ${l} or coalesce(te.email, '') ilike ${l}
        or coalesce(te.role_label, '') ilike ${l} or (${isId} and te.id::text = ${raw.toLowerCase()}) or lower(te.id::text) like ${raw.toLowerCase() + '%'}
        or (${phoneish} and regexp_replace(coalesce(te.normalized_phone, te.phone_display, ''), '\\D', '', 'g') like ${'%' + d + '%'})
        or exists (select 1 from technician_services m3 join services s on s.id = m3.service_id and s.tenant_id = m3.tenant_id where m3.tenant_id = ${T} and m3.technician_id = te.id and s.name ilike ${l}))`;
    const from = sql`from technicians te left join technician_workforce_state ws on ws.technician_id = te.id and ws.tenant_id = te.tenant_id left join branches b on b.id = te.branch_id and b.tenant_id = te.tenant_id`;
    const inner = sql`select te.id, coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) as name, te.first_name, te.last_name, te.avatar_url, te.email, te.phone_display, te.normalized_phone,
        te.role_label, te.status, te.is_active, te.archived_at, te.created_at, te.updated_at, te.user_id, te.service_eligibility_mode, b.name as branch_name,
        ws.queue_status, ws.shift_status, ws.clock_status, ws.manual_unavailable, ws.break_started_at,
        (select count(*) from technician_services m where m.tenant_id = ${T} and m.technician_id = te.id)::int as mapped,
        (select avg(r.rating) from reviews r where r.tenant_id = ${T} and r.technician_id = te.id and r.rating is not null and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false))::numeric(4,2) as rating_avg,
        (select count(*) from reviews r where r.tenant_id = ${T} and r.technician_id = te.id and r.rating is not null and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false))::int as rating_count,
        (select count(distinct l.id) from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id where l.tenant_id = ${T} and l.technician_id = te.id and l.removed_at is null
          and lower(coalesce(l.line_kind, 'service')) = 'service' and not coalesce(l.is_add_on, false) and ${this.paid()} and ${inPeriod(sql`t.paid_at`, today)})::int as done,
        (select a.app_enabled from technician_app_settings a where a.tenant_id = ${T} and a.technician_id = te.id limit 1) as app_enabled,
        (select m.status from tech_salon_memberships m where m.tenant_id = ${T} and m.technician_id = te.id order by m.created_at desc limit 1) as membership_status,
        (select to_char(sh.start_time at time zone ${today.tz}, 'HH24:MI') || '–' || to_char(sh.end_time at time zone ${today.tz}, 'HH24:MI') from technician_shifts sh where sh.tenant_id = ${T} and sh.technician_id = te.id
          and sh.shift_date = ${today.today}::date and coalesce(sh.status, 'scheduled') not in ('cancelled', 'canceled') order by sh.start_time limit 1) as shift_today,
        (select to_char(sc.start_time, 'HH24:MI') || '–' || to_char(sc.end_time, 'HH24:MI') from technician_schedules sc where sc.tenant_id = ${T} and sc.technician_id = te.id and sc.day_of_week = ${today.dow} and sc.is_working limit 1) as weekly_today,
        case when ${raw} = '' then null when ${isId} and te.id::text = ${raw.toLowerCase()} then 'id' when ${phoneish} and regexp_replace(coalesce(te.normalized_phone, te.phone_display, ''), '\\D', '', 'g') like ${'%' + d + '%'} then 'phone'
          when te.full_name ilike ${l} or (coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, '')) ilike ${l} then 'name' when coalesce(te.email, '') ilike ${l} then 'email'
          when coalesce(te.role_label, '') ilike ${l} then 'role' when lower(te.id::text) like ${raw.toLowerCase() + '%'} then 'id' else 'service' end as matched_via,
        case when ${isId} and te.id::text = ${raw.toLowerCase()} then 0 when lower(te.full_name) = ${raw.toLowerCase()} then 1 when te.full_name ilike ${raw + '%'} then 2 else 3 end as rank
      ${from} where ${w}`;
    const bandW = band === 'unrated' ? sql`x.rating_avg is null` : band === 'excellent' ? sql`x.rating_avg >= 4.5` : band === 'very_good' ? sql`x.rating_avg >= 3.5 and x.rating_avg < 4.5`
      : band === 'good' ? sql`x.rating_avg >= 2.5 and x.rating_avg < 3.5` : band === 'needs' ? sql`x.rating_avg < 2.5` : sql`true`;
    const total = N((await sql<any>`select count(*)::int as n from (${inner}) x where ${bandW}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select x.* from (${inner}) x where ${bandW} order by ${raw ? sql`x.rank asc, ` : sql``}${ORDER[sort]} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const roles = (await sql<any>`select coalesce(nullif(te.role_label, ''), 'Technician') as role, count(*)::int as n from technicians te where te.tenant_id = ${T} and te.archived_at is null and coalesce(te.status, '') <> 'archived' and ${this.br(ctx)} group by 1 order by 1`.execute(this.db)).rows;
    const all = roles.reduce((a: number, r: any) => a + N(r.n), 0);
    // the matched services, so a "gel" search says WHY a technician is on the list
    const svc = raw && rows.length ? (await sql<any>`select m.technician_id, s.name from technician_services m join services s on s.id = m.service_id and s.tenant_id = m.tenant_id
      where m.tenant_id = ${T} and m.technician_id in (${sql.join(rows.map((r: any) => sql`${r.id}`))}) and s.name ilike ${l} order by lower(s.name)`.execute(this.db)).rows : [];
    return { period: per, status, shift, sort, roles: { all, byRole: roles.map((r: any) => ({ role: String(r.role), count: N(r.n) })) },
      items: rows.map((r: any) => {
        const working = r.queue_status === 'AVAILABLE' && !r.manual_unavailable ? 'available' : r.queue_status === 'SERVING' ? 'in_service' : r.queue_status === 'ASSIGNED' ? 'assigned'
          : r.queue_status === 'BREAK' || r.clock_status === 'ON_BREAK' ? 'on_break' : r.shift_status === 'ON_SHIFT' ? 'on_shift' : 'off';
        return { technicianId: String(r.id), name: String(r.name || ''), avatarUrl: r.avatar_url ?? null, code: String(r.id).slice(0, 8).toUpperCase(), branchName: r.branch_name ?? null, role: r.role_label || 'Technician',
          status: r.archived_at ? 'archived' : String(r.status ?? 'active'), working, workingSince: iso(r.break_started_at),
          email: contact ? r.email ?? null : null, phone: contact ? r.phone_display ?? r.normalized_phone ?? null : maskPhone(r.phone_display ?? r.normalized_phone), contactMasked: !contact,
          qualifiedServices: N(r.mapped), missingMapping: N(r.mapped) === 0, eligibilityMode: r.service_eligibility_mode ?? null,
          rating: r.rating_avg == null ? null : Number(r.rating_avg), ratingCount: N(r.rating_count), servicesToday: N(r.done),
          app: r.user_id && r.app_enabled !== false ? 'connected' : r.membership_status === 'invited' || r.membership_status === 'pending' ? 'invited' : r.user_id ? 'inactive' : 'not_set',
          shiftToday: r.shift_today ?? r.weekly_today ?? null, shiftSource: r.shift_today ? 'published' : r.weekly_today ? 'weekly' : null,
          matchedVia: r.matched_via ?? null, matchedServices: svc.filter((s: any) => String(s.technician_id) === String(r.id)).slice(0, 4).map((s: any) => String(s.name)),
          createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
      }), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  // ── the Profile overlay: Appointments · Service history · History tabs (Overview / Services / Schedule / Earnings /
  //    Gallery read the existing technician endpoints) ─────────────────────────────────────────────────────────────
  private async mustTech(ctx: TeamCtx, id: string) {
    if (!UUID.test(String(id))) throw err(404, 'TECHNICIAN_NOT_FOUND', 'Technician not found');
    const r = (await sql<any>`select te.id from technicians te where te.tenant_id = ${ctx.tenantId} and te.id = ${id} and ${this.br(ctx)}`.execute(this.db)).rows[0];
    if (!r) throw err(404, 'TECHNICIAN_NOT_FOUND', 'Technician not found');
  }
  async appointments(ctx: TeamCtx, id: string, f: { scope?: string; page?: unknown; pageSize?: unknown }) {
    await this.mustTech(ctx, id); const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 8); const today = await this.period(ctx, { preset: 'today' });
    const upcoming = f.scope !== 'past';
    const w = sql`a.tenant_id = ${T} and a.technician_id = ${id} and ${upcoming ? sql`a.appt_date >= ${today.today}::date and coalesce(a.status, '') not in ('cancelled', 'canceled', 'no_show', 'completed')` : sql`(a.appt_date < ${today.today}::date or a.status in ('completed', 'cancelled', 'canceled', 'no_show'))`}`;
    const total = N((await sql<any>`select count(*)::int as n from pos_tech_appointments a where a.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select a.id, a.appt_date, a.start_time, a.end_time, a.duration_minutes, a.status, a.customer_name, a.services, a.source from pos_tech_appointments a where a.tenant_id = ${T} and ${w}
      order by ${upcoming ? sql`a.appt_date asc, a.start_time asc, a.id asc` : sql`a.appt_date desc, a.start_time desc, a.id desc`} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const customers = can(ctx, 'customers.view');
    return { scope: upcoming ? 'upcoming' : 'past', items: rows.map((r: any) => ({ appointmentId: String(r.id), date: dateColumnYmd(r.appt_date),
      start: r.start_time ?? null, end: r.end_time ?? null, minutes: N(r.duration_minutes), status: String(r.status ?? ''), customer: customers ? r.customer_name ?? null : null, source: r.source ?? null,
      services: Array.isArray(r.services) ? r.services.map((s: any) => String(s?.name ?? s?.serviceName ?? s?.label ?? '')).filter(Boolean) : [] })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  async serviceHistory(ctx: TeamCtx, id: string, f: { q?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    await this.mustTech(ctx, id); const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 8); const per = await this.period(ctx, f, 'month');
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw);
    const w = sql`l.tenant_id = ${T} and l.technician_id = ${id} and l.removed_at is null and lower(coalesce(l.line_kind, 'service')) <> 'retail' and ${this.paid()} and ${inPeriod(sql`t.paid_at`, per)}
      and (${raw} = '' or l.service_name_snapshot ilike ${l} or t.ticket_number::text = ${raw.replace(/^#/, '')})`;
    const from = sql`from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id left join customers cu on cu.id = t.customer_id and cu.tenant_id = t.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select l.id, l.service_name_snapshot, l.line_total_cents, l.is_add_on, l.status, t.ticket_number, t.paid_at, cu.full_name ${from} where ${w} order by t.paid_at desc, l.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const pay = can(ctx, 'technicians.view_pay', 'payroll.view'); const customers = can(ctx, 'customers.view');
    return { period: per, items: rows.map((r: any) => ({ lineId: String(r.id), service: String(r.service_name_snapshot ?? ''), addOn: !!r.is_add_on, at: iso(r.paid_at), ticketNumber: r.ticket_number == null ? null : String(r.ticket_number),
      customer: customers ? r.full_name ?? null : null, amountCents: pay ? N(r.line_total_cents) : null, status: r.status ?? null })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  /** History: status, employment and audit events for one technician (or the whole team), newest first */
  async history(ctx: TeamCtx, f: { technicianId?: string; q?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f, 'all');
    const tid = f.technicianId && UUID.test(f.technicianId) ? f.technicianId : null; if (tid) await this.mustTech(ctx, tid);
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw);
    const events = sql`select a.id, a.technician_id, a.action as kind, a.metadata::text as detail, a.user_id as actor_id, a.created_at as at, 'audit' as source from technician_audit_logs a where a.tenant_id = ${T}
      union all select s.id, s.technician_id, 'status:' || coalesce(s.old_status, '') || '→' || coalesce(s.new_status, ''), s.reason, s.changed_by_user_id, s.created_at, 'status' from technician_status_events s where s.tenant_id = ${T}
      union all select e.id, e.technician_id, e.event_type, coalesce(e.from_value, '') || case when e.to_value is not null then ' → ' || e.to_value else '' end || case when e.reason is not null then ' · ' || e.reason else '' end, e.actor_user_id, e.occurred_at, 'employment' from technician_employment_events e where e.tenant_id = ${T}`;
    const w = sql`(${tid}::uuid is null or x.technician_id = ${tid}) and ${inPeriod(sql`x.at`, per)} and te.tenant_id = ${T} and ${this.br(ctx)}
      and (${raw} = '' or x.kind ilike ${l} or coalesce(x.detail, '') ilike ${l} or coalesce(te.full_name, '') ilike ${l})`;
    const from = sql`from (${events}) x join technicians te on te.id = x.technician_id and te.tenant_id = ${T} left join users u on u.id = x.actor_id and u.tenant_id = ${T}`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where te.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select x.id, x.technician_id, x.kind, x.detail, x.at, x.source, te.full_name, coalesce(nullif(u.full_name, ''), u.email) as actor ${from} where te.tenant_id = ${T} and ${w} order by x.at desc, x.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, items: rows.map((r: any) => ({ id: String(r.id), technicianId: String(r.technician_id), technician: r.full_name ?? null, kind: String(r.kind ?? ''), detail: r.detail ? String(r.detail).slice(0, 300) : null,
      source: String(r.source), at: iso(r.at), actor: r.actor ?? null })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  /** Training & Certifications: verified records only as stored; expiring = within 30 days */
  async certifications(ctx: TeamCtx, f: { state?: string; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 6); const today = await this.period(ctx, { preset: 'today' });
    const st = ['valid', 'expiring', 'expired', 'all'].includes(String(f.state)) ? String(f.state) : 'all';
    const w = sql`c.tenant_id = ${T} and te.archived_at is null and ${this.br(ctx)} and (${st} = 'all' or (${st} = 'valid' and c.revoked_reason is null and (c.expires_at is null or c.expires_at >= ${today.today}::date))
      or (${st} = 'expiring' and c.revoked_reason is null and c.expires_at between ${today.today}::date and ${today.today}::date + 30) or (${st} = 'expired' and c.expires_at < ${today.today}::date))`;
    const from = sql`from technician_certifications c join technicians te on te.id = c.technician_id and te.tenant_id = c.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select c.id, c.name, c.issuer, c.issued_at, c.expires_at, c.verification_status, c.revoked_reason, te.id as tid, te.full_name ${from} where ${w} order by c.expires_at asc nulls last, c.id limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const ymd = (v: unknown) => dateColumnYmd(v);   // a Postgres DATE column (the driver's local-midnight Date) → its calendar day
    return { today: today.today, items: rows.map((r: any) => ({ id: String(r.id), technicianId: String(r.tid), technician: r.full_name ?? null, name: String(r.name ?? ''), issuer: r.issuer ?? null, issuedAt: ymd(r.issued_at), expiresAt: ymd(r.expires_at),
      verified: String(r.verification_status ?? '').toUpperCase() === 'VERIFIED', revoked: !!r.revoked_reason })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  /** Service Mapping Assistant: the whole tenant catalog against ONE technician's current mapping (never pre-ticked) */
  async mappingReview(ctx: TeamCtx, id: string) {
    await this.mustTech(ctx, id); const T = ctx.tenantId;
    const rows = (await sql<any>`select s.id, s.name, s.duration_minutes, s.price_cents, s.status, c.name as category, b.name as branch_name,
        exists (select 1 from technician_services m where m.tenant_id = ${T} and m.technician_id = ${id} and m.service_id = s.id) as mapped,
        (select count(*) from ticket_service_lines l where l.tenant_id = ${T} and l.technician_id = ${id} and l.service_id = s.id and l.removed_at is null)::int as performed,
        exists (select 1 from technician_skill_change_requests r where r.tenant_id = ${T} and r.technician_id = ${id} and r.service_id = s.id and r.status in ('submitted', 'pending', 'under_review', 'more_information_required')) as requested
      from services s left join service_categories c on c.id = s.category_id and c.tenant_id = s.tenant_id left join branches b on b.id = s.branch_id and b.tenant_id = s.tenant_id
      where s.tenant_id = ${T} and s.status <> 'archived' and (${branchOf(ctx)}::uuid is null or s.branch_id = ${branchOf(ctx)} or s.branch_id is null) order by lower(coalesce(c.name, '')), lower(s.name), s.id`.execute(this.db)).rows;
    return { technicianId: id, services: rows.map((r: any) => ({ serviceId: String(r.id), name: String(r.name), category: r.category ?? null, branchName: r.branch_name ?? null, durationMinutes: N(r.duration_minutes),
      priceCents: N(r.price_cents), active: r.status === 'active', mapped: !!r.mapped, performedBefore: N(r.performed), requested: !!r.requested })) };
  }
}
