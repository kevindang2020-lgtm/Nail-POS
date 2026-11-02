// branch-health.ts — BUILD_PLAN Phase 14 B (Constitution 11 §345 "Branch Health Snapshot — similarly branch", §156 shape).
//
// THE QUESTION: "which LOCATION is in trouble right now?" — a tenant health row says the salon's Twilio is fine; this says
// the Cherry Hill branch has 9 guests waiting, the longest for 70 minutes, and half its card payments failed this hour.
//
// HOW (the tenant-health pattern, one level down):
//   • facts per branch from the tables the platform already keeps (tickets, pos_queue_items, technicians, payment_attempts,
//     customer_display_devices, go_checkin_devices, pos_payment_terminals, outbox_events, sms_usage_records) — one grouped
//     query per fact for ALL of a salon's branches, every query filtered by tenant_id;
//   • a fact query that FAILS is recorded by name and its facts are NULL (not measured) — never zero (SILENT-SQL-RISK);
//   • the overall is derived by evaluateBranchHealth (pure, every rule pinned by a test) — explicit reasons, no opaque score;
//   • every 15 minutes the tick enqueues ONE `branch.health.snapshot.tenant` job per active salon (Phase 11 partitioning,
//     idempotency key `<tenant>:<slot>`), the job stores one row per branch per slot (unique (branch_id, snapshot_slot)).
// Super Admin reads the latest row per branch, worst first; an owner reads only their own salon's branches.
//
// JUDGEMENT CALLS, stated:
//   • A branch with no activity in the window (no open tickets, no queue, no payments, no SMS) is UNKNOWN 'idle' — closed
//     at night, or not trading — never HEALTHY by default and never an outage.
//   • Devices offline is only a finding while the branch is visibly OPEN (tickets, queue or payments): a kiosk switched
//     off overnight is not an incident. Terminals report no heartbeat, so they are counted (paired), not judged.
//   • Payment failures are judged on volume (MIN_PAYMENTS) like tenant health's MIN_VOLUME: two declines at 9 am are noise.
import { SuperAdminGuard, TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { BadRequestException, Controller, ForbiddenException, Get, Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional, Query, Req, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { runTick, log } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { decodeOffsetCursor, encodeOffsetCursor } from '@aipowersalon/api-contracts';
import { DATABASE, enqueueJob, registerJobHandler, jobHandlerFor, PermanentJobError, ListQueries } from '@aipowersalon/database';
import type { BranchHealthFacts, BranchHealthSnapshot, BranchHealthStatus, OwnerBranchHealth } from '@aipowersalon/api-contracts/tenant';
import type { SuperAdminBranchHealthList, SuperAdminBranchHealthRow } from '@aipowersalon/api-contracts/platform';
import { BranchHealthListControllerListQueries } from './branch-health.list-queries';

export const SLOT_MS = 15 * 60_000;
export const BRANCH_SNAPSHOT_JOB = 'branch.health.snapshot.tenant';
export const snapshotSlotOf = (now: Date) => new Date(Math.floor(now.getTime() / SLOT_MS) * SLOT_MS);
/** A device not seen for this long is offline (the platform live-queue view's window). */
export const DEVICE_ONLINE_SECONDS = 300;
export const MIN_PAYMENTS = 5;
export const MIN_SMS = 5;
export const LONG_WAIT_SECONDS = 60 * 60;
const HOUR = 3_600_000, DAY = 86_400_000;

export const FACT_QUERIES = ['tickets', 'queue', 'technicians', 'payments', 'displays', 'kiosks', 'terminals', 'realtime', 'sms'] as const;
export type FactQuery = (typeof FACT_QUERIES)[number];

export const emptyFacts = (): BranchHealthFacts => ({
  openTickets: null, queueWaiting: null, queueLongestWaitSeconds: null, techniciansOnShift: null, paymentsLastHour: null, paymentsFailedLastHour: null,
  displaysTotal: null, displaysOnline: null, kiosksTotal: null, kiosksOnline: null, terminalsPaired: null, lastRealtimeEventAt: null,
  smsSentLastHour: null, smsFailedLastHour: null,
});

const RANK: Record<BranchHealthStatus, number> = { HEALTHY: 0, UNKNOWN: 1, DEGRADED: 2, OUTAGE: 3 };

/** Pure: one branch's facts (+ which fact queries failed) → overall + reasons. Every rule is pinned by a test. */
export function evaluateBranchHealth(f: BranchHealthFacts, failed: readonly string[] = []): { overall: BranchHealthStatus; reasons: string[] } {
  const reasons: string[] = [];
  let worst: BranchHealthStatus = 'HEALTHY';
  const raise = (s: BranchHealthStatus, why: string) => { reasons.push(why); if (RANK[s] > RANK[worst]) worst = s; };
  const n = (v: number | null) => v ?? 0;

  if (f.paymentsLastHour !== null && f.paymentsFailedLastHour !== null && f.paymentsLastHour >= MIN_PAYMENTS) {
    const rate = f.paymentsFailedLastHour / f.paymentsLastHour;
    if (rate >= 0.5) raise('OUTAGE', 'payments_failing');
    else if (rate >= 0.2) raise('DEGRADED', 'payment_failures');
  }
  if (n(f.queueWaiting) > 0 && f.queueLongestWaitSeconds !== null && f.queueLongestWaitSeconds >= LONG_WAIT_SECONDS) raise('DEGRADED', 'long_wait');
  if (f.smsSentLastHour !== null && f.smsFailedLastHour !== null && f.smsSentLastHour >= MIN_SMS && f.smsFailedLastHour / f.smsSentLastHour >= 0.5) raise('DEGRADED', 'sms_failing');
  const open = n(f.openTickets) > 0 || n(f.queueWaiting) > 0 || n(f.paymentsLastHour) > 0;
  const devicesKnown = f.displaysTotal !== null && f.kiosksTotal !== null;
  if (open && devicesKnown && n(f.displaysTotal) + n(f.kiosksTotal) > 0 && n(f.displaysOnline) + n(f.kiosksOnline) === 0) raise('DEGRADED', 'devices_offline_while_open');

  for (const q of failed) reasons.push(`query_failed:${q}`);
  if (worst !== 'HEALTHY') return { overall: worst, reasons };
  // No finding. A failed fact query means we cannot say HEALTHY (no fake green); no activity means idle, not healthy.
  if (failed.length) return { overall: 'UNKNOWN', reasons };
  const active = open || n(f.smsSentLastHour) > 0;
  if (!active) return { overall: 'UNKNOWN', reasons: ['idle'] };
  return { overall: 'HEALTHY', reasons: ['ok'] };
}

@Injectable()
export class BranchHealthService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  /** Every active branch of one salon with its facts. Counts and timestamps only — no customer data. */
  async facts(tenantId: string, now = new Date()): Promise<{ branches: Array<{ branchId: string; branchName: string | null; facts: BranchHealthFacts }>; failed: FactQuery[] }> {
    const branches = (await sql<any>`select id, name from branches where tenant_id = ${tenantId} and status = 'active' and deleted_at is null order by name, id`.execute(this.db)).rows;
    const facts = new Map<string, BranchHealthFacts>(branches.map((b: any) => [String(b.id), emptyFacts()]));
    const failed: FactQuery[] = [];
    const h1 = new Date(now.getTime() - HOUR), d1 = new Date(now.getTime() - DAY), online = new Date(now.getTime() - DEVICE_ONLINE_SECONDS * 1000);
    const secs = (d: unknown) => (d ? Math.max(0, Math.round((now.getTime() - new Date(d as string).getTime()) / 1000)) : null);
    // Each fact query: rows keyed by branch_id. A failure → the query is named, its facts stay NULL for every branch.
    const run = async (name: FactQuery, q: any, apply: (f: BranchHealthFacts, r: any | undefined) => void) => {
      let rows: any[];
      try { rows = (await q.execute(this.db)).rows; } catch (e) { failed.push(name); log.warn('branch_health.fact_failed', { tenantId, fact: name, error: (e as Error).message }); return; }
      const by = new Map(rows.map((r) => [String(r.branch_id), r]));
      for (const [id, f] of facts) apply(f, by.get(id));
    };
    if (!branches.length) return { branches: [], failed };
    await run('tickets', sql`select branch_id, count(*)::int n from tickets
        where tenant_id = ${tenantId} and created_at >= ${d1} and paid_at is null and removed_at is null
          and lower(status) not in ('paid', 'closed', 'completed', 'cancelled', 'canceled', 'voided', 'void', 'refunded', 'removed')
        group by branch_id`, (f, r) => { f.openTickets = r?.n ?? 0; });
    await run('queue', sql`select branch_id, count(*)::int n, min(coalesce(checked_in_at, created_at)) oldest from pos_queue_items
        where tenant_id = ${tenantId} and status in ('waiting', 'assigned', 'called', 'ready_for_tech') and coalesce(checked_in_at, created_at) >= ${d1}
        group by branch_id`, (f, r) => { f.queueWaiting = r?.n ?? 0; f.queueLongestWaitSeconds = r ? secs(r.oldest) : null; });
    await run('technicians', sql`select branch_id, count(*)::int n from technicians
        where tenant_id = ${tenantId} and is_active = true and status in ('available', 'busy', 'on_shift', 'on_break') group by branch_id`, (f, r) => { f.techniciansOnShift = r?.n ?? 0; });
    await run('payments', sql`select branch_id, count(*)::int n, count(*) filter (where lower(status) in ('failed', 'declined', 'timed_out'))::int failed
        from payment_attempts where tenant_id = ${tenantId} and created_at >= ${h1} group by branch_id`, (f, r) => { f.paymentsLastHour = r?.n ?? 0; f.paymentsFailedLastHour = r?.failed ?? 0; });
    await run('displays', sql`select branch_id, count(*)::int n, count(*) filter (where last_seen_at >= ${online})::int online from customer_display_devices
        where tenant_id = ${tenantId} and pairing_status = 'paired' and revoked_at is null group by branch_id`, (f, r) => { f.displaysTotal = r?.n ?? 0; f.displaysOnline = r?.online ?? 0; });
    await run('kiosks', sql`select branch_id, count(*)::int n, count(*) filter (where last_seen_at >= ${online})::int online from go_checkin_devices
        where tenant_id = ${tenantId} and status = 'active' group by branch_id`, (f, r) => { f.kiosksTotal = r?.n ?? 0; f.kiosksOnline = r?.online ?? 0; });
    await run('terminals', sql`select branch_id, count(*)::int n from pos_payment_terminals
        where tenant_id = ${String(tenantId)} and status <> 'unpaired' and branch_id is not null group by branch_id`, (f, r) => { f.terminalsPaired = r?.n ?? 0; });
    await run('realtime', sql`select branch_id, max(occurred_at) at from outbox_events
        where tenant_id = ${tenantId} and branch_id is not null and occurred_at >= ${d1} group by branch_id`, (f, r) => { f.lastRealtimeEventAt = r?.at ? new Date(r.at).toISOString() : null; });
    await run('sms', sql`select branch_id, count(*)::int n, count(*) filter (where status in ('FAILED', 'UNDELIVERED'))::int failed from sms_usage_records
        where tenant_id = ${tenantId} and branch_id is not null and created_at >= ${h1} group by branch_id`, (f, r) => { f.smsSentLastHour = r?.n ?? 0; f.smsFailedLastHour = r?.failed ?? 0; });
    return { branches: branches.map((b: any) => ({ branchId: String(b.id), branchName: b.name ?? null, facts: facts.get(String(b.id))! })), failed };
  }
}

const rowToSnapshot = (x: any): BranchHealthSnapshot => ({
  branchId: String(x.branch_id), branchName: x.branch_name ?? null, observedAt: new Date(x.observed_at).toISOString(), overall: x.overall_status,
  reasons: Array.isArray(x.reasons) ? x.reasons : [], failedQueries: Array.isArray(x.failed_queries) ? x.failed_queries : [],
  openTickets: x.open_tickets, queueWaiting: x.queue_waiting, queueLongestWaitSeconds: x.queue_longest_wait_seconds, techniciansOnShift: x.technicians_on_shift,
  paymentsLastHour: x.payments_last_hour, paymentsFailedLastHour: x.payments_failed_last_hour, displaysTotal: x.displays_total, displaysOnline: x.displays_online,
  kiosksTotal: x.kiosks_total, kiosksOnline: x.kiosks_online, terminalsPaired: x.terminals_paired,
  lastRealtimeEventAt: x.last_realtime_event_at ? new Date(x.last_realtime_event_at).toISOString() : null,
  smsSentLastHour: x.sms_sent_last_hour, smsFailedLastHour: x.sms_failed_last_hour,
});

/** the snapshot columns every read selects (never `*` — check:response-exposure) */
const SNAPSHOT_COLUMNS = ['branch_id', 'tenant_id', 'observed_at', 'overall_status', 'reasons', 'failed_queries', 'open_tickets', 'queue_waiting',
  'queue_longest_wait_seconds', 'technicians_on_shift', 'payments_last_hour', 'payments_failed_last_hour', 'displays_total', 'displays_online',
  'kiosks_total', 'kiosks_online', 'terminals_paired', 'last_realtime_event_at', 'sms_sent_last_hour', 'sms_failed_last_hour'] as const;
const snapshotCols = (alias: string) => sql.raw(SNAPSHOT_COLUMNS.map((c) => `${alias}.${c}`).join(', '));

const SEVERITY_SQL = sql`case l.overall_status when 'OUTAGE' then 3 when 'DEGRADED' then 2 when 'UNKNOWN' then 1 else 0 end`;
export type BranchHealthSort = 'worst' | 'name' | 'observed';

@Injectable()
export class BranchHealthSnapshots implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly health: BranchHealthService, @Optional() @Inject(DATABASE) private readonly db: any) {}

  onModuleInit(): void {
    if (this.db && !jobHandlerFor(BRANCH_SNAPSHOT_JOB)) registerJobHandler(BRANCH_SNAPSHOT_JOB, async (payload, ctx) => {
      const tenantId = ctx.tenantId; const at = typeof payload.observedAt === 'string' ? new Date(payload.observedAt) : null;
      if (!tenantId || !at || Number.isNaN(at.getTime())) throw new PermanentJobError('branch.health.snapshot.tenant needs a tenant and observedAt');
      return { stored: await this.snapshotTenant(tenantId, at) };
    });
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs
    if (process.env.NODE_ENV === 'test' || !this.db) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'branch.health.snapshot', jobClass: 'standard', everyMs: SLOT_MS }, () => this.dispatch()).catch(() => undefined); }, SLOT_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /** One salon, one slot: a row per active branch. Returns rows stored (a slot already stored adds none). Throws on a DB
   *  failure of the branch list or the insert (the queue job retries); a failed FACT query is stored as UNKNOWN, named. */
  async snapshotTenant(tenantId: string, now: Date): Promise<number> {
    const slot = snapshotSlotOf(now);
    const { branches, failed } = await this.health.facts(tenantId, now);
    let stored = 0;
    for (const b of branches) {
      const f = b.facts; const { overall, reasons } = evaluateBranchHealth(f, failed);
      const res: any = await sql`insert into branch_health_snapshots (tenant_id, branch_id, observed_at, snapshot_slot, overall_status, reasons,
            open_tickets, queue_waiting, queue_longest_wait_seconds, technicians_on_shift, payments_last_hour, payments_failed_last_hour,
            displays_total, displays_online, kiosks_total, kiosks_online, terminals_paired, last_realtime_event_at, sms_sent_last_hour, sms_failed_last_hour, failed_queries)
          values (${tenantId}, ${b.branchId}, ${now}, ${slot}, ${overall}, ${sql`${reasons}::text[]`},
            ${f.openTickets}, ${f.queueWaiting}, ${f.queueLongestWaitSeconds}, ${f.techniciansOnShift}, ${f.paymentsLastHour}, ${f.paymentsFailedLastHour},
            ${f.displaysTotal}, ${f.displaysOnline}, ${f.kiosksTotal}, ${f.kiosksOnline}, ${f.terminalsPaired}, ${f.lastRealtimeEventAt}, ${f.smsSentLastHour}, ${f.smsFailedLastHour},
            ${sql`${[...failed]}::text[]`})
          on conflict (branch_id, snapshot_slot) do nothing`.execute(this.db);
      stored += Number(res?.numAffectedRows ?? res?.numInsertedOrUpdatedRows ?? 0) > 0 ? 1 : 0;
    }
    return stored;
  }

  /** The production tick: one job per ACTIVE salon for this slot; exactly once per salon per slot (idempotency key). */
  async dispatch(now = new Date()): Promise<{ salons: number; enqueued: number; duplicates: number }> {
    if (!this.db) return { salons: 0, enqueued: 0, duplicates: 0 };
    const tenants = (await sql<{ id: string }>`select id from tenants where status = 'active' order by id`.execute(this.db)).rows.map((r) => String(r.id));
    const slot = snapshotSlotOf(now).toISOString();
    let enqueued = 0, duplicates = 0;
    for (const id of tenants) {
      const r = await enqueueJob(this.db, { jobClass: 'standard', jobType: BRANCH_SNAPSHOT_JOB, tenantId: id, payload: { observedAt: now.toISOString() }, priority: 3, maxAttempts: 3, idempotencyKey: `${id}:${slot}` });
      if (r.duplicate) duplicates++; else enqueued++;
    }
    return { salons: tenants.length, enqueued, duplicates };
  }

  /** Owner: every active branch of THIS salon with its latest snapshot (null = not snapshotted yet). Tenant from the session only. */
  async forTenant(tenantId: string, now = new Date()): Promise<OwnerBranchHealth> {
    if (!this.db) return { generatedAt: now.toISOString(), branches: [] };
    const r = await sql<any>`select ${snapshotCols('l')}, b.id bid, b.name bname
        from branches b
        left join lateral (select ${snapshotCols('s')} from branch_health_snapshots s where s.branch_id = b.id and s.tenant_id = ${tenantId} order by s.observed_at desc limit 1) l on true
        where b.tenant_id = ${tenantId} and b.status = 'active' and b.deleted_at is null
        order by ${SEVERITY_SQL} desc nulls last, b.name, b.id`.execute(this.db);
    return {
      generatedAt: now.toISOString(),
      branches: r.rows.map((x: any) => ({ branchId: String(x.bid), branchName: x.bname ?? null, snapshot: x.observed_at ? rowToSnapshot({ ...x, branch_id: x.bid, branch_name: x.bname }) : null })),
    };
  }

  /** Super Admin: ONE PAGE of the latest snapshot per branch across every salon, sorted and filtered in the database. */
  async list(sort: BranchHealthSort = 'worst', status?: BranchHealthStatus, page: { limit?: number; cursor?: string | null } = {}, now = new Date()): Promise<SuperAdminBranchHealthList> {
    if (!this.db) return { rows: [], generatedAt: now.toISOString(), total: 0, counts: {}, nextCursor: null };
    const limit = Math.min(Math.max(1, Math.floor(page.limit ?? 100)), 500);
    const offset = decodeBranchHealthCursor(page.cursor);
    const order = sort === 'name' ? sql`t.display_name asc, b.name asc, l.branch_id asc`
      : sort === 'observed' ? sql`l.observed_at asc, t.display_name asc, l.branch_id asc`
      : sql`${SEVERITY_SQL} desc, t.display_name asc, b.name asc, l.branch_id asc`;
    const latest = sql`(select distinct on (s.branch_id) ${snapshotCols('s')} from branch_health_snapshots s order by s.branch_id, s.observed_at desc)`;
    const r = await sql<any>`select ${snapshotCols('l')}, b.name branch_name, t.display_name tenant_name from ${latest} l
        join branches b on b.id = l.branch_id join tenants t on t.id = l.tenant_id
        ${status ? sql`where l.overall_status = ${status}` : sql``}
        order by ${order} limit ${limit + 1} offset ${offset}`.execute(this.db);
    const c = await sql<any>`select l.overall_status, count(*)::int n from ${latest} l group by l.overall_status`.execute(this.db);
    const counts: Partial<Record<BranchHealthStatus, number>> = {};
    for (const x of c.rows) counts[x.overall_status as BranchHealthStatus] = Number(x.n);
    const total = status ? (counts[status] ?? 0) : Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
    const rows: SuperAdminBranchHealthRow[] = r.rows.slice(0, limit).map((x: any) => ({ ...rowToSnapshot(x), tenantId: String(x.tenant_id), tenantName: x.tenant_name ?? null }));
    return { rows, generatedAt: now.toISOString(), total, counts, nextCursor: r.rows.length > limit ? encodeOffsetCursor({ page: Math.floor((offset + limit) / limit) + 1, pageSize: limit, sizeKey: 'limit' }) : null };
  }
}

export function decodeBranchHealthCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const p = decodeOffsetCursor(cursor);
  if (p) return (p.page - 1) * p.pageSize;
  throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'cursor is not valid — restart from the first page' });
}

const SORTS: BranchHealthSort[] = ['worst', 'name', 'observed'];
const STATES: BranchHealthStatus[] = ['HEALTHY', 'DEGRADED', 'OUTAGE', 'UNKNOWN'];

@UseGuards(SuperAdminGuard)
@ListQueries(BranchHealthListControllerListQueries)
@Controller('super-admin/branch-health')
export class BranchHealthListController {
  constructor(private readonly snapshots: BranchHealthSnapshots) {}
  /** §345 — every branch's latest 15-minute snapshot across all salons, worst first by default. */
  @Get() @RequirePermission('super_admin.system_operations.view')
  list(@Query('sort') sort?: string, @Query('status') status?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string): Promise<SuperAdminBranchHealthList> {
    return this.snapshots.list(SORTS.includes(sort as BranchHealthSort) ? (sort as BranchHealthSort) : 'worst',
      STATES.includes(status as BranchHealthStatus) ? (status as BranchHealthStatus) : undefined, { limit: limit ? Number(limit) : undefined, cursor: cursor ?? null });
  }
}

/** owner/branch-health — the Owner App card: the caller's OWN salon's branches only (tenant from the session, never the
 *  query). owner.dashboard.view like the rest of the owner app. */
@Controller('owner/branch-health')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class OwnerBranchHealthController {
  constructor(private readonly snapshots: BranchHealthSnapshots) {}
  @Get() @RequirePermission('owner.dashboard.view')
  get(@Req() req: any): Promise<OwnerBranchHealth> {
    const tenantId = req?.ctx?.tenantId;
    if (!tenantId) throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED', message: 'A salon session is required.' });   // unreachable behind TenantAuthGuard; a registered code
    return this.snapshots.forTenant(String(tenantId));
  }
}
