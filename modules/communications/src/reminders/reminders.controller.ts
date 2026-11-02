// reminders.controller.ts — the externally-triggered job endpoint (secret-guarded) + tenant config endpoints.
import { requireServiceCaller, ServiceAuthError, type ServiceScope } from '@aipowersalon/auth';
import { HttpException, Controller, Get, Patch, Post, Body, Req, UseGuards } from '@nestjs/common';
import { RequirePermission, TenantAuthGuard, RequireFeature, ValidatedBody } from '@aipowersalon/permissions/guards';
import { RemindersService, ValidationError } from './reminders.service';
import { REMINDERS_BODY } from '../request-schemas';

// POST /jobs/appointment-reminders — called by an external scheduler (cron/EventBridge/Lambda). Authenticated
// with a shared secret header, NOT a tenant session (this is a cross-tenant platform job). Path is excluded from
// TenantContextMiddleware in app.module. Fails closed when JOBS_SECRET is unset.
/** Constitution 3 Step 6: the shared service-caller check, mapped to this route's HTTP errors. */
function serviceCaller(r: any, scope: ServiceScope, legacy: { name: string; secret: string | undefined; header: string }) {
  try { return requireServiceCaller(r, scope, legacy); }
  catch (e) { if (e instanceof ServiceAuthError) throw new HttpException(e.status === 403 ? 'Forbidden' : e.message, e.status); throw e; }
}

@Controller('jobs')
export class ReminderJobController {
  constructor(private readonly svc: RemindersService) {}

  @Post('appointment-reminders')
  async run(@Req() r: any) {
    serviceCaller(r, 'jobs.reminders.run', { name: 'JOBS_SECRET', secret: process.env.JOBS_SECRET, header: 'x-jobs-secret' });
    return this.svc.runDueReminders(Date.now(), 'jobs_route');
  }
}

@UseGuards(TenantAuthGuard)
@RequireFeature('smart_reminders')   // BUILD_PLAN Phase 12 (#13): plan-gated — observe by default (feature-entitlement.ts)
@Controller('pos/reminders')
export class PosRemindersController {
  constructor(private readonly svc: RemindersService) {}

  // GET /pos/reminders — the tenant's reminder config (defaults applied when unset).
  // BUILD_PLAN Phase 9: keyed for the POS roles that reach the Communications screens (communications.view /
  // communications.manage — owner, manager, front desk, reception); technicians and API keys no longer reach it.
  @RequirePermission('communications.view') @Get()
  config(@Req() req: any) { return this.svc.getConfig(req?.ctx?.tenantId); }

  // PATCH /pos/reminders {enabled?, leadMinutes?, windowMinutes?, channel?} — owner-configurable.
  @RequirePermission('communications.manage') @Patch()
  update(@Body(ValidatedBody(REMINDERS_BODY, { strict: true })) body: { enabled?: boolean; leadMinutes?: number; windowMinutes?: number; channel?: 'sms' | 'email'; ladderMinutes?: number[] | null }, @Req() req: any) {
    // §163 run 3 (Oct 27 2026): the service's ValidationError (e.g. a ladder of 0 or 6 rungs) is a 400, not a 500
    return this.svc.updateConfig(req?.ctx?.tenantId, body || {}).catch((e: unknown) => {
      if (e instanceof ValidationError) throw new HttpException({ code: 'VALIDATION_FAILED', message: e.message }, 400);
      throw e;
    });
  }
}
