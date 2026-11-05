// super-admin-booking-checkin.kysely.repository.ts — every aggregate reads REAL platform tables, scoped by tenant
// (parseScope/andTenant) and optionally branch. Each query is fail-soft (a missing/empty table yields a neutral zero
// rather than failing the whole Overview, matching the existing aggregate convention). No fabricated values.
import { type AppDatabase, andTenant, type OverviewScope } from '@aipowersalon/database';
import { sql } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { BOOKING_CHECKIN_FAILED_EVENT } from '../lifecycles';

export interface Range { start: Date; end: Date }
export interface ApptFilter { sources?: string[]; status?: string }
const branchPred = (branchId?: string | null) => (branchId ? sql`and branch_id = ${branchId}` : sql``);
const sourcePred = (f?: ApptFilter) => (f?.sources && f.sources.length ? sql`and source = any(${f.sources})` : sql``);
const statusPred = (f?: ApptFilter) => (f?.status ? sql`and status = ${f.status}` : sql``);
const rows = async <T>(db: AppDatabase, q: any): Promise<T[]> => { try { return (await q.execute(db)).rows as T[]; } catch { return []; } };
const one = async <T>(db: AppDatabase, q: any, dflt: T): Promise<T> => { try { const r = (await q.execute(db)).rows[0]; return (r ?? dflt) as T; } catch { return dflt; } };
/** Non-swallowing single-row read for the controlled write path: genuine DB errors propagate (they must NOT be
 *  misread as "not found" or "idempotent replay"); a legitimately empty result returns null. */
const pickOne = async <T>(db: AppDatabase, q: any): Promise<T | null> => { const r = (await q.execute(db)).rows[0]; return (r ?? null) as T | null; };

export class SuperAdminBookingCheckinKyselyRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Booking counts grouped by original creation source, for a period. Source is never overwritten on later edits. */
  bookingsBySource(range: Range, scope: OverviewScope, branchId?: string | null, f?: ApptFilter) {
    return rows<{ source: string | null; count: string }>(this.db, sql`
      select coalesce(nullif(trim(source), ''), 'other') as source, count(*)::text as count
      from pos_tech_appointments
      where created_at >= ${range.start} and created_at < ${range.end} ${andTenant(scope)} ${branchPred(branchId)} ${sourcePred(f)} ${statusPred(f)}
      group by 1 order by 2 desc`);
  }

  /** Appointment status distribution for the cohort (bookings created in range). Drives the lifecycle funnel. */
  statusCounts(range: Range, scope: OverviewScope, branchId?: string | null, f?: ApptFilter) {
    return rows<{ status: string | null; count: string }>(this.db, sql`
      select coalesce(nullif(trim(status), ''), 'unknown') as status, count(*)::text as count
      from pos_tech_appointments
      where created_at >= ${range.start} and created_at < ${range.end} ${andTenant(scope)} ${branchPred(branchId)} ${sourcePred(f)}
      group by 1`);
  }

  /** Kiosk/check-in sessions started in range, and average completion seconds (completed only). */
  checkinStats(range: Range, scope: OverviewScope, branchId?: string | null) {
    return one<{ started: string; completed: string; expired: string; avg_seconds: string | null }>(this.db, sql`
      select
        count(*) filter (where started_at >= ${range.start} and started_at < ${range.end})::text as started,
        count(*) filter (where completed_at is not null and completed_at >= ${range.start} and completed_at < ${range.end})::text as completed,
        count(*) filter (where expired_at is not null and expired_at >= ${range.start} and expired_at < ${range.end})::text as expired,
        avg(extract(epoch from (completed_at - started_at))) filter (where completed_at is not null and completed_at >= started_at)::text as avg_seconds
      from go_checkin_sessions
      where true ${andTenant(scope)} ${branchPred(branchId)}`,
      { started: '0', completed: '0', expired: '0', avg_seconds: null });
  }

  /** Queue lifecycle snapshot for the cohort range — waiting and serving/in-queue counts, plus conversion inputs. */
  queueSnapshot(range: Range, scope: OverviewScope, branchId?: string | null) {
    return one<{ waiting: string; serving: string; entered: string; avg_wait_seconds: string | null }>(this.db, sql`
      select
        count(*) filter (where status in ('waiting','queued'))::text as waiting,
        count(*) filter (where status in ('serving','in_service','in_queue','called'))::text as serving,
        count(*) filter (where checked_in_at >= ${range.start} and checked_in_at < ${range.end})::text as entered,
        avg(extract(epoch from (started_at - checked_in_at))) filter (where started_at is not null and checked_in_at is not null and started_at >= checked_in_at)::text as avg_wait_seconds
      from pos_queue_items
      where true ${andTenant(scope)} ${branchPred(branchId)}`,
      { waiting: '0', serving: '0', entered: '0', avg_wait_seconds: null });
  }

  /** Device fleet by type with real-heartbeat online classification (seen within 5 min AND not disabled). */
  deviceStatus(scope: OverviewScope, branchId?: string | null) {
    return rows<{ device_type: string | null; total: string; online: string }>(this.db, sql`
      select coalesce(nullif(trim(device_type), ''), 'kiosk') as device_type,
        count(*)::text as total,
        count(*) filter (where disabled_at is null and last_seen_at is not null and last_seen_at > now() - interval '5 minutes')::text as online
      from go_checkin_devices
      where true ${andTenant(scope)} ${branchPred(branchId)}
      group by 1 order by 1`);
  }

  /** Per-branch average wait time (queue start − check-in), with booking and check-in volumes. Top N by wait desc. */
  branchWaitTimes(range: Range, scope: OverviewScope, limit = 5) {
    return rows<{ branch_id: string; branch_name: string | null; avg_wait_seconds: string | null; bookings: string; checkins: string }>(this.db, sql`
      with q as (
        select branch_id,
          avg(extract(epoch from (started_at - checked_in_at))) filter (where started_at is not null and checked_in_at is not null and started_at >= checked_in_at) as avg_wait_seconds,
          count(*) filter (where checked_in_at >= ${range.start} and checked_in_at < ${range.end}) as checkins
        from pos_queue_items where true ${andTenant(scope)} group by branch_id),
      b as (
        select branch_id, count(*) as bookings from pos_tech_appointments
        where created_at >= ${range.start} and created_at < ${range.end} ${andTenant(scope)} group by branch_id)
      select q.branch_id::text as branch_id, br.name as branch_name,
        q.avg_wait_seconds::text as avg_wait_seconds, coalesce(b.bookings,0)::text as bookings, coalesce(q.checkins,0)::text as checkins
      from q left join b on b.branch_id = q.branch_id
      left join branches br on br.id = q.branch_id
      where q.avg_wait_seconds is not null
      order by q.avg_wait_seconds desc nulls last limit ${limit}`);
  }

  /** 7-day check-in vs failed (expired) sessions by local day. */
  /** 7-day check-in (sessions started) vs failed (recorded check-in failures) by local day. */
  checkinTrend(scope: OverviewScope, branchId?: string | null, days = 7) {
    const b = branchId ? sql`and s.branch_id = ${branchId}` : sql``;
    const bf = branchId ? sql`and fe.branch_id = ${branchId}` : sql``;
    return rows<{ day: string; checkins: string; failed: string }>(this.db, sql`
      select to_char(d::date, 'YYYY-MM-DD') as day,
        (select count(*) from go_checkin_sessions s where s.started_at::date = d::date ${andTenant(scope, 's.tenant_id')} ${b})::text as checkins,
        (select count(*) from booking_checkin_failed_events fe where fe.category = 'check_in' and fe.occurred_at::date = d::date ${andTenant(scope, 'fe.tenant_id')} ${bf})::text as failed
      from generate_series((now()::date - cast(${days - 1} as int))::timestamp, now()::date::timestamp, interval '1 day') d
      order by d`);
  }

  /** Failed-event counts by category for a period (powers the failed-check-in + API-failure KPIs). */
  failedEventCounts(range: Range, scope: OverviewScope, branchId?: string | null) {
    return one<{ check_in: string; api: string; booking: string }>(this.db, sql`
      select
        count(*) filter (where category = 'check_in')::text as check_in,
        count(*) filter (where category in ('api','integration'))::text as api,
        count(*) filter (where category = 'booking')::text as booking
      from booking_checkin_failed_events
      where occurred_at >= ${range.start} and occurred_at < ${range.end} ${andTenant(scope)} ${branchPred(branchId)}`,
      { check_in: '0', api: '0', booking: '0' });
  }

  /** Failed-event rows for the Failed Booking & Check-In Events module (safe diagnostic columns only). */
  failedEventRows(range: Range, scope: OverviewScope, branchId?: string | null, limit = 6) {
    return rows<{ event_code: string; branch_name: string | null; source: string | null; failure_type: string; occurred_at: string; retry_status: string }>(this.db, sql`
      select fe.event_code, br.name as branch_name, fe.source, fe.failure_type, fe.occurred_at::text as occurred_at, fe.retry_status
      from booking_checkin_failed_events fe left join branches br on br.id = fe.branch_id
      where fe.occurred_at >= ${range.start} and fe.occurred_at < ${range.end} ${andTenant(scope, 'fe.tenant_id')} ${branchId ? sql`and fe.branch_id = ${branchId}` : sql``}
      order by fe.occurred_at desc limit ${limit}`);
  }

  /** Duplicate check-in candidate count for a period (powers the Duplicate Check-Ins KPI + duplicate rate). */
  duplicateCount(range: Range, scope: OverviewScope, branchId?: string | null) {
    return one<{ c: string }>(this.db, sql`
      select count(*)::text as c from duplicate_checkin_candidates
      where detected_at >= ${range.start} and detected_at < ${range.end} ${andTenant(scope)} ${branchPred(branchId)}`, { c: '0' });
  }

  /** Open unmatched-customer records (count + recent rows). Tenant-scoped; never cross-tenant. */
  unmatched(scope: OverviewScope, branchId?: string | null, limit = 6) {
    const count = one<{ c: string }>(this.db, sql`
      select count(*)::text as c from unmatched_customer_records
      where review_state in ('pending','in_review') ${andTenant(scope)} ${branchPred(branchId)}`, { c: '0' });
    const list = rows<{ id: string; display_name: string | null; source: string | null; possible_matches: number; last_contact_at: string | null }>(this.db, sql`
      select id::text as id, display_name, source, possible_matches, last_contact_at::text as last_contact_at
      from unmatched_customer_records
      where review_state in ('pending','in_review') ${andTenant(scope)} ${branchPred(branchId)}
      order by last_contact_at desc nulls last limit ${limit}`);
    return Promise.all([count, list]).then(([c, rowsList]) => ({ count: Number(c.c) || 0, rows: rowsList }));
  }

  /** AI receptionist handoff rows for the module (minimal necessary detail; no transcripts). */
  aiHandoffRows(range: Range, scope: OverviewScope, branchId?: string | null, limit = 6) {
    return rows<{ call_code: string; branch_name: string | null; transferred_to: string; reason: string | null; status: string; requested_at: string }>(this.db, sql`
      select h.call_code, br.name as branch_name, h.transferred_to, h.reason, h.status, h.requested_at::text as requested_at
      from ai_receptionist_handoffs h left join branches br on br.id = h.branch_id
      where h.requested_at >= ${range.start} and h.requested_at < ${range.end} ${andTenant(scope, 'h.tenant_id')} ${branchId ? sql`and h.branch_id = ${branchId}` : sql``}
      order by h.requested_at desc limit ${limit}`);
  }

  /** Paginated + filtered failed events for the Failed Events submodule page (full safe diagnostic detail). */
  async failedEventsPage(range: Range, scope: OverviewScope, f: { branchId?: string | null; category?: string | null; retryStatus?: string | null; search?: string | null; page: number; pageSize: number }) {
    const cat = f.category ? sql`and fe.category = ${f.category}` : sql``;
    const retry = f.retryStatus ? sql`and fe.retry_status = ${f.retryStatus}` : sql``;
    const branch = f.branchId ? sql`and fe.branch_id = ${f.branchId}` : sql``;
    const term = f.search ? `%${f.search.toLowerCase()}%` : null;
    const search = term ? sql`and (lower(fe.event_code) like ${term} or lower(fe.failure_type) like ${term} or lower(coalesce(fe.source,'')) like ${term})` : sql``;
    const where = sql`fe.occurred_at >= ${range.start} and fe.occurred_at < ${range.end} ${andTenant(scope, 'fe.tenant_id')} ${branch} ${cat} ${retry} ${search}`;
    const total = await one<{ c: string }>(this.db, sql`select count(*)::text as c from booking_checkin_failed_events fe where ${where}`, { c: '0' });
    const offset = Math.max(0, (f.page - 1) * f.pageSize);
    const list = await rows<{
      id: string; event_code: string; branch_name: string | null; category: string; source: string | null; check_in_method: string | null;
      failure_type: string; error_code: string | null; error_message: string | null; correlation_id: string | null;
      retry_status: string; retry_count: number; attempt_count: number; escalation_state: string; resolution: string | null;
      occurred_at: string; last_attempt_at: string | null;
    }>(this.db, sql`
      select fe.id::text as id, fe.event_code, br.name as branch_name, fe.category, fe.source, fe.check_in_method,
        fe.failure_type, fe.error_code, fe.error_message, fe.correlation_id, fe.retry_status, fe.retry_count, fe.attempt_count,
        fe.escalation_state, fe.resolution, fe.occurred_at::text as occurred_at, fe.last_attempt_at::text as last_attempt_at
      from booking_checkin_failed_events fe left join branches br on br.id = fe.branch_id
      where ${where}
      order by fe.occurred_at desc limit ${f.pageSize} offset ${offset}`);
    return { rows: list, total: Number(total.c) || 0 };
  }

  /** Bookings awaiting confirmation — open holds not yet expired. Recent rows for the table. */
  pendingConfirmations(scope: OverviewScope, branchId?: string | null, limit = 5) {
    const count = one<{ c: string }>(this.db, sql`
      select count(*)::text as c from booking_holds
      where status in ('pending','active','held') and (expires_at is null or expires_at > now()) ${andTenant(scope)} ${branchPred(branchId)}`, { c: '0' });
    const list = rows<{ id: string; branch_name: string | null; created_at: string }>(this.db, sql`
      select bh.id::text as id, br.name as branch_name, bh.created_at::text as created_at
      from booking_holds bh left join branches br on br.id = bh.branch_id
      where bh.status in ('pending','active','held') and (bh.expires_at is null or bh.expires_at > now()) ${andTenant(scope, 'bh.tenant_id')}
      order by bh.created_at desc limit ${limit}`);
    return Promise.all([count, list]).then(([c, rowsList]) => ({ count: Number(c.c) || 0, rows: rowsList }));
  }

  /** Integration configuration health — what's enabled/connected across in-scope tenants (config signal, not secrets). */
  integrationConfig(scope: OverviewScope) {
    return one<{ tenants: string; online: string; google: string; ai_phone: string }>(this.db, sql`
      select count(*)::text as tenants,
        count(*) filter (where online_booking_enabled)::text as online,
        count(*) filter (where google_reserve_connected)::text as google,
        count(*) filter (where ai_phone_enabled)::text as ai_phone
      from pos_booking_integrations
      where ${scope.tenantId ? sql`tenant_id = ${scope.tenantId}` : sql`true`}`,
      { tenants: '0', online: '0', google: '0', ai_phone: '0' });
  }

  /** Paginated + filtered per-device list for the Device Status submodule. Online classification uses the REAL
   *  heartbeat (seen <5 min AND not disabled); disabled rows are surfaced honestly as their own state. */
  async devicesPage(scope: OverviewScope, f: { branchId?: string | null; status?: string | null; deviceType?: string | null; search?: string | null; page: number; pageSize: number }) {
    const branch = f.branchId ? sql`and d.branch_id = ${f.branchId}` : sql``;
    const type = f.deviceType ? sql`and d.device_type = ${f.deviceType}` : sql``;
    const term = f.search ? `%${f.search.toLowerCase()}%` : null;
    const search = term ? sql`and (lower(d.device_name) like ${term} or lower(coalesce(d.checkin_slug,'')) like ${term})` : sql``;
    const stateExpr = sql`case when d.disabled_at is not null then 'disabled' when d.last_seen_at is not null and d.last_seen_at > now() - interval '5 minutes' then 'online' else 'offline' end`;
    const stateFilter = f.status ? sql`and (${stateExpr}) = ${f.status}` : sql``;
    const where = sql`true ${andTenant(scope, 'd.tenant_id')} ${branch} ${type} ${search} ${stateFilter}`;
    const total = await one<{ c: string }>(this.db, sql`select count(*)::text as c from go_checkin_devices d where ${where}`, { c: '0' });
    const offset = Math.max(0, (f.page - 1) * f.pageSize);
    const list = await rows<{ id: string; device_name: string; device_type: string | null; branch_name: string | null; state: string; status: string; last_seen_at: string | null; disabled_at: string | null; created_at: string }>(this.db, sql`
      select d.id::text as id, d.device_name, d.device_type, br.name as branch_name,
        (${stateExpr}) as state, d.status, d.last_seen_at::text as last_seen_at, d.disabled_at::text as disabled_at, d.created_at::text as created_at
      from go_checkin_devices d left join branches br on br.id = d.branch_id
      where ${where}
      order by (case (${stateExpr}) when 'offline' then 0 when 'disabled' then 1 else 2 end), d.last_seen_at desc nulls last
      limit ${f.pageSize} offset ${offset}`);
    return { rows: list, total: Number(total.c) || 0 };
  }

  /** Wait-Time Analysis overall stats. Wait = started_at − checked_in_at (queue processing begins − check-in
   *  completed, per the documented formula); abandonment = entered queue but removed/cancelled without ever starting. */
  waitTimeOverall(range: Range, scope: OverviewScope, branchId?: string | null) {
    return one<{ avg_sec: string | null; median_sec: string | null; p90_sec: string | null; longest_sec: string | null; sampled: string; entered: string; abandoned: string }>(this.db, sql`
      with base as (
        select status, checked_in_at, started_at,
          extract(epoch from (started_at - checked_in_at)) as wait_sec
        from pos_queue_items
        where checked_in_at >= ${range.start} and checked_in_at < ${range.end} ${andTenant(scope)} ${branchPred(branchId)}
      ), w as (select wait_sec from base where started_at is not null and checked_in_at is not null and started_at >= checked_in_at)
      select
        (select avg(wait_sec) from w)::text as avg_sec,
        (select percentile_cont(0.5) within group (order by wait_sec) from w)::text as median_sec,
        (select percentile_cont(0.9) within group (order by wait_sec) from w)::text as p90_sec,
        (select max(wait_sec) from w)::text as longest_sec,
        (select count(*) from w)::text as sampled,
        (select count(*) from base)::text as entered,
        (select count(*) from base where status in ('removed','cancelled') and started_at is null)::text as abandoned`,
      { avg_sec: null, median_sec: null, p90_sec: null, longest_sec: null, sampled: '0', entered: '0', abandoned: '0' });
  }

  /** Per-branch wait-time ranking (avg/median/p90/longest + sample + check-ins entered). */
  waitTimeByBranch(range: Range, scope: OverviewScope, branchId?: string | null) {
    return rows<{ branch_id: string; branch: string | null; avg_sec: string | null; median_sec: string | null; p90_sec: string | null; longest_sec: string | null; waits: string; checkins: string }>(this.db, sql`
      with entered as (
        select branch_id, count(*)::int as checkins
        from pos_queue_items
        where checked_in_at >= ${range.start} and checked_in_at < ${range.end} ${andTenant(scope)} ${branchPred(branchId)}
        group by 1
      ), w as (
        select branch_id, extract(epoch from (started_at - checked_in_at)) as wait_sec
        from pos_queue_items
        where checked_in_at >= ${range.start} and checked_in_at < ${range.end} ${andTenant(scope)} ${branchPred(branchId)}
          and started_at is not null and checked_in_at is not null and started_at >= checked_in_at
      )
      select b.id::text as branch_id, b.name as branch,
        avg(w.wait_sec)::text as avg_sec,
        percentile_cont(0.5) within group (order by w.wait_sec)::text as median_sec,
        percentile_cont(0.9) within group (order by w.wait_sec)::text as p90_sec,
        max(w.wait_sec)::text as longest_sec,
        count(w.wait_sec)::text as waits,
        coalesce(max(e.checkins), 0)::text as checkins
      from branches b
      left join w on w.branch_id = b.id
      left join entered e on e.branch_id = b.id
      where (e.checkins is not null or w.wait_sec is not null)
      group by 1, 2
      order by avg(w.wait_sec) desc nulls last`);
  }

  /** Wait-time by raw booking source (queue entry source). */
  waitTimeBySource(range: Range, scope: OverviewScope, branchId?: string | null) {
    return rows<{ source: string | null; avg_sec: string | null; waits: string }>(this.db, sql`
      select coalesce(nullif(trim(source), ''), 'other') as source,
        avg(extract(epoch from (started_at - checked_in_at)))::text as avg_sec,
        count(*)::text as waits
      from pos_queue_items
      where checked_in_at >= ${range.start} and checked_in_at < ${range.end} ${andTenant(scope)} ${branchPred(branchId)}
        and started_at is not null and checked_in_at is not null and started_at >= checked_in_at
      group by 1 order by 2 desc nulls last`);
  }

  /** Wait-time by hour of day (branch-local operational grouping approximated on checked_in_at). */
  waitTimeByHour(range: Range, scope: OverviewScope, branchId?: string | null) {
    return rows<{ hour: string; avg_sec: string | null; waits: string }>(this.db, sql`
      select extract(hour from checked_in_at)::int::text as hour,
        avg(extract(epoch from (started_at - checked_in_at)))::text as avg_sec,
        count(*)::text as waits
      from pos_queue_items
      where checked_in_at >= ${range.start} and checked_in_at < ${range.end} ${andTenant(scope)} ${branchPred(branchId)}
        and started_at is not null and checked_in_at is not null and started_at >= checked_in_at
      group by 1 order by 1`);
  }

  /** Per-method check-in session performance for the Check-In Performance submodule. Durations come from real
   *  completed sessions (completed_at − started_at); counts are conditional by status. */
  checkinByMethod(range: Range, scope: OverviewScope, branchId?: string | null) {
    return rows<{ device_type: string | null; total: string; completed: string; expired: string; failed: string; active: string; avg_dur: string | null }>(this.db, sql`
      select coalesce(nullif(trim(d.device_type), ''), 'unknown') as device_type,
        count(*)::text as total,
        count(*) filter (where s.status = 'completed')::text as completed,
        count(*) filter (where s.status = 'expired')::text as expired,
        count(*) filter (where s.status = 'failed')::text as failed,
        count(*) filter (where s.status in ('active','inactive'))::text as active,
        avg(extract(epoch from (s.completed_at - s.started_at))) filter (where s.status = 'completed' and s.completed_at is not null and s.completed_at >= s.started_at) as avg_dur
      from go_checkin_sessions s left join go_checkin_devices d on d.id = s.device_id
      where s.started_at >= ${range.start} and s.started_at < ${range.end} ${andTenant(scope, 's.tenant_id')} ${branchId ? sql`and s.branch_id = ${branchId}` : sql``}
      group by 1`);
  }

  /** Per-source × status counts for the Booking Sources performance submodule (reconciles with the Overview). */
  sourceStatusCounts(range: Range, scope: OverviewScope, branchId?: string | null) {
    return rows<{ source: string | null; status: string | null; count: string }>(this.db, sql`
      select coalesce(nullif(trim(source), ''), 'other') as source, coalesce(nullif(trim(status), ''), 'unknown') as status, count(*)::text as count
      from pos_tech_appointments
      where created_at >= ${range.start} and created_at < ${range.end} ${andTenant(scope)} ${branchPred(branchId)}
      group by 1, 2`);
  }

  /** Failed booking events grouped by raw source, for the Booking Sources submodule (bucketed in the service). */
  failedBookingsBySource(range: Range, scope: OverviewScope, branchId?: string | null) {
    return rows<{ source: string | null; count: string }>(this.db, sql`
      select coalesce(nullif(trim(source), ''), 'other') as source, count(*)::text as count
      from booking_checkin_failed_events
      where category in ('booking','api','integration') and occurred_at >= ${range.start} and occurred_at < ${range.end} ${andTenant(scope)} ${branchPred(branchId)}
      group by 1`);
  }

  /** Paginated + filtered AI receptionist handoffs for the AI Handoffs submodule (minimal detail; no transcripts). */
  async handoffsPage(range: Range, scope: OverviewScope, f: { branchId?: string | null; status?: string | null; transferredTo?: string | null; search?: string | null; page: number; pageSize: number }) {
    const branch = f.branchId ? sql`and h.branch_id = ${f.branchId}` : sql``;
    const status = f.status ? sql`and h.status = ${f.status}` : sql``;
    const dest = f.transferredTo ? sql`and h.transferred_to = ${f.transferredTo}` : sql``;
    const term = f.search ? `%${f.search.toLowerCase()}%` : null;
    const search = term ? sql`and (lower(h.call_code) like ${term} or lower(coalesce(h.reason,'')) like ${term})` : sql``;
    const where = sql`h.requested_at >= ${range.start} and h.requested_at < ${range.end} ${andTenant(scope, 'h.tenant_id')} ${branch} ${status} ${dest} ${search}`;
    const total = await one<{ c: string }>(this.db, sql`select count(*)::text as c from ai_receptionist_handoffs h where ${where}`, { c: '0' });
    const offset = Math.max(0, (f.page - 1) * f.pageSize);
    const list = await rows<{ id: string; call_code: string; branch_name: string | null; transferred_to: string; reason: string | null; status: string; requested_at: string; connected_at: string | null; wait_seconds: number | null; failure_reason: string | null; booking_result: string | null }>(this.db, sql`
      select h.id::text as id, h.call_code, br.name as branch_name, h.transferred_to, h.reason, h.status,
        h.requested_at::text as requested_at, h.connected_at::text as connected_at, h.wait_seconds, h.failure_reason, h.booking_result
      from ai_receptionist_handoffs h left join branches br on br.id = h.branch_id
      where ${where}
      order by h.requested_at desc limit ${f.pageSize} offset ${offset}`);
    return { rows: list, total: Number(total.c) || 0 };
  }

  // ── Controlled retry workflow (the only write path in this module) ──

  /** Fetch a failed event for a retry decision, tenant-scoped. Returns null if it doesn't exist or is out of scope. */
  failedEventForRetry(id: string, scope: OverviewScope) {
    return pickOne<{ id: string; tenant_id: string; branch_id: string | null; retry_status: string; retry_count: number; attempt_count: number; escalation_state: string; correlation_id: string | null; category: string }>(this.db, sql`
      select id::text as id, tenant_id::text as tenant_id, branch_id::text as branch_id, retry_status, retry_count, attempt_count, escalation_state, correlation_id, category
      from booking_checkin_failed_events
      where id = ${id} ${andTenant(scope, 'tenant_id')}`);
  }

  /** Look up an existing retry attempt by its idempotency key (for replay detection). */
  retryAttemptByKey(failedEventId: string, idempotencyKey: string) {
    return pickOne<{ id: string; attempt_number: number; status: string; backoff_seconds: number; next_retry_at: string | null; created_at: string }>(this.db, sql`
      select id::text as id, attempt_number, status, backoff_seconds, next_retry_at::text as next_retry_at, created_at::text as created_at
      from booking_checkin_retry_attempts where failed_event_id = ${failedEventId} and idempotency_key = ${idempotencyKey}`);
  }

  /** Insert a retry attempt. Idempotent: ON CONFLICT (failed_event_id, idempotency_key) DO NOTHING → returns null on replay. */
  insertRetryAttempt(a: { tenantId: string; branchId: string | null; failedEventId: string; idempotencyKey: string; attemptNumber: number; status: string; backoffSeconds: number; nextRetryAt: Date | null; requestedByUserId?: string | null; requestedByEmail?: string | null; reason?: string | null }) {
    return pickOne<{ id: string; attempt_number: number; status: string; backoff_seconds: number; next_retry_at: string | null; created_at: string }>(this.db, sql`
      insert into booking_checkin_retry_attempts (tenant_id, branch_id, failed_event_id, idempotency_key, attempt_number, status, backoff_seconds, next_retry_at, requested_by_user_id, requested_by_email, reason)
      values (${a.tenantId}, ${a.branchId}, ${a.failedEventId}, ${a.idempotencyKey}, ${a.attemptNumber}, ${a.status}, ${a.backoffSeconds}, ${a.nextRetryAt}, ${a.requestedByUserId ?? null}, ${a.requestedByEmail ?? null}, ${a.reason ?? null})
      on conflict (failed_event_id, idempotency_key) do nothing
      returning id::text as id, attempt_number, status, backoff_seconds, next_retry_at::text as next_retry_at, created_at::text as created_at`);
  }

  /** Advance the failed event's retry bookkeeping after a new attempt (preserves the original diagnostic fields). */
  async bumpFailedEventRetry(id: string, retryStatus: string, retryCount: number, escalationState: string) {
    await sql`update booking_checkin_failed_events set retry_status = ${retryStatus}, retry_count = ${retryCount}, attempt_count = attempt_count + 1, escalation_state = ${escalationState}, last_attempt_at = now() where id = ${id} and ${canMoveToSql(BOOKING_CHECKIN_FAILED_EVENT, retryStatus)}`.execute(this.db as any);
  }

  /** Append a single audit row for an Overview access (read), tenant-scoped where applicable. */
  async writeAudit(actor: { userId?: string; email?: string; ip?: string }, action: string, scope: OverviewScope, summary: string, metadata: unknown) {
    try {
      await sql`insert into audit_events (tenant_id, actor_user_id, actor_role, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${scope.tenantId ?? null}, ${actor.userId ?? null}, 'SUPER_ADMIN', ${actor.email ?? null}, 'booking-checkin-monitor', ${action}, 'overview', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* audit is best-effort; never blocks the read */ }
  }
}
