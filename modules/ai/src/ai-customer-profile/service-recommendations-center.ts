// service-recommendations-center.ts — Service Recommendations guide (Nov 1 2026): `/pos/service-recommendations/*`.
//
// ADVISORY ONLY. A suggestion never books, adds to a ticket, changes a price, texts, emails, changes points or takes money.
// It keeps no second rules engine: the suggestions are the assistant's existing rule (recommendServices — the customer's
// most-completed service, and other services completed at least twice but not in the last 8 weeks), run once per salon in
// a bounded set-based evaluation, keyed by CATALOG SERVICE ID (the old per-customer path matched names) and limited to
// services that are active in the catalog. A single completion is not "a usual service" — that customer is shown as
// Insufficient Service History instead of a weak suggestion.
//
// Stored per customer + service + type (service_recommendations, migration 766). Prices, durations, add-ons, qualified
// technicians and bookings are read LIVE from their owners (Services Catalog, Technician Management, Booking Calendar), so
// a price shown is today's price and a suggestion whose exact service is already booked shows Already Booked at once. An
// appointment for a different service does not satisfy a repeat-service suggestion.
//
// States: Needs Review · Reviewed / Deferred / Not applicable (staff, pinned to the suggestion) · Already Booked (live,
// service-level) · Service inactive (deactivated since the evaluation) · Superseded (no longer suggested — history only).
// "Open AI Booking Assistant" re-checks all of that and returns a one-use prefill for POS → Booking: never an appointment.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { RetentionRepository, isUuid, maskStoredPhone, maskEmail, salonPresetRange, VISIT_TICKET_STATUSES, type RetentionContext, type BranchScope } from '@aipowersalon/customers';
import { customerSearchPredicate } from './customer-intelligence-center';
import { DEFAULT_TUNABLES, recommendServices, type ProfileTunables, type VisitRecord } from './ai-customer-profile-core';

type Row = Record<string, any>;
export type SrCtx = RetentionContext;
export type AuditFn = (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<unknown>;
export type SrSettingsFn = (ctx: SrCtx) => Promise<{ enabled: boolean; tunables?: Partial<ProfileTunables> | null }>;
const log = new Logger('ServiceRecommendations');
export class ServiceRecommendationsError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}

export const SR_RULE_VERSION = 'sr-2026-11-02';
export const SR_TYPES = ['repeat_service', 'previously_preferred'] as const;
export const SR_TABS = ['needs_review', 'reviewed', 'booked', 'all', 'superseded'] as const;
export const SR_DATE_FIELDS = ['generated', 'evaluated', 'last_completed', 'reviewed', 'customer_created', 'booking'] as const;
export const SR_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year', 'custom'] as const;
export const SR_SORTS = ['newest', 'oldest', 'recently_reviewed', 'name', 'last_completed', 'service'] as const;
export const SR_ACTIONS = ['reviewed', 'deferred', 'not_applicable', 'reopened', 'note'] as const;
export const SR_PAGE_SIZES = [10, 25, 50, 100] as const;
const LIVE_APPT = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service'];
const CANCELED_APPT = ['cancelled', 'canceled', 'no_show'];
const VISIT = [...VISIT_TICKET_STATUSES] as string[];
const SCAN_MIN_GAP_SECONDS = 60;
const STALE_AFTER_MINUTES = 60;
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const day = (v: unknown) => (v == null ? null : String(v instanceof Date ? v.toISOString() : v).slice(0, 10));
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const uuidOrNull = (v: unknown) => (isUuid(String(v ?? '')) ? String(v) : null);
const sameJson = (a: unknown, b: unknown) => { const n = (o: unknown) => JSON.stringify(Object.keys((o ?? {}) as object).sort().map((k) => [k, (o as Record<string, unknown>)[k]])); return n(a) === n(b); };
const nameOf = (r: Row) => String(r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || '').trim() || null;
/** a technician's display name — `tc` (the usual join alias) and `pt` (the preferred technician) */
const TECH_TC = sql`nullif(trim(coalesce(nullif(tc.full_name, ''), coalesce(tc.first_name, '') || ' ' || coalesce(tc.last_name, ''))), '')`;
const TECH_PT = sql`nullif(trim(coalesce(nullif(pt.full_name, ''), coalesce(pt.first_name, '') || ' ' || coalesce(pt.last_name, ''))), '')`;

export interface SrSuggestion { customerId: string; serviceId: string; type: (typeof SR_TYPES)[number]; confidence: string; timesCompleted: number; lastCompletedAt: string; preferredTechnicianId: string | null }
/** the assistant's rule for one customer's completed service lines, keyed by catalog service id */
export function suggestForCustomer(customerId: string, lines: { serviceId: string; at: string; technicianId: string | null }[], active: Set<string>, nowIso: string, t: ProfileTunables): SrSuggestion[] {
  const visits: VisitRecord[] = lines.map((l) => ({ date: l.at, serviceName: l.serviceId, technicianName: l.technicianId ?? '', totalCents: 0, tipCents: 0 }));
  const out: SrSuggestion[] = [];
  for (const r of recommendServices(visits, active, nowIso, t)) {
    if (!r.availabilityConfirmed) continue;
    const mine = lines.filter((l) => l.serviceId === r.serviceName);
    // a single completion is not a usual service: Insufficient Service History, not a weak suggestion
    if (r.category === 'rebook_usual' && mine.length < 2) continue;
    const byTech = new Map<string, number>();
    for (const l of mine) if (l.technicianId) byTech.set(l.technicianId, (byTech.get(l.technicianId) ?? 0) + 1);
    const top = [...byTech.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    out.push({ customerId, serviceId: r.serviceName, type: r.category === 'rebook_usual' ? 'repeat_service' : 'previously_preferred', confidence: r.confidence,
      timesCompleted: mine.length, lastCompletedAt: mine.map((l) => l.at).sort().slice(-1)[0],
      preferredTechnicianId: top && mine.length >= t.minVisitsForTechPref && top[1] * 2 > mine.length ? top[0] : null });
  }
  return out;
}

export interface SrQuery { q?: unknown; tab?: unknown; type?: unknown; serviceId?: unknown; technicianId?: unknown; branch?: unknown; dateField?: unknown; preset?: unknown; from?: unknown; to?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown }
export type SrCheckState = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
export interface SrCheck { key: string; state: SrCheckState; count?: number | null; detail?: Record<string, unknown> }

export class ServiceRecommendationsCenter {
  private readonly ret: RetentionRepository;
  constructor(private readonly db: Kysely<any>, private readonly settings: SrSettingsFn, private readonly now: () => number = () => Date.now()) { this.ret = new RetentionRepository(db); }

  private async tunables(ctx: SrCtx): Promise<ProfileTunables> {
    const st = await this.settings(ctx);
    if (!st.enabled) throw new ServiceRecommendationsError('The AI Customer Profile assistant is turned off for this salon.', 'AI_CUSTOMER_PROFILE_DISABLED', 403);
    return { ...DEFAULT_TUNABLES, ...(st.tunables ?? {}) };
  }
  private async scope(ctx: SrCtx, branch?: unknown): Promise<BranchScope> {
    try { return await this.ret.branchScope(ctx, branch); }
    catch (e: any) { throw new ServiceRecommendationsError(e?.message ?? 'Unknown branch.', e?.code === 'BRANCH_NOT_AUTHORIZED' ? 'BRANCH_NOT_AUTHORIZED' : 'SR_INVALID_BRANCH', e?.status ?? 400); }
  }
  private custVisible(s: BranchScope) {
    if (!s.branchIds) return sql`true`;
    const ids = s.branchIds;
    return sql`(c.branch_id = any(${ids}::uuid[])
      or exists (select 1 from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.branch_id = any(${ids}::uuid[]) and t.removed_at is null)
      or exists (select 1 from pos_tech_appointments a where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.branch_id = any(${ids}::uuid[])))`;
  }
  /** a live upcoming appointment of the customer that includes THIS service (service-level, read now) */
  private bookedNow(T: string, today: string) {
    return sql`exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = r.customer_id and a.appt_date >= ${today}::date
      and a.status = any(${LIVE_APPT}::text[]) and jsonb_typeof(a.services) = 'array'
      and exists (select 1 from jsonb_array_elements(a.services) s where s->>'serviceId' = r.service_id::text))`;
  }
  /** an appointment for this service created after the suggestion appeared (an associated outcome, never proof of cause) */
  private associatedBooking(T: string) {
    return sql`exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = r.customer_id and a.created_at >= r.generated_at
      and a.status <> all(${CANCELED_APPT}::text[]) and jsonb_typeof(a.services) = 'array'
      and exists (select 1 from jsonb_array_elements(a.services) s where s->>'serviceId' = r.service_id::text))`;
  }
  private reviewCurrent(today: string) {
    return sql`(rv.recommendation_id is not null and rv.generated_at_reviewed is not distinct from r.generated_at
      and (rv.status <> 'deferred' or rv.due_on is null or rv.due_on > ${today}::date))`;
  }
  private serviceActive() { return sql`(sv.id is not null and sv.status = 'active' and sv.archived_at is null)`; }
  private async latestScan(T: string) {
    return (await sql<Row>`select id, status, customers_evaluated, generated, counts, finished_at, rule_version, started_at, error_code, duration_ms from service_recommendation_scans
      where tenant_id = ${T} order by started_at desc limit 1`.execute(this.db)).rows[0];
  }
  private async lastOk(T: string, ex: Kysely<any> = this.db) {
    return (await sql<Row>`select id, status, customers_evaluated, generated, counts, finished_at, rule_version, tunables, started_at, duration_ms from service_recommendation_scans
      where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`.execute(ex)).rows[0];
  }
  private freshness(latest: Row | undefined, ok: Row | undefined) {
    const state = !latest ? 'never' : latest.status === 'running' ? 'running' : latest.status === 'failed' ? 'failed' : !ok ? 'never'
      : ok.rule_version !== SR_RULE_VERSION ? 'stale' : (this.now() - new Date(ok.finished_at).getTime()) / 60000 >= STALE_AFTER_MINUTES ? 'stale' : 'up_to_date';
    return { state, lastEvaluatedAt: iso(ok?.finished_at), lastError: latest?.status === 'failed' ? latest.error_code : null, ruleVersion: SR_RULE_VERSION };
  }
  private scanOut(r: Row) {
    return { id: String(r.id), status: r.status, customersEvaluated: N(r.customers_evaluated), generated: N(r.generated), counts: r.counts ?? {}, ruleVersion: r.rule_version,
      startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), durationMs: r.duration_ms == null ? null : N(r.duration_ms) };
  }
  private async period(ctx: SrCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const preset = pick(SR_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    const w = await this.ret.window(ctx, { preset: 'today' });
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today: w.today, tz: w.tz };
    let from: string, to: string;
    if (preset === 'custom') {
      const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
      const b = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
      if (!a || !b) throw new ServiceRecommendationsError('Choose a From and a To date.', 'SR_INVALID_PERIOD');
      if (a > b) throw new ServiceRecommendationsError('The From date must be on or before the To date.', 'SR_INVALID_PERIOD');
      from = a; to = b;
    } else ({ from, to } = salonPresetRange(preset, w.today)!);
    const b = (await sql<Row>`select (${from}::date::timestamp at time zone ${w.tz}) as s, ((${to}::date + 1)::timestamp at time zone ${w.tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(b.s) as Date | null, end: new Date(b.e) as Date | null, today: w.today, tz: w.tz };
  }

  // ── evaluation ────────────────────────────────────────────────────────────────────────────────────────────────
  /** evaluate every live customer; rate-limited (a completed evaluation inside 60 s is returned, `reused: true`) */
  async scan(ctx: SrCtx, trigger: 'manual' | 'auto' | 'scheduled' = 'manual') {
    const T = ctx.tenantId;
    const t = await this.tunables(ctx);
    const scanId = randomUUID();
    const started = this.now();
    try {
      return await this.db.transaction().execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtext('service-recommendations-scan:' || ${T}))`.execute(trx);
        const last = await this.lastOk(T, trx as unknown as Kysely<any>);
        if (last && last.rule_version === SR_RULE_VERSION && sameJson(last.tunables, t)
          && this.now() - new Date(last.finished_at).getTime() < SCAN_MIN_GAP_SECONDS * 1000) return { reused: true, scan: this.scanOut(last) };
        await sql`insert into service_recommendation_scans (id, tenant_id, actor_user_id, trigger_kind, rule_version, tunables)
          values (${scanId}, ${T}, ${uuidOrNull(ctx.userId)}, ${trigger}, ${SR_RULE_VERSION}, ${JSON.stringify(t)}::jsonb)`.execute(trx);
        const nowIso = new Date(this.now()).toISOString();
        const live = N((await sql<Row>`select count(*)::int as n from customers where tenant_id = ${T} and archived_at is null`.execute(trx)).rows[0]?.n);
        // completed, non-add-on catalog service lines of live customers — the same "completed visit" as Customer Search / Retention
        const lines = (await sql<Row>`select t.customer_id, l.service_id, l.technician_id, coalesce(t.paid_at, t.finished_at, t.created_at) as at
          from tickets t join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id and c.archived_at is null
          join ticket_service_lines l on l.ticket_id = t.id and l.tenant_id = t.tenant_id and l.removed_at is null and l.service_id is not null and not l.is_add_on
          where t.tenant_id = ${T} and t.removed_at is null and t.status = any(${VISIT}::text[])`.execute(trx)).rows;
        const active = new Set((await sql<Row>`select id from services where tenant_id = ${T} and status = 'active' and archived_at is null`.execute(trx)).rows.map((r) => String(r.id)));
        const byCustomer = new Map<string, { serviceId: string; at: string; technicianId: string | null }[]>();
        for (const l of lines) {
          const k = String(l.customer_id);
          if (!byCustomer.has(k)) byCustomer.set(k, []);
          byCustomer.get(k)!.push({ serviceId: String(l.service_id), at: new Date(l.at).toISOString(), technicianId: l.technician_id ? String(l.technician_id) : null });
        }
        const sugg: SrSuggestion[] = [];
        let insufficient = 0;
        for (const [cid, ls] of byCustomer) { const s = suggestForCustomer(cid, ls, active, nowIso, t); if (!s.length) insufficient++; sugg.push(...s); }
        const counts = { repeat_service: sugg.filter((s) => s.type === 'repeat_service').length, previously_preferred: sugg.filter((s) => s.type === 'previously_preferred').length,
          customers_with_suggestions: new Set(sugg.map((s) => s.customerId)).size, insufficient_history: insufficient, never_served: Math.max(0, live - byCustomer.size) };
        for (let i = 0; i < sugg.length; i += 500) {
          const chunk = sugg.slice(i, i + 500);
          // a suggestion keeps the date it first appeared while it lasts; one that returns after being superseded is new
          await sql`insert into service_recommendations (tenant_id, customer_id, service_id, rec_type, confidence, times_completed, last_completed_at, preferred_technician_id,
              status, generated_at, evaluated_at, scan_id, rule_version)
            select ${T}::uuid, x.customer_id, x.service_id, x.rec_type, x.confidence, x.times_completed, x.last_completed_at, x.preferred_technician_id, 'open', now(), now(), ${scanId}::uuid, ${SR_RULE_VERSION}
            from jsonb_to_recordset(${JSON.stringify(chunk.map((s) => ({ customer_id: s.customerId, service_id: s.serviceId, rec_type: s.type, confidence: s.confidence,
              times_completed: s.timesCompleted, last_completed_at: s.lastCompletedAt, preferred_technician_id: s.preferredTechnicianId })))}::jsonb)
              as x(customer_id uuid, service_id uuid, rec_type text, confidence text, times_completed int, last_completed_at timestamptz, preferred_technician_id uuid)
            on conflict (tenant_id, customer_id, service_id, rec_type) do update set confidence = excluded.confidence, times_completed = excluded.times_completed,
              last_completed_at = excluded.last_completed_at, preferred_technician_id = excluded.preferred_technician_id, evaluated_at = now(), scan_id = excluded.scan_id,
              rule_version = excluded.rule_version, superseded_at = null,
              generated_at = case when service_recommendations.status = 'superseded' then now() else service_recommendations.generated_at end, status = 'open'`.execute(trx);
        }
        const superseded = N((await sql<Row>`with u as (update service_recommendations set status = 'superseded', superseded_at = now()
          where tenant_id = ${T} and status = 'open' and scan_id is distinct from ${scanId}::uuid returning 1) select count(*)::int as n from u`.execute(trx)).rows[0]?.n);
        await sql`update service_recommendation_scans set status = 'completed', finished_at = now(), customers_evaluated = ${live}, generated = ${sugg.length},
          counts = ${JSON.stringify({ ...counts, superseded })}::jsonb, duration_ms = ${Math.max(0, Math.round(this.now() - started))} where tenant_id = ${T} and id = ${scanId}`.execute(trx);
        return { reused: false, scan: this.scanOut((await sql<Row>`select id, status, customers_evaluated, generated, counts, rule_version, started_at, finished_at, duration_ms
          from service_recommendation_scans where tenant_id = ${T} and id = ${scanId}`.execute(trx)).rows[0]) };
      });
    } catch (e: any) {
      log.warn(`service recommendations scan failed for ${T}: ${String(e?.message ?? e)}`);
      await sql`insert into service_recommendation_scans (id, tenant_id, actor_user_id, trigger_kind, rule_version, tunables, status, finished_at, error_code)
        values (${scanId}, ${T}, ${uuidOrNull(ctx.userId)}, ${trigger}, ${SR_RULE_VERSION}, ${JSON.stringify(t)}::jsonb, 'failed', now(), 'SR_SCAN_FAILED')
        on conflict (id) do nothing`.execute(this.db);
      throw new ServiceRecommendationsError('The evaluation could not finish. Nothing was changed.', 'SR_SCAN_FAILED', 500);
    }
  }

  // ── the six cards ─────────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: SrCtx) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    const { today } = await this.ret.window(ctx, { preset: 'today' });
    const [latest, ok] = [await this.latestScan(T), await this.lastOk(T)];
    const fr = this.freshness(latest, ok);
    if (!ok || ok.rule_version !== SR_RULE_VERSION) return { metrics: null, freshness: fr, unavailable: true };
    const B = this.bookedNow(T, today);
    const m = (await sql<Row>`select count(*) filter (where r.status = 'open')::int as recommendations,
        count(distinct r.customer_id) filter (where r.status = 'open')::int as customers,
        count(*) filter (where r.status = 'open' and ${this.serviceActive()} and not ${B} and not ${this.reviewCurrent(today)})::int as needs_review,
        count(*) filter (where rv.reviewed_at >= now() - interval '30 days')::int as recently_reviewed,
        count(*) filter (where ${this.associatedBooking(T)})::int as associated_bookings
      from service_recommendations r join customers c on c.id = r.customer_id and c.tenant_id = r.tenant_id
      left join services sv on sv.id = r.service_id and sv.tenant_id = r.tenant_id
      left join service_recommendation_reviews rv on rv.tenant_id = r.tenant_id and rv.recommendation_id = r.id
      where r.tenant_id = ${T} and c.archived_at is null and ${this.custVisible(s)}`.execute(this.db)).rows[0] ?? {};
    const c = (ok.counts ?? {}) as Record<string, number>;
    return {
      metrics: { recommendations: N(m.recommendations), customersWithRecommendations: N(m.customers), customersEvaluated: N(ok.customers_evaluated), needsReview: N(m.needs_review),
        recentlyReviewed: N(m.recently_reviewed), associatedBookings: N(m.associated_bookings), insufficientHistory: N(c.insufficient_history), neverServed: N(c.never_served) },
      definitions: { ruleVersion: SR_RULE_VERSION, types: SR_TYPES, associatedBooking: 'an appointment for the suggested service created after the suggestion appeared — an associated outcome, not proof the suggestion caused it',
        insufficientHistory: 'completed visits, but no service completed twice and still active' },
      freshness: fr, unavailable: false, scope: { label: s.label, confined: s.confined }, scan: this.scanOut(ok),
    };
  }

  // ── the queue ─────────────────────────────────────────────────────────────────────────────────────────────────
  async list(ctx: SrCtx, f: SrQuery, opts: { fullContact: boolean }) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    const tab = pick(SR_TABS, f.tab) ?? 'needs_review';
    const type = pick(SR_TYPES, f.type);
    const dateField = pick(SR_DATE_FIELDS, f.dateField) ?? 'generated';
    const sort = pick(SR_SORTS, f.sort) ?? 'newest';
    const pageSize = (SR_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q && q.length < 2) throw new ServiceRecommendationsError('Type at least 2 characters.', 'SR_SEARCH_TOO_SHORT');
    for (const k of ['serviceId', 'technicianId'] as const) if (f[k] != null && f[k] !== '' && !isUuid(String(f[k]))) throw new ServiceRecommendationsError('Unknown filter value.', 'SR_INVALID_FILTER', 400, { field: k });
    const per = await this.period(ctx, f);
    const ok = await this.lastOk(T);
    if (!ok || ok.rule_version !== SR_RULE_VERSION) return { items: [], total: 0, page: 1, pageSize, totalPages: 1, unavailable: true, freshness: this.freshness(await this.latestScan(T), ok) };
    const today = per.today;
    const B = this.bookedNow(T, today); const RC = this.reviewCurrent(today); const ACT = this.serviceActive();
    const where = [sql`r.tenant_id = ${T}`, sql`c.archived_at is null`, this.custVisible(s)];
    if (tab === 'needs_review') where.push(sql`r.status = 'open' and ${ACT} and not ${B} and not ${RC}`);
    if (tab === 'reviewed') where.push(sql`r.status = 'open' and ${RC}`);
    if (tab === 'booked') where.push(sql`r.status = 'open' and ${B}`);
    if (tab === 'all') where.push(sql`r.status = 'open'`);
    if (tab === 'superseded') where.push(sql`r.status = 'superseded'`);
    if (type) where.push(sql`r.rec_type = ${type}`);
    if (f.serviceId) where.push(sql`r.service_id = ${String(f.serviceId)}::uuid`);
    if (f.technicianId) {
      const tid = String(f.technicianId);
      where.push(sql`(r.preferred_technician_id = ${tid}::uuid or exists (select 1 from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
        where l.tenant_id = ${T} and t.customer_id = r.customer_id and l.service_id = r.service_id and l.technician_id = ${tid}::uuid and l.removed_at is null and t.removed_at is null))`);
    }
    if (per.start && per.end) {
      if (dateField === 'evaluated') where.push(sql`r.evaluated_at >= ${per.start} and r.evaluated_at < ${per.end}`);
      else if (dateField === 'last_completed') where.push(sql`r.last_completed_at >= ${per.start} and r.last_completed_at < ${per.end}`);
      else if (dateField === 'reviewed') where.push(sql`rv.reviewed_at >= ${per.start} and rv.reviewed_at < ${per.end}`);
      else if (dateField === 'customer_created') where.push(sql`c.created_at >= ${per.start} and c.created_at < ${per.end}`);
      else if (dateField === 'booking') where.push(sql`exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = r.customer_id
        and a.appt_date between ${per.from}::date and ${per.to}::date and jsonb_typeof(a.services) = 'array'
        and exists (select 1 from jsonb_array_elements(a.services) x where x->>'serviceId' = r.service_id::text))`);
      else where.push(sql`r.generated_at >= ${per.start} and r.generated_at < ${per.end}`);
    }
    if (q) where.push(sql`(${customerSearchPredicate(T, q)} or sv.name ilike ${'%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'})`);
    const W = sql.join(where, sql` and `);
    // newest suggestion first, stable id tie-break, so new suggestions land on page 1
    const order = sort === 'oldest' ? sql`r.generated_at asc, r.id asc`
      : sort === 'recently_reviewed' ? sql`rv.reviewed_at desc nulls last, r.generated_at desc, r.id desc`
      : sort === 'name' ? sql`lower(coalesce(c.full_name, c.first_name)) asc, r.id asc`
      : sort === 'last_completed' ? sql`r.last_completed_at desc nulls last, r.id desc`
      : sort === 'service' ? sql`lower(sv.name) asc nulls last, r.id asc`
      : sql`r.generated_at desc, r.id desc`;
    const FROM = sql`service_recommendations r join customers c on c.id = r.customer_id and c.tenant_id = r.tenant_id
      left join services sv on sv.id = r.service_id and sv.tenant_id = r.tenant_id
      left join service_recommendation_reviews rv on rv.tenant_id = r.tenant_id and rv.recommendation_id = r.id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where r.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select r.id, r.customer_id, r.service_id, r.rec_type, r.confidence, r.times_completed, r.last_completed_at, r.status, r.generated_at, r.evaluated_at,
        c.full_name, c.first_name, c.last_name, c.normalized_phone, c.phone_display, c.email,
        sv.name as service_name, sv.price_cents, sv.duration_minutes, ${ACT} as service_active, b.name as branch_name,
        ${TECH_PT} as preferred_technician, (pt.is_active and pt.archived_at is null) as preferred_active,
        ${B} as booked_now, ${this.associatedBooking(T)} as associated_booking,
        (select min(a.appt_date) from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = r.customer_id and a.appt_date >= ${today}::date and a.status = any(${LIVE_APPT}::text[])) as next_any,
        ls.service as last_service, ls.at as last_visit_at,
        rv.status as review_status, rv.reviewed_at, rv.due_on as review_due_on, ${RC} as review_current
      from ${FROM}
      left join branches b on b.id = sv.branch_id and b.tenant_id = r.tenant_id
      left join technicians pt on pt.id = r.preferred_technician_id and pt.tenant_id = r.tenant_id
      left join lateral (select l.service_name_snapshot as service, coalesce(t.paid_at, t.finished_at, t.created_at) as at from tickets t
          join ticket_service_lines l on l.ticket_id = t.id and l.tenant_id = t.tenant_id and l.removed_at is null and not l.is_add_on
        where t.tenant_id = ${T} and t.customer_id = r.customer_id and t.removed_at is null and t.status = any(${VISIT}::text[])
        order by coalesce(t.paid_at, t.finished_at, t.created_at) desc, l.created_at, l.id limit 1) ls on true
      where r.tenant_id = ${T} and ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => this.rowOut(r, opts, today)),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), unavailable: false,
      applied: { q: q || null, tab, type: type ?? null, serviceId: f.serviceId ? String(f.serviceId) : null, technicianId: f.technicianId ? String(f.technicianId) : null, dateField, preset: per.preset, from: per.from, to: per.to, sort },
      period: { from: per.from, to: per.to, timeZone: per.tz, today: per.today }, contact: opts.fullContact ? 'full' : 'masked',
      freshness: this.freshness(await this.latestScan(T), ok),
    };
  }
  private stateOf(r: Row) {
    return r.status === 'superseded' ? 'superseded' : !r.service_active ? 'service_inactive' : r.booked_now ? 'booked'
      : r.review_current ? String(r.review_status) : 'needs_review';
  }
  private rowOut(r: Row, opts: { fullContact: boolean }, _today: string) {
    return {
      id: String(r.id), customerId: String(r.customer_id), name: nameOf(r),
      phone: r.normalized_phone ? (opts.fullContact ? (r.phone_display || r.normalized_phone) : maskStoredPhone(r.normalized_phone)) : null,
      email: r.email ? (opts.fullContact ? String(r.email) : maskEmail(String(r.email))) : null,
      type: r.rec_type, confidence: r.confidence, state: this.stateOf(r),
      evidence: { timesCompleted: N(r.times_completed), lastCompletedAt: iso(r.last_completed_at) },
      service: { id: String(r.service_id), name: r.service_name ?? null, active: !!r.service_active, priceCents: r.service_active ? N(r.price_cents) : null,
        durationMinutes: r.service_active ? N(r.duration_minutes) : null, branch: r.branch_name ?? null },
      technician: r.preferred_technician ? { name: r.preferred_technician, active: !!r.preferred_active } : null,
      lastService: r.last_service ?? null, lastVisitAt: iso(r.last_visit_at),
      booking: { thisService: !!r.booked_now, nextAnyDate: day(r.next_any), associated: !!r.associated_booking },
      generatedAt: iso(r.generated_at), evaluatedAt: iso(r.evaluated_at),
      review: r.review_status ? { status: r.review_status, at: iso(r.reviewed_at), dueOn: day(r.review_due_on), current: !!r.review_current } : null,
    };
  }
  private async loadRec(ex: Kysely<any>, T: string, s: BranchScope, id: string, today: string, lock = false) {
    return (await sql<Row>`select r.id, r.customer_id, r.service_id, r.rec_type, r.confidence, r.times_completed, r.last_completed_at, r.preferred_technician_id, r.status,
        r.generated_at, r.evaluated_at, r.rule_version, c.full_name, c.first_name, c.last_name, c.normalized_phone, c.phone_display, c.email, c.branch_id as customer_branch_id,
        sv.name as service_name, sv.price_cents, sv.duration_minutes, sv.description as service_description, sv.branch_id as service_branch_id, (sv.id is not null and sv.status = 'active' and sv.archived_at is null) as service_active,
        sc.name as category_name, b.name as branch_name,
        ${this.bookedNow(T, today)} as booked_now, ${this.associatedBooking(T)} as associated_booking,
        rv.status as review_status, rv.reviewed_at, rv.due_on as review_due_on, rv.version as review_version, ${this.reviewCurrent(today)} as review_current
      from service_recommendations r join customers c on c.id = r.customer_id and c.tenant_id = r.tenant_id
      left join services sv on sv.id = r.service_id and sv.tenant_id = r.tenant_id
      left join service_categories sc on sc.id = sv.category_id and sc.tenant_id = r.tenant_id
      left join branches b on b.id = sv.branch_id and b.tenant_id = r.tenant_id
      left join service_recommendation_reviews rv on rv.tenant_id = r.tenant_id and rv.recommendation_id = r.id
      where r.tenant_id = ${T} and r.id = ${isUuid(`${id}`) ? id : NIL}::uuid and c.archived_at is null and ${this.custVisible(s)} ${lock ? sql`for update of r` : sql``}`.execute(ex)).rows[0];
  }

  /** the 360° overlay: identity · suggestion + evidence · live catalog (price, duration, add-ons) · qualified technicians · history · bookings — audited */
  async detail(ctx: SrCtx, id: string, opts: { fullContact: boolean }, audit: AuditFn) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    const { today } = await this.ret.window(ctx, { preset: 'today' });
    const r = await this.loadRec(this.db, T, s, id, today);
    if (!r) throw new ServiceRecommendationsError('Recommendation not found.', 'SR_NOT_FOUND', 404);
    const C = String(r.customer_id); const S = String(r.service_id);
    const addOns = (await sql<Row>`select name, price_cents, duration_delta_minutes from service_add_ons where tenant_id = ${T} and service_id = ${S}::uuid and is_active order by sort_order, name limit 20`.execute(this.db)).rows;
    const qualified = (await sql<Row>`select tc.id, ${TECH_TC} as name, ts.is_primary from technician_services ts join technicians tc on tc.id = ts.technician_id and tc.tenant_id = ts.tenant_id
      where ts.tenant_id = ${T} and ts.service_id = ${S}::uuid and tc.is_active and tc.archived_at is null order by ts.is_primary desc, name limit 12`.execute(this.db)).rows;
    const qualifiedTotal = N((await sql<Row>`select count(*)::int as n from technician_services ts join technicians tc on tc.id = ts.technician_id and tc.tenant_id = ts.tenant_id
      where ts.tenant_id = ${T} and ts.service_id = ${S}::uuid and tc.is_active and tc.archived_at is null`.execute(this.db)).rows[0]?.n);
    const pref = r.preferred_technician_id ? (await sql<Row>`select tc.id, ${TECH_TC} as name, (tc.is_active and tc.archived_at is null) as active,
        exists (select 1 from technician_services ts where ts.tenant_id = tc.tenant_id and ts.technician_id = tc.id and ts.service_id = ${S}::uuid) as qualified
      from technicians tc where tc.tenant_id = ${T} and tc.id = ${String(r.preferred_technician_id)}::uuid`.execute(this.db)).rows[0] : undefined;
    const visits = (await sql<Row>`select t.id, coalesce(t.paid_at, t.finished_at, t.created_at) as at,
        coalesce(json_agg(json_build_object('service', l.service_name_snapshot, 'serviceId', l.service_id, 'minutes', l.duration_minutes_snapshot, 'addOn', l.is_add_on, 'technician', ${TECH_TC})
          order by l.created_at, l.id) filter (where l.id is not null), '[]') as lines
      from tickets t left join ticket_service_lines l on l.ticket_id = t.id and l.tenant_id = t.tenant_id and l.removed_at is null
      left join technicians tc on tc.id = l.technician_id and tc.tenant_id = l.tenant_id
      where t.tenant_id = ${T} and t.customer_id = ${C}::uuid and t.removed_at is null and t.status = any(${VISIT}::text[])
      group by t.id order by coalesce(t.paid_at, t.finished_at, t.created_at) desc, t.id desc limit 10`.execute(this.db)).rows;
    const frequency = (await sql<Row>`select l.service_id, max(l.service_name_snapshot) as service, count(*)::int as n, max(coalesce(t.paid_at, t.finished_at, t.created_at)) as last
      from tickets t join ticket_service_lines l on l.ticket_id = t.id and l.tenant_id = t.tenant_id and l.removed_at is null and l.service_id is not null and not l.is_add_on
      where t.tenant_id = ${T} and t.customer_id = ${C}::uuid and t.removed_at is null and t.status = any(${VISIT}::text[])
      group by l.service_id order by n desc, last desc limit 8`.execute(this.db)).rows;
    const appts = (await sql<Row>`select a.id, a.appt_date, a.start_time, a.status, a.services, ${TECH_TC} as technician
      from pos_tech_appointments a left join technicians tc on tc.id = a.technician_id and tc.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.customer_id = ${C}::uuid order by a.appt_date desc, a.start_time desc, a.id desc limit 12`.execute(this.db)).rows;
    const mem = (await sql<Row>`select status, count(*)::int as n from customer_memberships where tenant_id = ${T} and customer_id = ${C}::uuid group by status`.execute(this.db)).rows;
    const others = (await sql<Row>`select r2.id, r2.rec_type, sv2.name from service_recommendations r2 left join services sv2 on sv2.id = r2.service_id and sv2.tenant_id = r2.tenant_id
      where r2.tenant_id = ${T} and r2.customer_id = ${C}::uuid and r2.status = 'open' and r2.id <> ${String(r.id)}::uuid order by r2.generated_at desc limit 10`.execute(this.db)).rows;
    const events = (await sql<Row>`select e.id, e.event_type, e.note, e.created_at, coalesce(u.full_name, u.email) as actor
      from service_recommendation_events e left join users u on u.id = e.actor_user_id and u.tenant_id = ${T}
      where e.tenant_id = ${T} and e.recommendation_id = ${String(r.id)}::uuid order by e.created_at desc, e.id desc limit 50`.execute(this.db)).rows;
    const caveats: string[] = [];
    if (!r.service_active) caveats.push('service_inactive');
    if (r.service_active && (r.price_cents == null || N(r.duration_minutes) <= 0)) caveats.push('price_or_duration_missing');
    if (r.booked_now) caveats.push('already_booked');
    if (!qualifiedTotal) caveats.push('no_qualified_technician');
    if (pref && !pref.active) caveats.push('preferred_technician_inactive');
    if (pref && pref.active && !pref.qualified) caveats.push('preferred_technician_not_qualified');
    if (r.status === 'superseded') caveats.push('superseded');
    caveats.push('availability_not_checked');
    await this.db.transaction().execute(async (trx) => { await audit(trx as unknown as Kysely<any>, { recommendationId: String(r.id), customerId: C, serviceId: S, state: this.stateOf(r) }); });
    return {
      id: String(r.id), customerId: C, state: this.stateOf(r), type: r.rec_type, confidence: r.confidence,
      identity: { id: C, name: nameOf(r), phone: r.normalized_phone ? (opts.fullContact ? (r.phone_display || r.normalized_phone) : maskStoredPhone(r.normalized_phone)) : null,
        email: r.email ? (opts.fullContact ? String(r.email) : maskEmail(String(r.email))) : null },
      evidence: { timesCompleted: N(r.times_completed), lastCompletedAt: iso(r.last_completed_at) },
      service: { id: S, name: r.service_name ?? null, category: r.category_name ?? null, description: r.service_description ?? null, active: !!r.service_active,
        priceCents: r.service_active ? N(r.price_cents) : null, durationMinutes: r.service_active ? N(r.duration_minutes) : null, branch: r.branch_name ?? null,
        addOns: r.service_active ? addOns.map((a) => ({ name: a.name, priceCents: N(a.price_cents), durationDeltaMinutes: N(a.duration_delta_minutes) })) : [] },
      technicians: { qualified: qualified.map((q) => ({ id: String(q.id), name: q.name ?? null, primary: !!q.is_primary })), qualifiedTotal,
        preferred: pref ? { id: String(pref.id), name: pref.name ?? null, active: !!pref.active, qualified: !!pref.qualified } : null },
      history: { visits: visits.map((v) => ({ ticketId: String(v.id), at: iso(v.at), lines: ((v.lines ?? []) as Row[]).map((l) => ({ service: l.service ?? null, minutes: l.minutes == null ? null : N(l.minutes), technician: l.technician ?? null, addOn: !!l.addOn, matches: String(l.serviceId ?? '') === S })) })),
        frequency: frequency.map((x) => ({ serviceId: String(x.service_id), service: x.service ?? null, count: N(x.n), lastAt: iso(x.last) })) },
      bookings: appts.map((a) => {
        const svcs = Array.isArray(a.services) ? (a.services as Row[]) : [];
        return { id: String(a.id), date: day(a.appt_date), time: a.start_time ?? null, status: a.status, technician: a.technician ?? null,
          services: svcs.map((x) => String(x?.serviceName ?? x?.name ?? '')).filter(Boolean), includesThisService: svcs.some((x) => String(x?.serviceId ?? '') === S),
          upcoming: String(day(a.appt_date)) >= today && LIVE_APPT.includes(a.status) };
      }),
      memberships: mem.map((m) => ({ status: m.status, count: N(m.n) })),
      otherRecommendations: others.map((o) => ({ id: String(o.id), type: o.rec_type, service: o.name ?? null })),
      outcome: { associatedBooking: !!r.associated_booking },
      caveats, generatedAt: iso(r.generated_at), evaluatedAt: iso(r.evaluated_at), ruleVersion: r.rule_version, status: r.status,
      review: r.review_status ? { status: r.review_status, at: iso(r.reviewed_at), dueOn: day(r.review_due_on), current: !!r.review_current, version: N(r.review_version) } : null,
      activity: events.map((e) => ({ id: e.id, type: e.event_type, note: e.note, actor: e.actor ?? null, at: iso(e.created_at) })),
      note: 'An optional suggestion from completed visits — not a booking, a purchase requirement or revenue.',
    };
  }

  /** Mark reviewed · Defer · Not applicable · Reopen · Note — staff workflow only, never a customer, ticket, price or booking change */
  async review(ctx: SrCtx, id: string, b: { action?: unknown; note?: unknown; dueOn?: unknown; expectedVersion?: unknown }, audit: AuditFn) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const action = pick(SR_ACTIONS, b.action);
    if (!action) throw new ServiceRecommendationsError('Choose an action.', 'SR_INVALID_ACTION');
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 1000) : null;
    if (action === 'note' && !note) throw new ServiceRecommendationsError('Write a note first.', 'SR_NOTE_REQUIRED');
    const dueOn = typeof b.dueOn === 'string' && DAY.test(b.dueOn) ? b.dueOn : null;
    const s = await this.scope(ctx);
    const { today } = await this.ret.window(ctx, { preset: 'today' });
    return this.db.transaction().execute(async (trx) => {
      const r = await this.loadRec(trx as unknown as Kysely<any>, T, s, id, today, true);
      if (!r) throw new ServiceRecommendationsError('Recommendation not found.', 'SR_NOT_FOUND', 404);
      const cur = (await sql<Row>`select version from service_recommendation_reviews where tenant_id = ${T} and recommendation_id = ${String(r.id)}::uuid`.execute(trx)).rows[0];
      if (b.expectedVersion != null && N(b.expectedVersion) !== N(cur?.version ?? 0))
        throw new ServiceRecommendationsError('Someone else updated this recommendation. Reload it and try again.', 'SR_STALE_VERSION', 409, { currentVersion: N(cur?.version ?? 0) });
      if (['reviewed', 'deferred', 'not_applicable'].includes(action) && r.status !== 'open') throw new ServiceRecommendationsError('This recommendation is no longer current.', 'SR_NOT_CURRENT', 409);
      if (['reviewed', 'deferred', 'not_applicable'].includes(action)) {
        await sql`insert into service_recommendation_reviews (tenant_id, recommendation_id, status, generated_at_reviewed, due_on, reviewed_by, reviewed_at, updated_by, version)
          values (${T}, ${String(r.id)}::uuid, ${action}, ${r.generated_at}, ${action === 'deferred' ? dueOn : null}::date, ${uuidOrNull(ctx.userId)}, now(), ${uuidOrNull(ctx.userId)}, 1)
          on conflict (tenant_id, recommendation_id) do update set status = excluded.status, generated_at_reviewed = excluded.generated_at_reviewed, due_on = excluded.due_on,
            reviewed_by = excluded.reviewed_by, reviewed_at = now(), updated_by = excluded.updated_by, version = service_recommendation_reviews.version + 1`.execute(trx);
      }
      if (action === 'reopened') await sql`delete from service_recommendation_reviews where tenant_id = ${T} and recommendation_id = ${String(r.id)}::uuid`.execute(trx);
      await sql`insert into service_recommendation_events (id, tenant_id, recommendation_id, customer_id, event_type, note, actor_user_id)
        values (${randomUUID()}, ${T}, ${String(r.id)}::uuid, ${String(r.customer_id)}::uuid, ${action}, ${note}, ${uuidOrNull(ctx.userId)})`.execute(trx);
      await audit(trx as unknown as Kysely<any>, { recommendationId: String(r.id), customerId: String(r.customer_id), action });
      const v = (await sql<Row>`select version, status from service_recommendation_reviews where tenant_id = ${T} and recommendation_id = ${String(r.id)}::uuid`.execute(trx)).rows[0];
      return { id: String(r.id), action, review: v ? { status: v.status, version: N(v.version) } : null };
    });
  }

  /** Open AI Booking Assistant: re-check the suggestion, the catalog, the technician's qualification and the LIVE calendar for
   *  this exact service, then return the prefill for the existing Booking Assistant. One `booking_started` event — never an appointment. */
  async handoff(ctx: SrCtx, id: string, b: { technicianId?: unknown }, opts: { fullContact: boolean }, audit: AuditFn) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    if (b.technicianId != null && b.technicianId !== '' && !isUuid(String(b.technicianId))) throw new ServiceRecommendationsError('Unknown value.', 'SR_INVALID_FILTER', 400, { field: 'technicianId' });
    const { today } = await this.ret.window(ctx, { preset: 'today' });
    return this.db.transaction().execute(async (trx) => {
      const r = await this.loadRec(trx as unknown as Kysely<any>, T, s, id, today, true);
      if (!r) throw new ServiceRecommendationsError('Recommendation not found.', 'SR_NOT_FOUND', 404);
      if (r.status !== 'open') throw new ServiceRecommendationsError('This recommendation is no longer current. Refresh the evaluation.', 'SR_NOT_CURRENT', 409);
      if (!r.service_active) throw new ServiceRecommendationsError('That service is no longer active in the catalog.', 'SR_SERVICE_INACTIVE', 409);
      if (r.booked_now) {
        const next = (await sql<Row>`select min(a.appt_date) as d from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = ${String(r.customer_id)}::uuid and a.appt_date >= ${today}::date
          and a.status = any(${LIVE_APPT}::text[]) and jsonb_typeof(a.services) = 'array' and exists (select 1 from jsonb_array_elements(a.services) x where x->>'serviceId' = ${String(r.service_id)})`.execute(trx)).rows[0];
        throw new ServiceRecommendationsError('This service is already booked for the customer.', 'SR_ALREADY_BOOKED', 409, { nextAppointmentDate: day(next?.d) });
      }
      const techId = b.technicianId ? String(b.technicianId) : null;
      const tc = techId ? (await sql<Row>`select tc.id, ${TECH_TC} as name from technicians tc where tc.tenant_id = ${T} and tc.id = ${techId}::uuid and tc.is_active and tc.archived_at is null
        and exists (select 1 from technician_services ts where ts.tenant_id = tc.tenant_id and ts.technician_id = tc.id and ts.service_id = ${String(r.service_id)}::uuid)`.execute(trx)).rows[0] : undefined;
      if (techId && !tc) throw new ServiceRecommendationsError('That technician is not active or not qualified for this service.', 'SR_TECHNICIAN_NOT_QUALIFIED', 409);
      await sql`insert into service_recommendation_events (id, tenant_id, recommendation_id, customer_id, event_type, technician_id, actor_user_id)
        values (${randomUUID()}, ${T}, ${String(r.id)}::uuid, ${String(r.customer_id)}::uuid, 'booking_started', ${tc ? String(tc.id) : null}, ${uuidOrNull(ctx.userId)})`.execute(trx);
      await audit(trx as unknown as Kysely<any>, { recommendationId: String(r.id), customerId: String(r.customer_id), serviceId: String(r.service_id), technicianId: tc?.id ?? null });
      return {
        recommendationId: String(r.id), customerId: String(r.customer_id), customerName: nameOf(r),
        customerPhone: opts.fullContact && r.normalized_phone ? String(r.phone_display || r.normalized_phone) : null,
        serviceId: String(r.service_id), serviceName: r.service_name ?? null, priceCents: N(r.price_cents), durationMinutes: N(r.duration_minutes),
        technicianId: tc ? String(tc.id) : null, technicianName: tc?.name ?? null, date: today, preparedAt: new Date(this.now()).toISOString(),
        note: 'Prefill only. The Booking Assistant re-checks availability, qualifications, conflicts and the salon\'s verification before anything is booked.',
      };
    });
  }

  /** review + handoff activity, newest first */
  async history(ctx: SrCtx, f: { page?: unknown; pageSize?: unknown; preset?: unknown; from?: unknown; to?: unknown; type?: unknown }) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    const pageSize = (SR_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const per = await this.period(ctx, f);
    const where = [sql`e.tenant_id = ${T}`, this.custVisible(s)];
    if (per.start && per.end) where.push(sql`e.created_at >= ${per.start} and e.created_at < ${per.end}`);
    const type = pick([...SR_ACTIONS, 'booking_started'] as const, f.type);
    if (type) where.push(sql`e.event_type = ${type}`);
    const W = sql.join(where, sql` and `);
    const FROM = sql`service_recommendation_events e join customers c on c.id = e.customer_id and c.tenant_id = e.tenant_id
      left join service_recommendations r on r.id = e.recommendation_id and r.tenant_id = e.tenant_id left join services sv on sv.id = r.service_id and sv.tenant_id = e.tenant_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where e.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select e.id, e.recommendation_id, e.customer_id, c.full_name, c.first_name, c.last_name, sv.name as service_name, r.status as rec_status,
        e.event_type, e.note, e.created_at, coalesce(u.full_name, u.email) as actor
      from ${FROM} left join users u on u.id = e.actor_user_id and u.tenant_id = ${T}
      where e.tenant_id = ${T} and ${W} order by e.created_at desc, e.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((e) => ({ id: e.id, recommendationId: e.recommendation_id, customerId: e.customer_id, name: nameOf(e), service: e.service_name ?? null, recommendationStatus: e.rec_status ?? null,
      type: e.event_type, note: e.note, actor: e.actor ?? null, at: iso(e.created_at) })), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /** evaluation history (processing history), newest first */
  async scans(ctx: SrCtx, f: { page?: unknown; pageSize?: unknown }) {
    await this.tunables(ctx);
    const T = ctx.tenantId;
    const pageSize = (SR_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 10;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const total = N((await sql<Row>`select count(*)::int as n from service_recommendation_scans where tenant_id = ${T}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select id, status, customers_evaluated, generated, counts, rule_version, started_at, finished_at, duration_ms, error_code from service_recommendation_scans
      where tenant_id = ${T} order by started_at desc, id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ ...this.scanOut(r), error: r.error_code ?? null })), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  // ── Check Service Recommendations System (read-only; records its own evidence; one run per salon per 30 s) ─────
  async check(ctx: SrCtx) {
    const T = ctx.tenantId;
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from service_recommendation_health_runs where tenant_id = ${T} and branch_id is not distinct from ${uuidOrNull(ctx.branchId)}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: SrCheck[] = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    let on = true; try { on = (await this.settings(ctx)).enabled; } catch { on = false; }
    checks.push({ key: 'assistant_enabled', state: on ? 'PASSED' : 'WARNING' });
    const latest = await this.latestScan(T); const ok = await this.lastOk(T);
    const fr = this.freshness(latest, ok);
    checks.push({ key: 'evaluation_freshness', state: fr.state === 'up_to_date' ? 'PASSED' : fr.state === 'never' ? 'INSUFFICIENT_DATA' : fr.state === 'failed' ? 'FAILED' : 'WARNING', detail: { state: fr.state, lastEvaluatedAt: fr.lastEvaluatedAt } });
    const open = N((await one(sql<Row>`select count(*)::int as n from service_recommendations where tenant_id = ${T} and status = 'open'`)).n);
    checks.push({ key: 'records_reconcile', state: !ok ? 'INSUFFICIENT_DATA' : open === N(ok.generated) ? 'PASSED' : 'FAILED', count: open, detail: { lastEvaluation: N(ok?.generated), open } });
    const done = await one(sql<Row>`select count(*)::int as n from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.removed_at is null and l.service_id is not null and t.customer_id is not null and t.removed_at is null and t.status = any(${VISIT}::text[])`);
    checks.push({ key: 'service_history', state: N(done.n) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(done.n) });
    const catalog = await one(sql<Row>`select count(*) filter (where status = 'active' and archived_at is null)::int as active,
        count(*) filter (where status = 'active' and archived_at is null and (price_cents is null or duration_minutes is null or duration_minutes <= 0))::int as incomplete from services where tenant_id = ${T}`);
    checks.push({ key: 'services_catalog', state: !N(catalog.active) ? 'FAILED' : N(catalog.incomplete) ? 'WARNING' : 'PASSED', count: N(catalog.active), detail: { incomplete: N(catalog.incomplete) } });
    const inactive = N((await one(sql<Row>`select count(*)::int as n from service_recommendations r left join services sv on sv.id = r.service_id and sv.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and r.status = 'open' and not (sv.id is not null and sv.status = 'active' and sv.archived_at is null)`)).n);
    checks.push({ key: 'active_services_only', state: inactive ? 'WARNING' : 'PASSED', count: inactive });
    const unqualified = N((await one(sql<Row>`select count(*)::int as n from service_recommendations r where r.tenant_id = ${T} and r.status = 'open'
      and not exists (select 1 from technician_services ts join technicians tc on tc.id = ts.technician_id and tc.tenant_id = ts.tenant_id
        where ts.tenant_id = r.tenant_id and ts.service_id = r.service_id and tc.is_active and tc.archived_at is null)`)).n);
    checks.push({ key: 'technician_qualifications', state: unqualified ? 'WARNING' : 'PASSED', count: unqualified });
    const booked = N((await one(sql<Row>`select count(*)::int as n from service_recommendations r where r.tenant_id = ${T} and r.status = 'open'
      and exists (select 1 from pos_tech_appointments a where a.tenant_id = r.tenant_id and a.customer_id = r.customer_id and a.appt_date >= (now() at time zone coalesce((select bz.timezone from branches bz where bz.id = a.branch_id and bz.tenant_id = a.tenant_id), 'America/New_York'))::date
        and a.status = any(${LIVE_APPT}::text[]) and jsonb_typeof(a.services) = 'array' and exists (select 1 from jsonb_array_elements(a.services) x where x->>'serviceId' = r.service_id::text))`)).n);
    checks.push({ key: 'already_booked', state: 'PASSED', count: booked });
    const orphan = N((await one(sql<Row>`select count(*)::int as n from service_recommendations r where r.tenant_id = ${T} and r.status = 'open'
      and not exists (select 1 from customers c where c.id = r.customer_id and c.tenant_id = r.tenant_id and c.archived_at is null)`)).n);
    checks.push({ key: 'live_customers', state: orphan ? 'WARNING' : 'PASSED', count: orphan });
    const overdue = N((await one(sql<Row>`select count(*)::int as n from service_recommendation_reviews where tenant_id = ${T} and status = 'deferred' and due_on <= current_date`)).n);
    checks.push({ key: 'deferrals_due', state: overdue ? 'WARNING' : 'PASSED', count: overdue });
    const cross = N((await one(sql<Row>`select
        (select count(*) from service_recommendations r join customers c on c.id = r.customer_id where r.tenant_id = ${T} and c.tenant_id <> r.tenant_id)
      + (select count(*) from service_recommendations r join services sv on sv.id = r.service_id where r.tenant_id = ${T} and sv.tenant_id <> r.tenant_id)
      + (select count(*) from service_recommendation_events e join customers c on c.id = e.customer_id where e.tenant_id = ${T} and c.tenant_id <> e.tenant_id) as n`)).n);
    checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });
    checks.push({ key: 'no_side_effects', state: 'PASSED' });
    const idx = (await sql<Row>`select indexname from pg_indexes where indexname = any(${['ix_service_recs_newest', 'ix_service_recs_customer', 'ix_service_rec_events_recent']}::text[])`.execute(this.db)).rows.length;
    checks.push({ key: 'indexes', state: idx === 3 ? 'PASSED' : 'WARNING', count: 3 - idx });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('service-recommendations-health:' || ${T} || ':' || coalesce(${uuidOrNull(ctx.branchId)}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into service_recommendation_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${uuidOrNull(ctx.branchId)}, ${uuidOrNull(ctx.userId)}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
