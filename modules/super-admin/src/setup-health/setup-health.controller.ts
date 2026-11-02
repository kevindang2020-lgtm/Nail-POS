// setup-health.controller.ts — Four-Module Completion Guide (Oct 30 2026) HL-01 / HL-02 / QA evidence.
//   tenant  /tenant/setup-health/*        settings.view: summary · runs     settings.edit: run · alerts/:id/acknowledge
//   admin   /super-admin/release-evidence SuperAdminGuard: record (audited) · list
// Tenant, role, permissions and authorized branches come from the session (req.ctx), never the body or the query.
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Injectable, Logger, Optional, Param, Post, Query, Req, UseGuards, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ListQuery } from '@aipowersalon/database';
import { registerJobHandler, jobHandlerFor } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { runTick, logException } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SetupHealthRepository, SetupHealthError, SETUP_HEALTH_NIGHTLY_JOB, type HealthCtx } from './setup-health.repository';
import { SETUP_HEALTH_RUN_BODY, RELEASE_EVIDENCE_BODY } from '../request-schemas-ai';

export const SETUP_HEALTH_REPOSITORY = 'SetupHealthRepository';
function ctxOf(req: any): HealthCtx {
  const c = req?.ctx || {};
  if (!c.tenantId) throw new HttpException({ code: 'AUTH_REQUIRED', message: 'Not authenticated' }, HttpStatus.UNAUTHORIZED);
  return { tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: c.permissions || [], branchIds: c.authz?.branchIds ?? null };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof SetupHealthError) throw new HttpException({ code: e.code, message: e.message, details: e.details ?? {} }, e.status); throw e; }
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('tenant/setup-health')
export class SetupHealthController {
  constructor(@Inject(SETUP_HEALTH_REPOSITORY) private readonly repo: SetupHealthRepository | null) {}
  private r(): SetupHealthRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Setup Health needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('summary') @RequirePermission('settings.view') @ListQuery({ filters: { branchId: { type: 'uuid' } }, search: false })
  summary(@Req() q: any, @Query() f: any) { return run(() => this.r().summary(ctxOf(q), { branchId: s(f?.branchId) ?? null })); }

  @Get('runs') @RequirePermission('settings.view') @ListQuery({ search: false, maxLimit: 50, defaultLimit: 10, params: ['page'] })
  runs(@Req() q: any, @Query() f: any) { return run(() => this.r().runs(ctxOf(q), { page: f?.page, pageSize: f?.pageSize })); }

  /** Run Health Check: reads every module's authoritative record now (rate-limited); never calls a provider by itself —
   *  the provider checks are the modules' own (Messaging "Run health check", registration Refresh Status) */
  @Post('run') @RequirePermission('settings.edit')
  runNow(@Req() q: any, @Body(ValidatedBody(SETUP_HEALTH_RUN_BODY, { strict: true })) b: any) {
    const c = ctxOf(q);
    void b; return run(async () => { await this.r().run(c, 'manual'); return this.r().summary(c, { branchId: null }); });
  }

  @Post('alerts/:id/acknowledge') @RequirePermission('settings.edit')
  acknowledge(@Req() q: any, @Param('id') id: string) { if (!UUID.test(id)) throw new HttpException({ code: 'HEALTH_ALERT_NOT_FOUND', message: 'Alert not found.' }, 404); return run(() => this.r().acknowledge(ctxOf(q), id)); }
}

@Controller('super-admin/release-evidence')
@UseGuards(SuperAdminGuard)
export class ReleaseEvidenceController {
  constructor(@Inject(SETUP_HEALTH_REPOSITORY) private readonly repo: SetupHealthRepository | null, @Optional() private readonly audit?: AuditService) {}
  private r(): SetupHealthRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }
  @Get() @ListQuery({ filters: { appVersion: { type: 'text', maxLength: 40 } }, search: false }) list(@Query() f: any) { return run(() => this.r().listEvidence({ appVersion: s(f?.appVersion) })); }
  /** record one piece of release evidence (CI run id, staging report, device test). Requires a reference. Audited to the
   *  platform audit log (best-effort writer — the evidence row itself is the record). */
  @Post() record(@Req() q: any, @Body(ValidatedBody(RELEASE_EVIDENCE_BODY, { strict: true })) b: any) {
    const userId = q?.ctx?.userId ?? q?.user?.id;
    return run(async () => {
      const out = await this.r().recordEvidence({ userId }, b ?? {});
      await this.audit?.recordPlatform({ userId: userId ?? null, role: 'SUPER_ADMIN', module: 'release', action: 'release.evidence.recorded', resourceType: 'release_evidence', resourceId: out.id,
        summary: 'Release evidence recorded', metadata: { kind: b?.kind, appVersion: b?.appVersion, outcome: b?.outcome } });
      return out;
    });
  }
}

/** HL-02: hourly tick that enqueues the nightly per-salon job at 03:00 salon time (env-gated, off by default) and the
 *  queue handler that runs it. Idempotent per salon × date; the queue retries with backoff and dead-letters. */
@Injectable()
export class SetupHealthNightlyScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SetupHealthNightly');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(@Inject(SETUP_HEALTH_REPOSITORY) private readonly repo: SetupHealthRepository | null) {}
  onModuleInit(): void {
    const repo = this.repo; if (!repo) return;
    if (!jobHandlerFor(SETUP_HEALTH_NIGHTLY_JOB)) registerJobHandler(SETUP_HEALTH_NIGHTLY_JOB, (payload) => repo.runNightlyJob(payload));
    if (!runsBackgroundJob('standard') || !setupHealthNightlyEnabled()) return;
    const every = 60 * 60 * 1000;
    const tick = () => runTick({ jobType: 'setup_health.schedule', jobClass: 'standard', everyMs: every }, () => this.tick()).catch((x) => logException(x, { where: 'setup-health.schedule_tick' }));
    void tick(); this.timer = setInterval(() => { void tick(); }, every);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log('Setup Health nightly verifier armed (03:00 salon time).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async tick(): Promise<void> {
    if (this.running || !this.repo) return; this.running = true;
    try { const r = await this.repo.scheduleNightly(); if (r.enqueued) this.log.log(`Setup Health: ${r.enqueued} salon(s) queued.`); }
    catch (e: any) { this.log.error(`Setup Health schedule failed: ${e?.message ?? e}`); }
    finally { this.running = false; }
  }
}
export function setupHealthNightlyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.SETUP_HEALTH_NIGHTLY_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
