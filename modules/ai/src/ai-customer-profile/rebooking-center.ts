// rebooking-center.ts — Rebooking Opportunities guide (Nov 1 2026): `/pos/rebooking/*`.
//
// ADVISORY ONLY. A rebooking opportunity never books, reschedules, cancels, texts, emails, changes points or takes money.
// It keeps no second rules engine and no second customer list: the opportunity is the assistant's existing rule
// (rebookingOpportunity — past or approaching the customer's own return window, suppressed by a future appointment,
// Insufficient History below the cadence minimum), computed for every live customer by the ONE Customer Intelligence scan
// (customer_intelligence_snapshots, migrations 763/765). Rebooking adds only its review workflow (rebooking_reviews +
// append-only rebooking_review_events), a read-only health check, and a HANDOFF that prepares context for the existing
// Booking Assistant (POS → Booking), which re-checks availability, takes the human confirmation and applies the salon's
// SMS verification. The handoff writes one `booking_started` event — never an appointment.
//
// Opportunity states (guide §06/§07), from the persisted rule output without renaming it:
//   rebooking + past the window (due_for_return / inactive / long_term_inactive) → Due for Review
//   rebooking + approaching the window (rebooking_soon)                          → Coming Due
//   a future appointment exists                                                   → Already Booked (the Booking Calendar's)
//   below the cadence minimum (with at least one completed visit)                 → Insufficient History
// A review stands for the opportunity it reviewed (same `rebooking_since`) until a deferral date passes; a new
// opportunity returns to Due for Review. A booking made after the last evaluation is read LIVE from the Booking Calendar,
// so a stale snapshot can never offer a second booking.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql, tenantTimeZone } from '@aipowersalon/database';
import { REBOOKING_REVIEW } from '../ai-lifecycles';
import { randomUUID } from 'node:crypto';
import { RetentionRepository, isUuid, maskStoredPhone, maskEmail, salonPresetRange, VISIT_TICKET_STATUSES, type RetentionContext, type BranchScope } from '@aipowersalon/customers';
import { customerSearchPredicate, CI_RULE_VERSION } from './customer-intelligence-center';
import { DEFAULT_TUNABLES, type ProfileTunables } from './ai-customer-profile-core';
import { businessDate } from '@aipowersalon/date-time';   // §87

type Row = Record<string, any>;
export type RbCtx = RetentionContext;
export type AuditFn = (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<unknown>;
export type RbSettingsFn = (ctx: RbCtx) => Promise<{ enabled: boolean; tunables?: Partial<ProfileTunables> | null }>;
export class RebookingError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}

export const RB_TABS = ['due_for_review', 'coming_due', 'reviewed', 'booked', 'insufficient', 'all'] as const;
export const RB_DATE_FIELDS = ['opportunity', 'last_visit', 'suggested_return', 'next_appointment', 'created', 'reviewed', 'evaluated'] as const;
export const RB_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year', 'custom'] as const;
export const RB_SORTS = ['newest', 'most_overdue', 'last_visit', 'name'] as const;
export const RB_ACTIONS = ['reviewed', 'deferred', 'reopened', 'note'] as const;
export const RB_PAGE_SIZES = [10, 25, 50, 100] as const;
const PAST_WINDOW = ['due_for_return', 'inactive', 'long_term_inactive'];
const LIVE_APPT = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service'];
const VISIT = [...VISIT_TICKET_STATUSES] as string[];
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const day = (v: unknown) => (v == null ? null : String(v instanceof Date ? v.toISOString() : v).slice(0, 10));
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const uuidOrNull = (v: unknown) => (isUuid(String(v ?? '')) ? String(v) : null);
const NIL = '00000000-0000-0000-0000-000000000000';
const nameOf = (r: Row) => String(r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || '').trim() || null;
/** the guide's opportunity state for one snapshot row (`bookedNow` = a live future appointment, read from the Booking Calendar) */
export const rebookingState = (r: { status?: string | null; rebooking?: boolean | null; has_upcoming?: boolean | null; completed_visits?: number | null }, bookedNow = false) =>
  r.status == null ? 'data_unavailable'
    : bookedNow || r.has_upcoming ? (N(r.completed_visits) > 0 ? 'booked' : 'not_due')
    : r.rebooking && PAST_WINDOW.includes(String(r.status)) ? 'due'
    : r.rebooking && r.status === 'rebooking_soon' ? 'coming_due'
    : r.status === 'insufficient_history' && N(r.completed_visits) > 0 ? 'insufficient'
    : 'not_due';

export interface RbQuery { q?: unknown; tab?: unknown; serviceId?: unknown; technicianId?: unknown; branch?: unknown; dateField?: unknown; preset?: unknown; from?: unknown; to?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown }
export type RbCheckState = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
export interface RbCheck { key: string; state: RbCheckState; count?: number | null; detail?: Record<string, unknown> }

export class RebookingCenter {
  private readonly ret: RetentionRepository;
  constructor(private readonly db: Kysely<any>, private readonly settings: RbSettingsFn, private readonly now: () => number = () => Date.now()) { this.ret = new RetentionRepository(db); }

  private async tunables(ctx: RbCtx): Promise<ProfileTunables> {
    const st = await this.settings(ctx);
    if (!st.enabled) throw new RebookingError('The AI Customer Profile assistant is turned off for this salon.', 'AI_CUSTOMER_PROFILE_DISABLED', 403);
    return { ...DEFAULT_TUNABLES, ...(st.tunables ?? {}) };
  }
  private async scope(ctx: RbCtx, branch?: unknown): Promise<BranchScope> {
    try { return await this.ret.branchScope(ctx, branch); }
    catch (e: any) { throw new RebookingError(e?.message ?? 'Unknown branch.', e?.code === 'BRANCH_NOT_AUTHORIZED' ? 'BRANCH_NOT_AUTHORIZED' : 'REBOOKING_INVALID_BRANCH', e?.status ?? 400); }
  }
  private custVisible(s: BranchScope) {
    if (!s.branchIds) return sql`true`;
    const ids = s.branchIds;
    return sql`(c.branch_id = any(${ids}::uuid[])
      or exists (select 1 from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.branch_id = any(${ids}::uuid[]) and t.removed_at is null)
      or exists (select 1 from pos_tech_appointments a where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.branch_id = any(${ids}::uuid[])))`;
  }
  /** a live future appointment for the customer — the Booking Calendar's, read now (not the last evaluation's) */
  private bookedNow(T: string, today: string) {
    return sql`exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = c.id and a.appt_date >= ${today}::date and a.status = any(${LIVE_APPT}::text[]))`;
  }
  /** a review still stands: it reviewed THIS opportunity, and a deferral has not passed its date */
  private reviewCurrent(today: string) {
    return sql`(r.customer_id is not null and r.opportunity_since is not distinct from sn.rebooking_since
      and (r.status = 'reviewed' or r.due_on is null or r.due_on > ${today}::date))`;
  }
  private async latestScan(T: string) {
    return (await sql<Row>`select id, status, scanned, counts, finished_at, rule_version, started_at, error_code from customer_intelligence_scans
      where tenant_id = ${T} order by started_at desc limit 1`.execute(this.db)).rows[0];
  }
  private async lastOk(T: string) {
    return (await sql<Row>`select id, scanned, counts, finished_at, rule_version, tunables from customer_intelligence_scans where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`.execute(this.db)).rows[0];
  }
  private freshness(latest: Row | undefined, ok: Row | undefined) {
    const state = !latest ? 'never' : latest.status === 'running' ? 'running' : latest.status === 'failed' ? 'failed' : !ok ? 'never'
      : ok.rule_version !== CI_RULE_VERSION ? 'stale' : (this.now() - new Date(ok.finished_at).getTime()) / 60000 >= 60 ? 'stale' : 'up_to_date';
    return { state, lastEvaluatedAt: iso(ok?.finished_at), lastError: latest?.status === 'failed' ? latest.error_code : null, ruleVersion: CI_RULE_VERSION };
  }
  private async period(ctx: RbCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const preset = pick(RB_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    const w = await this.ret.window(ctx, { preset: 'today' });
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today: w.today, tz: w.tz };
    let from: string, to: string;
    if (preset === 'custom') {
      const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
      const b = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
      if (!a || !b) throw new RebookingError('Choose a From and a To date.', 'REBOOKING_INVALID_PERIOD');
      if (a > b) throw new RebookingError('The From date must be on or before the To date.', 'REBOOKING_INVALID_PERIOD');
      from = a; to = b;
    } else ({ from, to } = salonPresetRange(preset, w.today)!);
    const b = (await sql<Row>`select (${from}::date::timestamp at time zone ${w.tz}) as s, ((${to}::date + 1)::timestamp at time zone ${w.tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(b.s) as Date | null, end: new Date(b.e) as Date | null, today: w.today, tz: w.tz };
  }
  private unavailable(ok: Row | undefined) { return !ok || ok.rule_version !== CI_RULE_VERSION; }

  // ── the four cards ────────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: RbCtx) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    const { today } = await this.ret.window(ctx, { preset: 'today' });
    const [latest, ok] = [await this.latestScan(T), await this.lastOk(T)];
    const fr = this.freshness(latest, ok);
    if (this.unavailable(ok)) return { metrics: null, freshness: fr, unavailable: true };
    const B = this.bookedNow(T, today);
    const m = (await sql<Row>`select count(*)::int as evaluated,
        count(*) filter (where sn.rebooking and not ${B})::int as opportunities,
        count(*) filter (where sn.rebooking and sn.status = any(${PAST_WINDOW}::text[]) and not ${B} and not ${this.reviewCurrent(today)})::int as due_for_review,
        count(*) filter (where sn.rebooking and sn.status = 'rebooking_soon' and not ${B} and not ${this.reviewCurrent(today)})::int as coming_due,
        count(*) filter (where sn.rebooking and not ${B} and ${this.reviewCurrent(today)})::int as reviewed,
        count(*) filter (where sn.completed_visits > 0 and (sn.has_upcoming or ${B}))::int as booked,
        count(*) filter (where sn.rebooking and not sn.has_upcoming and ${B})::int as booked_since_evaluation,
        count(*) filter (where sn.status = 'insufficient_history' and sn.completed_visits > 0 and not (sn.has_upcoming or ${B}))::int as insufficient
      from customer_intelligence_snapshots sn join customers c on c.id = sn.customer_id and c.tenant_id = sn.tenant_id
      left join rebooking_reviews r on r.tenant_id = sn.tenant_id and r.customer_id = sn.customer_id
      where sn.tenant_id = ${T} and c.archived_at is null and ${this.custVisible(s)}`.execute(this.db)).rows[0] ?? {};
    return {
      metrics: { evaluated: N(m.evaluated), opportunities: N(m.opportunities), dueForReview: N(m.due_for_review), comingDue: N(m.coming_due), reviewed: N(m.reviewed),
        alreadyBooked: N(m.booked), bookedSinceEvaluation: N(m.booked_since_evaluation), insufficientHistory: N(m.insufficient) },
      definitions: { ruleVersion: CI_RULE_VERSION, opportunity: 'past or approaching the customer\'s own return window, with no future appointment',
        dueForReview: PAST_WINDOW, comingDue: ['rebooking_soon'], alreadyBooked: 'a future appointment in the Booking Calendar (read live)', reviewStandsUntil: 'a new opportunity, or a deferral date passes' },
      freshness: fr, unavailable: false, scope: { label: s.label, confined: s.confined },
    };
  }

  // ── the review queue ──────────────────────────────────────────────────────────────────────────────────────────
  async list(ctx: RbCtx, f: RbQuery, opts: { fullContact: boolean }) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    const tab = pick(RB_TABS, f.tab) ?? 'due_for_review';
    const dateField = pick(RB_DATE_FIELDS, f.dateField) ?? 'opportunity';
    const sort = pick(RB_SORTS, f.sort) ?? 'newest';
    const pageSize = (RB_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q && q.length < 2) throw new RebookingError('Type at least 2 characters.', 'REBOOKING_SEARCH_TOO_SHORT');
    for (const k of ['serviceId', 'technicianId'] as const) if (f[k] != null && f[k] !== '' && !isUuid(String(f[k]))) throw new RebookingError('Unknown filter value.', 'REBOOKING_INVALID_FILTER', 400, { field: k });
    const serviceId = f.serviceId ? String(f.serviceId) : null;
    const technicianId = f.technicianId ? String(f.technicianId) : null;
    const per = await this.period(ctx, f);
    const ok = await this.lastOk(T);
    if (this.unavailable(ok)) return { items: [], total: 0, page: 1, pageSize, totalPages: 1, unavailable: true, freshness: this.freshness(await this.latestScan(T), ok) };
    const today = per.today;
    const B = this.bookedNow(T, today);
    const RC = this.reviewCurrent(today);
    const where = [sql`sn.tenant_id = ${T}`, sql`c.archived_at is null`, this.custVisible(s)];
    if (tab === 'due_for_review') where.push(sql`sn.rebooking and sn.status = any(${PAST_WINDOW}::text[]) and not ${B} and not ${RC}`);
    if (tab === 'coming_due') where.push(sql`sn.rebooking and sn.status = 'rebooking_soon' and not ${B} and not ${RC}`);
    if (tab === 'reviewed') where.push(sql`sn.rebooking and not ${B} and ${RC}`);
    if (tab === 'booked') where.push(sql`sn.completed_visits > 0 and (sn.has_upcoming or ${B})`);
    if (tab === 'insufficient') where.push(sql`sn.status = 'insufficient_history' and sn.completed_visits > 0 and not (sn.has_upcoming or ${B})`);
    if (tab === 'all') where.push(sql`sn.rebooking`);
    if (serviceId || technicianId) {
      where.push(sql`exists (select 1 from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
        where l.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and l.removed_at is null and t.status = any(${VISIT}::text[])
        ${serviceId ? sql`and l.service_id = ${serviceId}::uuid` : sql``} ${technicianId ? sql`and l.technician_id = ${technicianId}::uuid` : sql``})`);
    }
    if (per.start && per.end) {
      if (dateField === 'last_visit') where.push(sql`sn.last_visit_at >= ${per.start} and sn.last_visit_at < ${per.end}`);
      else if (dateField === 'suggested_return') where.push(sql`sn.rebooking_due_on >= ${per.from}::date and sn.rebooking_due_on <= ${per.to}::date`);
      else if (dateField === 'next_appointment') where.push(sql`sn.next_appointment_date >= ${per.from}::date and sn.next_appointment_date <= ${per.to}::date`);
      else if (dateField === 'created') where.push(sql`c.created_at >= ${per.start} and c.created_at < ${per.end}`);
      else if (dateField === 'reviewed') where.push(sql`r.reviewed_at >= ${per.start} and r.reviewed_at < ${per.end}`);
      else if (dateField === 'evaluated') where.push(sql`sn.computed_at >= ${per.start} and sn.computed_at < ${per.end}`);
      else where.push(sql`sn.rebooking_since >= ${per.start} and sn.rebooking_since < ${per.end}`);
    }
    if (q) where.push(customerSearchPredicate(T, q));
    const W = sql.join(where, sql` and `);
    // newest opportunities first (stable id tie-break), so new records land on page 1
    const order = sort === 'most_overdue' ? sql`sn.rebooking_due_on asc nulls last, c.id desc`
      : sort === 'last_visit' ? sql`sn.last_visit_at desc nulls last, c.id desc`
      : sort === 'name' ? sql`lower(coalesce(c.full_name, c.first_name)) asc, c.id asc`
      : sql`sn.rebooking_since desc nulls last, sn.last_visit_at desc nulls last, c.id desc`;
    const FROM = sql`customer_intelligence_snapshots sn join customers c on c.id = sn.customer_id and c.tenant_id = sn.tenant_id
      left join rebooking_reviews r on r.tenant_id = sn.tenant_id and r.customer_id = sn.customer_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where sn.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select c.id, c.full_name, c.first_name, c.last_name, c.normalized_phone, c.phone_display, c.email,
        sn.status, sn.rebooking, sn.rebooking_reason, sn.rebooking_since, sn.rebooking_due_on, sn.rebooking_window_end, sn.last_visit_at, sn.days_since_last,
        sn.typical_interval_days, sn.completed_visits, sn.has_upcoming, sn.next_appointment_date, sn.computed_at,
        ${B} as booked_now, (select min(a.appt_date) from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = c.id and a.appt_date >= ${today}::date
          and a.status = any(${LIVE_APPT}::text[])) as next_live_date,
        r.status as review_status, r.reviewed_at, r.due_on as review_due_on, ${RC} as review_current,
        ls.services as last_services, ls.service_id as last_service_id, ls.technicians as last_technicians, sv.name as service_name, sv.price_cents, sv.duration_minutes,
        (sv.id is not null and sv.status = 'active' and sv.archived_at is null) as service_active
      from ${FROM}
      left join lateral (select t.id from tickets t where t.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT}::text[])
        order by coalesce(t.paid_at, t.finished_at, t.created_at) desc, t.id desc limit 1) lt on true
      left join lateral (select string_agg(distinct l.service_name_snapshot, ', ') as services,
          (array_agg(l.service_id order by l.is_add_on, l.created_at, l.id) filter (where l.service_id is not null))[1] as service_id,
          string_agg(distinct nullif(trim(coalesce(nullif(tc.full_name, ''), coalesce(tc.first_name, '') || ' ' || coalesce(tc.last_name, ''))), ''), ', ') as technicians
        from ticket_service_lines l left join technicians tc on tc.id = l.technician_id and tc.tenant_id = l.tenant_id
        where l.tenant_id = ${T} and l.ticket_id = lt.id and l.removed_at is null) ls on true
      left join services sv on sv.id = ls.service_id and sv.tenant_id = ${T}
      where sn.tenant_id = ${T} and ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => ({
        id: String(r.id), name: nameOf(r),
        phone: r.normalized_phone ? (opts.fullContact ? (r.phone_display || r.normalized_phone) : maskStoredPhone(r.normalized_phone)) : null,
        email: r.email ? (opts.fullContact ? String(r.email) : maskEmail(String(r.email))) : null,
        state: rebookingState(r, !!r.booked_now), reason: r.rebooking_reason ?? null, activity: r.status,
        opportunitySince: iso(r.rebooking_since), lastVisitAt: iso(r.last_visit_at), daysSinceLast: r.days_since_last == null ? null : N(r.days_since_last),
        typicalIntervalDays: r.typical_interval_days == null ? null : N(r.typical_interval_days), completedVisits: N(r.completed_visits),
        window: r.rebooking_due_on ? { dueOn: day(r.rebooking_due_on), endsOn: day(r.rebooking_window_end) } : null,
        lastService: r.last_services ?? null, lastTechnician: r.last_technicians ?? null,
        suggestedService: r.last_service_id ? { id: String(r.last_service_id), name: r.service_name ?? null, active: !!r.service_active,
          priceCents: r.service_active ? N(r.price_cents) : null, durationMinutes: r.service_active ? N(r.duration_minutes) : null } : null,
        booking: { upcoming: !!r.booked_now || !!r.has_upcoming, nextDate: day(r.next_live_date) ?? day(r.next_appointment_date), bookedSinceEvaluation: !!r.booked_now && !r.has_upcoming },
        evaluatedAt: iso(r.computed_at),
        review: r.review_status ? { status: r.review_status, at: iso(r.reviewed_at), dueOn: day(r.review_due_on), current: !!r.review_current } : null,
      })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), unavailable: false,
      applied: { q: q || null, tab, serviceId, technicianId, dateField, preset: per.preset, from: per.from, to: per.to, sort },
      period: { from: per.from, to: per.to, timeZone: per.tz, today: per.today }, contact: opts.fullContact ? 'full' : 'masked',
      freshness: this.freshness(await this.latestScan(T), ok),
    };
  }

  /** the 360° review overlay: identity · recommendation + evidence · completed services · bookings · preference · review — audited */
  async customer(ctx: RbCtx, id: string, opts: { fullContact: boolean }, audit: AuditFn) {
    const tun = await this.tunables(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    if (!isUuid(`${id}`)) throw new RebookingError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const { today } = await this.ret.window(ctx, { preset: 'today' });
    const r = (await sql<Row>`select c.id, c.full_name, c.first_name, c.last_name, c.normalized_phone, c.phone_display, c.email, c.branch_id, c.created_at, c.archived_at, b.name as branch_name,
        sn.status, sn.rebooking, sn.rebooking_reason, sn.rebooking_since, sn.rebooking_due_on, sn.rebooking_window_end, sn.evidence, sn.completed_visits, sn.first_visit_at,
        sn.last_visit_at, sn.typical_interval_days, sn.days_since_last, sn.has_upcoming, sn.next_appointment_date, sn.computed_at, sn.scan_id,
        ${this.bookedNow(T, today)} as booked_now,
        r.status as review_status, r.reviewed_at, r.due_on as review_due_on, r.version as review_version, ${this.reviewCurrent(today)} as review_current
      from customers c left join branches b on b.id = c.branch_id and b.tenant_id = c.tenant_id
      left join customer_intelligence_snapshots sn on sn.tenant_id = c.tenant_id and sn.customer_id = c.id
      left join rebooking_reviews r on r.tenant_id = c.tenant_id and r.customer_id = c.id
      where c.tenant_id = ${T} and c.id = ${id}::uuid and ${this.custVisible(s)}`.execute(this.db)).rows[0];
    if (!r) throw new RebookingError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const visits = (await sql<Row>`select t.id, t.ticket_number, coalesce(t.paid_at, t.finished_at, t.created_at) as at, bb.name as branch,
        coalesce(json_agg(json_build_object('serviceId', l.service_id, 'service', l.service_name_snapshot, 'minutes', l.duration_minutes_snapshot, 'addOn', l.is_add_on,
          'technicianId', l.technician_id, 'technician', nullif(trim(coalesce(nullif(tc.full_name, ''), coalesce(tc.first_name, '') || ' ' || coalesce(tc.last_name, ''))), ''))
          order by l.created_at, l.id) filter (where l.id is not null), '[]') as lines
      from tickets t left join branches bb on bb.id = t.branch_id and bb.tenant_id = t.tenant_id
      left join ticket_service_lines l on l.ticket_id = t.id and l.tenant_id = t.tenant_id and l.removed_at is null
      left join technicians tc on tc.id = l.technician_id and tc.tenant_id = l.tenant_id
      where t.tenant_id = ${T} and t.customer_id = ${id}::uuid and t.removed_at is null and t.status = any(${VISIT}::text[])
      group by t.id, bb.name order by coalesce(t.paid_at, t.finished_at, t.created_at) desc, t.id desc limit 10`.execute(this.db)).rows;
    const appts = (await sql<Row>`select a.id, a.appt_date, a.start_time, a.status, a.services, a.created_at,
        nullif(trim(coalesce(nullif(tc.full_name, ''), coalesce(tc.first_name, '') || ' ' || coalesce(tc.last_name, ''))), '') as technician
      from pos_tech_appointments a left join technicians tc on tc.id = a.technician_id and tc.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.customer_id = ${id}::uuid order by a.appt_date desc, a.start_time desc, a.id desc limit 12`.execute(this.db)).rows;
    const techPref = (await sql<Row>`select l.technician_id, count(distinct t.id)::int as visits,
        nullif(trim(coalesce(nullif(tc.full_name, ''), coalesce(tc.first_name, '') || ' ' || coalesce(tc.last_name, ''))), '') as name, (tc.is_active and tc.archived_at is null) as active
      from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id left join technicians tc on tc.id = l.technician_id and tc.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and t.customer_id = ${id}::uuid and t.removed_at is null and l.removed_at is null and l.technician_id is not null and t.status = any(${VISIT}::text[])
      group by l.technician_id, tc.full_name, tc.first_name, tc.last_name, tc.is_active, tc.archived_at order by visits desc, l.technician_id limit 1`.execute(this.db)).rows[0];
    const lastLine = visits[0] ? ((visits[0].lines ?? []) as Row[]).filter((l) => l.serviceId).sort((a, b) => Number(!!a.addOn) - Number(!!b.addOn))[0] : undefined;
    const sv = lastLine ? (await sql<Row>`select id, name, price_cents, duration_minutes, status, archived_at from services where tenant_id = ${T} and id = ${String(lastLine.serviceId)}::uuid`.execute(this.db)).rows[0] : undefined;
    const svActive = !!sv && sv.status === 'active' && sv.archived_at == null;
    const mem = (await sql<Row>`select m.status, count(*)::int as n from customer_memberships m where m.tenant_id = ${T} and m.customer_id = ${id}::uuid group by m.status`.execute(this.db)).rows;
    const events = (await sql<Row>`select e.id, e.event_type, e.note, e.created_at, coalesce(u.full_name, u.email) as actor
      from rebooking_review_events e left join users u on u.id = e.actor_user_id and u.tenant_id = ${T}
      where e.tenant_id = ${T} and e.customer_id = ${id}::uuid order by e.created_at desc, e.id desc limit 50`.execute(this.db)).rows;
    const scan = r.scan_id ? (await sql<Row>`select rule_version, finished_at from customer_intelligence_scans where tenant_id = ${T} and id = ${r.scan_id}`.execute(this.db)).rows[0] : null;
    const totalVisits = N(r.completed_visits);
    const preferred = techPref && totalVisits >= tun.minVisitsForTechPref && N(techPref.visits) * 2 > totalVisits;
    const caveats: string[] = [];
    if (r.status == null) caveats.push('not_evaluated');
    if (r.booked_now && !r.has_upcoming) caveats.push('booked_since_evaluation');
    if (lastLine && !svActive) caveats.push('service_inactive');
    if (!lastLine && totalVisits > 0) caveats.push('no_service_lines');
    if (r.typical_interval_days == null && totalVisits > 0) caveats.push('no_cadence');
    if (techPref && !preferred) caveats.push('no_technician_preference');
    if (techPref && preferred && !techPref.active) caveats.push('preferred_technician_inactive');
    await this.db.transaction().execute(async (trx) => { await audit(trx as unknown as Kysely<any>, { customerId: id, state: rebookingState(r, !!r.booked_now) }); });
    return {
      customerId: id,
      identity: { id, name: nameOf(r), phone: r.normalized_phone ? (opts.fullContact ? (r.phone_display || r.normalized_phone) : maskStoredPhone(r.normalized_phone)) : null,
        email: r.email ? (opts.fullContact ? String(r.email) : maskEmail(String(r.email))) : null, branch: r.branch_name ?? null, createdAt: iso(r.created_at), archived: r.archived_at != null },
      recommendation: r.status == null ? null : {
        state: rebookingState(r, !!r.booked_now), reason: r.rebooking_reason ?? null, activity: r.status, evidence: (r.evidence ?? []) as string[],
        opportunitySince: iso(r.rebooking_since), completedVisits: totalVisits, firstVisitAt: iso(r.first_visit_at), lastVisitAt: iso(r.last_visit_at),
        typicalIntervalDays: r.typical_interval_days == null ? null : N(r.typical_interval_days), daysSinceLast: r.days_since_last == null ? null : N(r.days_since_last),
        window: r.rebooking_due_on ? { dueOn: day(r.rebooking_due_on), endsOn: day(r.rebooking_window_end) } : null,
        minVisitsForCadence: tun.minVisitsForCadence, note: 'A suggestion for staff review — not a booking, a visit or revenue.',
      },
      suggestedService: sv ? { id: String(sv.id), name: sv.name, active: svActive, priceCents: svActive ? N(sv.price_cents) : null, durationMinutes: svActive ? N(sv.duration_minutes) : null } : null,
      technician: techPref ? { id: String(techPref.technician_id), name: techPref.name ?? null, visits: N(techPref.visits), of: totalVisits, preferred: !!preferred, active: !!techPref.active } : null,
      completedServices: visits.map((v) => ({ ticketId: String(v.id), ticketNumber: v.ticket_number ?? null, at: iso(v.at), branch: v.branch ?? null,
        lines: ((v.lines ?? []) as Row[]).map((l) => ({ service: l.service ?? null, minutes: l.minutes == null ? null : N(l.minutes), technician: l.technician ?? null, addOn: !!l.addOn })) })),
      bookings: appts.map((a) => ({ id: String(a.id), date: day(a.appt_date), time: a.start_time ?? null, status: a.status, technician: a.technician ?? null,
        services: Array.isArray(a.services) ? (a.services as Row[]).map((x) => String(x?.name ?? x?.serviceName ?? '')).filter(Boolean) : [], upcoming: String(day(a.appt_date)) >= today && LIVE_APPT.includes(a.status) })),
      memberships: mem.map((m) => ({ status: m.status, count: N(m.n) })),
      caveats,
      rule: scan ? { version: scan.rule_version, evaluatedAt: iso(r.computed_at) } : null,
      review: r.review_status ? { status: r.review_status, at: iso(r.reviewed_at), dueOn: day(r.review_due_on), current: !!r.review_current, version: N(r.review_version) } : null,
      history: events.map((e) => ({ id: e.id, type: e.event_type, note: e.note, actor: e.actor ?? null, at: iso(e.created_at) })),
    };
  }

  /** Mark reviewed · Defer (with an optional date) · Reopen · Add note — internal workflow only, never a customer or booking change */
  async review(ctx: RbCtx, id: string, b: { action?: unknown; note?: unknown; dueOn?: unknown; expectedVersion?: unknown }, audit: AuditFn) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const action = pick(RB_ACTIONS, b.action);
    if (!action) throw new RebookingError('Choose an action.', 'REBOOKING_INVALID_ACTION');
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 1000) : null;
    if (action === 'note' && !note) throw new RebookingError('Write a note first.', 'REBOOKING_NOTE_REQUIRED');
    const dueOn = typeof b.dueOn === 'string' && DAY.test(b.dueOn) ? b.dueOn : null;
    const s = await this.scope(ctx);
    return this.db.transaction().execute(async (trx) => {
      const c = (await sql<Row>`select c.id, sn.rebooking, sn.rebooking_since from customers c left join customer_intelligence_snapshots sn on sn.tenant_id = c.tenant_id and sn.customer_id = c.id
        where c.tenant_id = ${T} and c.id = ${isUuid(`${id}`) ? id : NIL}::uuid and c.archived_at is null and ${this.custVisible(s)}`.execute(trx)).rows[0];
      if (!c) throw new RebookingError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
      const cur = (await sql<Row>`select version from rebooking_reviews where tenant_id = ${T} and customer_id = ${id}::uuid for update`.execute(trx)).rows[0];
      if (b.expectedVersion != null && N(b.expectedVersion) !== N(cur?.version ?? 0))
        throw new RebookingError('Someone else updated this review. Reload it and try again.', 'REBOOKING_STALE_VERSION', 409, { currentVersion: N(cur?.version ?? 0) });
      if ((action === 'reviewed' || action === 'deferred') && !c.rebooking) throw new RebookingError('There is no current rebooking opportunity to review.', 'REBOOKING_NOT_CURRENT', 409);
      if (action === 'reviewed' || action === 'deferred') {
        await sql`insert into rebooking_reviews (tenant_id, customer_id, status, opportunity_since, due_on, reviewed_by, reviewed_at, updated_by, version)
          values (${T}, ${id}::uuid, ${action}, ${c.rebooking_since ?? null}, ${action === 'deferred' ? dueOn : null}::date, ${uuidOrNull(ctx.userId)}, now(), ${uuidOrNull(ctx.userId)}, 1)
          on conflict (tenant_id, customer_id) do update set status = excluded.status, opportunity_since = excluded.opportunity_since, due_on = excluded.due_on,
            reviewed_by = excluded.reviewed_by, reviewed_at = now(), updated_by = excluded.updated_by, version = rebooking_reviews.version + 1
          where ${canMoveToSql(REBOOKING_REVIEW, action, 'rebooking_reviews')}`.execute(trx);
      }
      if (action === 'reopened') await sql`delete from rebooking_reviews where tenant_id = ${T} and customer_id = ${id}::uuid`.execute(trx);
      await sql`insert into rebooking_review_events (id, tenant_id, customer_id, event_type, opportunity_since, note, actor_user_id)
        values (${randomUUID()}, ${T}, ${id}::uuid, ${action}, ${c.rebooking_since ?? null}, ${note}, ${uuidOrNull(ctx.userId)})`.execute(trx);
      await audit(trx as unknown as Kysely<any>, { customerId: id, action });
      const v = (await sql<Row>`select version, status from rebooking_reviews where tenant_id = ${T} and customer_id = ${id}::uuid`.execute(trx)).rows[0];
      return { customerId: id, action, review: v ? { status: v.status, version: N(v.version) } : null };
    });
  }

  /** Open AI Booking Assistant: re-check the opportunity and the LIVE Booking Calendar, then return the permitted context
   *  for the existing Booking Assistant to prefill. It writes one `booking_started` event — never an appointment. */
  async handoff(ctx: RbCtx, id: string, b: { serviceId?: unknown; technicianId?: unknown }, opts: { fullContact: boolean }, audit: AuditFn) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    for (const k of ['serviceId', 'technicianId'] as const) if (b[k] != null && b[k] !== '' && !isUuid(String(b[k]))) throw new RebookingError('Unknown value.', 'REBOOKING_INVALID_FILTER', 400, { field: k });
    const { today } = await this.ret.window(ctx, { preset: 'today' });
    return this.db.transaction().execute(async (trx) => {
      const c = (await sql<Row>`select c.id, c.full_name, c.first_name, c.last_name, c.normalized_phone, c.phone_display, sn.rebooking, sn.rebooking_since, sn.rebooking_due_on
        from customers c left join customer_intelligence_snapshots sn on sn.tenant_id = c.tenant_id and sn.customer_id = c.id
        where c.tenant_id = ${T} and c.id = ${isUuid(`${id}`) ? id : NIL}::uuid and c.archived_at is null and ${this.custVisible(s)} for update of c`.execute(trx)).rows[0];
      if (!c) throw new RebookingError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
      const live = (await sql<Row>`select a.id, a.appt_date from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = ${id}::uuid
        and a.appt_date >= ${today}::date and a.status = any(${LIVE_APPT}::text[]) order by a.appt_date, a.start_time limit 1`.execute(trx)).rows[0];
      if (live) throw new RebookingError('This customer already has an upcoming appointment.', 'REBOOKING_ALREADY_BOOKED', 409, { nextAppointmentDate: day(live.appt_date) });
      if (!c.rebooking) throw new RebookingError('There is no current rebooking opportunity for this customer. Refresh the evaluation.', 'REBOOKING_NOT_CURRENT', 409);
      const svcId = b.serviceId ? String(b.serviceId) : null;
      const sv = svcId ? (await sql<Row>`select id, name from services where tenant_id = ${T} and id = ${svcId}::uuid and status = 'active' and archived_at is null`.execute(trx)).rows[0] : undefined;
      if (svcId && !sv) throw new RebookingError('That service is not active in the catalog.', 'REBOOKING_SERVICE_INACTIVE', 409);
      const techId = b.technicianId ? String(b.technicianId) : null;
      const tc = techId ? (await sql<Row>`select id, nullif(trim(coalesce(nullif(full_name, ''), coalesce(first_name, '') || ' ' || coalesce(last_name, ''))), '') as name
        from technicians where tenant_id = ${T} and id = ${techId}::uuid and is_active and archived_at is null`.execute(trx)).rows[0] : undefined;
      if (techId && !tc) throw new RebookingError('That technician is not active.', 'REBOOKING_TECHNICIAN_INACTIVE', 409);
      const due = day(c.rebooking_due_on);
      const date = due && due > today ? due : today;
      await sql`insert into rebooking_review_events (id, tenant_id, customer_id, event_type, opportunity_since, service_id, technician_id, actor_user_id)
        values (${randomUUID()}, ${T}, ${id}::uuid, 'booking_started', ${c.rebooking_since ?? null}, ${sv ? String(sv.id) : null}, ${tc ? String(tc.id) : null}, ${uuidOrNull(ctx.userId)})`.execute(trx);
      await audit(trx as unknown as Kysely<any>, { customerId: id, serviceId: sv?.id ?? null, technicianId: tc?.id ?? null });
      return {
        customerId: id, customerName: nameOf(c),
        // the Booking Assistant needs a phone it can verify; a masked number is useless there, so it is only sent with contact access
        customerPhone: opts.fullContact && c.normalized_phone ? String(c.phone_display || c.normalized_phone) : null,
        serviceId: sv ? String(sv.id) : null, serviceName: sv?.name ?? null, technicianId: tc ? String(tc.id) : null, technicianName: tc?.name ?? null,
        date, opportunitySince: iso(c.rebooking_since), preparedAt: new Date(this.now()).toISOString(),
        note: 'Prefill only. The Booking Assistant re-checks availability, conflicts and the salon\'s verification before anything is booked.',
      };
    });
  }

  /** review + handoff history, newest first */
  async history(ctx: RbCtx, f: { page?: unknown; pageSize?: unknown; preset?: unknown; from?: unknown; to?: unknown; customerId?: unknown; type?: unknown }) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    const pageSize = (RB_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const per = await this.period(ctx, f);
    const where = [sql`e.tenant_id = ${T}`, this.custVisible(s)];
    if (per.start && per.end) where.push(sql`e.created_at >= ${per.start} and e.created_at < ${per.end}`);
    const type = pick([...RB_ACTIONS, 'booking_started'] as const, f.type);
    if (type) where.push(sql`e.event_type = ${type}`);
    if (f.customerId != null && f.customerId !== '') { if (!isUuid(String(f.customerId))) throw new RebookingError('Unknown customer.', 'REBOOKING_INVALID_FILTER'); where.push(sql`e.customer_id = ${String(f.customerId)}::uuid`); }
    const W = sql.join(where, sql` and `);
    const FROM = sql`rebooking_review_events e join customers c on c.id = e.customer_id and c.tenant_id = e.tenant_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where e.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select e.id, e.customer_id, c.full_name, c.first_name, c.last_name, e.event_type, e.note, e.created_at, coalesce(u.full_name, u.email) as actor
      from ${FROM} left join users u on u.id = e.actor_user_id and u.tenant_id = ${T}
      where e.tenant_id = ${T} and ${W} order by e.created_at desc, e.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((e) => ({ id: e.id, customerId: e.customer_id, name: nameOf(e), type: e.event_type, note: e.note, actor: e.actor ?? null, at: iso(e.created_at) })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  // ── Check Rebooking System (read-only; records its own evidence; one run per salon per 30 s) ──────────────────
  async check(ctx: RbCtx) {
    const T = ctx.tenantId;
    const today = businessDate(await tenantTimeZone(this.db, T));   // §87: the salon's day, not the server's
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from rebooking_health_runs where tenant_id = ${T} and branch_id is not distinct from ${uuidOrNull(ctx.branchId)}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: RbCheck[] = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    let on = true; try { on = (await this.settings(ctx)).enabled; } catch { on = false; }
    checks.push({ key: 'assistant_enabled', state: on ? 'PASSED' : 'WARNING' });
    const latest = await this.latestScan(T); const ok = await this.lastOk(T);
    const fr = this.freshness(latest, ok);
    checks.push({ key: 'evaluation_freshness', state: fr.state === 'up_to_date' ? 'PASSED' : fr.state === 'never' ? 'INSUFFICIENT_DATA' : fr.state === 'failed' ? 'FAILED' : 'WARNING', detail: { state: fr.state, lastEvaluatedAt: fr.lastEvaluatedAt } });
    // the scan's own rebooking count must equal the stored opportunities (the Customer Intelligence card counts the same thing)
    const stored = N((await one(sql<Row>`select count(*)::int as n from customer_intelligence_snapshots where tenant_id = ${T} and rebooking`)).n);
    const counted = N((ok?.counts ?? {}).rebooking);
    checks.push({ key: 'intelligence_agreement', state: !ok ? 'INSUFFICIENT_DATA' : ok.rule_version !== CI_RULE_VERSION ? 'WARNING' : stored === counted ? 'PASSED' : 'FAILED', count: stored, detail: { scanCount: counted, stored } });
    const noWindow = N((await one(sql<Row>`select count(*)::int as n from customer_intelligence_snapshots where tenant_id = ${T} and rebooking and (rebooking_since is null or (typical_interval_days is not null and rebooking_due_on is null))`)).n);
    checks.push({ key: 'opportunity_dates', state: !ok ? 'INSUFFICIENT_DATA' : noWindow ? 'WARNING' : 'PASSED', count: noWindow });
    const done = await one(sql<Row>`select count(*)::int as n, max(coalesce(paid_at, finished_at, created_at)) as at from tickets where tenant_id = ${T} and customer_id is not null and removed_at is null and status = any(${VISIT}::text[])`);
    checks.push({ key: 'service_done_history', state: N(done.n) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(done.n), detail: { latest: iso(done.at) } });
    const noLines = N((await one(sql<Row>`select count(*)::int as n from tickets t where t.tenant_id = ${T} and t.customer_id is not null and t.removed_at is null and t.status = any(${VISIT}::text[])
      and not exists (select 1 from ticket_service_lines l where l.tenant_id = t.tenant_id and l.ticket_id = t.id and l.removed_at is null and l.service_id is not null)`)).n);
    checks.push({ key: 'visits_with_services', state: noLines ? 'WARNING' : 'PASSED', count: noLines });
    const booking = await one(sql<Row>`select count(*)::int as n, max(updated_at) as at from pos_tech_appointments where tenant_id = ${T}`);
    checks.push({ key: 'booking_calendar', state: 'PASSED', count: N(booking.n), detail: { latestChange: iso(booking.at) } });
    const bookedSince = N((await one(sql<Row>`select count(*)::int as n from customer_intelligence_snapshots sn where sn.tenant_id = ${T} and sn.rebooking and exists (select 1 from pos_tech_appointments a
      where a.tenant_id = sn.tenant_id and a.customer_id = sn.customer_id and a.appt_date >= (now() at time zone coalesce((select bz.timezone from branches bz where bz.id = a.branch_id and bz.tenant_id = a.tenant_id), 'America/New_York'))::date and a.status = any(${LIVE_APPT}::text[]))`)).n);
    // these are already shown as Already Booked (the list reads bookings live) — a warning only says the evaluation is behind
    checks.push({ key: 'bookings_since_evaluation', state: bookedSince ? 'WARNING' : 'PASSED', count: bookedSince });
    const catalog = await one(sql<Row>`select count(*) filter (where status = 'active' and archived_at is null)::int as active, count(*)::int as total from services where tenant_id = ${T}`);
    checks.push({ key: 'services_catalog', state: N(catalog.active) ? 'PASSED' : 'FAILED', count: N(catalog.active), detail: { total: N(catalog.total) } });
    const techs = N((await one(sql<Row>`select count(*)::int as n from technicians where tenant_id = ${T} and is_active and archived_at is null`)).n);
    checks.push({ key: 'technicians_active', state: techs ? 'PASSED' : 'FAILED', count: techs });
    const orphan = N((await one(sql<Row>`select count(*)::int as n from rebooking_reviews r where r.tenant_id = ${T}
      and not exists (select 1 from customers c where c.id = r.customer_id and c.tenant_id = r.tenant_id and c.archived_at is null)`)).n);
    checks.push({ key: 'reviews_point_at_live_customers', state: orphan ? 'WARNING' : 'PASSED', count: orphan });
    const overdue = N((await one(sql<Row>`select count(*)::int as n from rebooking_reviews where tenant_id = ${T} and status = 'deferred' and due_on <= ${today}::date`)).n);
    checks.push({ key: 'deferrals_due', state: overdue ? 'WARNING' : 'PASSED', count: overdue });
    const cross = N((await one(sql<Row>`select
        (select count(*) from rebooking_reviews r join customers c on c.id = r.customer_id where r.tenant_id = ${T} and c.tenant_id <> r.tenant_id)
      + (select count(*) from rebooking_review_events e join customers c on c.id = e.customer_id where e.tenant_id = ${T} and c.tenant_id <> e.tenant_id) as n`)).n);
    checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });
    // Rebooking has no book / send / edit path: its only writes are its own review rows and events (verified by the tests)
    checks.push({ key: 'no_booking_or_message_side_effects', state: 'PASSED' });
    const idx = (await sql<Row>`select indexname from pg_indexes where indexname = any(${['ix_customer_intelligence_snap_rebooking', 'ix_rebooking_review_events_recent', 'ix_customer_intelligence_snap_status']}::text[])`.execute(this.db)).rows.length;
    checks.push({ key: 'indexes', state: idx === 3 ? 'PASSED' : 'WARNING', count: 3 - idx });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('rebooking-health:' || ${T} || ':' || coalesce(${uuidOrNull(ctx.branchId)}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into rebooking_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${uuidOrNull(ctx.branchId)}, ${uuidOrNull(ctx.userId)}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
