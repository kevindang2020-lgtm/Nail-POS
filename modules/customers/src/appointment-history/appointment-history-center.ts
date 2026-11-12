// appointment-history-center.ts — Appointment History SUNMI guide (Nov 9 2026): `/pos/appointment-history/*`, the salon-wide
// appointment history workspace. It OWNS NO DATA and writes nothing: appointments are Booking (pos_tech_appointments), their
// lifecycle is the append-only appointment_change_log that every booking path writes (created · status_changed · rescheduled ·
// cancelled · assigned), technicians are Team, customers are Customer Management.
//
// The six cards (guide §05), each over the SAME filters as the table:
//   Appointments  canonical appointment rows (not service lines)
//   Upcoming      salon-local date today or later with an open status (booked · confirmed · checked_in · waiting · in_service)
//   Completed     status completed (never inferred from a past time)
//   Canceled      status cancelled
//   No-Shows      status no_show (an explicit outcome — never inferred from an overdue time)
//   Rescheduled   appointments with at least one recorded `rescheduled` change (a move is not a cancellation)
// Scope: a branch-confined role sees only appointments of its branches.
import { sql, type Kysely } from 'kysely';
import type { AhSummaryResponse, AhListResponse, AhCheckResponse, AhOptionsResponse, AhChange } from '@aipowersalon/api-contracts/tenant';
import { RetentionRepository, isUuid, maskPhone, type RetentionContext, type BranchScope } from '../retention/retention.repository';

type Row = Record<string, any>;
export type AhCtx = RetentionContext;
export class AppointmentHistoryError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}

export const AH_STATUSES = ['all', 'upcoming', 'completed', 'canceled', 'no_show', 'rescheduled'] as const;
export const AH_DATE_FIELDS = ['scheduled', 'created', 'updated', 'completed', 'canceled'] as const;
export const AH_PRESETS = ['all', 'today', 'week', 'month', 'year', 'custom'] as const;
export const AH_SORTS = ['newest', 'scheduled', 'upcoming', 'updated'] as const;
export const AH_PAGE_SIZES = [10, 25, 50, 100] as const;
const OPEN = ['booked', 'confirmed', 'checked_in', 'waiting', 'in_service'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

export interface AhQuery { q?: unknown; status?: unknown; technician?: unknown; dateField?: unknown; preset?: unknown; from?: unknown; to?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown }

export class AppointmentHistoryCenter {
  private readonly ret: RetentionRepository;
  constructor(readonly db: Kysely<any>, private readonly now: () => number = () => Date.now()) { this.ret = new RetentionRepository(db); }

  private async scope(ctx: AhCtx): Promise<BranchScope> {
    try { return await this.ret.branchScope(ctx, undefined); }
    catch (e: any) { throw new AppointmentHistoryError(e?.message ?? 'Unknown branch.', 'BRANCH_NOT_AUTHORIZED', e?.status ?? 400); }
  }
  private async period(ctx: AhCtx, f: AhQuery) {
    const preset = pick(AH_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    if (preset === 'custom') {
      const from = typeof f.from === 'string' && DAY.test(f.from) ? f.from : null, to = typeof f.to === 'string' && DAY.test(f.to) ? f.to : null;
      if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new AppointmentHistoryError('Choose a From and a To date.', 'APPOINTMENT_HISTORY_INVALID_PERIOD');
      if (from > to) throw new AppointmentHistoryError('The From date must be on or before the To date.', 'APPOINTMENT_HISTORY_INVALID_PERIOD');
    }
    if (preset === 'all') { const w = await this.ret.window(ctx, { preset: 'today' }); return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today: w.today, tz: w.tz }; }
    try { const w = await this.ret.window(ctx, { preset, from: f.from, to: f.to }); return { preset, from: w.from, to: w.to, start: w.start, end: w.end, today: w.today, tz: w.tz }; }
    catch (e: any) { throw new AppointmentHistoryError(e?.message ?? 'Choose a valid period.', 'APPOINTMENT_HISTORY_INVALID_PERIOD'); }
  }

  /** every appointment of the scope with what the history needs (one row per appointment) */
  private rows(T: string, s: BranchScope) {
    return sql`(select a.id, a.branch_id, a.customer_id, a.technician_id, a.any_technician, a.status, a.source, a.appt_date, a.start_time::text as start_time, a.end_time::text as end_time,
        a.duration_minutes, a.created_at, a.updated_at, coalesce(c.full_name, a.customer_name) as customer_name, coalesce(c.normalized_phone, a.customer_phone) as phone,
        te.full_name as technician_name, b.name as branch_name,
        (select string_agg(coalesce(x->>'name', x->>'serviceName'), ', ') from jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) x) as services,
        (select count(*)::int from appointment_change_log l where l.tenant_id = a.tenant_id and l.appointment_id = a.id and l.change_type = 'rescheduled') as reschedules,
        (select max(l.created_at) from appointment_change_log l where l.tenant_id = a.tenant_id and l.appointment_id = a.id and l.change_type = 'status_changed' and l.new_value = 'completed') as completed_at,
        (select max(l.created_at) from appointment_change_log l where l.tenant_id = a.tenant_id and l.appointment_id = a.id and (l.change_type = 'cancelled' or (l.change_type = 'status_changed' and l.new_value = 'cancelled'))) as canceled_at
      from pos_tech_appointments a
      left join customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id
      left join technicians te on te.id = a.technician_id and te.tenant_id = a.tenant_id
      left join branches b on b.id = a.branch_id and b.tenant_id = a.tenant_id
      where a.tenant_id = ${T} ${s.branchIds ? sql`and a.branch_id = any(${s.branchIds}::uuid[])` : sql``})`;
  }
  private bucket(status: string, today: string) {
    switch (status) {
      case 'upcoming': return sql`r.appt_date >= ${today}::date and r.status = any(${OPEN}::text[])`;
      case 'completed': return sql`r.status = 'completed'`;
      case 'canceled': return sql`r.status = 'cancelled'`;
      case 'no_show': return sql`r.status = 'no_show'`;
      case 'rescheduled': return sql`r.reschedules > 0`;
      default: return sql`true`;
    }
  }
  /** the filters every card and the table share (search · technician · which date + range) */
  private async filters(ctx: AhCtx, f: AhQuery) {
    const per = await this.period(ctx, f);
    const where: any[] = [sql`true`];
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q && q.length < 2) throw new AppointmentHistoryError('Type at least 2 characters to search.', 'APPOINTMENT_HISTORY_SEARCH_TOO_SHORT');
    if (q) {
      if (isUuid(`${q}`)) where.push(sql`(r.id = ${q}::uuid or r.customer_id = ${q}::uuid)`);   // a copy: the guard must not narrow `q` below
      else {
        const digits = q.replace(/\D/g, ''); const like = '%' + likeEsc(q) + '%';
        where.push(sql`(vi_fold(coalesce(r.customer_name, '')) like '%' || vi_fold(${likeEsc(q)}) || '%' or coalesce(r.technician_name, '') ilike ${like} or coalesce(r.services, '') ilike ${like}
          ${digits.length >= 4 ? sql`or regexp_replace(coalesce(r.phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'}` : sql``})`);
      }
    }
    if (typeof f.technician === 'string' && isUuid(f.technician)) where.push(sql`r.technician_id = ${f.technician}::uuid`);
    const dateField = pick(AH_DATE_FIELDS, f.dateField) ?? 'scheduled';
    if (per.from && per.to && per.start && per.end) {
      if (dateField === 'scheduled') where.push(sql`r.appt_date >= ${per.from}::date and r.appt_date <= ${per.to}::date`);
      else {
        const col = dateField === 'created' ? sql`r.created_at` : dateField === 'updated' ? sql`r.updated_at` : dateField === 'completed' ? sql`r.completed_at` : sql`r.canceled_at`;
        where.push(sql`${col} >= ${per.start.toISOString()}::timestamptz and ${col} < ${per.end.toISOString()}::timestamptz`);
      }
    }
    return { per, where, q, dateField };
  }

  async summary(ctx: AhCtx, f: AhQuery = {}): Promise<AhSummaryResponse> {
    const T = ctx.tenantId; const s = await this.scope(ctx);
    const { per, where } = await this.filters(ctx, f);
    const w = sql.join(where, sql` and `);
    const r = (await sql<Row>`select count(*)::int as total,
        count(*) filter (where ${this.bucket('upcoming', per.today)})::int as upcoming,
        count(*) filter (where r.status = 'completed')::int as completed,
        count(*) filter (where r.status = 'cancelled')::int as canceled,
        count(*) filter (where r.status = 'no_show')::int as no_show,
        count(*) filter (where r.reschedules > 0)::int as rescheduled
      from ${this.rows(T, s)} r where ${w}`.execute(this.db)).rows[0] ?? {};
    return {
      asOf: new Date(this.now()).toISOString(),
      cards: { appointments: N(r.total), upcoming: N(r.upcoming), completed: N(r.completed), canceled: N(r.canceled), noShows: N(r.no_show), rescheduled: N(r.rescheduled) },
      period: { today: per.today, timeZone: per.tz, preset: per.preset, from: per.from, to: per.to },
      scope: { label: s.label, confined: s.confined },
    };
  }

  async list(ctx: AhCtx, f: AhQuery): Promise<AhListResponse> {
    const T = ctx.tenantId; const s = await this.scope(ctx);
    const pageSize = (AH_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const status = pick(AH_STATUSES, f.status) ?? 'all';
    const sort = pick(AH_SORTS, f.sort) ?? 'newest';
    const { per, where, q, dateField } = await this.filters(ctx, f);
    where.push(this.bucket(status, per.today));
    const w = sql.join(where, sql` and `);
    const order = sort === 'scheduled' ? sql`r.appt_date desc, r.start_time desc, r.id desc` : sort === 'upcoming' ? sql`r.appt_date asc, r.start_time asc, r.id asc`
      : sort === 'updated' ? sql`r.updated_at desc nulls last, r.id desc` : sql`r.created_at desc, r.id desc`;
    const total = N((await sql<Row>`select count(*)::int as n from ${this.rows(T, s)} r where ${w}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages);
    const rows = (await sql<Row>`select r.*, to_char(r.appt_date, 'YYYY-MM-DD') as day from ${this.rows(T, s)} r where ${w} order by ${order} limit ${pageSize} offset ${(p - 1) * pageSize}`.execute(this.db)).rows;
    // extras (Appointment History 04) — change & source evidence for the details overlay: what the append-only change log
    // recorded for the appointments on THIS page (original → new value, who, which path, when), newest first, ≤ 10 each.
    // Read-only; the Booking event history itself is never rewritten.
    const ids = rows.map((r) => String(r.id));
    const changeRows = ids.length ? (await sql<Row>`select * from (select l.id, l.appointment_id, l.change_type, l.field, l.old_value, l.new_value, l.actor_type, l.source, l.created_at,
        coalesce(nullif(u.full_name, ''), u.email) as actor, row_number() over (partition by l.appointment_id order by l.created_at desc, l.id desc) as rn
      from appointment_change_log l left join users u on u.id = l.actor_id and u.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.appointment_id = any(${ids}::uuid[])) x where x.rn <= 10 order by x.created_at desc, x.id desc`.execute(this.db)).rows : [];
    const changesBy = new Map<string, AhChange[]>();
    for (const c of changeRows) {
      const k = String(c.appointment_id); if (!changesBy.has(k)) changesBy.set(k, []);
      changesBy.get(k)!.push({ id: String(c.id), changeType: String(c.change_type), field: c.field ?? null, oldValue: c.old_value ?? null, newValue: c.new_value ?? null,
        actor: c.actor ?? null, actorType: c.actor_type ?? null, source: c.source ?? null, at: iso(c.created_at) });
    }
    return {
      items: rows.map((r) => ({
        id: String(r.id), date: String(r.day), startTime: r.start_time ?? null, endTime: r.end_time ?? null, durationMinutes: r.duration_minutes == null ? null : N(r.duration_minutes),
        customerId: r.customer_id ? String(r.customer_id) : null, customer: r.customer_name ?? null, phone: maskPhone(r.phone),
        services: r.services ?? null, technician: r.technician_name ?? null, anyTechnician: !!r.any_technician, branch: r.branch_name ?? null,
        status: String(r.status), source: r.source ?? null, rescheduled: N(r.reschedules), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
        completedAt: iso(r.completed_at), canceledAt: iso(r.canceled_at), changes: changesBy.get(String(r.id)) ?? [],
      })),
      total, page: p, pageSize, totalPages,
      applied: { q: q || null, status, dateField, sort, preset: per.preset, from: per.from, to: per.to },
      period: { today: per.today, timeZone: per.tz },
    };
  }

  /** technicians that appear in this scope's appointments (filter options from real rows only) */
  async options(ctx: AhCtx): Promise<AhOptionsResponse> {
    const T = ctx.tenantId; const s = await this.scope(ctx);
    const tech = (await sql<Row>`select distinct r.technician_id as id, r.technician_name as name from ${this.rows(T, s)} r where r.technician_id is not null and r.technician_name is not null order by 2 limit 300`.execute(this.db)).rows;
    return { technicians: tech.map((t) => ({ id: String(t.id), name: String(t.name) })), statuses: AH_STATUSES, dateFields: AH_DATE_FIELDS, sorts: AH_SORTS, pageSizes: AH_PAGE_SIZES };
  }

  /** Check Appointment History System — read-only */
  async check(ctx: AhCtx): Promise<AhCheckResponse> {
    const T = ctx.tenantId; const s = await this.scope(ctx);
    type C = AhCheckResponse['checks'][number];
    const checks: C[] = [];
    const total = N((await sql<Row>`select count(*)::int as n from ${this.rows(T, s)} r`.execute(this.db)).rows[0]?.n);
    checks.push({ key: 'appointments_readable', state: 'READY', count: total });
    const noLog = N((await sql<Row>`select count(*)::int as n from pos_tech_appointments a where a.tenant_id = ${T} and a.status <> 'booked'
        and not exists (select 1 from appointment_change_log l where l.tenant_id = a.tenant_id and l.appointment_id = a.id)
        ${s.branchIds ? sql`and a.branch_id = any(${s.branchIds}::uuid[])` : sql``}`.execute(this.db)).rows[0]?.n);
    checks.push({ key: 'lifecycle_history', state: noLog ? 'WARNING' : 'READY', count: noLog });
    const orphan = N((await sql<Row>`select count(*)::int as n from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id is not null
        and not exists (select 1 from customers c where c.id = a.customer_id and c.tenant_id = a.tenant_id)`.execute(this.db)).rows[0]?.n);
    checks.push({ key: 'customer_links', state: orphan ? 'WARNING' : 'READY', count: orphan });
    const stale = N((await sql<Row>`select count(*)::int as n from ${this.rows(T, s)} r where r.status = any(${OPEN}::text[]) and r.appt_date < ${(await this.ret.window(ctx, { preset: 'today' })).today}::date`.execute(this.db)).rows[0]?.n);
    checks.push({ key: 'past_open_appointments', state: stale ? 'WARNING' : 'READY', count: stale });
    // extras arc (Nov 10 2026): an upcoming booking whose deposit failed — the customer may arrive expecting a held slot
    const depFail = N((await sql<Row>`select count(*)::int as n from pos_tech_appointments a where a.tenant_id = ${T} and a.status in ('booked', 'confirmed') and a.deposit_status = 'failed'
        and a.appt_date >= ${(await this.ret.window(ctx, { preset: 'today' })).today}::date
        ${s.branchIds ? sql`and a.branch_id = any(${s.branchIds}::uuid[])` : sql``}`.execute(this.db)).rows[0]?.n);
    checks.push({ key: 'deposit_failed_upcoming', state: depFail ? 'WARNING' : 'READY', count: depFail });
    // extras (Appointment History 02 "Booking-to-History Accuracy Monitor"): History reads Booking's own rows live (no copy, no
    // cache, no worker — so nothing can go stale between them); what CAN drift is named here, read-only:
    //   inactive_technician an upcoming open booking whose technician (not "first available") is archived or inactive — the
    //                       technician link itself is a foreign key, so a missing technician cannot happen and is not checked
    //   status_log_mismatch a booking whose current status differs from the last status its lifecycle log recorded
    const BR = s.branchIds ? sql`and a.branch_id = any(${s.branchIds}::uuid[])` : sql``;
    const today = (await this.ret.window(ctx, { preset: 'today' })).today;
    const offTech = N((await sql<Row>`select count(*)::int as n from pos_tech_appointments a join technicians te on te.id = a.technician_id and te.tenant_id = a.tenant_id
        where a.tenant_id = ${T} and coalesce(a.any_technician, false) = false and a.status = any(${OPEN}::text[]) and a.appt_date >= ${today}::date
          and (te.archived_at is not null or te.is_active = false) ${BR}`.execute(this.db)).rows[0]?.n);
    checks.push({ key: 'inactive_technician', state: offTech ? 'WARNING' : 'READY', count: offTech });
    const drift = N((await sql<Row>`select count(*)::int as n from pos_tech_appointments a
        join lateral (select l.new_value from appointment_change_log l where l.tenant_id = a.tenant_id and l.appointment_id = a.id
          and (l.change_type = 'status_changed' or l.change_type = 'cancelled') and l.new_value is not null order by l.created_at desc, l.id desc limit 1) last on true
        where a.tenant_id = ${T} and last.new_value <> a.status ${BR}`.execute(this.db)).rows[0]?.n);
    checks.push({ key: 'status_log_mismatch', state: drift ? 'WARNING' : 'READY', count: drift });
    checks.push({ key: 'no_side_effects', state: 'READY' });
    const overall = checks.some((c) => c.state === 'FAILED') ? 'FAILED' : checks.some((c) => c.state === 'WARNING') ? 'WARNING' : 'READY';
    return { overall, checkedAt: new Date(this.now()).toISOString(), checks };
  }
}
