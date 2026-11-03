// money-protection-detection.scheduler.ts — AI Money Protection guides (Nov 3 2026). Before this NOTHING ran detection: the
// "background worker" the controller mentions did not exist, so alerts appeared only if someone called POST evaluate (no screen
// did) — and the reconciliation rules were never called at all. Now each tick enqueues one durable `ai.money_protection.detect`
// job per salon subscribed to the add-on (idempotent per salon per interval); the job runs ONE recorded detection pass (all three
// layers) through MoneyProtectionCenter.runDetection, so every pass — and every failure — is on record.
// Opt-in like the other heavy AI scans: AI_MONEY_PROTECTION_DETECTION_ENABLED=1 (interval AI_MONEY_PROTECTION_DETECTION_INTERVAL_MS,
// default 15 min). The check reports when it is off. Detection only reads money tables and raises alerts — it never moves money.
import { DATABASE, enqueueJob, registerJobHandler, jobHandlerFor, PermanentJobError, type AppDatabase } from '@aipowersalon/database';
import { runTick } from '@aipowersalon/observability';
import { withCode } from '@aipowersalon/api-contracts';
import { runsBackgroundJob } from '@aipowersalon/config';
import { Injectable, Logger, Inject, Optional, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'kysely';
import { MONEY_PROTECTION_PACKAGE } from './ai-money-protection-entitlement';
import type { MoneyProtectionCenter } from './money-protection-center';
import { MONEY_PROTECTION_CENTER } from './money-protection-center.controller';

export const MP_DETECT_JOB = 'ai.money_protection.detect';
export const detectionScheduled = (env: NodeJS.ProcessEnv = process.env) => env.AI_MONEY_PROTECTION_DETECTION_ENABLED === '1';

@Injectable()
export class MoneyProtectionDetectionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MoneyProtectionDetection');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs = Number(process.env.AI_MONEY_PROTECTION_DETECTION_INTERVAL_MS || 15 * 60 * 1000);

  constructor(
    @Optional() @Inject(MONEY_PROTECTION_CENTER) private readonly center: MoneyProtectionCenter | null = null,
    @Optional() @Inject(DATABASE) private readonly db: AppDatabase | undefined = undefined,
  ) {}

  onModuleInit(): void {
    if (this.db && this.center && !jobHandlerFor(MP_DETECT_JOB)) registerJobHandler(MP_DETECT_JOB, async (_payload, ctx) => {
      if (!ctx.tenantId) throw withCode(new PermanentJobError('ai.money_protection.detect needs a tenant'), 'VALIDATION_FAILED');
      const r = await this.center!.runDetection({ tenantId: ctx.tenantId, branchId: null, userId: null, role: 'SYSTEM', permissions: [] }, 'scheduled');
      return { tenant: ctx.tenantId, status: r.status };
    });
    if (!runsBackgroundJob('ai') || !detectionScheduled()) return;
    if (!this.db || !this.center) { this.logger.log('detection scheduler idle (no database)'); return; }
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 60_000) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'ai.money_protection.detect', jobClass: 'ai', everyMs: this.intervalMs }, () => this.dispatch()).catch((e) => this.logger.warn(`tick failed: ${e?.message ?? e}`)); }, this.intervalMs);
    if (typeof this.timer?.unref === 'function') this.timer.unref();
    this.logger.log(`detection scheduler started (every ${Math.round(this.intervalMs / 60000)}m, one job per subscribed salon)`);
  }
  onModuleDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  /** one queue job per active salon with the add-on, exactly once per salon per interval */
  async dispatch(now = new Date()): Promise<{ tenants: number; enqueued: number; duplicates: number }> {
    if (!this.db) return { tenants: 0, enqueued: 0, duplicates: 0 };
    const rows = (await sql<{ id: string }>`select t.id from tenants t join tenant_ai_subscriptions s on s.tenant_id = t.id and s.package_code = ${MONEY_PROTECTION_PACKAGE}
      where t.status = 'active' and lower(s.status) in ('active', 'trialing', 'trial', 'past_due') order by t.id`.execute(this.db)).rows;
    const period = Math.floor(now.getTime() / Math.max(60_000, this.intervalMs));
    let enqueued = 0, duplicates = 0;
    for (const r of rows) {
      const q = await enqueueJob(this.db, { jobClass: 'ai', jobType: MP_DETECT_JOB, tenantId: String(r.id), payload: {}, priority: 3, maxAttempts: 2, idempotencyKey: `${r.id}:${period}` });
      if (q.duplicate) duplicates++; else enqueued++;
    }
    return { tenants: rows.length, enqueued, duplicates };
  }
}
