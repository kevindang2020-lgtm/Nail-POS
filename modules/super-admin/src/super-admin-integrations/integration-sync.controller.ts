// integration-sync.controller.ts — SuperAdminGuard-only sync endpoints. Enqueue is bounded (creates a job, does not
// run unbounded work in the request); drain/retry are bounded worker/operator actions.

import { Body, Controller, Get, HttpException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { IntegrationPermissionGuard, RequireIntegrationPermission } from './integration-permission.guard';
import { P } from './integration-permissions';
import { SyncEngineService } from './sync-engine.service';
import { INT_LIMIT_BODY, INT_SYNC_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

const ERR: Record<string, [number, string]> = {
  unavailable: [503, 'Sync engine is not available.'], not_found: [404, 'Not found.'],
  connection_disabled: [409, 'Connection is disabled.'], authentication_required: [409, 'Authentication is not valid.'],
  sync_not_supported: [400, 'This provider does not support synchronization.'], not_retryable: [409, 'Only partial/failed jobs can be retried.'],
  dead_letter: [409, 'Job moved to the dead-letter queue after exhausting retries.'], connection_required: [400, 'A connection is required.'],
};
const guard = <T extends { ok: boolean; error?: string; status?: number }>(res: T): T => { if (!res.ok && res.error && ERR[res.error]) { const [s, m] = ERR[res.error]; throw new HttpException({ code: res.error, message: m, ...(('jobStatus' in (res as any)) ? { jobStatus: (res as any).jobStatus } : {}) }, s); } return res; };
const actorFrom = (r: any) => ({ id: r?.ctx?.userId ?? r?.user?.id ?? undefined, role: r?.ctx?.role ?? r?.user?.role ?? undefined });

@Controller('super-admin/integrations')
@UseGuards(SuperAdminGuard, IntegrationPermissionGuard)
export class IntegrationSyncController {
  constructor(private readonly svc: SyncEngineService) {}

  @RequireIntegrationPermission(P.syncRetry)
  @Post('connections/:id/sync')
  async enqueue(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INT_SYNC_BODY, { strict: true })) b: any) { return guard(await this.svc.enqueueSync(actorFrom(r), id, { syncType: b?.syncType, idempotencyKey: b?.idempotencyKey })); }

  @RequireIntegrationPermission(P.syncView)
  @Get('connections/:id/syncs')
  async jobs(@Req() r: any, @Param('id') id: string) { return this.svc.listSyncJobs(actorFrom(r), id); }

  @RequireIntegrationPermission(P.syncRetry)
  @Post('sync/:jobId/retry')
  async retry(@Req() r: any, @Param('jobId') jobId: string) { return guard(await this.svc.retrySyncJob(actorFrom(r), jobId)); }

  @RequireIntegrationPermission(P.syncRetry)
  @Post('sync/drain')
  async drain(@Req() r: any, @Body(ValidatedBody(INT_LIMIT_BODY, { strict: true })) b: any) { return guard(await this.svc.drainDueJobs(actorFrom(r), Number(b?.limit) || 10)); }
}
