// ai-control-plane.controller.ts — Constitution 10 §171–§176 (Super Admin AI & Automation) and §166 (the
// tenant's own AI dashboard), plus the §129 feedback endpoint.
//
// Two controllers because they answer to two different authorities. The Super Admin pages are guarded by
// SuperAdminGuard and are platform-wide by design. The tenant routes are tenant-scoped from the session and
// **filtered by the caller's own AI permissions** — §168 and §169 are absences, and an endpoint that returns
// everything and lets the UI hide things is how an absence gets violated.
import { Controller, Get, Post, Body, Query, Req, UseGuards, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AI_DASHBOARD_FEEDBACK_BODY, AI_DASHBOARD_SETTINGS_BODY } from '../request-schemas';
import { AiControlPlaneService } from './ai-control-plane.service';
import { validateFeedback, FeedbackValidationError, DEFAULT_AI_PERMISSIONS, AI_PERMISSIONS } from './ai-feedback';
import type { TenantSafetySettings } from './ai-safety-policy';
import { PLATFORM_MAX_AUTOMATION, AUTOMATION_LEVELS } from './ai-safety-policy';
import { validateAiSettings, AiSettingsValidationError, type AiSettingsStore } from './ai-settings-store';
import { AI_TASKS } from './ai-task-registry';
import { ListQueries } from '@aipowersalon/database';
import { SuperAdminAiPlatformControllerListQueries, TenantAiDashboardControllerListQueries } from './ai-control-plane.list-queries';

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof HttpException) throw e;
    throw new HttpException({ ok: false, message: e?.message || 'AI control plane error' }, e?.status && e.status >= 400 && e.status < 600 ? e.status : HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminAiPlatformControllerListQueries)
@Controller('super-admin/ai-platform')
export class SuperAdminAiPlatformController {
  constructor(private readonly svc: AiControlPlaneService) {}

  /** §172 platform overview. */
  @Get('overview') overview() { return run(() => this.svc.overview()); }

  /** §173 provider dashboard — status, latency, errors, cost. No credentials, ever. */
  @Get('providers') providers() { return run(() => this.svc.providers()); }

  /** §174 model dashboard. `qualityScore` is null until evaluations run against a real provider. */
  @Get('models') models() { return run(() => this.svc.models()); }

  /** §175 routing dashboard — derived from the registries, so it cannot drift from what the router does. */
  @Get('routing') routing() { return run(() => this.svc.routing()); }

  /** Tenant AI usage, ranked by cost. */
  @Get('tenants') tenants(@Query('limit') limit?: string) {
    const l = Math.max(1, Math.min(100, parseInt(limit || '25', 10) || 25));
    return run(() => this.svc.tenants(l));
  }
}

/** The branch the session is working in (req.ctx.branchId; req.branch kept for older callers). */
function branchOf(req: any): string | null { return req?.ctx?.branchId ?? req?.branch?.id ?? null; }

/** The caller's AI permissions: explicit if the session carries them, otherwise the role defaults (§167). */
function aiPermissionsOf(req: any): { tenantId: string; role: string; permissions: string[] } {
  const tenantId = req?.ctx?.tenantId ?? req?.tenant?.id ?? req?.user?.tenantId;
  if (!tenantId) throw new HttpException('unauthenticated', HttpStatus.UNAUTHORIZED);
  // w4 sweep SW-05: the session lives on req.ctx (nothing sets req.user) — reading only req.user made every caller a TECHNICIAN
  const role = String(req?.ctx?.role ?? req?.user?.role ?? 'TECHNICIAN');
  const explicit: string[] | undefined = req?.user?.aiPermissions;
  const permissions = explicit ?? [...(DEFAULT_AI_PERMISSIONS[role] ?? DEFAULT_AI_PERMISSIONS.TECHNICIAN)];
  return { tenantId: String(tenantId), role, permissions };
}

@ListQueries(TenantAiDashboardControllerListQueries)
@Controller('ai/dashboard')
export class TenantAiDashboardController {
  constructor(private readonly svc: AiControlPlaneService, @Inject('AiSettingsStore') private readonly settings: AiSettingsStore) {}

  /**
   * §166. The response is already shaped by the caller's permissions — a section they may not see is absent and
   * NAMED in `hidden`, rather than returned empty for the UI to suppress. An endpoint that returns everything
   * and trusts the client to hide it is not access control.
   */
  @Get()
  dashboard(@Req() req: any) {
    const { tenantId, role, permissions } = aiPermissionsOf(req);
    // Settings are READ from the store now. They used to be taken off the request, where nothing ever put
    // them — the platform obeyed a setting no one could save.
    return run(async () => {
      const safety: TenantSafetySettings = await this.settings.get(tenantId, branchOf(req));
      return this.svc.tenantDashboard({ tenantId, role, permissions, safety });
    });
  }

  /**
   * §52/§53 read the tenant's AI settings, alongside the platform ceilings so a UI can render what is
   * ADJUSTABLE rather than offering choices that will be refused. Needs ai.settings.manage (§169).
   */
  @Get('settings')
  getSettings(@Req() req: any) {
    const { tenantId, permissions } = aiPermissionsOf(req);
    if (!permissions.includes(AI_PERMISSIONS.SETTINGS_MANAGE)) throw new HttpException({ error: 'forbidden', need: AI_PERMISSIONS.SETTINGS_MANAGE }, HttpStatus.FORBIDDEN);
    return run(async () => ({
      settings: await this.settings.get(tenantId, branchOf(req)),
      levels: AUTOMATION_LEVELS,
      tasks: Object.values(AI_TASKS).map((t) => ({ taskKey: t.key, module: t.module, risk: t.risk, platformMax: PLATFORM_MAX_AUTOMATION[t.key] ?? 'SUGGEST_ONLY' })),
    }));
  }

  /**
   * §52/§110 save them. A payload asking for MORE automation than the platform allows is REJECTED with the
   * reason, not stored and clamped at read time — storing a lie and correcting it later shows the tenant a
   * setting they do not actually have.
   */
  @Post('settings')
  putSettings(@Req() req: any, @Body(ValidatedBody(AI_DASHBOARD_SETTINGS_BODY)) body: any) {
    const { tenantId, permissions } = aiPermissionsOf(req);
    if (!permissions.includes(AI_PERMISSIONS.SETTINGS_MANAGE)) throw new HttpException({ error: 'forbidden', need: AI_PERMISSIONS.SETTINGS_MANAGE }, HttpStatus.FORBIDDEN);
    return run(async () => {
      try {
        const validated = validateAiSettings(body?.settings ?? body);
        const saved = await this.settings.put(tenantId, validated, (req?.ctx?.userId ?? req?.user?.id ?? null), branchOf(req));
        return { ok: true, settings: saved };
      } catch (e) {
        if (e instanceof AiSettingsValidationError) throw new HttpException({ error: 'invalid_settings', message: e.message }, HttpStatus.BAD_REQUEST);
        throw e;
      }
    });
  }

  /** §129 what this tenant's own corrections say. Needs usage-read, because it is tenant-wide analytics (§168). */
  @Get('feedback')
  feedback(@Req() req: any, @Query('taskKey') taskKey?: string) {
    const { tenantId, permissions } = aiPermissionsOf(req);
    if (!permissions.includes(AI_PERMISSIONS.USAGE_READ)) throw new HttpException({ error: 'forbidden', need: AI_PERMISSIONS.USAGE_READ }, HttpStatus.FORBIDDEN);
    return run(() => this.svc.feedback(tenantId, taskKey));
  }

  /**
   * §129 record a correction. Anyone who may use AI may report on it — withholding that from the people who
   * actually read the drafts would leave the evaluation data to the one person with the admin role.
   */
  @Post('feedback')
  submitFeedback(@Req() req: any, @Body(ValidatedBody(AI_DASHBOARD_FEEDBACK_BODY)) body: any) {
    const { tenantId, permissions } = aiPermissionsOf(req);
    if (!permissions.includes(AI_PERMISSIONS.READ)) throw new HttpException({ error: 'forbidden', need: AI_PERMISSIONS.READ }, HttpStatus.FORBIDDEN);
    return run(async () => {
      try {
        // tenantId comes from the SESSION, never the body — the same rule the tool gateway applies (§135).
        const entry = validateFeedback({ ...body, tenantId, actorUserId: (req?.ctx?.userId ?? req?.user?.id ?? null) });
        return { ok: true, feedback: entry };
      } catch (e) {
        if (e instanceof FeedbackValidationError) throw new HttpException({ error: 'invalid_feedback', message: e.message }, HttpStatus.BAD_REQUEST);
        throw e;
      }
    });
  }
}
