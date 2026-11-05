// tenant-warning-dispatch.cron.controller.ts — external-scheduler / ops trigger for an immediate dispatch run. Guarded
// by a shared secret (header 'x-cron-secret' must equal TENANT_WARNING_DISPATCH_CRON_SECRET); 403 unless the env secret
// is set AND matches, so it's disabled by default and unauthenticated callers can't reach it. Mirrors the hardware
// reconciliation cron controller, so a plain curl from system cron / a cloud scheduler works without a session.
import { requireServiceCaller, ServiceAuthError, type ServiceScope } from '@aipowersalon/auth';
import { Controller, Post, Query, Req, HttpException, HttpStatus } from '@nestjs/common';
import { TenantWarningDispatchJob } from './tenant-warning-dispatch.job';

/** Constitution 3 Step 6: the shared service-caller check, mapped to this route's HTTP errors. */
function serviceCaller(r: any, scope: ServiceScope, legacy: { name: string; secret: string | undefined; header: string }) {
  try { return requireServiceCaller(r, scope, legacy); }
  catch (e) { if (e instanceof ServiceAuthError) throw new HttpException(e.status === 403 ? 'Forbidden' : e.message, e.status); throw e; }
}

@Controller('internal/tenant-warnings')
export class TenantWarningDispatchCronController {
  constructor(private readonly job: TenantWarningDispatchJob) {}

  @Post('dispatch')
  async dispatch(@Req() r: any, @Query() q: any) {
    serviceCaller(r, 'tenant_warnings.dispatch', { name: 'TENANT_WARNING_DISPATCH_CRON_SECRET', secret: process.env.TENANT_WARNING_DISPATCH_CRON_SECRET, header: 'x-cron-secret' });
    const limit = Math.min(200, Math.max(1, Number(q?.limit) || 50));
    return this.job.dispatchPending(limit);
  }
}
