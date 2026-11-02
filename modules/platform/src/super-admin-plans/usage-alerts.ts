// usage-alerts.ts — Constitution 7 §41: tell the tenant owner (and record for platform billing / operations) when a plan
// limit reaches 80%, 90% and 100%. Each threshold alerts ONCE per tenant, metric and month (UNIQUE key, migration 466),
// so the hourly sweep can run on any number of workers. Usage comes from the same entitlement evaluation that enforces
// the limits — one source of truth, no second counter.
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, enqueueJob, registerJobHandler, jobHandlerFor, PermanentJobError, ListQueries } from '@aipowersalon/database';
import { runsBackgroundJob } from '@aipowersalon/config';
import { runTick, log } from '@aipowersalon/observability';
import { EntitlementsService, utilizationMetrics } from './entitlements.service';
import { UsageAlertsControllerListQueries } from './usage-alerts.list-queries';

export const USAGE_THRESHOLDS = [80, 90, 100] as const;
/** Pure: every threshold this percentage has reached (ascending). */
export function thresholdsReached(pct: number): number[] { return USAGE_THRESHOLDS.filter((t) => Number.isFinite(pct) && pct >= t); }
export const usagePeriod = (d: Date) => d.toISOString().slice(0, 7);
const SEVERITY: Record<number, string> = { 80: 'info', 90: 'warning', 100: 'high' };
/** BUILD_PLAN Phase 11 (Constitution 4 §27/§107): one queue job per salon per hour instead of one loop over every salon. */
export const USAGE_ALERT_TENANT_JOB = 'usage.alert.tenant';
export interface UsageMetric { metric: string; used: number; effective: number; pct: number }

@Injectable()
export class UsageAlertSweep implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly ent: EntitlementsService, @Optional() @Inject(DATABASE) private readonly db: any) {}

  onModuleInit(): void {
    // registered wherever this module loads, so whichever process runs 'standard' jobs can run it
    if (this.db && !jobHandlerFor(USAGE_ALERT_TENANT_JOB)) registerJobHandler(USAGE_ALERT_TENANT_JOB, async (payload, ctx) => {
      const at = typeof payload.at === 'string' ? new Date(payload.at) : null;
      if (!ctx.tenantId || !at || Number.isNaN(at.getTime())) throw new PermanentJobError('usage.alert.tenant needs a tenant and at');
      return this.alertTenant(ctx.tenantId, at);
    });
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (process.env.NODE_ENV === 'test' || !this.db) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'usage.alert.sweep', jobClass: 'standard', everyMs: 60 * 60 * 1000 }, () => this.dispatch()).catch(() => undefined); }, 60 * 60 * 1000);
    if (typeof (this.timer as any)?.unref === 'function') (this.timer as any).unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /** The production tick (Phase 11): one `usage.alert.tenant` job per salon per hour — idempotency key `<tenant>:<hour>`. */
  async dispatch(now = new Date()): Promise<{ tenants: number; enqueued: number; duplicates: number }> {
    if (!this.db) return { tenants: 0, enqueued: 0, duplicates: 0 };
    const ids = await this.ent.utilizationTenantIds();
    const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
    let enqueued = 0, duplicates = 0;
    for (const id of ids) {
      const r = await enqueueJob(this.db, { jobClass: 'standard', jobType: USAGE_ALERT_TENANT_JOB, tenantId: id, payload: { at: now.toISOString() }, priority: 3, maxAttempts: 3, idempotencyKey: `${id}:${hour}` });
      if (r.duplicate) duplicates++; else enqueued++;
    }
    return { tenants: ids.length, enqueued, duplicates };
  }

  /** One salon: the same entitlement evaluation that enforces the limits, the same once-per-month alert rows. */
  async alertTenant(tenantId: string, now = new Date()): Promise<{ alerts: number; failed: number }> {
    const ent = await this.ent.getEntitlements(tenantId);
    return this.alertFor(tenantId, utilizationMetrics(ent), now);
  }

  private async alertFor(tenantId: string, metrics: UsageMetric[], now: Date): Promise<{ alerts: number; failed: number }> {
    const period = usagePeriod(now);
    let alerts = 0, failed = 0;
    for (const m of metrics) {
      for (const threshold of thresholdsReached(m.pct)) {
        try {
          const inserted = await this.db.transaction().execute(async (trx: any) => {
            const r: any = await sql`insert into usage_alerts (tenant_id, metric, threshold, period, used, limit_value, pct)
                                     values (${tenantId}, ${m.metric}, ${threshold}, ${period}, ${m.used}, ${m.effective}, ${m.pct})
                                     on conflict (tenant_id, metric, threshold, period) do nothing`.execute(trx);
            if (Number(r?.numAffectedRows ?? r?.numInsertedOrUpdatedRows ?? 0) === 0) return false;
            await sql`insert into owner_alerts (tenant_id, category, severity, status, title, body, metadata, audience)
                      values (${tenantId}, 'usage_limit', ${SEVERITY[threshold]}, 'new',
                              ${threshold >= 100 ? `You have reached your ${m.metric} limit` : `You have used ${threshold}% of your ${m.metric} limit`},
                              ${`${m.used} of ${m.effective} ${m.metric} used on your plan. Upgrade your plan or contact AI PowerSalon to raise the limit.`},
                              ${JSON.stringify({ metric: m.metric, threshold, used: m.used, limit: m.effective, period })}::jsonb, 'owner')`.execute(trx);
            return true;
          });
          if (inserted) alerts++;
        } catch (e) { failed++; log.error('usage_alert.failed', { tenantId, metric: m.metric, error: (e as Error).message }); }
      }
    }
    return { alerts, failed };
  }

  /** Every salon in THIS process (ops / tests) — the same per-salon code as the queue job. */
  async sweep(now = new Date()): Promise<{ tenants: number; alerts: number; failed: number }> {
    if (!this.db) return { tenants: 0, alerts: 0, failed: 0 };
    const u = await this.ent.getPlanUtilization();
    let alerts = 0, failed = 0;
    for (const t of u.tenants) {
      const r = await this.alertFor(t.tenantId, t.metrics, now);
      alerts += r.alerts; failed += r.failed;
    }
    return { tenants: u.tenants.length, alerts, failed };
  }

  /** Platform billing / operations: the most recent usage alerts across tenants. */
  async recent(limit = 100) {
    if (!this.db) return { rows: [] };
    const r = await sql<any>`select a.*, t.display_name from usage_alerts a join tenants t on t.id = a.tenant_id order by a.created_at desc limit ${Math.min(Math.max(1, limit), 500)}`.execute(this.db);
    return { rows: r.rows.map((x: any) => ({ tenantId: String(x.tenant_id), tenantName: x.display_name ?? null, metric: x.metric, threshold: Number(x.threshold),
      period: x.period, used: Number(x.used), limit: Number(x.limit_value), pct: Number(x.pct), createdAt: new Date(x.created_at).toISOString() })) };
  }
}

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, RequirePermission } from '@aipowersalon/permissions/guards';
/** §41 — platform billing / operations read the usage alerts across tenants. */
@UseGuards(SuperAdminGuard)
@ListQueries(UsageAlertsControllerListQueries)
@Controller('super-admin/plans/usage-alerts')
export class UsageAlertsController {
  constructor(private readonly sweep: UsageAlertSweep) {}
  @Get() @RequirePermission('super_admin.plans.view')
  list(@Query('limit') limit?: string) { return this.sweep.recent(Number(limit) || 100); }
}
