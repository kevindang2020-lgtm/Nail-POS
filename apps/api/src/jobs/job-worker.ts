// job-worker.ts — drains the ONE job queue (migration 519; BUILD_PLAN Phase 2; Constitution 4 §28–36).
//
// In every process that runs a job class (PROCESS_ROLE / WORKER_JOB_CLASSES, Constitution 13 Phase 8) a small loop per
// class claims due jobs (FOR UPDATE SKIP LOCKED — two processes never take the same job), runs each job's registered
// handler through runJob (job id, tenant, attempt, queue wait — Constitution 11 §192), renews the lease while the
// handler works, and records the outcome: succeeded, retry later with backoff + jitter, or dead after max_attempts (or
// at once for a PermanentJobError / a type nobody handles). A reaper tick (single-owner, runTick) puts the jobs of a
// worker that died back in the queue. On shutdown the loops stop claiming and wait for the jobs in flight.
//
// Off in tests (NODE_ENV=test) and when JOBS_WORKER=off; otherwise on wherever the job class may run.
import { Inject, Injectable, Logger, Optional, type BeforeApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  DATABASE, DATABASE_WORKER, JOB_QUEUE_CLASSES, claimJobs, completeJob, failJob, renewJobLease, startLeaseHeartbeat, reapExpiredLeases, jobHandlerFor,
  PermanentJobError, registerJobHandler, jobHandlerFor as handlerFor, type JobQueueClass, type JobRow,
} from '@aipowersalon/database';
import { runJob, runTick } from '@aipowersalon/observability';
import { postRestoreHoldActive, POST_RESTORE_HOLD_MESSAGE, runsBackgroundJob, processInstanceId } from '@aipowersalon/config';

export interface WorkerOptions { pollMs?: number; idlePollMs?: number; leaseMs?: number; concurrency?: number; perTenantCap?: number }

/** The built-in self-test: proves a worker is alive and which process ran the job (Super Admin → Jobs → Run self-test).
 *  It does no work and touches no salon data; its result names the process that ran it. */
export const SELF_TEST_JOB = 'jobs.self_test';
export function registerBuiltInJobHandlers(owner = processInstanceId()): void {
  if (!handlerFor(SELF_TEST_JOB)) registerJobHandler(SELF_TEST_JOB, async (payload, ctx) => {
    // holdMs (0–2000): the job occupies its worker slot that long, so a self-test of several jobs shows every worker taking a share
    const hold = Math.max(0, Math.min(2_000, Math.floor(Number(payload?.holdMs) || 0)));
    if (hold) await new Promise((r) => setTimeout(r, hold));
    return { processedBy: owner, attempt: ctx.attempt, heldMs: hold, at: new Date().toISOString() };
  });
}

export function jobsWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'test') return false;
  return String(env.JOBS_WORKER ?? 'on').toLowerCase() !== 'off';
}
export function concurrencyFor(jobClass: JobQueueClass, env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env[`JOBS_CONCURRENCY_${jobClass.toUpperCase()}`] ?? env.JOBS_CONCURRENCY ?? 2);
  return Number.isFinite(v) ? Math.max(1, Math.min(32, Math.floor(v))) : 2;
}

/** One class's loop. Exported (and constructible without Nest) so the real-Postgres tests drive exactly this code. */
export class JobClassLoop {
  private inFlight = new Set<Promise<void>>();
  private stopped = false;
  private heldLogged = false;   // mandate §212: the hold is logged once per pause
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly processed = { succeeded: 0, retried: 0, dead: 0 };
  constructor(
    private readonly db: Kysely<any>, readonly jobClass: JobQueueClass, private readonly owner: string,
    private readonly opts: Required<WorkerOptions>, private readonly log: Pick<Logger, 'warn' | 'error' | 'log'> = new Logger('JobWorker'),
  ) {}

  start(): void { this.stopped = false; this.schedule(0); }
  async stop(graceMs = 20_000): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await Promise.race([Promise.allSettled([...this.inFlight]), new Promise((r) => setTimeout(r, graceMs))]);
  }
  get busy(): number { return this.inFlight.size; }

  private pumping = false;
  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);   // one pending wake-up at a time
    this.timer = setTimeout(() => { void this.pump(); }, ms);
    (this.timer as any).unref?.();
  }

  /** Claim as many jobs as there are free slots and start them. Public for tests (one deterministic round). */
  async pump(): Promise<number> {
    if (this.stopped || this.pumping) return 0;
    this.pumping = true;
    try { return await this.pumpOnce(); } finally { this.pumping = false; }
  }
  private async pumpOnce(): Promise<number> {
    const free = this.opts.concurrency - this.inFlight.size;
    let claimed: JobRow[] = [];
    // mandate §212: after a database restore nothing may be re-sent / re-billed from rolled-back state
    if (postRestoreHoldActive()) { if (!this.heldLogged) { this.heldLogged = true; this.log.warn(`[jobs:${this.jobClass}] ${POST_RESTORE_HOLD_MESSAGE}`); } return 0; }
    this.heldLogged = false;
    if (free > 0) {
      try { claimed = await claimJobs(this.db, this.jobClass, this.owner, { limit: free, leaseMs: this.opts.leaseMs, perTenantCap: this.opts.perTenantCap }); }
      catch (e: any) { this.log.warn(`[jobs:${this.jobClass}] claim failed: ${e?.message ?? e}`); }
    }
    for (const job of claimed) {
      const p = this.run(job).finally(() => { this.inFlight.delete(p); if (!this.stopped) this.schedule(0); });
      this.inFlight.add(p);
    }
    this.schedule(claimed.length ? this.opts.pollMs : this.opts.idlePollMs);
    return claimed.length;
  }

  async run(job: JobRow): Promise<void> {
    const handler = jobHandlerFor(job.jobType);
    if (!handler) {
      const out = await failJob(this.db, job.id, this.owner, `no handler is registered for job type "${job.jobType}"`, { retryable: false });
      if (out === 'dead') this.processed.dead++;
      this.log.error(`[jobs:${this.jobClass}] ${job.jobType} ${job.id}: no handler — dead`);
      return;
    }
    const stopHeartbeat = startLeaseHeartbeat(this.db, job.id, this.owner, this.opts.leaseMs);
    try {
      const result = await runJob(
        { jobType: job.jobType, jobClass: this.jobClass, jobId: job.id, tenantId: job.tenantId, correlationId: job.correlationId, attempt: job.attempts, enqueuedAt: new Date(job.runAfter), traceparent: job.traceparent },
        () => handler(job.payload, { jobId: job.id, tenantId: job.tenantId, attempt: job.attempts, correlationId: job.correlationId, renewLease: () => renewJobLease(this.db, job.id, this.owner, this.opts.leaseMs) }),
      );
      if (await completeJob(this.db, job.id, this.owner, result ?? null)) this.processed.succeeded++;
    } catch (e: any) {
      const out = await failJob(this.db, job.id, this.owner, e?.message ?? String(e), { retryable: !(e instanceof PermanentJobError) }).catch(() => 'lost' as const);
      if (out === 'dead') { this.processed.dead++; this.log.error(`[jobs:${this.jobClass}] ${job.jobType} ${job.id} is dead after ${job.attempts} attempt(s): ${e?.message ?? e}`); }
      else if (out === 'retrying') this.processed.retried++;
    } finally {
      stopHeartbeat();
    }
  }
}

@Injectable()
export class JobWorkerService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly log = new Logger('JobWorker');
  private loops: JobClassLoop[] = [];
  private reaper: ReturnType<typeof setInterval> | null = null;
  // Jobs run on the WORKER pool (Constitution 1 §60–61, Phase 10): their own connections and longer timeouts, so a burst
  // of jobs cannot starve HTTP requests. Without one (tests, in-memory) the primary handle is used, as before.
  private readonly db?: Kysely<any> | null;
  constructor(@Optional() @Inject(DATABASE) primary?: Kysely<any> | null, @Optional() @Inject(DATABASE_WORKER) worker?: Kysely<any> | null) {
    this.db = worker ?? primary;
  }

  onModuleInit(): void {
    const owner = processInstanceId();
    registerBuiltInJobHandlers(owner);
    if (!this.db || !jobsWorkerEnabled()) return;
    const base = { pollMs: 250, idlePollMs: Number(process.env.JOBS_IDLE_POLL_MS) || 2_000, leaseMs: 5 * 60_000, perTenantCap: Number(process.env.JOBS_PER_TENANT_CAP) || 3 };
    for (const c of JOB_QUEUE_CLASSES) {
      if (!runsBackgroundJob(c)) continue;
      const loop = new JobClassLoop(this.db, c, owner, { ...base, concurrency: concurrencyFor(c) }, this.log);
      loop.start(); this.loops.push(loop);
    }
    if (this.loops.length) this.log.log(`job worker started for: ${this.loops.map((l) => l.jobClass).join(', ')}`);
    // Jobs whose worker died: back to the queue. A 'critical' tick, single-owner across the fleet (runTick); every minute.
    if (!runsBackgroundJob('critical')) return;
    this.reaper = setInterval(() => { void runTick({ jobType: 'jobs.reap_expired_leases', jobClass: 'critical', everyMs: 60_000 }, async () => {
      const r = await reapExpiredLeases(this.db!);
      if (r.requeued || r.dead) this.log.warn(`[jobs] reaped expired leases: ${r.requeued} back in the queue, ${r.dead} dead`);
    }).catch(() => undefined); }, 60_000);
    (this.reaper as any).unref?.();
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    await Promise.all(this.loops.map((l) => l.stop(20_000)));
  }
}
