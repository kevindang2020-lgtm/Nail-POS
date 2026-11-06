// customer-intelligence-center.ts — Customer Intelligence guide (Nov 1 2026): `/pos/customer-intelligence/*`.
//
// The decision-support dashboard behind /tenant/ai/customer-profile. It OWNS only derived, rebuildable records (migration
// 763): scans and the latest per-customer classification. Identity is Customer Management; completed visits are Service
// Done / Checkout (settled tickets); appointments are Booking; duplicate groups are Duplicate Review; points are the Loyalty
// ledger. Nothing here merges, books, messages, edits a profile or changes points.
//
// One definition of "active": every customer is classified by the SAME pure functions the per-customer AI profile uses —
// summarizeVisits (median gap = usual interval) → classifyInactivity → rebookingOpportunity, with the salon's own tunables —
// over two set-based reads per salon (completed-visit times, future appointments), not two API calls per customer, and
// with no 300-customer cap. Every state is counted, so the six cards always reconcile: scanned = active + rebooking soon +
// due for return + inactive + long-term inactive + insufficient history (never served + under-cadence).
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { CUSTOMER_INTELLIGENCE_SCAN } from '../ai-lifecycles';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { RetentionRepository, isUuid, maskStoredPhone, maskEmail, salonPresetRange, toStoredCustomerPhone, VISIT_TICKET_STATUSES, type RetentionContext, type BranchScope } from '@aipowersalon/customers';
import { summarizeVisits, classifyInactivity, rebookingOpportunity, evaluateChurnRisk, DEFAULT_TUNABLES, type ProfileTunables, type VisitRecord, type AppointmentRecord } from './ai-customer-profile-core';
import { addDays as addYmdDays } from '@aipowersalon/date-time';   // §87: one calendar helper

type Row = Record<string, any>;
export type CiCtx = RetentionContext;
const log = new Logger('CustomerIntelligence');

export class CustomerIntelligenceError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}

export const CI_RULE_VERSION = 'ci-2026-11-02c';   // b: + the churn rule (Churn Watch, 764) · c: + the rebooking window and opportunity date (Rebooking, 765)
export const CI_STATES = ['active', 'rebooking_soon', 'due_for_return', 'inactive', 'long_term_inactive', 'insufficient_history'] as const;
export const CI_STATUS_FILTERS = ['all', ...CI_STATES, 'inactive_all', 'never_served', 'not_scanned'] as const;   // inactive_all = the Inactive card (inactive + long-term)
export const CI_FLAGS = ['churn_watch', 'rebooking', 'upcoming', 'duplicate'] as const;
export const CI_DATE_FIELDS = ['last_visit', 'created', 'next_appointment', 'profile_updated'] as const;
export const CI_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year', 'custom'] as const;
export const CI_SORTS = ['last_visit', 'recently_added', 'name', 'visits', 'days_since'] as const;
export const CI_PAGE_SIZES = [10, 25, 50, 100] as const;
const OPEN_DUP = ['pending', 'in_review', 'deferred', 'failed'];
const VISIT = [...VISIT_TICKET_STATUSES] as string[];
const SCAN_MIN_GAP_SECONDS = 60;
const STALE_AFTER_MINUTES = 60;
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const uuidOrNull = (v: unknown) => (isUuid(String(v ?? '')) ? String(v) : null);
/** jsonb stores keys in its own order: compare settings by sorted keys */
const sameJson = (a: unknown, b: unknown) => { const n = (o: unknown) => JSON.stringify(Object.keys((o ?? {}) as object).sort().map((k) => [k, (o as Record<string, unknown>)[k]])); return n(a) === n(b); };

export interface CiClassification {
  customerId: string; status: (typeof CI_STATES)[number]; completedVisits: number; firstVisitAt: string | null; lastVisitAt: string | null;
  typicalIntervalDays: number | null; daysSinceLast: number | null; hasUpcoming: boolean; nextAppointmentDate: string | null;
  churnWatch: boolean; rebooking: boolean; rebookingReason: string; evidence: string[];
  churnLevel: 'insufficient' | 'low' | 'possible' | 'elevated' | 'high'; churnConfidence: string; churnEvidence: string[];
  canceledCount: number; noShowCount: number; membershipCanceled: boolean;
  /** the customer's own return window: last completed visit + typical interval → + half an interval (null without a cadence) */
  rebookingDueOn: string | null; rebookingWindowEnd: string | null;
}
export interface CiHistory { canceled: number; noShows: number; membershipCanceled: boolean }
/** the per-customer AI profile's own rules, applied to one customer's completed-visit times and future appointments */
export function classifyCustomer(customerId: string, visitTimes: string[], upcoming: { date: string; status: string }[], nowIso: string, t: ProfileTunables, h: CiHistory = { canceled: 0, noShows: 0, membershipCanceled: false }): CiClassification {
  const visits: VisitRecord[] = visitTimes.map((d) => ({ date: d, serviceName: '', technicianName: '', totalCents: 0, tipCents: 0 }));
  const appts: AppointmentRecord[] = upcoming.map((a) => ({ startsAt: `${a.date}T23:59:59.000Z`, serviceName: '', technicianName: '', status: a.status }));
  const vs = summarizeVisits(visits, appts, nowIso, 0, t);
  const hasUpcoming = vs.upcomingCount > 0;
  const inact = classifyInactivity(vs.lastVisit, vs.typicalIntervalDays, hasUpcoming, vs.completedVisits, nowIso, t);
  const rb = rebookingOpportunity(inact, hasUpcoming, false, vs.typicalIntervalDays);
  // the same "coarse churn watch" the old aggregate used: past due, inactive or long-term inactive, with nothing booked
  const churn = !hasUpcoming && (inact.status === 'due_for_return' || inact.status === 'inactive' || inact.status === 'long_term_inactive');
  // the assistant's existing per-customer churn rule (evaluateChurnRisk), with the same inputs it reads one customer at a time
  const risk = evaluateChurnRisk({ completedVisits: vs.completedVisits, daysSinceLastVisit: inact.daysSinceLastVisit, typicalIntervalDays: vs.typicalIntervalDays,
    hasFutureAppointment: hasUpcoming, canceledCount: h.canceled, noShowCount: h.noShows, membershipCanceled: h.membershipCanceled, unresolvedFollowUp: false }, t);
  return {
    customerId, status: inact.status as CiClassification['status'], completedVisits: vs.completedVisits, firstVisitAt: vs.firstVisit, lastVisitAt: vs.lastVisit,
    typicalIntervalDays: vs.typicalIntervalDays, daysSinceLast: inact.daysSinceLastVisit, hasUpcoming, nextAppointmentDate: upcoming.length ? [...upcoming].sort((a, b) => a.date.localeCompare(b.date))[0].date : null,
    churnWatch: churn, rebooking: rb.eligible, rebookingReason: rb.reason, evidence: inact.evidence,
    churnLevel: risk.level as CiClassification['churnLevel'], churnConfidence: String(risk.confidence), churnEvidence: risk.evidence,
    canceledCount: h.canceled, noShowCount: h.noShows, membershipCanceled: h.membershipCanceled,
    // the same multipliers classifyInactivity applies: due at interval × dueMultiplier, past the window at × inactiveMultiplier
    rebookingDueOn: addDays(vs.lastVisit, vs.typicalIntervalDays == null ? null : vs.typicalIntervalDays * t.dueMultiplier),
    rebookingWindowEnd: addDays(vs.lastVisit, vs.typicalIntervalDays == null ? null : vs.typicalIntervalDays * t.inactiveMultiplier),
  };
}
const addDays = (fromIso: string | null, days: number | null) => (fromIso == null || days == null ? null : addYmdDays(fromIso.slice(0, 10), Math.round(days)));

/** the authorized customer search (alias `c`): name (accents optional) · phone in any format · email · customer id · appointment id ·
 *  technician / service from completed visits. Shared by Customer Intelligence and Churn Watch. */
export function customerSearchPredicate(T: string, q: string) {
  const digits = q.replace(/\D/g, '');
  const stored = toStoredCustomerPhone(q) ?? null;
  const conds = [];
  if (isUuid(`${q}`)) conds.push(sql`(c.id = ${q}::uuid or exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.id = ${q}::uuid and a.customer_id = c.id))`);
  else {
    if (q.includes('@')) conds.push(sql`c.email ilike ${'%' + likeEsc(q) + '%'}`);
    if (stored) conds.push(sql`c.normalized_phone = ${stored}`);
    if (digits.length >= 4 && digits.length >= q.replace(/[\s()+.-]/g, '').length) conds.push(sql`regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'}`);
    if (!q.includes('@')) {
      const folded = sql`${'%'} || vi_fold(${likeEsc(q)}::text) || ${'%'}`;
      conds.push(sql`vi_fold(coalesce(c.full_name, c.first_name || ' ' || coalesce(c.last_name, ''))) ilike ${folded}`);
      // technician / service: a completed visit with them (not a preference — labelled separately in the 360° view)
      conds.push(sql`exists (select 1 from tickets t join ticket_service_lines l on l.ticket_id = t.id and l.tenant_id = t.tenant_id and l.removed_at is null
          left join technicians tc on tc.id = l.technician_id and tc.tenant_id = l.tenant_id
        where t.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT}::text[])
          and (vi_fold(coalesce(l.service_name_snapshot, '')) ilike ${folded} or vi_fold(coalesce(tc.full_name, '')) ilike ${folded}))`);
      // the visit's main technician (a ticket may have no service lines yet, e.g. an imported visit)
      conds.push(sql`exists (select 1 from tickets t join technicians tp on tp.id = t.primary_technician_id and tp.tenant_id = t.tenant_id
        where t.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT}::text[])
          and vi_fold(coalesce(tp.full_name, tp.first_name || ' ' || coalesce(tp.last_name, ''))) ilike ${folded})`);
    }
  }
  return sql`(${sql.join(conds, sql` or `)})`;
}

export interface CiQuery {
  q?: unknown; status?: unknown; flag?: unknown; branch?: unknown; dateField?: unknown; preset?: unknown; from?: unknown; to?: unknown;
  sort?: unknown; page?: unknown; pageSize?: unknown;
}
export type CiCheckState = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
export interface CiCheck { key: string; state: CiCheckState; count?: number | null; detail?: Record<string, unknown> }
export type SettingsFn = (ctx: CiCtx) => Promise<{ enabled: boolean; tunables: ProfileTunables }>;
export type AuditFn = (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<unknown>;

export class CustomerIntelligenceCenter {
  private readonly ret: RetentionRepository;
  constructor(private readonly db: Kysely<any>, private readonly settings: SettingsFn, private readonly now: () => number = () => Date.now()) { this.ret = new RetentionRepository(db); }

  private async scope(ctx: CiCtx, branch?: unknown): Promise<BranchScope> {
    try { return await this.ret.branchScope(ctx, branch); }
    catch (e: any) { throw new CustomerIntelligenceError(e?.message ?? 'Unknown branch.', e?.code === 'BRANCH_NOT_AUTHORIZED' ? 'BRANCH_NOT_AUTHORIZED' : 'INTELLIGENCE_INVALID_BRANCH', e?.status ?? 400); }
  }
  private custVisible(s: BranchScope) {
    if (!s.branchIds) return sql`true`;
    const ids = s.branchIds;
    return sql`(c.branch_id = any(${ids}::uuid[])
      or exists (select 1 from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.branch_id = any(${ids}::uuid[]) and t.removed_at is null)
      or exists (select 1 from pos_tech_appointments a where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.branch_id = any(${ids}::uuid[])))`;
  }
  private async tunables(ctx: CiCtx): Promise<ProfileTunables> {
    const st = await this.settings(ctx);
    if (!st.enabled) throw new CustomerIntelligenceError('The AI Customer Profile assistant is turned off for this salon.', 'AI_CUSTOMER_PROFILE_DISABLED', 403);
    return { ...DEFAULT_TUNABLES, ...(st.tunables ?? {}) };
  }

  // ── scan ──────────────────────────────────────────────────────────────────────────────────────────────────────
  /** classify every live customer; rate-limited (a completed scan inside 60 s is returned, `reused: true`) */
  async scan(ctx: CiCtx, trigger: 'manual' | 'auto' | 'scheduled' = 'manual') {
    const T = ctx.tenantId;
    const t = await this.tunables(ctx);
    const scanId = randomUUID();
    const started = this.now();
    try {
      return await this.db.transaction().execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtext('customer-intelligence-scan:' || ${T}))`.execute(trx);
        const last = (await sql<Row>`select id, status, scanned, counts, archived_excluded, rule_version, tunables, started_at, finished_at, duration_ms
          from customer_intelligence_scans where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`.execute(trx)).rows[0];
        if (last && last.rule_version === CI_RULE_VERSION && sameJson(last.tunables, t)
          && this.now() - new Date(last.finished_at).getTime() < SCAN_MIN_GAP_SECONDS * 1000) return { reused: true, scan: this.scanOut(last) };
        await sql`insert into customer_intelligence_scans (id, tenant_id, actor_user_id, trigger_kind, rule_version, tunables)
          values (${scanId}, ${T}, ${uuidOrNull(ctx.userId)}, ${trigger}, ${CI_RULE_VERSION}, ${JSON.stringify(t)}::jsonb)`.execute(trx);
        const { today } = await this.ret.window(ctx, { preset: 'today' });
        const nowIso = new Date(this.now()).toISOString();
        // two set-based reads for the whole salon (the same "completed visit" as Customer Search / Retention)
        const live = (await sql<Row>`select c.id from customers c where c.tenant_id = ${T} and c.archived_at is null`.execute(trx)).rows.map((r) => String(r.id));
        const archived = N((await sql<Row>`select count(*)::int as n from customers where tenant_id = ${T} and archived_at is not null`.execute(trx)).rows[0]?.n);
        const visitRows = (await sql<Row>`select t.customer_id, array_agg(coalesce(t.paid_at, t.finished_at, t.created_at) order by coalesce(t.paid_at, t.finished_at, t.created_at)) as at
          from tickets t join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id and c.archived_at is null
          where t.tenant_id = ${T} and t.removed_at is null and t.status = any(${VISIT}::text[]) group by t.customer_id`.execute(trx)).rows;
        const apptRows = (await sql<Row>`select a.customer_id, array_agg(a.appt_date::text order by a.appt_date) as d, array_agg(a.status order by a.appt_date) as s
          from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id is not null and a.appt_date >= ${today}::date
            and a.status in ('booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service') group by a.customer_id`.execute(trx)).rows;
        const histRows = (await sql<Row>`select a.customer_id, count(*) filter (where a.status = 'cancelled')::int as canceled, count(*) filter (where a.status = 'no_show')::int as no_shows
          from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id is not null group by a.customer_id`.execute(trx)).rows;
        const memRows = (await sql<Row>`select m.customer_id from customer_memberships m where m.tenant_id = ${T} and m.status in ('canceled', 'cancelled')
          and not exists (select 1 from customer_memberships x where x.tenant_id = m.tenant_id and x.customer_id = m.customer_id and x.status = 'active') group by m.customer_id`.execute(trx)).rows;
        const prevRows = (await sql<Row>`select customer_id, churn_level, churn_since, rebooking, rebooking_since from customer_intelligence_snapshots where tenant_id = ${T}`.execute(trx)).rows;
        const hist = new Map(histRows.map((r) => [String(r.customer_id), r]));
        const memCanceled = new Set(memRows.map((r) => String(r.customer_id)));
        const prev = new Map(prevRows.map((r) => [String(r.customer_id), r]));
        const visits = new Map(visitRows.map((r) => [String(r.customer_id), (r.at as unknown[]).map((x) => new Date(x as string).toISOString())]));
        const appts = new Map(apptRows.map((r) => [String(r.customer_id), (r.d as string[]).map((d, i) => ({ date: d, status: String((r.s as string[])[i]) }))]));
        const counts: Record<string, number> = Object.fromEntries([...CI_STATES, 'churn_watch', 'rebooking', 'with_upcoming', 'never_served', 'under_cadence', 'risk_insufficient', 'risk_low', 'risk_possible', 'risk_elevated', 'risk_high'].map((k) => [k, 0]));
        const rows = live.map((id) => { const hh = hist.get(id); return classifyCustomer(id, visits.get(id) ?? [], appts.get(id) ?? [], nowIso, t,
          { canceled: N(hh?.canceled), noShows: N(hh?.no_shows), membershipCanceled: memCanceled.has(id) }); });
        const FLAGGED = ['possible', 'elevated', 'high'];
        // a signal keeps the date it was first seen while it lasts; a new signal starts now; no signal has no date
        const since = (r: CiClassification) => (!FLAGGED.includes(r.churnLevel) ? null
          : FLAGGED.includes(String(prev.get(r.customerId)?.churn_level)) && prev.get(r.customerId)?.churn_since ? new Date(prev.get(r.customerId)!.churn_since).toISOString() : nowIso);
        // the same for a rebooking opportunity: "opportunity created" is the first scan that saw it, kept while it lasts
        const rebSince = (r: CiClassification) => (!r.rebooking ? null
          : prev.get(r.customerId)?.rebooking && prev.get(r.customerId)?.rebooking_since ? new Date(prev.get(r.customerId)!.rebooking_since).toISOString() : nowIso);
        for (const r of rows) {
          counts[r.status]++;
          if (r.churnWatch) counts.churn_watch++;
          if (r.rebooking) counts.rebooking++;
          if (r.hasUpcoming) counts.with_upcoming++;
          if (r.status === 'insufficient_history') counts[r.completedVisits === 0 ? 'never_served' : 'under_cadence']++;
          counts['risk_' + r.churnLevel]++;
        }
        await sql`delete from customer_intelligence_snapshots where tenant_id = ${T}`.execute(trx);
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          await sql`insert into customer_intelligence_snapshots (tenant_id, customer_id, scan_id, status, completed_visits, first_visit_at, last_visit_at, typical_interval_days,
              days_since_last, has_upcoming, next_appointment_date, churn_watch, rebooking, rebooking_reason, evidence,
              churn_level, churn_confidence, churn_evidence, canceled_count, no_show_count, membership_canceled, churn_since, rebooking_since, rebooking_due_on, rebooking_window_end)
            select ${T}::uuid, x.customer_id, ${scanId}::uuid, x.status, x.completed_visits, x.first_visit_at, x.last_visit_at, x.typical_interval_days, x.days_since_last,
              x.has_upcoming, x.next_appointment_date, x.churn_watch, x.rebooking, x.rebooking_reason, x.evidence,
              x.churn_level, x.churn_confidence, x.churn_evidence, x.canceled_count, x.no_show_count, x.membership_canceled, x.churn_since, x.rebooking_since, x.rebooking_due_on, x.rebooking_window_end
            from jsonb_to_recordset(${JSON.stringify(chunk.map((r) => ({
              customer_id: r.customerId, status: r.status, completed_visits: r.completedVisits, first_visit_at: r.firstVisitAt, last_visit_at: r.lastVisitAt,
              typical_interval_days: r.typicalIntervalDays, days_since_last: r.daysSinceLast, has_upcoming: r.hasUpcoming, next_appointment_date: r.nextAppointmentDate,
              churn_watch: r.churnWatch, rebooking: r.rebooking, rebooking_reason: r.rebookingReason, evidence: r.evidence,
              churn_level: r.churnLevel, churn_confidence: r.churnConfidence, churn_evidence: r.churnEvidence, canceled_count: r.canceledCount,
              no_show_count: r.noShowCount, membership_canceled: r.membershipCanceled, churn_since: since(r),
              rebooking_since: rebSince(r), rebooking_due_on: r.rebookingDueOn, rebooking_window_end: r.rebookingWindowEnd,
            })))}::jsonb) as x(customer_id uuid, status text, completed_visits int, first_visit_at timestamptz, last_visit_at timestamptz, typical_interval_days int,
              days_since_last int, has_upcoming boolean, next_appointment_date date, churn_watch boolean, rebooking boolean, rebooking_reason text, evidence text[],
              churn_level text, churn_confidence text, churn_evidence text[], canceled_count int, no_show_count int, membership_canceled boolean, churn_since timestamptz,
              rebooking_since timestamptz, rebooking_due_on date, rebooking_window_end date)`.execute(trx);
        }
        await sql`update customer_intelligence_scans set status = 'completed', finished_at = now(), scanned = ${rows.length}, counts = ${JSON.stringify(counts)}::jsonb,
          archived_excluded = ${archived}, duration_ms = ${Math.max(0, Math.round(this.now() - started))} where tenant_id = ${T} and id = ${scanId} and ${canMoveToSql(CUSTOMER_INTELLIGENCE_SCAN, 'completed')}`.execute(trx);
        const row = (await sql<Row>`select id, status, scanned, counts, archived_excluded, rule_version, tunables, started_at, finished_at, duration_ms
          from customer_intelligence_scans where tenant_id = ${T} and id = ${scanId}`.execute(trx)).rows[0];
        return { reused: false, scan: this.scanOut(row) };
      });
    } catch (e: any) {
      await sql`insert into customer_intelligence_scans (id, tenant_id, actor_user_id, trigger_kind, rule_version, tunables, status, finished_at, error_code)
        values (${randomUUID()}, ${T}, ${uuidOrNull(ctx.userId)}, ${trigger}, ${CI_RULE_VERSION}, ${JSON.stringify(t)}::jsonb, 'failed', now(), ${String(e?.code ?? 'SCAN_FAILED').slice(0, 60)})`.execute(this.db)
        .catch((err: unknown) => log.warn(`could not record a failed intelligence scan: ${(err as Error)?.message ?? err}`));
      if (e instanceof CustomerIntelligenceError) throw e;
      throw new CustomerIntelligenceError('The intelligence scan could not finish. Nothing was changed.', 'INTELLIGENCE_SCAN_FAILED', 503);
    }
  }
  private scanOut(r: Row) {
    return { id: r.id, status: r.status, scanned: N(r.scanned), counts: r.counts ?? {}, archivedExcluded: N(r.archived_excluded), ruleVersion: r.rule_version,
      tunables: r.tunables ?? {}, startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), durationMs: r.duration_ms == null ? null : N(r.duration_ms) };
  }
  private async freshness(T: string) {
    const rows = (await sql<Row>`select status, started_at, finished_at, error_code, rule_version from customer_intelligence_scans where tenant_id = ${T} order by started_at desc limit 5`.execute(this.db)).rows;
    const latest = rows[0];
    const lastOk = rows.find((r) => r.status === 'completed') ?? (await sql<Row>`select finished_at, rule_version from customer_intelligence_scans where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`.execute(this.db)).rows[0];
    const age = lastOk?.finished_at ? Math.floor((this.now() - new Date(lastOk.finished_at).getTime()) / 60000) : null;
    const state = latest?.status === 'running' ? 'running' : latest?.status === 'failed' ? 'failed' : !lastOk ? 'never'
      : lastOk.rule_version !== CI_RULE_VERSION || (age ?? 0) >= STALE_AFTER_MINUTES ? 'stale' : 'up_to_date';
    return { state, lastSuccessAt: iso(lastOk?.finished_at), lastError: latest?.status === 'failed' ? latest.error_code : null, minutesSinceSuccess: age, ruleVersion: CI_RULE_VERSION, staleAfterMinutes: STALE_AFTER_MINUTES };
  }

  // ── the six cards ─────────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: CiCtx) {
    const T = ctx.tenantId;
    const t = await this.tunables(ctx);
    const last = (await sql<Row>`select id, status, scanned, counts, archived_excluded, rule_version, tunables, started_at, finished_at, duration_ms
      from customer_intelligence_scans where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`.execute(this.db)).rows[0];
    const liveNow = N((await sql<Row>`select count(*)::int as n from customers where tenant_id = ${T} and archived_at is null`.execute(this.db)).rows[0]?.n);
    const dup = (await sql<Row>`select (select count(*)::int from customer_duplicate_groups where tenant_id = ${T} and status = any(${OPEN_DUP}::text[])) as open,
        (select max(finished_at) from customer_duplicate_scans where tenant_id = ${T} and status = 'completed') as last`.execute(this.db)).rows[0] ?? {};
    const c = (last?.counts ?? {}) as Record<string, number>;
    const scan = last ? this.scanOut(last) : null;
    return {
      cards: scan ? {
        duplicateGroups: dup.last ? N(dup.open) : null, active: N(c.active), withUpcoming: N(c.with_upcoming),
        inactive: N(c.inactive) + N(c.long_term_inactive), churnWatch: N(c.churn_watch), rebooking: N(c.rebooking), scanned: scan.scanned,
      } : null,
      // the reconciliation the screenshot could not show: every scanned profile is in exactly one state
      breakdown: scan ? {
        scanned: scan.scanned, states: Object.fromEntries(CI_STATES.map((s) => [s, N(c[s])])), neverServed: N(c.never_served), underCadence: N(c.under_cadence),
        sumOfStates: CI_STATES.reduce((n, s) => n + N(c[s]), 0), archivedExcluded: scan.archivedExcluded, liveNow, newSinceScan: Math.max(0, liveNow - scan.scanned),
      } : null,
      definitions: {
        ruleVersion: CI_RULE_VERSION, inactiveDays: t.inactiveDays, longTermInactiveDays: t.longTermInactiveDays, minVisitsForCadence: t.minVisitsForCadence,
        dueMultiplier: t.dueMultiplier, inactiveMultiplier: t.inactiveMultiplier, visitStatuses: VISIT,
      },
      duplicateReview: { lastScanAt: iso(dup.last), open: dup.last ? N(dup.open) : null },
      scan, freshness: await this.freshness(T),
    };
  }

  // ── authorized customer list ──────────────────────────────────────────────────────────────────────────────────
  async customers(ctx: CiCtx, f: CiQuery, opts: { fullContact: boolean }) {
    const T = ctx.tenantId;
    await this.tunables(ctx);
    const s = await this.scope(ctx, f.branch);
    const status = pick(CI_STATUS_FILTERS, f.status) ?? 'all';
    const flag = pick(CI_FLAGS, f.flag);
    const dateField = pick(CI_DATE_FIELDS, f.dateField) ?? 'last_visit';
    const sort = pick(CI_SORTS, f.sort) ?? 'last_visit';
    const pageSize = (CI_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q && q.length < 2) throw new CustomerIntelligenceError('Type at least 2 characters.', 'INTELLIGENCE_SEARCH_TOO_SHORT');
    const per = await this.period(ctx, f);

    const where = [sql`c.tenant_id = ${T}`, sql`c.archived_at is null`, this.custVisible(s)];
    if (status === 'never_served') where.push(sql`sn.status = 'insufficient_history' and sn.completed_visits = 0`);
    else if (status === 'not_scanned') where.push(sql`sn.customer_id is null`);
    else if (status === 'inactive_all') where.push(sql`sn.status in ('inactive', 'long_term_inactive')`);
    else if (status !== 'all') where.push(sql`sn.status = ${status}`);
    if (flag === 'churn_watch') where.push(sql`sn.churn_watch`);
    if (flag === 'rebooking') where.push(sql`sn.rebooking`);
    if (flag === 'upcoming') where.push(sql`sn.has_upcoming`);
    if (flag === 'duplicate') where.push(sql`exists (select 1 from customer_duplicate_groups g where g.tenant_id = ${T} and c.id = any(g.member_ids) and g.status = any(${OPEN_DUP}::text[]))`);
    if (per.start && per.end) {
      if (dateField === 'created') where.push(sql`c.created_at >= ${per.start} and c.created_at < ${per.end}`);
      else if (dateField === 'profile_updated') where.push(sql`c.updated_at >= ${per.start} and c.updated_at < ${per.end}`);
      else if (dateField === 'next_appointment') where.push(sql`sn.next_appointment_date >= ${per.from}::date and sn.next_appointment_date <= ${per.to}::date`);
      else where.push(sql`sn.last_visit_at >= ${per.start} and sn.last_visit_at < ${per.end}`);
    }
    if (q) where.push(customerSearchPredicate(T, q));
    const W = sql.join(where, sql` and `);
    const order = sort === 'recently_added' ? sql`c.created_at desc, c.id desc`
      : sort === 'name' ? sql`lower(coalesce(c.full_name, c.first_name)) asc, c.id asc`
      : sort === 'visits' ? sql`coalesce(sn.completed_visits, 0) desc, sn.last_visit_at desc nulls last, c.id desc`
      : sort === 'days_since' ? sql`sn.days_since_last desc nulls last, c.id desc`
      : sql`sn.last_visit_at desc nulls last, c.created_at desc, c.id desc`;
    const total = N((await sql<Row>`select count(*)::int as n from customers c left join customer_intelligence_snapshots sn on sn.tenant_id = c.tenant_id and sn.customer_id = c.id where c.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select c.id, c.full_name, c.first_name, c.last_name, c.normalized_phone, c.phone_display, c.email, c.created_at, c.preferred_technician_id,
        sn.status, sn.completed_visits, sn.last_visit_at, sn.days_since_last, sn.typical_interval_days, sn.has_upcoming, sn.next_appointment_date, sn.churn_watch, sn.rebooking,
        sn.rebooking_reason, sn.evidence, sn.computed_at,
        coalesce(nullif(pt.full_name, ''), trim(coalesce(pt.first_name, '') || ' ' || coalesce(pt.last_name, ''))) as preferred_technician,
        (select coalesce(nullif(tc.full_name, ''), trim(coalesce(tc.first_name, '') || ' ' || coalesce(tc.last_name, ''))) from tickets t join technicians tc on tc.id = t.primary_technician_id and tc.tenant_id = t.tenant_id
          where t.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT}::text[]) order by coalesce(t.paid_at, t.created_at) desc limit 1) as last_technician,
        lp.points_balance, lp.loyalty_tier,
        exists (select 1 from customer_memberships m where m.tenant_id = ${T} and m.customer_id = c.id and m.status = 'active') as member,
        exists (select 1 from customer_duplicate_groups g where g.tenant_id = ${T} and c.id = any(g.member_ids) and g.status = any(${OPEN_DUP}::text[])) as duplicate
      from customers c
      left join customer_intelligence_snapshots sn on sn.tenant_id = c.tenant_id and sn.customer_id = c.id
      left join technicians pt on pt.tenant_id = c.tenant_id and pt.id = c.preferred_technician_id
      left join customer_loyalty_profiles lp on lp.tenant_id = c.tenant_id and lp.customer_id = c.id
      where c.tenant_id = ${T} and ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => ({
        id: String(r.id), name: String(r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || '').trim() || null,
        phone: r.normalized_phone ? (opts.fullContact ? (r.phone_display || r.normalized_phone) : maskStoredPhone(r.normalized_phone)) : null,
        email: r.email ? (opts.fullContact ? String(r.email) : maskEmail(String(r.email))) : null, createdAt: iso(r.created_at),
        scanned: r.status != null, status: r.status ?? null, neverServed: r.status === 'insufficient_history' && N(r.completed_visits) === 0,
        completedVisits: r.status == null ? null : N(r.completed_visits), lastVisitAt: iso(r.last_visit_at), daysSinceLast: r.days_since_last == null ? null : N(r.days_since_last),
        typicalIntervalDays: r.typical_interval_days == null ? null : N(r.typical_interval_days), nextAppointmentDate: r.next_appointment_date ? String(r.next_appointment_date).slice(0, 10) : null,
        churnWatch: !!r.churn_watch, rebooking: !!r.rebooking, rebookingReason: r.rebooking_reason ?? null, evidence: (r.evidence ?? []) as string[], computedAt: iso(r.computed_at),
        lastTechnician: r.last_technician ? String(r.last_technician).trim() || null : null, preferredTechnician: r.preferred_technician ? String(r.preferred_technician).trim() || null : null,
        loyalty: r.points_balance == null ? null : { points: N(r.points_balance), tier: r.loyalty_tier ?? null }, member: !!r.member, duplicate: !!r.duplicate,
      })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, status, flag: flag ?? null, dateField, preset: per.preset, from: per.from, to: per.to, sort },
      period: { from: per.from, to: per.to, timeZone: per.tz, today: per.today }, contact: opts.fullContact ? 'full' : 'masked',
      freshness: await this.freshness(T),
    };
  }
  private async period(ctx: CiCtx, f: CiQuery) {
    const preset = pick(CI_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    const w = await this.ret.window(ctx, { preset: 'today' });
    const today = w.today, tz = w.tz;
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today, tz };
    let from: string, to: string;
    if (preset === 'custom') {
      const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
      const b = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
      if (!a || !b) throw new CustomerIntelligenceError('Choose a From and a To date.', 'INTELLIGENCE_INVALID_PERIOD');
      if (a > b) throw new CustomerIntelligenceError('The From date must be on or before the To date.', 'INTELLIGENCE_INVALID_PERIOD');
      from = a; to = b;
    } else ({ from, to } = salonPresetRange(preset, today)!);
    const b = (await sql<Row>`select (${from}::date::timestamp at time zone ${tz}) as s, ((${to}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(b.s) as Date | null, end: new Date(b.e) as Date | null, today, tz };
  }

  /** one customer's classification with its evidence (the 360° identity / visits / benefits come from Customer Search) */
  async customer(ctx: CiCtx, id: string, audit: AuditFn) {
    const T = ctx.tenantId;
    await this.tunables(ctx);
    const s = await this.scope(ctx);
    if (!isUuid(`${id}`)) throw new CustomerIntelligenceError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const r = (await sql<Row>`select c.id, sn.status, sn.completed_visits, sn.first_visit_at, sn.last_visit_at, sn.typical_interval_days, sn.days_since_last, sn.has_upcoming,
        sn.next_appointment_date, sn.churn_watch, sn.rebooking, sn.rebooking_reason, sn.evidence, sn.computed_at, sn.scan_id
      from customers c left join customer_intelligence_snapshots sn on sn.tenant_id = c.tenant_id and sn.customer_id = c.id
      where c.tenant_id = ${T} and c.id = ${id}::uuid and ${this.custVisible(s)}`.execute(this.db)).rows[0];
    if (!r) throw new CustomerIntelligenceError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const groups = (await sql<Row>`select id, confidence, status, reasons from customer_duplicate_groups where tenant_id = ${T} and ${id}::uuid = any(member_ids) and status = any(${OPEN_DUP}::text[]) order by detected_at desc limit 5`.execute(this.db)).rows;
    await this.db.transaction().execute(async (trx) => { await audit(trx as unknown as Kysely<any>, { customerId: id }); });
    return {
      customerId: id, scanned: r.status != null,
      classification: r.status == null ? null : {
        status: r.status, completedVisits: N(r.completed_visits), firstVisitAt: iso(r.first_visit_at), lastVisitAt: iso(r.last_visit_at),
        typicalIntervalDays: r.typical_interval_days == null ? null : N(r.typical_interval_days), daysSinceLast: r.days_since_last == null ? null : N(r.days_since_last),
        hasUpcoming: !!r.has_upcoming, nextAppointmentDate: r.next_appointment_date ? String(r.next_appointment_date).slice(0, 10) : null,
        churnWatch: !!r.churn_watch, rebooking: !!r.rebooking, rebookingReason: r.rebooking_reason ?? null, evidence: (r.evidence ?? []) as string[], computedAt: iso(r.computed_at), scanId: r.scan_id,
      },
      duplicateGroups: groups.map((g) => ({ id: String(g.id), confidence: g.confidence, status: g.status, reasons: g.reasons })),
    };
  }

  /** scan history = the dashboard's own activity, newest first */
  async scans(ctx: CiCtx, f: { page?: unknown; pageSize?: unknown; preset?: unknown; from?: unknown; to?: unknown }) {
    const T = ctx.tenantId;
    await this.tunables(ctx);
    const pageSize = (CI_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const per = await this.period(ctx, f);
    const range = per.start && per.end ? sql`and started_at >= ${per.start} and started_at < ${per.end}` : sql``;
    const total = N((await sql<Row>`select count(*)::int as n from customer_intelligence_scans where tenant_id = ${T} ${range}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select s.id, s.status, s.scanned, s.counts, s.archived_excluded, s.rule_version, s.tunables, s.started_at, s.finished_at, s.duration_ms, s.error_code, s.trigger_kind,
        coalesce(u.full_name, u.email) as actor
      from customer_intelligence_scans s left join users u on u.id = s.actor_user_id and u.tenant_id = ${T}
      where s.tenant_id = ${T} ${range} order by s.started_at desc, s.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ ...this.scanOut(r), errorCode: r.error_code ?? null, trigger: r.trigger_kind, actor: r.actor ?? null })), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  // ── Check Customer Intelligence System (read-only; records its own evidence; one run per salon per 30 s) ──────
  async check(ctx: CiCtx) {
    const T = ctx.tenantId;
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from customer_intelligence_health_runs where tenant_id = ${T} and branch_id is not distinct from ${uuidOrNull(ctx.branchId)}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: CiCheck[] = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    let enabled = true;
    try { const st = await this.settings(ctx); enabled = !!st.enabled; } catch { enabled = false; }
    checks.push({ key: 'assistant_enabled', state: enabled ? 'PASSED' : 'WARNING' });

    const fr = await this.freshness(T);
    checks.push({ key: 'scan_freshness', state: fr.state === 'up_to_date' ? 'PASSED' : fr.state === 'never' ? 'INSUFFICIENT_DATA' : fr.state === 'failed' ? 'FAILED' : 'WARNING', detail: { state: fr.state, lastSuccessAt: fr.lastSuccessAt, lastError: fr.lastError } });
    const last = await one(sql<Row>`select scanned, counts, finished_at from customer_intelligence_scans where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`);
    const c = (last.counts ?? {}) as Record<string, number>;
    const sum = CI_STATES.reduce((n, s) => n + N(c[s]), 0);
    checks.push({ key: 'counts_reconcile', state: !last.finished_at ? 'INSUFFICIENT_DATA' : sum === N(last.scanned) ? 'PASSED' : 'FAILED', count: N(last.scanned), detail: { sumOfStates: sum, scanned: N(last.scanned) } });
    if (last.finished_at) checks.push({ key: 'eligibility', state: 'PASSED', count: N(last.scanned), detail: {
      scanned: N(last.scanned), active: N(c.active), inactiveCard: N(c.inactive) + N(c.long_term_inactive), rebookingSoon: N(c.rebooking_soon), dueForReturn: N(c.due_for_return),
      neverServed: N(c.never_served), underCadence: N(c.under_cadence) } });
    const snapRows = N((await one(sql<Row>`select count(*)::int as n from customer_intelligence_snapshots where tenant_id = ${T}`)).n);
    checks.push({ key: 'snapshot_matches_scan', state: !last.finished_at ? 'INSUFFICIENT_DATA' : snapRows === N(last.scanned) ? 'PASSED' : 'FAILED', count: snapRows });
    const liveNow = N((await one(sql<Row>`select count(*)::int as n from customers where tenant_id = ${T} and archived_at is null`)).n);
    const archivedInSnap = N((await one(sql<Row>`select count(*)::int as n from customer_intelligence_snapshots sn join customers c on c.id = sn.customer_id where sn.tenant_id = ${T} and c.archived_at is not null`)).n);
    checks.push({ key: 'coverage', state: !last.finished_at ? 'INSUFFICIENT_DATA' : liveNow !== N(last.scanned) || archivedInSnap ? 'WARNING' : 'PASSED', count: Math.abs(liveNow - N(last.scanned)), detail: { liveNow, scanned: N(last.scanned), archivedSinceScan: archivedInSnap } });
    const cross = N((await one(sql<Row>`select count(*)::int as n from customer_intelligence_snapshots sn join customers c on c.id = sn.customer_id where sn.tenant_id = ${T} and c.tenant_id <> sn.tenant_id`)).n);
    checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });
    const visitsNoTime = N((await one(sql<Row>`select count(*)::int as n from tickets where tenant_id = ${T} and customer_id is not null and removed_at is null and status = any(${VISIT}::text[]) and paid_at is null and finished_at is null`)).n);
    const visitsAnon = N((await one(sql<Row>`select count(*)::int as n from tickets where tenant_id = ${T} and customer_id is null and removed_at is null and status = any(${VISIT}::text[]) and coalesce(paid_at, created_at) >= now() - interval '90 days'`)).n);
    checks.push({ key: 'completed_visits', state: visitsNoTime ? 'WARNING' : 'PASSED', count: visitsNoTime, detail: { withoutCompletionTime: visitsNoTime, withoutCustomer90d: visitsAnon } });
    const apptArchived = N((await one(sql<Row>`select count(*)::int as n from pos_tech_appointments a join customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.appt_date >= (now() at time zone coalesce((select bz.timezone from branches bz where bz.id = a.branch_id and bz.tenant_id = a.tenant_id), 'America/New_York'))::date and a.status in ('booked', 'confirmed') and c.archived_at is not null`)).n);
    checks.push({ key: 'booking_sync', state: apptArchived ? 'WARNING' : 'PASSED', count: apptArchived });
    const dup = await one(sql<Row>`select (select max(finished_at) from customer_duplicate_scans where tenant_id = ${T} and status = 'completed') as last,
      (select count(*)::int from customer_duplicate_groups where tenant_id = ${T} and status = any(${OPEN_DUP}::text[])) as open`);
    checks.push({ key: 'duplicate_review', state: !dup.last ? 'INSUFFICIENT_DATA' : N(dup.open) ? 'WARNING' : 'PASSED', count: N(dup.open), detail: { lastScanAt: iso(dup.last) } });
    const sample = toStoredCustomerPhone('(609) 555-0101');
    checks.push({ key: 'phone_normalizer', state: sample && sample === toStoredCustomerPhone('+1 609 555 0101') ? 'PASSED' : 'FAILED' });
    const idx = (await sql<Row>`select indexname from pg_indexes where indexname = any(${['ix_customer_intelligence_snap_status', 'ix_customer_intelligence_snap_last', 'idx_tickets_tenant_customer_paid', 'ix_customers_tenant_created']}::text[])`.execute(this.db)).rows.length;
    checks.push({ key: 'indexes', state: idx === 4 ? 'PASSED' : 'WARNING', count: 4 - idx });

    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('customer-intelligence-health:' || ${T} || ':' || coalesce(${uuidOrNull(ctx.branchId)}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into customer_intelligence_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${uuidOrNull(ctx.branchId)}, ${uuidOrNull(ctx.userId)}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
