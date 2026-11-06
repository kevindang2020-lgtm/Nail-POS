// retention-snapshots.ts — Customer Retention, Four-Module Completion Guide (Oct 30 2026) CR-01: versioned historical
// snapshots ("Who was At Risk on September 1?"). One durable, idempotent job (`retention.snapshot.day`) computes ONE
// completed salon-local day for ONE salon and writes one append-only row per customer; GET handlers only READ them
// (nothing is recomputed in a GET). Raw SQL, the tenant written in every statement.
//
// Definition version = SEGMENTATION_VERSION + the salon's settings version IN FORCE at the end of that day
// (tenant_retention_settings_history). A later threshold change is a NEW definition_version — history is never rewritten.
//
// What a day means (the same rules as the live screen, evaluated "as recorded at the end of that salon day"):
//   customer   profile created before the end of the day, not archived by then (archived with no date = excluded)
//   visit      a ticket with status closed / paid, visit time coalesce(paid_at, created_at) before the end of the day, not
//              removed by then; one ticket = one visit; canceled / open tickets and bookings are not visits
//   value      settled ticket totals minus refunds recorded by then (net, never below 0)
//   segment    never_visited (0 visits) · at_risk (days away ≥ risk) · approaching (≥ approaching) · active
// Coverage (run + every row): complete = computed by the nightly job for yesterday; reconstructed = rebuilt later from
// ticket history (backfill or a late nightly run); incomplete = NOT computed (no rows): the day is before the salon's
// first ticket record, the salon has no ticket history, or the thresholds in force that day are unknown. The screen shows
// "Incomplete / unverifiable" for those and for a day with no run at all — never an invented snapshot.
import { dateColumnYmd, utcDate } from '@aipowersalon/date-time';
import { withCode } from '@aipowersalon/api-contracts';
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { tenantTimeZone, enqueueJob, PermanentJobError, canMoveToSql } from '@aipowersalon/database';
import { CUSTOMER_RETENTION_SNAPSHOT_RUN } from '../customer-lifecycles';
import { logException } from '@aipowersalon/observability';
import { VISIT_TICKET_STATUSES } from '../customers/customer-segments';
import { RetentionError, SEGMENTATION_VERSION, DEFAULT_RISK_DAYS, DEFAULT_APPROACHING_DAYS, maskPhone, isUuid, type RetentionContext } from './retention.repository';

export const RETENTION_SNAPSHOT_JOB = 'retention.snapshot.day';
export const MAX_BACKFILL_DAYS = 366;
export const SNAPSHOT_SEGMENTS = ['never_visited', 'active', 'approaching', 'at_risk'] as const;
export type SnapshotSegment = (typeof SNAPSHOT_SEGMENTS)[number];
const VISIT = [...VISIT_TICKET_STATUSES] as string[];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const ymd = (v: unknown) => dateColumnYmd(v);   // DATE columns are selected as text (to_char) — right for node-postgres and PGlite alike
export const definitionVersion = (settingsVersion: number | null) => `${SEGMENTATION_VERSION}+s${settingsVersion == null ? 'unknown' : settingsVersion}`;
const validDay = (d: unknown): d is string => typeof d === 'string' && DAY.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && utcDate(new Date(d + 'T00:00:00Z')) === d;

export interface DefinitionInForce { known: boolean; version: number | null; riskDays: number; approachingDays: number; source: 'history' | 'defaults' | 'unknown' }
export interface ComputeResult { outcome: 'computed' | 'skipped' | 'incomplete'; runId: string; definitionVersion: string; rows: number; coverage: string | null; reason: string | null }

async function zoneOf(db: Kysely<any>, tenantId: string): Promise<string> {
  try { return await tenantTimeZone(db, tenantId); }
  catch (e) { logException(e, { where: 'retention-snapshots.time_zone', tenantId }); return 'America/New_York'; }
}

/** the snapshot-run columns runOut / day() read — never the whole row */
const SNAP_RUN_COLS = sql`r.has_branch, r.id, to_char(r.snapshot_local_date, 'YYYY-MM-DD') as snapshot_local_date, r.status, r.coverage, r.coverage_reason, r.kind, r.definition_version, r.settings_version,
  r.segmentation_version, r.risk_days, r.approaching_days, r.time_zone, r.customers_count, r.rows_written, r.attempts, r.last_error,
  r.source_watermark, r.earliest_ticket_at, r.started_at, r.finished_at`;

export class RetentionSnapshotRepository {
  constructor(readonly db: Kysely<any>) {}

  async todayOf(tenantId: string): Promise<{ tz: string; today: string }> {
    const tz = await zoneOf(this.db, tenantId);
    const r = (await sql<any>`select (now() at time zone ${tz})::date::text as d`.execute(this.db)).rows[0];
    return { tz, today: String(r.d) };
  }

  /** the thresholds in force at the END of salon-local `date` (the latest history row that took effect before then) */
  async definitionAt(tenantId: string, date: string, tz: string): Promise<DefinitionInForce> {
    const r = (await sql<any>`select h.version, h.risk_days, h.approaching_days from tenant_retention_settings_history h
      where h.tenant_id = ${tenantId} and h.effective_from < ((${date}::date + 1)::timestamp at time zone ${tz}) order by h.effective_from desc, h.version desc limit 1`.execute(this.db)).rows[0];
    if (r) return { known: true, version: N(r.version), riskDays: N(r.risk_days), approachingDays: N(r.approaching_days), source: 'history' };
    const first = (await sql<any>`select h.version, h.source from tenant_retention_settings_history h where h.tenant_id = ${tenantId} order by h.effective_from asc, h.version asc limit 1`.execute(this.db)).rows[0];
    const cur = (await sql<any>`select s.version from tenant_retention_settings s where s.tenant_id = ${tenantId}`.execute(this.db)).rows[0];
    // before the first recorded version: the documented defaults (version 0) — known only when that first version is 1
    // (an edit made through the screen) or the salon never changed its thresholds
    if ((!first && !cur) || (first && N(first.version) === 1)) return { known: true, version: 0, riskDays: DEFAULT_RISK_DAYS, approachingDays: DEFAULT_APPROACHING_DAYS, source: 'defaults' };
    return { known: false, version: null, riskDays: DEFAULT_RISK_DAYS, approachingDays: DEFAULT_APPROACHING_DAYS, source: 'unknown' };
  }

  /** Compute one completed salon-local day. Idempotent: a completed run for (salon, date, definition) is returned as-is;
   *  a failed / interrupted one is re-run (rows are insert-only; the whole day is written in ONE transaction). */
  async computeDay(tenantId: string, date: string, opts: { kind: 'nightly' | 'backfill'; jobId?: string | null; requestedBy?: string | null }): Promise<ComputeResult> {
    if (!isUuid(tenantId)) throw withCode(new PermanentJobError('bad tenant'), 'VALIDATION_FAILED');
    if (!validDay(date)) throw new RetentionError('Choose a valid date.', 'SNAPSHOT_INVALID_DATE');
    const { tz, today } = await this.todayOf(tenantId);
    if (date >= today) throw new RetentionError('Only a completed salon day can be snapshotted.', 'SNAPSHOT_INVALID_DATE');
    const def = await this.definitionAt(tenantId, date, tz);
    const dv = definitionVersion(def.version);
    const T = tenantId;
    const claim = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'retention-snapshot:' + T + ':' + date}))`.execute(trx);
      const ex = (await sql<any>`select r.id, r.status, r.coverage, r.coverage_reason, r.rows_written from customer_retention_snapshot_runs r
        where r.tenant_id = ${T} and r.snapshot_local_date = ${date}::date and r.definition_version = ${dv} for update`.execute(trx)).rows[0];
      if (ex?.status === 'completed') return { skip: true as const, id: String(ex.id), rows: N(ex.rows_written), coverage: ex.coverage ?? null, reason: ex.coverage_reason ?? null };
      if (ex) {
        await sql`update customer_retention_snapshot_runs set status = 'running', attempts = attempts + 1, last_error = null, started_at = now(), updated_at = now(),
          job_id = coalesce(${opts.jobId ?? null}::uuid, job_id) where tenant_id = ${T} and id = ${ex.id} and ${canMoveToSql(CUSTOMER_RETENTION_SNAPSHOT_RUN, 'running')}`.execute(trx);
        return { skip: false as const, id: String(ex.id) };
      }
      const ins = (await sql<any>`insert into customer_retention_snapshot_runs (tenant_id, snapshot_local_date, definition_version, settings_version, segmentation_version, risk_days, approaching_days,
          time_zone, kind, status, job_id, requested_by_user_id)
        values (${T}, ${date}::date, ${dv}, ${def.version ?? -1}, ${SEGMENTATION_VERSION}, ${def.riskDays}, ${def.approachingDays}, ${tz}, ${opts.kind}, 'running', ${opts.jobId ?? null}, ${isUuid(opts.requestedBy) ? opts.requestedBy : null})
        returning id`.execute(trx)).rows[0];
      return { skip: false as const, id: String(ins.id) };
    });
    if (claim.skip) return { outcome: 'skipped', runId: claim.id, definitionVersion: dv, rows: claim.rows, coverage: claim.coverage, reason: claim.reason };
    const runId = claim.id;
    try {
      const src = (await sql<any>`select max(t.updated_at) as wm, min(t.created_at) as earliest, (min(t.created_at) at time zone ${tz})::date::text as earliest_day
        from tickets t where t.tenant_id = ${T}`.execute(this.db)).rows[0] || {};
      const reason = !def.known ? 'definition_unknown' : !src.earliest ? 'no_ticket_history' : date < String(src.earliest_day) ? 'before_ticket_history' : null;
      if (reason) {
        const fin = (await sql<{ id: string }>`update customer_retention_snapshot_runs set status = 'completed', coverage = 'incomplete', coverage_reason = ${reason}, rows_written = 0, customers_count = 0,
          source_watermark = ${src.wm ?? null}, earliest_ticket_at = ${src.earliest ?? null}, finished_at = now(), updated_at = now() where tenant_id = ${T} and id = ${runId} and ${canMoveToSql(CUSTOMER_RETENTION_SNAPSHOT_RUN, 'completed')}
          returning id`.execute(this.db)).rows[0];
        if (!fin) throw withCode(new Error(`retention snapshot run ${runId} is no longer running`), 'INVALID_STATE_TRANSITION');
        return { outcome: 'incomplete', runId, definitionVersion: dv, rows: 0, coverage: 'incomplete', reason };
      }
      const yesterday = (await sql<any>`select (${today}::date - 1)::text as d`.execute(this.db)).rows[0].d;
      const quality = opts.kind === 'nightly' && date === String(yesterday) ? 'complete' : 'reconstructed';
      const rows = await this.db.transaction().execute(async (trx) => {
        const r = (await sql<any>`with tw as (select ((${date}::date + 1)::timestamp at time zone ${tz}) as e),
          tv as (select t.id, t.customer_id, t.branch_id, coalesce(t.paid_at, t.created_at) as vt, coalesce(t.total_cents, 0)::bigint as total_cents
                 from tickets t, tw where t.tenant_id = ${T} and t.customer_id is not null and t.status = any(${VISIT}::text[])
                   and (t.removed_at is null or t.removed_at >= tw.e) and coalesce(t.paid_at, t.created_at) < tw.e),
          v as (select tv.customer_id, count(*)::int as visits, min(tv.vt) as first_vt, max(tv.vt) as last_vt, sum(tv.total_cents)::bigint as spend from tv group by tv.customer_id),
          lb as (select distinct on (tv.customer_id) tv.customer_id, tv.branch_id from tv order by tv.customer_id, tv.vt desc, tv.id desc),
          rf as (select tv.customer_id, coalesce(sum(pr.amount_cents), 0)::bigint as refunded
                 from payment_refunds pr join payments p on p.id = pr.payment_id and p.tenant_id = pr.tenant_id join tv on tv.id = p.ticket_id, tw
                 where pr.tenant_id = ${T} and pr.status = 'refunded' and pr.created_at < tw.e group by tv.customer_id),
          cu as (select c.id, c.branch_id as home_branch_id from customers c, tw where c.tenant_id = ${T} and c.created_at < tw.e
                 and (c.status <> 'archived' or (c.archived_at is not null and c.archived_at >= tw.e))),
          x as (select cu.id, cu.home_branch_id, lb.branch_id as last_branch_id, coalesce(v.visits, 0) as visits, v.first_vt, v.last_vt, greatest(0, coalesce(v.spend, 0) - coalesce(rf.refunded, 0))::bigint as net,
                 case when v.last_vt is null then null else (${date}::date - (v.last_vt at time zone ${tz})::date) end as days,
                 -- Customer Segments §11: the VIP flag / loyalty tier IN FORCE are recorded only for a COMPLETE (nightly, yesterday)
                 -- day; a reconstructed day leaves them NULL (a past VIP flag is not reproducible — never invented)
                 case when ${quality}::text = 'complete' then (lp.vip_since is not null or coalesce(lp.loyalty_tier, '') ~* 'vip') end as is_vip,
                 case when ${quality}::text = 'complete' then coalesce(lp.loyalty_tier, 'Regular') end as loyalty_tier
                 from cu left join v on v.customer_id = cu.id left join lb on lb.customer_id = cu.id left join rf on rf.customer_id = cu.id
                 left join lateral (select clp.loyalty_tier, clp.vip_since from customer_loyalty_profiles clp where clp.tenant_id = ${T} and clp.customer_id = cu.id order by clp.created_at limit 1) lp on true),
          ins as (insert into customer_retention_daily_snapshots (tenant_id, customer_id, snapshot_local_date, definition_version, settings_version, segment, first_visit_at, last_visit_at,
                   visit_count, net_lifetime_value_cents, days_away, data_quality, run_id, source_watermark, calculated_at, is_vip, loyalty_tier, last_visit_branch_id, home_branch_id)
                 select ${T}, x.id, ${date}::date, ${dv}, ${def.version ?? -1},
                   case when x.visits = 0 then 'never_visited' when x.days >= ${def.riskDays} then 'at_risk' when x.days >= ${def.approachingDays} then 'approaching' else 'active' end,
                   x.first_vt, x.last_vt, x.visits, x.net, x.days, ${quality}, ${runId}::uuid, ${src.wm ?? null}, now(), x.is_vip, x.loyalty_tier, x.last_branch_id, x.home_branch_id
                 from x on conflict do nothing returning 1)
          select (select count(*) from ins)::int as written, (select count(*) from c)::int as customers`.execute(trx)).rows[0];
        const fin = (await sql<{ id: string }>`update customer_retention_snapshot_runs set status = 'completed', coverage = ${quality}, coverage_reason = null, rows_written = ${N(r.written)}, customers_count = ${N(r.customers)}, has_branch = true,
          source_watermark = ${src.wm ?? null}, earliest_ticket_at = ${src.earliest ?? null}, finished_at = now(), updated_at = now() where tenant_id = ${T} and id = ${runId} and ${canMoveToSql(CUSTOMER_RETENTION_SNAPSHOT_RUN, 'completed')}
          returning id`.execute(trx)).rows[0];
        // another run finished this day first: roll back this one's rows (the day keeps the first, complete result)
        if (!fin) throw withCode(new Error(`retention snapshot run ${runId} is no longer running`), 'INVALID_STATE_TRANSITION');
        return N(r.written);
      });
      return { outcome: 'computed', runId, definitionVersion: dv, rows, coverage: quality, reason: null };
    } catch (e) {
      // the failure is VISIBLE on the run (status failed + error) and the job queue retries with backoff
      await sql`update customer_retention_snapshot_runs set status = 'failed', last_error = ${String((e as Error)?.message ?? e).slice(0, 300)}, finished_at = now(), updated_at = now()
        where tenant_id = ${T} and id = ${runId} and ${canMoveToSql(CUSTOMER_RETENTION_SNAPSHOT_RUN, 'failed')}`.execute(this.db);   // a run another attempt completed stays completed
      throw e;
    }
  }

  /** enqueue one day (durable job; idempotent per key) */
  async enqueueDay(db: Kysely<any>, tenantId: string, date: string, kind: 'nightly' | 'backfill', key: string, runAfter?: Date, createdBy?: string | null) {
    return enqueueJob(db, { jobClass: 'standard', jobType: RETENTION_SNAPSHOT_JOB, tenantId, payload: { tenantId, date, kind, requestedBy: createdBy ?? null },
      idempotencyKey: key, runAfter, maxAttempts: 5, createdBy: isUuid(createdBy) ? createdBy : null });
  }

  /** CR-01 backfill: a bounded range of past salon days (≤ 366, all before today) → one job per day, staggered; the audit
   *  runs in the SAME transaction (fail-closed: no audit row → nothing queued). */
  async requestBackfill(ctx: RetentionContext, b: { from: unknown; to: unknown }, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    if (!validDay(b.from) || !validDay(b.to)) throw new RetentionError('Choose a From and a To date.', 'SNAPSHOT_INVALID_RANGE');
    const from = b.from, to = b.to;
    if (from > to) throw new RetentionError('The From date must be on or before the To date.', 'SNAPSHOT_INVALID_RANGE');
    const { today } = await this.todayOf(ctx.tenantId);
    if (to >= today) throw new RetentionError('Backfill completed days only (before today).', 'SNAPSHOT_INVALID_RANGE');
    const days = (await sql<any>`select d::date::text as d from generate_series(${from}::date, ${to}::date, interval '1 day') d`.execute(this.db)).rows.map((r: any) => String(r.d));
    if (days.length > MAX_BACKFILL_DAYS) throw new RetentionError(`Choose ${MAX_BACKFILL_DAYS} days or fewer.`, 'SNAPSHOT_INVALID_RANGE');
    const requestId = randomUUID();
    const user = isUuid(ctx.userId) ? ctx.userId : null;
    const queued = await this.db.transaction().execute(async (trx) => {
      let n = 0; const start = Date.now();
      for (let i = 0; i < days.length; i++) {
        const r = await this.enqueueDay(trx, ctx.tenantId, days[i]!, 'backfill', `retention-snapshot:${ctx.tenantId}:${days[i]}:${requestId}`, new Date(start + i * 2000), user);
        if (!r.duplicate) n++;
      }
      await audit(trx, { requestId, from, to, days: days.length });
      return n;
    });
    return { requestId, from, to, days: days.length, queued };
  }

  /** the run that answers a date: a completed one first, newest */
  private async runFor(tenantId: string, date: string) {
    return (await sql<any>`select ${SNAP_RUN_COLS} from customer_retention_snapshot_runs r where r.tenant_id = ${tenantId} and r.snapshot_local_date = ${date}::date
      order by (r.status = 'completed') desc, r.finished_at desc nulls last, r.created_at desc limit 1`.execute(this.db)).rows[0];
  }
  private runOut(r: any) {
    return { runId: String(r.id), date: ymd(r.snapshot_local_date), status: String(r.status), coverage: r.coverage ?? null, coverageReason: r.coverage_reason ?? null, kind: String(r.kind),
      definitionVersion: String(r.definition_version), settingsVersion: N(r.settings_version) < 0 ? null : N(r.settings_version), segmentationVersion: String(r.segmentation_version),
      riskDays: N(r.risk_days), approachingDays: N(r.approaching_days), timeZone: String(r.time_zone), customers: N(r.customers_count), rows: N(r.rows_written), attempts: N(r.attempts),
      lastError: r.last_error ? String(r.last_error).slice(0, 200) : null, sourceWatermark: iso(r.source_watermark), earliestTicketAt: iso(r.earliest_ticket_at), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at) };
  }

  /** C3/C5 gap (Nov 5 2026): one location's customers on a snapshot day — the location of their last visit that day, or their
   *  home location if they had never visited */
  private branchPred(branches: string[] | null) {
    return branches ? sql`(s.last_visit_branch_id = any(${branches}::uuid[]) or (s.last_visit_branch_id is null and s.home_branch_id = any(${branches}::uuid[])))` : sql`true`;
  }
  /** the locations a history view covers — the same rule as the live screen (CR-02): a location-confined role sees only its
   *  location(s) (it saw the whole salon's history before); a requested location must be one of the authorized ones */
  async branchOf(ctx: RetentionContext, raw: unknown): Promise<string[] | null> {
    const req = typeof raw === 'string' && raw.trim() && raw.trim() !== 'all' ? raw.trim() : null;
    const confined = ctx.authz?.scope === 'BRANCH' || ctx.authz?.scope === 'SELECTED_BRANCHES';
    if (!req && !confined) return null;
    const rows = (await sql<any>`select b.id::text as id from branches b where b.tenant_id = ${ctx.tenantId} and b.deleted_at is null`.execute(this.db)).rows.map((r: any) => String(r.id));
    const own = (ctx.authz?.branchIds ?? []).filter((b): b is string => typeof b === 'string' && /^[0-9a-f-]{36}$/i.test(b));
    const allowed = confined ? rows.filter((id) => (own.length ? own : [ctx.branchId]).includes(id)) : rows;
    if (!req) return allowed;
    if (!/^[0-9a-f-]{36}$/i.test(req) || !rows.includes(req)) throw new RetentionError('Unknown branch.', 'RETENTION_INVALID_BRANCH');
    if (!allowed.includes(req)) throw new RetentionError('You do not have access to that branch.', 'BRANCH_NOT_AUTHORIZED', 403);
    return [req];
  }

  /** GET one historical date: state (available / incomplete / missing / running / failed) + segment counts — read only.
   *  With a location: only that location's customers; a day computed before locations were recorded says so (no_branch_data). */
  async day(ctx: RetentionContext, date: unknown, branchRaw: unknown = null) {
    const branch = await this.branchOf(ctx, branchRaw);
    if (!validDay(date)) throw new RetentionError('Choose a valid date.', 'SNAPSHOT_INVALID_DATE');
    const { today, tz } = await this.todayOf(ctx.tenantId);
    if (date >= today) return { date, today, timeZone: tz, state: 'not_completed' as const, unverifiable: true, run: null, counts: null };
    const r = await this.runFor(ctx.tenantId, date);
    if (!r) return { date, today, timeZone: tz, state: 'missing' as const, unverifiable: true, run: null, counts: null };
    const run = this.runOut(r);
    if (r.status !== 'completed') return { date, today, timeZone: tz, state: r.status === 'failed' ? 'failed' as const : 'running' as const, unverifiable: true, run, counts: null };
    if (r.coverage === 'incomplete') return { date, today, timeZone: tz, state: 'incomplete' as const, unverifiable: true, run, counts: null };
    if (branch && !r.has_branch) return { date, today, timeZone: tz, state: 'no_branch_data' as const, unverifiable: true, run, counts: null, branch };
    const c = (await sql<any>`select count(*)::int as total, count(*) filter (where s.segment = 'never_visited')::int as never_visited, count(*) filter (where s.segment = 'active')::int as active,
        count(*) filter (where s.segment = 'approaching')::int as approaching, count(*) filter (where s.segment = 'at_risk')::int as at_risk,
        coalesce(sum(s.net_lifetime_value_cents) filter (where s.segment = 'at_risk'), 0)::bigint as lapsed
      from customer_retention_daily_snapshots s where s.tenant_id = ${ctx.tenantId} and s.snapshot_local_date = ${date}::date and s.definition_version = ${r.definition_version} and ${this.branchPred(branch)}`.execute(this.db)).rows[0] || {};
    return { date, today, timeZone: tz, state: 'available' as const, unverifiable: false, run, branch,
      counts: { total: N(c.total), never_visited: N(c.never_visited), active: N(c.active), approaching: N(c.approaching), at_risk: N(c.at_risk), lapsedValueCents: N(c.lapsed) } };
  }

  /** GET the members of a historical segment (drill-down), paged; names are today's profile names, the figures that day's */
  async members(ctx: RetentionContext, f: { date?: unknown; segment?: unknown; q?: unknown; branch?: unknown; page?: unknown; pageSize?: unknown }) {
    const d = await this.day(ctx, f.date, f.branch);
    const branch = (d as { branch?: string[] | null }).branch ?? null;
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(f.pageSize)) || 10)); const page = Math.max(1, Math.trunc(Number(f.page)) || 1);
    const seg = (SNAPSHOT_SEGMENTS as readonly string[]).includes(String(f.segment)) ? String(f.segment) : null;
    if (d.state !== 'available' || !d.run) return { ...d, segment: seg, items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
    const T = ctx.tenantId; const q = String(f.q ?? '').trim().slice(0, 100);
    const where = sql`s.tenant_id = ${T} and s.snapshot_local_date = ${d.date}::date and s.definition_version = ${d.run.definitionVersion}
      and ${seg ? sql`s.segment = ${seg}` : sql`true`} and ${this.branchPred(branch)} and ${q ? sql`c.full_name ilike ${'%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'} escape '\\'` : sql`true`}`;
    const total = N((await sql<any>`select count(*)::int as n from customer_retention_daily_snapshots s join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id where ${where}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages);
    const rows = (await sql<any>`select s.customer_id, c.full_name, c.normalized_phone, s.segment, s.first_visit_at, s.last_visit_at, s.visit_count, s.net_lifetime_value_cents, s.days_away, s.data_quality
      from customer_retention_daily_snapshots s join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id where ${where}
      order by s.days_away desc nulls last, lower(c.full_name), s.customer_id limit ${pageSize} offset ${(p - 1) * pageSize}`.execute(this.db)).rows;
    return { ...d, segment: seg, page: p, pageSize, totalItems: total, totalPages,
      items: rows.map((r: any) => ({ customerId: String(r.customer_id), customerName: String(r.full_name || ''), maskedPhone: maskPhone(r.normalized_phone), segment: String(r.segment),
        firstVisitAt: iso(r.first_visit_at), lastVisitAt: iso(r.last_visit_at), visits: N(r.visit_count), netLifetimeValueCents: N(r.net_lifetime_value_cents), daysAway: r.days_away == null ? null : N(r.days_away), dataQuality: String(r.data_quality) })) };
  }

  /** GET two dates side by side: counts, deltas and who moved between segments (only when BOTH dates are available) */
  async compare(ctx: RetentionContext, a: unknown, b: unknown, branchRaw: unknown = null) {
    const A = await this.day(ctx, a, branchRaw), B = await this.day(ctx, b, branchRaw);
    const branch = (A as { branch?: string[] | null }).branch ?? null;
    if (A.state !== 'available' || B.state !== 'available' || !A.counts || !B.counts || !A.run || !B.run) return { a: A, b: B, comparable: false, delta: null, transitions: [], definitionChanged: null };
    const delta = Object.fromEntries((['total', ...SNAPSHOT_SEGMENTS] as const).map((k) => [k, (B.counts as Record<string, number>)[k]! - (A.counts as Record<string, number>)[k]!]));
    const T = ctx.tenantId;
    const tr = (await sql<any>`select coalesce(x.segment, 'not_a_customer') as from_segment, coalesce(y.segment, 'not_a_customer') as to_segment, count(*)::int as n
      from (select s.customer_id, s.segment from customer_retention_daily_snapshots s where s.tenant_id = ${T} and s.snapshot_local_date = ${A.date}::date and s.definition_version = ${A.run.definitionVersion} and ${this.branchPred(branch)}) x
      full join (select s.customer_id, s.segment from customer_retention_daily_snapshots s where s.tenant_id = ${T} and s.snapshot_local_date = ${B.date}::date and s.definition_version = ${B.run.definitionVersion} and ${this.branchPred(branch)}) y
        on y.customer_id = x.customer_id
      where x.segment is distinct from y.segment group by 1, 2 order by 3 desc, 1, 2 limit 20`.execute(this.db)).rows;
    return { a: A, b: B, comparable: true, delta, definitionChanged: A.run.definitionVersion !== B.run.definitionVersion,
      transitions: tr.map((r: any) => ({ from: String(r.from_segment), to: String(r.to_segment), customers: N(r.n) })) };
  }

  /** GET the runs of a date range (coverage calendar), newest first, paged */
  async runs(ctx: RetentionContext, f: { from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const { today } = await this.todayOf(ctx.tenantId);
    const to = validDay(f.to) ? f.to : today; const from = validDay(f.from) ? f.from : (await sql<any>`select (${to}::date - 30)::text as d`.execute(this.db)).rows[0].d;
    if (from > to) throw new RetentionError('The From date must be on or before the To date.', 'SNAPSHOT_INVALID_RANGE');
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(f.pageSize)) || 10)); const page = Math.max(1, Math.trunc(Number(f.page)) || 1);
    const where = sql`r.snapshot_local_date between ${from}::date and ${to}::date`;
    const total = N((await sql<any>`select count(*)::int as n from customer_retention_snapshot_runs r where r.tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages);
    const rows = (await sql<any>`select ${SNAP_RUN_COLS} from customer_retention_snapshot_runs r where r.tenant_id = ${ctx.tenantId} and ${where} order by r.snapshot_local_date desc, r.created_at desc limit ${pageSize} offset ${(p - 1) * pageSize}`.execute(this.db)).rows;
    return { from, to, items: rows.map((r: any) => this.runOut(r)), page: p, pageSize, totalItems: total, totalPages };
  }

  /** the nightly sweep: for every active salon whose salon-local day has rolled over (≥ 1 AM), enqueue yesterday once
   *  (idempotency key per salon + date), staggered over 30 minutes by a stable hash of the tenant id */
  async enqueueNightly(): Promise<{ tenants: number; queued: number }> {
    const rows = (await sql<any>`select t.id, coalesce(b.tz, 'America/New_York') as tz from tenants t
      left join lateral (select br.timezone as tz from branches br where br.tenant_id = t.id and br.timezone is not null order by br.created_at asc limit 1) b on true
      where t.status = 'active'`.execute(this.db)).rows;
    let queued = 0;
    for (const r of rows) {
      const tid = String(r.id);
      try {
        const x = (await sql<any>`select ((now() at time zone ${String(r.tz)})::date - 1)::text as d, extract(hour from now() at time zone ${String(r.tz)})::int as h`.execute(this.db)).rows[0];
        if (N(x.h) < 1) continue;
        let hash = 0; for (const ch of tid) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
        const out = await this.enqueueDay(this.db, tid, String(x.d), 'nightly', `retention-snapshot:${tid}:${x.d}:nightly`, new Date(Date.now() + (hash % 1800) * 1000), null);
        if (!out.duplicate) queued++;
      } catch (e) { logException(e, { where: 'retention-snapshots.enqueue_nightly', tenantId: tid }); }
    }
    return { tenants: rows.length, queued };
  }
}

/** the job handler body (registered by RetentionSnapshotWorker); a bad payload is permanent, anything else retries */
export async function runRetentionSnapshotJob(db: Kysely<any>, payload: Record<string, unknown>): Promise<ComputeResult> {
  const tenantId = String(payload.tenantId ?? ''), date = String(payload.date ?? '');
  const kind = payload.kind === 'nightly' ? 'nightly' : 'backfill';
  if (!isUuid(tenantId) || !validDay(date)) throw withCode(new PermanentJobError('bad retention snapshot payload'), 'VALIDATION_FAILED');
  try { return await new RetentionSnapshotRepository(db).computeDay(tenantId, date, { kind, requestedBy: typeof payload.requestedBy === 'string' ? payload.requestedBy : null }); }
  catch (e) { if (e instanceof RetentionError) throw new PermanentJobError(e.message); throw e; }
}
