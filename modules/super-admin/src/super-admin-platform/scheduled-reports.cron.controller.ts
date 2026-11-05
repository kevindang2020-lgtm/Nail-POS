// scheduled-reports.cron.controller.ts — external-scheduler trigger ("point cron at run-due"). Guarded by a shared
// secret (header 'x-cron-secret' must equal SCHEDULED_REPORTS_CRON_SECRET); 403 unless the env secret is set AND
// matches, so it's disabled by default and unauthenticated callers can't reach it. No session needed — a plain curl
// from system cron / a cloud scheduler works. Excluded from TenantContextMiddleware in app.module.
import { requireServiceCaller, ServiceAuthError, type ServiceScope } from '@aipowersalon/auth';
import { Controller, Post, Req, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminPlatformService } from './super-admin-platform.service';

/** Constitution 3 Step 6: the shared service-caller check, mapped to this route's HTTP errors. */
function serviceCaller(r: any, scope: ServiceScope, legacy: { name: string; secret: string | undefined; header: string }) {
  try { return requireServiceCaller(r, scope, legacy); }
  catch (e) { if (e instanceof ServiceAuthError) throw new HttpException(e.status === 403 ? 'Forbidden' : e.message, e.status); throw e; }
}

@Controller('internal/scheduled-reports')
export class ScheduledReportsCronController {
  constructor(private readonly svc: SuperAdminPlatformService) {}

  @Post('run-due')
  async runDue(@Req() r: any) {
    serviceCaller(r, 'reports.scheduled.run', { name: 'SCHEDULED_REPORTS_CRON_SECRET', secret: process.env.SCHEDULED_REPORTS_CRON_SECRET, header: 'x-cron-secret' });
    return this.svc.runDueScheduledReports();
  }
}
