// tenant-health.ts — Constitution 11 §156–159, §293, §299–300, §339: one salon's operational health, for support.
//
// THE QUESTION IT ANSWERS: a salon calls — "is their Twilio connected, are their payments set up, are their booking
// codes getting through, are their devices online, is anything failing?" — without support opening private data (§159).
//
// HOW (§339: tenant diagnostics without metric explosion). Never a tenant label on a metric. Every fact comes from
// tables the platform already keeps PER SALON (several already aggregated per day), read on demand for ONE salon.
// Nothing here is persisted for all 10,000 salons every 30 seconds; a support lookup costs a handful of indexed queries.
//
// EXPLICIT COMPONENTS, NO OPAQUE SCORE (§157): payments, messaging, booking, devices, jobs — each with §300's state
// (HEALTHY / DEGRADED / MISCONFIGURED / RATE_LIMITED / OUTAGE / UNKNOWN) and a reason a support agent can read.
// §299: a salon's own configuration problem (MISCONFIGURED — their credentials) is kept distinct from a provider
// outage (the platform's providers are on System Operations).
//
// JUDGEMENT CALLS, stated:
//   • Card attempt failures are SHOWN, not judged: many are customer declines, and §58 forbids reading declines as
//     an outage. Payment health comes from the salon's payment configuration, not from its customers' cards.
//   • A feature the salon does not use (no SMS configured) is UNKNOWN "not_used" and does not affect the overall.
//   • Devices are judged over 24 hours: a salon closed overnight is not an offline salon.
import { SuperAdminGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { BadRequestException, Controller, Get, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Optional, Param, Query, UseGuards } from '@nestjs/common';
import { runTick, log } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { sql } from 'kysely';
import { decodeOffsetCursor, encodeOffsetCursor } from '@aipowersalon/api-contracts';
import { DATABASE, enqueueJob, registerJobHandler, jobHandlerFor, PermanentJobError, ListQueries } from '@aipowersalon/database';

// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15) — the Super Admin app reads the same ones.
export type { IntegrationState, TenantComponent, TenantHealth, TenantHealthRow, HealthListSort, TenantHealthList } from '@aipowersalon/api-contracts/platform';
import type { IntegrationState, TenantComponent, TenantHealth, TenantHealthRow, HealthListSort, TenantHealthList } from '@aipowersalon/api-contracts/platform';
import { TenantHealthListControllerListQueries } from './tenant-health.list-queries';

export interface TenantFacts {
  payment: { status: string | null; onboarding: string | null } | null;
  paymentAttempts24h: { total: number; failed: number };
  messaging: { status: string | null; validationError: string | null } | null;
  a2pCampaign: string | null;
  sms24h: { total: number; failed: number };
  verification2d: { sent: number; verified: number; failed: number };
  devices: { active: number; notSeen24h: number };
  jobs24h: { aiFailed: number; importsFailed7d: number };
  /** Fact queries that FAILED. Never read as "not configured" or zero — see evaluateTenantHealth. */
  failed: string[];
}

const lower = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();
const u = (reason: string, details: TenantComponent['details'] = {}): TenantComponent => ({ state: 'UNKNOWN', reason, details });
const MIN_VOLUME = 20;   // below this, a failure rate is noise, not a finding

/** Pure. Every rule below is pinned by a test. */
export function evaluateTenantHealth(f: TenantFacts): TenantHealth['components'] {
  const c = evaluateFromFacts(f);
  // SILENT-SQL-RISK: a query that FAILED must never read as "not configured" or "zero failures" — that is a salon
  // reported fine because a column name was wrong. Any component whose facts could not be read is UNKNOWN, named.
  const OWNS: Record<keyof TenantHealth['components'], string[]> = {
    payments: ['payment_config', 'payment_attempts'], messaging: ['messaging_credentials', 'a2p', 'sms_delivery'],
    booking: ['verification_usage'], devices: ['devices'], jobs: ['ai_jobs', 'import_jobs'],
  };
  for (const [k, facts] of Object.entries(OWNS) as Array<[keyof TenantHealth['components'], string[]]>) {
    const broken = facts.filter((x) => f.failed.includes(x));
    if (broken.length) c[k] = { state: 'UNKNOWN', reason: `query_failed:${broken.join(',')}`, details: c[k].details };
  }
  return c;
}

function evaluateFromFacts(f: TenantFacts): TenantHealth['components'] {
  // PAYMENTS — configuration, not customers' cards (§58).
  const pDetails = { configStatus: f.payment?.status ?? null, onboarding: f.payment?.onboarding ?? null, attempts24h: f.paymentAttempts24h.total, failedAttempts24h: f.paymentAttempts24h.failed };
  const payments: TenantComponent = !f.payment ? u('not_configured', pDetails)
    : lower(f.payment.status) === 'error' ? { state: 'MISCONFIGURED', reason: 'payment_config_error', details: pDetails }
    : lower(f.payment.onboarding) === 'declined' ? { state: 'MISCONFIGURED', reason: 'merchant_onboarding_declined', details: pDetails }
    : ['disabled', 'paused'].includes(lower(f.payment.status)) ? { state: 'DEGRADED', reason: `payments_${lower(f.payment.status)}`, details: pDetails }
    : lower(f.payment.status) === 'pending' ? { state: 'DEGRADED', reason: 'payments_pending_setup', details: pDetails }
    : { state: 'HEALTHY', reason: 'ok', details: pDetails };

  // MESSAGING — the salon's own Twilio credentials, its A2P campaign, and delivery.
  const smsRate = f.sms24h.total ? f.sms24h.failed / f.sms24h.total : 0;
  const mDetails = { credentials: f.messaging?.status ?? null, a2pCampaign: f.a2pCampaign, sent24h: f.sms24h.total, failed24h: f.sms24h.failed };
  const campaign = lower(f.a2pCampaign);
  const messaging: TenantComponent = !f.messaging || lower(f.messaging.status) === 'not_configured' ? u('not_used', mDetails)
    : f.messaging.validationError ? { state: 'MISCONFIGURED', reason: 'twilio_credentials_invalid', details: mDetails }
    : ['failed', 'rejected', 'declined'].includes(campaign) ? { state: 'MISCONFIGURED', reason: 'a2p_campaign_rejected', details: mDetails }
    : f.sms24h.total >= MIN_VOLUME && smsRate >= 0.5 ? { state: 'OUTAGE', reason: 'sms_delivery_failing', details: mDetails }
    : f.sms24h.total >= MIN_VOLUME && smsRate >= 0.2 ? { state: 'DEGRADED', reason: 'sms_delivery_errors', details: mDetails }
    : campaign && !['approved', 'verified', 'active'].includes(campaign) ? { state: 'DEGRADED', reason: 'a2p_campaign_not_approved', details: mDetails }
    : { state: 'HEALTHY', reason: 'ok', details: mDetails };

  // BOOKING — verification codes getting through (already aggregated per day).
  const v = f.verification2d;
  const bDetails = { codesSent2d: v.sent, verified2d: v.verified, failed2d: v.failed };
  const booking: TenantComponent = v.sent === 0 ? u('no_verification_traffic', bDetails)
    : v.sent >= MIN_VOLUME && v.failed / v.sent >= 0.3 ? { state: 'DEGRADED', reason: 'verification_failures_high', details: bDetails }
    : { state: 'HEALTHY', reason: 'ok', details: bDetails };

  // DEVICES — active devices not seen for a day (a salon closed overnight is not offline).
  const dDetails = { activeDevices: f.devices.active, notSeen24h: f.devices.notSeen24h };
  const devices: TenantComponent = f.devices.active === 0 ? u('no_devices', dDetails)
    : f.devices.notSeen24h === f.devices.active ? { state: 'OUTAGE', reason: 'all_devices_offline_24h', details: dDetails }
    : f.devices.notSeen24h > 0 ? { state: 'DEGRADED', reason: 'devices_offline_24h', details: dDetails }
    : { state: 'HEALTHY', reason: 'ok', details: dDetails };

  // JOBS — background work that failed for this salon.
  const jDetails = { aiJobsFailed24h: f.jobs24h.aiFailed, importsFailed7d: f.jobs24h.importsFailed7d };
  const jobs: TenantComponent = f.jobs24h.aiFailed > 0 || f.jobs24h.importsFailed7d > 0 ? { state: 'DEGRADED', reason: 'failed_jobs', details: jDetails } : { state: 'HEALTHY', reason: 'ok', details: jDetails };

  return { payments, messaging, booking, devices, jobs };
}

const RANK: Record<IntegrationState, number> = { HEALTHY: 0, UNKNOWN: 0, DEGRADED: 1, RATE_LIMITED: 2, MISCONFIGURED: 3, OUTAGE: 4 };
/** Worst of the components that are in use. UNKNOWN (not used / no traffic) never drags a salon down — or up. */
export function tenantOverall(c: TenantHealth['components']): IntegrationState {
  const inUse = Object.values(c).filter((x) => x.state !== 'UNKNOWN');
  if (inUse.length === 0) return 'UNKNOWN';
  return inUse.reduce<IntegrationState>((w, x) => (RANK[x.state] > RANK[w] ? x.state : w), 'HEALTHY');
}

@Injectable()
export class TenantHealthService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  /** Every query filters by tenant_id. Counts and statuses only — no customer or message content (§159). */
  async facts(tenantId: string, now = new Date()): Promise<TenantFacts> {
    const d1 = new Date(now.getTime() - 86_400_000), d7 = new Date(now.getTime() - 7 * 86_400_000);
    const failed: string[] = [];
    // A failure is RECORDED, never swallowed into "no row": see evaluateTenantHealth.
    const one = async <T>(name: string, q: any): Promise<T | null> => { try { return ((await q.execute(this.db)).rows[0] ?? null) as T | null; } catch { failed.push(name); return null; } };
    const pay = await one<any>('payment_config', sql`select status, onboarding_status from tenant_payment_config where tenant_id = ${tenantId} order by created_at desc limit 1`);
    const att = await one<any>('payment_attempts', sql`select count(*)::int total, count(*) filter (where lower(status) in ('failed', 'failure', 'declined', 'error'))::int failed
                                   from payment_attempts where tenant_id = ${tenantId} and created_at >= ${d1}`);
    const msg = await one<any>('messaging_credentials', sql`select status, last_validation_error from tenant_messaging_credentials where tenant_id = ${tenantId} and branch_id is null order by created_at desc limit 1`);
    const a2p = await one<any>('a2p', sql`select campaign_status from tenant_a2p_registrations where tenant_id = ${tenantId} order by created_at desc limit 1`);
    const sms = await one<any>('sms_delivery', sql`select count(*)::int total, count(*) filter (where status = 'failed')::int failed from sms_delivery_logs where tenant_id = ${tenantId} and created_at >= ${d1}`);
    const ver = await one<any>('verification_usage', sql`select coalesce(sum(sent_count), 0)::int sent, coalesce(sum(verified_count), 0)::int verified, coalesce(sum(failed_count), 0)::int failed
                                   from booking_verification_usage_daily where tenant_id = ${tenantId} and usage_date >= ${d1.toISOString().slice(0, 10)}`);
    const dev = await one<any>('devices', sql`select count(*)::int active, count(*) filter (where last_seen_at is null or last_seen_at < ${d1})::int stale from (
          select last_seen_at from go_checkin_devices where tenant_id = ${tenantId} and status = 'active'
          union all select last_seen_at from customer_display_devices where tenant_id = ${tenantId} and pairing_status = 'paired' and revoked_at is null
        ) d`);
    const ai = await one<any>('ai_jobs', sql`select count(*)::int n from ai_jobs where tenant_id = ${tenantId} and status = 'FAILED' and created_at >= ${d1}`);
    const imp = await one<any>('import_jobs', sql`select count(*)::int n from customer_import_jobs where tenant_id = ${tenantId} and lower(status) = 'failed' and created_at >= ${d7}`);
    return {
      payment: pay ? { status: pay.status, onboarding: pay.onboarding_status } : null,
      paymentAttempts24h: { total: att?.total ?? 0, failed: att?.failed ?? 0 },
      messaging: msg ? { status: msg.status, validationError: msg.last_validation_error } : null,
      a2pCampaign: a2p?.campaign_status ?? null,
      sms24h: { total: sms?.total ?? 0, failed: sms?.failed ?? 0 },
      verification2d: { sent: ver?.sent ?? 0, verified: ver?.verified ?? 0, failed: ver?.failed ?? 0 },
      devices: { active: dev?.active ?? 0, notSeen24h: dev?.stale ?? 0 },
      jobs24h: { aiFailed: ai?.n ?? 0, importsFailed7d: imp?.n ?? 0 },
      failed,
    };
  }

  async health(tenantId: string, now = new Date()): Promise<TenantHealth> {
    if (!this.db) throw new NotFoundException('Tenant not found.');
    const t = (await sql<any>`select id, display_name from tenants where id::text = ${tenantId} limit 1`.execute(this.db)).rows[0];
    if (!t) throw new NotFoundException('Tenant not found.');
    const facts = await this.facts(t.id, now);
    const components = evaluateTenantHealth(facts);
    return { tenantId: t.id, tenantName: t.display_name ?? null, observedAt: now.toISOString(), overall: tenantOverall(components), failedQueries: facts.failed, components };
  }
}

/** How bad a state is, for sorting the list worst-first. UNKNOWN (not in use) sorts after every real problem. */
export const STATE_SEVERITY: Record<IntegrationState, number> = { OUTAGE: 5, MISCONFIGURED: 4, DEGRADED: 3, RATE_LIMITED: 2, UNKNOWN: 1, HEALTHY: 0 };

/** Pure: order the latest-per-salon rows. 'worst' = highest severity first, then name (stable, so the list does not jump). */
export function sortHealthRows(rows: TenantHealthRow[], sort: HealthListSort = 'worst'): TenantHealthRow[] {
  const byName = (a: TenantHealthRow, b: TenantHealthRow) => String(a.tenantName ?? '').localeCompare(String(b.tenantName ?? '')) || a.tenantId.localeCompare(b.tenantId);
  const out = [...rows];
  if (sort === 'name') return out.sort(byName);
  if (sort === 'observed') return out.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || byName(a, b));   // stalest first
  return out.sort((a, b) => STATE_SEVERITY[b.overall] - STATE_SEVERITY[a.overall] || byName(a, b));
}

const SNAPSHOT_EVERY_MS = 60 * 60 * 1000;   // §344: hourly
/** BUILD_PLAN Phase 11 (Constitution 4 §27/§107): one queue job per salon per hour instead of one loop over every salon. */
export const TENANT_SNAPSHOT_JOB = 'tenant.health.snapshot.tenant';
export const snapshotHourOf = (now: Date) => new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);

/**
 * §344 — the hourly snapshot: every ACTIVE salon's health, evaluated by the SAME code as the on-demand read, stored as one
 * row per salon per hour (the unique (tenant_id, snapshot_hour) makes a second worker or a retry a no-op). One salon's
 * failure never stops the others.
 *
 * TENANT-PARTITIONED (Phase 11): the hourly tick no longer evaluates 10,000 salons in one process — it ENQUEUES one
 * `tenant.health.snapshot.tenant` job per active salon on the durable queue (class 'standard'), idempotency key
 * `<tenant>:<hour>`, so a second dispatcher in the same hour adds nothing, the workers spread the salons, the per-tenant
 * cap applies, and one salon's failure retries alone. `sweep()` (all salons in-process) stays for ops and tests.
 */
@Injectable()
export class TenantHealthSnapshots implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly health: TenantHealthService, @Optional() @Inject(DATABASE) private readonly db: any) {}

  onModuleInit(): void {
    // the handler is registered wherever this module loads, so whichever process runs 'standard' jobs can run it
    if (this.db && !jobHandlerFor(TENANT_SNAPSHOT_JOB)) registerJobHandler(TENANT_SNAPSHOT_JOB, async (payload, ctx) => {
      const tenantId = ctx.tenantId; const at = typeof payload.observedAt === 'string' ? new Date(payload.observedAt) : null;
      if (!tenantId || !at || Number.isNaN(at.getTime())) throw new PermanentJobError('tenant.health.snapshot.tenant needs a tenant and observedAt');
      return { stored: await this.snapshotOne(tenantId, at) };
    });
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (process.env.NODE_ENV === 'test' || !this.db) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'tenant.health.snapshot', jobClass: 'standard', everyMs: SNAPSHOT_EVERY_MS }, () => this.dispatch()).catch(() => undefined); }, SNAPSHOT_EVERY_MS);
    if (typeof (this.timer as any)?.unref === 'function') (this.timer as any).unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async activeTenantIds(): Promise<string[]> {
    return (await sql<{ id: string }>`select id from tenants where status = 'active' order by id`.execute(this.db)).rows.map((r) => String(r.id));
  }

  /** One salon, one hour. True when a row was stored (false = this hour already has one). Throws on failure (the job retries). */
  async snapshotOne(tenantId: string, now: Date): Promise<boolean> {
    const hour = snapshotHourOf(now);
    const h = await this.health.health(tenantId, now);
    const c = h.components;
    const res: any = await sql`insert into tenant_health_snapshots
        (tenant_id, observed_at, snapshot_hour, overall_status, payments_status, communications_status, booking_status, devices_status, jobs_status, realtime_status, failed_queries, components)
      values (${tenantId}, ${now}, ${hour}, ${h.overall}, ${c.payments.state}, ${c.messaging.state}, ${c.booking.state}, ${c.devices.state}, ${c.jobs.state}, ${null},
              ${sql`${h.failedQueries}::text[]`}, ${JSON.stringify(c)}::jsonb)
      on conflict (tenant_id, snapshot_hour) do nothing`.execute(this.db);
    return Number(res?.numAffectedRows ?? res?.numInsertedOrUpdatedRows ?? 0) > 0;
  }

  /** The production tick: one job per active salon for this hour. Exactly once per salon per hour (idempotency key). */
  async dispatch(now = new Date()): Promise<{ salons: number; enqueued: number; duplicates: number }> {
    if (!this.db) return { salons: 0, enqueued: 0, duplicates: 0 };
    const tenants = await this.activeTenantIds();
    const hour = snapshotHourOf(now).toISOString();
    let enqueued = 0, duplicates = 0;
    for (const id of tenants) {
      const r = await enqueueJob(this.db, { jobClass: 'standard', jobType: TENANT_SNAPSHOT_JOB, tenantId: id, payload: { observedAt: now.toISOString() }, priority: 3, maxAttempts: 3, idempotencyKey: `${id}:${hour}` });
      if (r.duplicate) duplicates++; else enqueued++;
    }
    return { salons: tenants.length, enqueued, duplicates };
  }

  /** Every active salon in THIS process (ops / tests). Same per-salon code as the queue job. */
  async sweep(now = new Date()): Promise<{ salons: number; stored: number; failed: number }> {
    if (!this.db) return { salons: 0, stored: 0, failed: 0 };
    const tenants = await this.activeTenantIds();
    let stored = 0, failed = 0;
    for (const id of tenants) {
      try { if (await this.snapshotOne(id, now)) stored += 1; }
      catch (e) {
        failed += 1;
        log.error('tenant_health.snapshot_failed', { tenantId: id, error: (e as Error).message });
      }
    }
    return { salons: tenants.length, stored, failed };
  }

  /** §156 — the latest snapshot per salon, sorted. A salon never snapshotted yet is simply absent (not shown as healthy). */
  /**
   * §156 + §290 — ONE PAGE of the latest snapshot per salon, sorted and filtered IN THE DATABASE (the first version loaded
   * every salon and sorted in memory; the load test measured 10,000 rows in one response). `counts` covers every salon so
   * the screen can show totals without loading them. The cursor is opaque to clients.
   */
  async list(sort: HealthListSort = 'worst', status?: IntegrationState, page: { limit?: number; cursor?: string | null } = {}): Promise<TenantHealthList> {
    if (!this.db) return { rows: [], generatedAt: new Date().toISOString(), total: 0, nextCursor: null, counts: {} };
    const limit = Math.min(Math.max(1, Math.floor(page.limit ?? 100)), 500);
    const offset = decodeHealthCursor(page.cursor);
    const order = sort === 'name' ? sql`t.display_name asc, l.tenant_id asc`
      : sort === 'observed' ? sql`l.observed_at asc, t.display_name asc, l.tenant_id asc`
      : sql`case l.overall_status when 'OUTAGE' then 5 when 'MISCONFIGURED' then 4 when 'DEGRADED' then 3 when 'RATE_LIMITED' then 2 when 'UNKNOWN' then 1 else 0 end desc, t.display_name asc, l.tenant_id asc`;
    const latest = sql`(select distinct on (tenant_id) * from tenant_health_snapshots order by tenant_id, observed_at desc)`;
    const r = await sql<any>`select l.*, t.display_name from ${latest} l join tenants t on t.id = l.tenant_id
                              ${status ? sql`where l.overall_status = ${status}` : sql``}
                              order by ${order} limit ${limit + 1} offset ${offset}`.execute(this.db);
    const c = await sql<any>`select l.overall_status, count(*)::int n from ${latest} l group by l.overall_status`.execute(this.db);
    const counts: Partial<Record<IntegrationState, number>> = {};
    for (const x of c.rows) counts[x.overall_status as IntegrationState] = Number(x.n);
    const total = status ? (counts[status] ?? 0) : Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
    const more = r.rows.length > limit;
    const rows: TenantHealthRow[] = r.rows.slice(0, limit).map((x: any) => ({
      tenantId: String(x.tenant_id), tenantName: x.display_name ?? null, observedAt: new Date(x.observed_at).toISOString(), overall: x.overall_status,
      components: { payments: x.payments_status, messaging: x.communications_status, booking: x.booking_status, devices: x.devices_status, jobs: x.jobs_status },
      realtime: x.realtime_status ?? null, failedQueries: Array.isArray(x.failed_queries) ? x.failed_queries : [],
    }));
    return { rows, generatedAt: new Date().toISOString(), total, counts, nextCursor: more ? encodeHealthCursor(offset + limit, limit) : null };
  }
}

// Constitution 5 §46: the shared v3 offset cursor (was a private {o} format). `offset` is always a multiple of `limit`
// because the bridge makes the cursor's size win over a re-sent ?limit=.
export const encodeHealthCursor = (offset: number, limit: number) => encodeOffsetCursor({ page: Math.floor(offset / limit) + 1, pageSize: limit, sizeKey: 'limit' });
/** A cursor that is neither ours nor a pre-Oct {o} cursor is refused: silently restarting at 0 would append duplicate
 *  rows to the salon-health screen's infinite scroll. */
export function decodeHealthCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const p = decodeOffsetCursor(cursor);
  if (p) return (p.page - 1) * p.pageSize;
  try { const o = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))?.o; if (Number.isInteger(o) && o >= 0) return o; } catch { /* fall through */ }
  throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'cursor is not valid — restart from the first page' });
}

const SORTS: HealthListSort[] = ['worst', 'name', 'observed'];
const STATES = Object.keys(STATE_SEVERITY) as IntegrationState[];

@UseGuards(SuperAdminGuard)
@ListQueries(TenantHealthListControllerListQueries)
@Controller('super-admin/tenant-health')
export class TenantHealthListController {
  constructor(private readonly snapshots: TenantHealthSnapshots) {}
  /** §156 — every salon's latest health (hourly snapshots), worst first by default. */
  @Get() @RequirePermission('super_admin.system_operations.view')
  list(@Query('sort') sort?: string, @Query('status') status?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.snapshots.list(SORTS.includes(sort as HealthListSort) ? (sort as HealthListSort) : 'worst', STATES.includes(status as IntegrationState) ? (status as IntegrationState) : undefined,
      { limit: limit ? Number(limit) : undefined, cursor: cursor ?? null });
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/tenants')
export class TenantHealthController {
  constructor(private readonly svc: TenantHealthService) {}
  /** §293 GET /api/v1/platform/tenants/{tenantId}/health, on this repo's route convention. */
  @Get(':tenantId/health') @RequirePermission('super_admin.system_operations.view')
  health(@Param('tenantId') tenantId: string) { return this.svc.health(tenantId); }
}
