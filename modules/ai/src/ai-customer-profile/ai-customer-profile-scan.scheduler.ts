// ai-customer-profile-scan.scheduler.ts — periodic tenant aggregate refresh (§39/§40). Multi-instance safe via
// runAsSingleOwner (advisory lock: exactly one node runs each tick). Opt-IN (scanning is heavy): set
// AI_CUSTOMER_PROFILE_SCAN_ENABLED=1. Never blocks process exit (unref).
//
// TENANT-PARTITIONED (BUILD_PLAN Phase 11, Constitution 4 §27/§107): the tick no longer refreshes salons one after another
// in the dispatching process — and no longer stops at the first AI_CUSTOMER_PROFILE_SCAN_TENANTS_PER_TICK salons (with
// no ordering, the same 200 every time; the rest were never scanned). It ENQUEUES one `ai.customer.profile.scan.tenant`
// job per active salon on the durable queue (class 'ai'), idempotency key `<tenant>:<interval number>` — exactly once
// per salon per interval however many dispatchers run; the 'ai' workers and the per-tenant cap spread the work (§41).
import { DATABASE, enqueueJob, registerJobHandler, jobHandlerFor, PermanentJobError, type AppDatabase } from '@aipowersalon/database';
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { Inject, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { AiCustomerProfileService } from './ai-customer-profile.service';
import { runTenantScan, buildSystemScanContext } from './ai-customer-profile.scan';
import { runsBackgroundJob } from '@aipowersalon/config';

export const AI_PROFILE_SCAN_JOB = 'ai.customer.profile.scan.tenant';

@Injectable()
export class AiCustomerProfileScanScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AiCustomerProfileScanScheduler');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs = Number(process.env.AI_CUSTOMER_PROFILE_SCAN_INTERVAL_MS || 30 * 60 * 1000); // 30 min
  private readonly perTickCap = Number(process.env.AI_CUSTOMER_PROFILE_SCAN_TENANTS_PER_TICK || 200);

  constructor(
    private readonly svc: AiCustomerProfileService,
    @Optional() @Inject(DATABASE) private readonly db: AppDatabase | undefined = undefined,
  ) {}

  onModuleInit(): void {
    // registered wherever this module loads, so whichever process runs 'ai' jobs can run it
    if (this.db && !jobHandlerFor(AI_PROFILE_SCAN_JOB)) registerJobHandler(AI_PROFILE_SCAN_JOB, async (_payload, ctx) => {
      if (!ctx.tenantId) throw new PermanentJobError('ai.customer.profile.scan.tenant needs a tenant');
      await this.svc.refreshTenantOverview(buildSystemScanContext(ctx.tenantId));
      return { refreshed: ctx.tenantId };
    });
    if (!runsBackgroundJob('ai')) return;   // Constitution 13 Phase 8: this process may not run 'ai' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (process.env.AI_CUSTOMER_PROFILE_SCAN_ENABLED !== '1') return; // opt-in only
    if (!this.db) { this.logger.log('scan scheduler idle (no primary DB handle)'); return; }
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 60_000) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'ai.customer.profile.scan', jobClass: 'ai', everyMs: this.intervalMs }, () => this.dispatch()).catch(() => undefined); }, this.intervalMs);
    if (typeof this.timer?.unref === 'function') this.timer.unref();
    this.logger.log(`scan scheduler started (every ${Math.round(this.intervalMs / 60000)}m, one queue job per salon)`);
  }

  onModuleDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  /** The production tick: one queue job per active salon for this interval. Exactly once per salon per interval. */
  async dispatch(now = new Date()): Promise<{ tenants: number; enqueued: number; duplicates: number }> {
    if (!this.db) return { tenants: 0, enqueued: 0, duplicates: 0 };
    const rows = await this.db.selectFrom('tenants').select(['id']).where('status', '=', 'active').orderBy('id').execute();
    const period = Math.floor(now.getTime() / Math.max(60_000, this.intervalMs));
    let enqueued = 0, duplicates = 0;
    for (const r of rows) {
      const id = String(r.id);
      const q = await enqueueJob(this.db, { jobClass: 'ai', jobType: AI_PROFILE_SCAN_JOB, tenantId: id, payload: {}, priority: 3, maxAttempts: 3, idempotencyKey: `${id}:${period}` });
      if (q.duplicate) duplicates++; else enqueued++;
    }
    if (enqueued) this.logger.log(`scan: queued ${enqueued} salon(s)`);
    return { tenants: rows.length, enqueued, duplicates };
  }

  /** The former in-process pass (bounded by AI_CUSTOMER_PROFILE_SCAN_TENANTS_PER_TICK) — kept for ops / tests. */
  async tick(): Promise<void> {
    try {
      // Single-owner across the fleet comes from runTick's lease (migration 518), not a transaction held open for the scan.
      const rows = await (this.db as any).selectFrom('tenants').select(['id'])
        .where('status', '=', 'active').limit(this.perTickCap).execute().catch(() => [] as any[]);
      const ids = (rows as any[]).map(r => String(r.id));
      const result = await runTenantScan(ids, (tenantId) => this.svc.refreshTenantOverview(buildSystemScanContext(tenantId)), { cap: this.perTickCap });
      if (result.failed > 0) this.logger.warn(`scan: ${result.succeeded}/${result.attempted} ok, ${result.failed} failed`);
      else if (result.attempted > 0) this.logger.log(`scan: refreshed ${result.succeeded} tenant(s)`);
    } catch (e: any) { this.logger.warn(`scan tick failed: ${e?.message ?? e}`); }
  }
}
