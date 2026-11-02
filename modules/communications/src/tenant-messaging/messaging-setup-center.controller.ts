// messaging-setup-center.controller.ts — HTTP surface of messaging-setup-center.ts (Text Messaging Setup & SMS Readiness
// guide §11–§16). Tenant from the session only; a branch path parameter must be one the actor may act for (403 otherwise);
// reads need settings.view (the page's nav permission). Nothing here sends, buys, registers or changes a credential —
// "Check SMS System" itself is the existing POST tenant/messaging/health-check (read-only at the provider).
import { Controller, Get, HttpException, HttpStatus, Inject, Injectable, Logger, Optional, Param, Query, Req, UseGuards, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { ERROR_REGISTRY, withCode } from '@aipowersalon/api-contracts';
import { DATABASE, ListQuery, registerJobHandler, jobHandlerFor, type AppDatabase } from '@aipowersalon/database';
import { TenantAuthGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { TenantMessagingReadinessService } from './tenant-messaging-readiness.service';
import { allowedBranchesOf } from './tenant-messaging.tenant.controller';
import { MessagingSetupCenter, dispatchScheduledHealth, runScheduledHealthJob, healthScheduleEnabled, MESSAGING_HEALTH_JOB, type SetupCtx } from './messaging-setup-center';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = SetupCtx & { authz: { scope: string | null; branchIds: string[] | null } | null };
function ctxOf(req: any): Ctx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, userId: c.userId, branchId: c.branchId ?? null,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds.map(String) : null } : null };
}
function reach(ctx: Ctx, branchId: string): void {
  if (!UUID.test(branchId)) throw withCode(new HttpException({ code: 'BRANCH_NOT_FOUND', message: 'Unknown branch.' }, HttpStatus.NOT_FOUND), 'BRANCH_NOT_FOUND');
  const allowed = allowedBranchesOf(ctx);
  if (allowed && !allowed.includes(branchId)) throw new HttpException({ code: 'BRANCH_ACCESS_DENIED', message: 'You do not have access to this location.' }, ERROR_REGISTRY.BRANCH_ACCESS_DENIED.status);
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const ACTIVITY_SPEC = {
  filters: {
    kind: { type: 'enum', values: ['test_sms', 'health_check', 'registration_check', 'number_purchase'] },
    state: { type: 'enum', values: ['ok', 'pending', 'failed'] },
    branchId: { type: 'uuid' },
    basis: { type: 'enum', values: ['created', 'updated', 'delivered'] },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] },
  },
  sort: { allowed: ['newest'], default: 'newest' }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard)
@Controller('tenant/messaging/setup')
export class MessagingSetupController {
  private readonly center: MessagingSetupCenter | null;
  constructor(@Optional() @Inject(DATABASE) db: AppDatabase | null, @Optional() readiness?: TenantMessagingReadinessService) {
    this.center = db && readiness ? new MessagingSetupCenter(db, readiness) : null;
  }
  private c(): MessagingSetupCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Messaging setup is not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'SERVICE_UNAVAILABLE');
    return this.center;
  }

  /** §11 the six-part readiness + wizard for the salon default */
  @Get('overview') @RequirePermission('settings.view')
  overview(@Req() r: any) { const ctx = ctxOf(r); return this.c().overview(ctx, null, allowedBranchesOf(ctx)); }

  /** the same for one branch the actor may act for (its EFFECTIVE configuration) */
  @Get('overview/branches/:branchId') @RequirePermission('settings.view')
  overviewBranch(@Req() r: any, @Param('branchId') branchId: string) { const ctx = ctxOf(r); reach(ctx, branchId); return this.c().overview(ctx, branchId, allowedBranchesOf(ctx)); }

  /** §13 per-branch effective sender */
  @Get('branches') @RequirePermission('settings.view')
  branches(@Req() r: any) { const ctx = ctxOf(r); return this.c().branches(ctx, allowedBranchesOf(ctx)); }

  /** §14–§16 activity history */
  @Get('activity') @RequirePermission('settings.view') @ListQuery(ACTIVITY_SPEC)
  activity(@Req() r: any, @Query() q: any) {
    const ctx = ctxOf(r);
    return this.c().activity(ctx, { q: s(q?.q), kind: s(q?.kind), state: s(q?.state), branchId: s(q?.branchId), basis: s(q?.basis), preset: s(q?.preset), from: s(q?.from), to: s(q?.to), page: q?.page, pageSize: q?.pageSize ?? q?.limit }, allowedBranchesOf(ctx));
  }

  @Get('activity/:kind/:id') @RequirePermission('settings.view')
  detail(@Req() r: any, @Param('kind') kind: string, @Param('id') id: string) { const ctx = ctxOf(r); return this.c().detail(ctx, kind, id, allowedBranchesOf(ctx)); }
}

/** §11 the controlled nightly run: the handler registers wherever the module loads; the dispatcher is env-gated
 *  (MESSAGING_HEALTH_SCHEDULE_ENABLED, OFF by default) and runs on the standard job class only. */
@Injectable()
export class MessagingHealthScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MessagingHealthScheduler');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly everyMs = 30 * 60 * 1000;
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null, @Optional() private readonly readiness?: TenantMessagingReadinessService) {}
  onModuleInit(): void {
    if (!this.db || !this.readiness) return;
    const db = this.db as unknown as Kysely<any>;
    const svc = this.readiness;
    if (!jobHandlerFor(MESSAGING_HEALTH_JOB)) registerJobHandler(MESSAGING_HEALTH_JOB, (payload, ctx) => runScheduledHealthJob(db, svc, ctx.tenantId, payload));
    if (!runsBackgroundJob('standard') || !healthScheduleEnabled()) return;
    this.timer = setInterval(() => {
      void runTick({ jobType: 'messaging.health_dispatch', jobClass: 'standard', everyMs: this.everyMs }, async () => {
        const r = await dispatchScheduledHealth(db);
        if (r.enqueued) this.logger.log(`messaging health: ${r.enqueued} salon(s) enqueued`);
      }).catch((e) => this.logger.warn(`messaging health dispatch failed: ${e?.message ?? e}`));
    }, this.everyMs);
    (this.timer as { unref?: () => void }).unref?.();
  }
  onModuleDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}
