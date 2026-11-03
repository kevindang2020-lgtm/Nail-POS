// ai-scheduling-jobs.ts — BUILD_PLAN Phase 7 (agent B): the optimizer's background work on the platform's ONE durable job
// queue (Phase 2: jobs table, registerJobHandler, the worker loop; runTick so one process dispatches).
//
// Every 5 minutes ONE process (runTick lease) runs the dispatcher. CROSS-TENANT BY DESIGN — it is a platform sweep that
// enqueues one job PER salon / PER location, each carrying that salon's own tenant id (tenant-partitioned):
//   ai.scheduling.branch_scan   once a day per active location of an ENTITLED salon whose optimizer is enabled (not
//                               switched off at salon or location level) and while the platform switch is off:
//                               engine.runDay(branch_day) for the location's today AND tomorrow, trigger 'job'
//                               (idempotency key per location + date, so the run itself is never duplicated)
//   ai.scheduling.expiry_sweep  every 5 minutes per salon with a live recommendation or customer proposal past its expiry:
//                               engine.expireDue(now) + proposals past their TTL → expired
//   ai.scheduling.insights      nightly per entitled salon (and on demand from POST insights/refresh): duration
//                               statistics + duration / staffing / availability suggestions
// Every handler re-checks the salon (active, entitled, enabled) when it RUNS — the salon may have been suspended or
// switched off while the job waited. Contexts come from systemContext() with only the permissions the job needs.
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DATABASE, enqueueJob, registerJobHandler, jobHandlerFor, PermanentJobError, type AppDatabase } from '@aipowersalon/database';
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { businessDate, utcDate } from '@aipowersalon/date-time';
import { SCHED_PACKAGE, SCHED_ENGINE, addDaysYmd, isUuid, rowsOf, schedWorkerCtx, type SchedEngine } from './ai-scheduling-ops.common';
import { SCHED_PLATFORM_SETTING } from './ai-scheduling-ops.platform-switch';
import { ScheduleProposalService } from './ai-scheduling-proposals';
import { SchedInsightService, type InsightRefreshQueue } from './ai-scheduling-insights';

export const SCHED_JOB = { branchScan: 'ai.scheduling.branch_scan', expirySweep: 'ai.scheduling.expiry_sweep', insights: 'ai.scheduling.insights' } as const;
export const TICK_MS = 5 * 60_000;
const DEFAULT_TZ = 'America/New_York';

/** On unless AI_SCHEDULING_JOBS is explicitly off. */
export function schedJobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.AI_SCHEDULING_JOBS ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

const ENTITLED = sql`
  select t.id from tenants t
   where t.status = 'active'
     and exists (select 1 from tenant_ai_subscriptions sub where sub.tenant_id = t.id and sub.package_code = ${SCHED_PACKAGE}
                   and sub.status in ('active','trialing') and (sub.trial_ends_at is null or sub.trial_ends_at > now() or sub.status = 'active'))
     and not exists (select 1 from tenant_scheduling_ai_settings s where s.tenant_id = t.id and s.level = 'tenant' and s.enabled = false)`;

async function platformKilled(db: Kysely<any>): Promise<boolean> {
  // Scheduling Optimizer guide (Nov 2026): no `.catch(() => no rows)` — an unreadable switch used to dispatch every scan
  // (fail open). A read error now fails the dispatch tick; the next tick retries.
  const r = rowsOf(await sql`select value from platform_settings where setting_key = ${SCHED_PLATFORM_SETTING} limit 1`.execute(db))[0];
  return !!r && (r.value === true || r.value === 'true');
}

/** The dispatcher. Returns what it enqueued (duplicates — the same day's scan, the same 5-minute sweep — are skipped). */
export async function dispatchSchedJobs(db: Kysely<any>, nowMs = Date.now()): Promise<{ scans: number; sweeps: number; insights: number; platformKilled: boolean }> {
  const day = utcDate(new Date(nowMs));       // the dispatch key; each location's own date is resolved when the job runs
  const bucket = Math.floor(nowMs / TICK_MS);
  let scans = 0, sweeps = 0, insights = 0;
  const killed = await platformKilled(db);
  if (!killed) {
    const branches = rowsOf(await sql`
      with entitled as (${ENTITLED})
      select b.tenant_id, b.id as branch_id from branches b join entitled e on e.id = b.tenant_id
       where b.status = 'active'
         and not exists (select 1 from tenant_scheduling_ai_settings s where s.tenant_id = b.tenant_id and s.level = 'branch' and s.branch_id = b.id and s.enabled = false)`.execute(db));
    for (const b of branches) {
      const r = await enqueueJob(db, { jobClass: 'standard', jobType: SCHED_JOB.branchScan, tenantId: String(b.tenant_id), payload: { branchId: String(b.branch_id) }, priority: 2, maxAttempts: 3, idempotencyKey: `${b.branch_id}:${day}` });
      if (!r.duplicate) scans++;
    }
    for (const t of rowsOf(await ENTITLED.execute(db))) {
      const r = await enqueueJob(db, { jobClass: 'standard', jobType: SCHED_JOB.insights, tenantId: String(t.id), payload: {}, priority: 3, maxAttempts: 2, idempotencyKey: `${t.id}:${day}` });
      if (!r.duplicate) insights++;
    }
  }
  // expiry runs even while the platform switch is on: an expired suggestion must never stay applicable
  const due = rowsOf(await sql`
    select tenant_id from schedule_optimization_recommendations
     where expires_at <= now() and status in ('generated','review_required','review_in_progress','accepted','partially_accepted','needs_revision','customer_approval_required','customer_approved','application_pending')
    union
    select tenant_id from schedule_change_proposals where expires_at <= now() and status in ('proposed','customer_notified')`.execute(db));
  for (const t of due) {
    const r = await enqueueJob(db, { jobClass: 'standard', jobType: SCHED_JOB.expirySweep, tenantId: String(t.tenant_id), payload: {}, priority: 1, maxAttempts: 3, idempotencyKey: `${t.tenant_id}:${bucket}` });
    if (!r.duplicate) sweeps++;
  }
  return { scans, sweeps, insights, platformKilled: killed };
}

export interface SchedJobDeps {
  db: Kysely<any>;
  engine: SchedEngine;
  proposals: Pick<ScheduleProposalService, 'expireDue'>;
  insights: Pick<SchedInsightService, 'generate'>;
  now?: () => number;
}

async function salonReady(db: Kysely<any>, tenantId: string): Promise<string | null> {
  const ok = rowsOf(await sql`with entitled as (${ENTITLED}) select 1 as ok from entitled where id = ${tenantId}`.execute(db))[0];
  return ok ? null : 'salon_not_entitled_or_disabled';
}

export async function runBranchScanJob(deps: SchedJobDeps, tenantId: string | null, payload: Record<string, unknown>) {
  if (!isUuid(tenantId) || !isUuid(payload.branchId)) throw new PermanentJobError('a scheduling scan needs its tenant and location');
  const branchId = payload.branchId;
  if (await platformKilled(deps.db)) return { skipped: 'platform_killed' };
  const why = await salonReady(deps.db, tenantId);
  if (why) return { skipped: why };
  const b = rowsOf(await sql`select status, timezone from branches where id = ${branchId} and tenant_id = ${tenantId}`.execute(deps.db))[0];
  if (!b || b.status !== 'active') return { skipped: 'branch_not_active' };
  const off = rowsOf(await sql`select 1 from tenant_scheduling_ai_settings where tenant_id = ${tenantId} and level = 'branch' and branch_id = ${branchId} and enabled = false`.execute(deps.db))[0];
  if (off) return { skipped: 'branch_disabled' };
  const today = businessDate(String(b.timezone || DEFAULT_TZ), new Date((deps.now ?? Date.now)()));
  const ctx = schedWorkerCtx('scheduling-daily-scan', tenantId, branchId);
  const runs: { date: string; runId: string | null; recommendations: number; error?: string }[] = [];
  for (const date of [today, addDaysYmd(today, 1)]) {
    try {
      const d = await deps.engine.runDay(ctx, { scope: 'branch_day', date, technicianId: null, idempotencyKey: `job:${branchId}:${date}` }, 'job');
      runs.push({ date, runId: d?.run?.id ?? null, recommendations: d?.recommendations?.length ?? 0 });
    } catch (e: any) { runs.push({ date, runId: null, recommendations: 0, error: String(e?.code ?? e?.message ?? e).slice(0, 120) }); }
  }
  if (runs.every((r) => r.error)) throw new Error(`scheduling scan failed: ${runs.map((r) => r.error).join('; ')}`);
  return { runs };
}

export async function runExpirySweepJob(deps: SchedJobDeps, tenantId: string | null) {
  if (!isUuid(tenantId)) throw new PermanentJobError('an expiry sweep needs its tenant');
  const now = (deps.now ?? Date.now)();
  const ctx = schedWorkerCtx('scheduling-expiry', tenantId, null);
  const recs = await deps.engine.expireDue(ctx, now);
  const proposals = await deps.proposals.expireDue(tenantId);
  return { recommendations: recs, proposals };
}

export async function runInsightsJob(deps: SchedJobDeps, tenantId: string | null) {
  if (!isUuid(tenantId)) throw new PermanentJobError('an insights run needs its tenant');
  const why = await salonReady(deps.db, tenantId);
  if (why) return { skipped: why };
  return deps.insights.generate(schedWorkerCtx('scheduling-insights', tenantId, null));
}

export function registerSchedJobHandlers(deps: SchedJobDeps): void {
  if (!jobHandlerFor(SCHED_JOB.branchScan)) registerJobHandler(SCHED_JOB.branchScan, async (payload, ctx) => runBranchScanJob(deps, ctx.tenantId, payload));
  if (!jobHandlerFor(SCHED_JOB.expirySweep)) registerJobHandler(SCHED_JOB.expirySweep, async (_p, ctx) => runExpirySweepJob(deps, ctx.tenantId));
  if (!jobHandlerFor(SCHED_JOB.insights)) registerJobHandler(SCHED_JOB.insights, async (_p, ctx) => runInsightsJob(deps, ctx.tenantId));
}

/** POST insights/refresh: one insights job for the salon (at most one per minute). */
export class JobInsightRefreshQueue implements InsightRefreshQueue {
  constructor(private readonly db: Kysely<any>, private readonly now: () => number = Date.now) {}
  async enqueueRefresh(tenantId: string) {
    const r = await enqueueJob(this.db, { jobClass: 'standard', jobType: SCHED_JOB.insights, tenantId, payload: { manual: true }, priority: 2, maxAttempts: 2, idempotencyKey: `${tenantId}:refresh:${Math.floor(this.now() / 60_000)}` });
    return { queued: !r.duplicate };
  }
}

@Injectable()
export class SchedOpsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AiSchedulingOps');
  private timer: NodeJS.Timeout | null = null;
  constructor(
    @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null,
    @Inject(SCHED_ENGINE) private readonly engine: SchedEngine,
    @Inject(ScheduleProposalService) private readonly proposals: ScheduleProposalService,
    @Inject(SchedInsightService) private readonly insights: SchedInsightService,
  ) {}

  deps(): SchedJobDeps | null {
    if (!this.db) return null;
    return { db: this.db as unknown as Kysely<any>, engine: this.engine, proposals: this.proposals, insights: this.insights };
  }
  onModuleInit(): void {
    const deps = this.deps();
    if (!deps) return;
    registerSchedJobHandlers(deps);                  // every process: a worker anywhere may take the job
    if (!runsBackgroundJob('standard') || !schedJobsEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'ai.scheduling.dispatch', jobClass: 'standard', everyMs: TICK_MS }, () => this.dispatch()).catch(() => undefined); }, TICK_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  /** Public so ops and tests can run one dispatch without waiting for the timer. */
  async dispatch() {
    if (!this.db) return null;
    const r = await dispatchSchedJobs(this.db as unknown as Kysely<any>);
    if (r.scans || r.sweeps || r.insights) this.log.debug?.(`scheduling ops: ${JSON.stringify(r)}`);
    return r;
  }
}
