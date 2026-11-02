// integration-scheduler.controller.ts — SuperAdmin-triggered bounded maintenance pass. A deployment also invokes the
// same tick on an interval; this endpoint lets an operator run one bounded pass on demand.

import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { IntegrationPermissionGuard, RequireIntegrationPermission } from './integration-permission.guard';
import { P } from './integration-permissions';
import { IntegrationSchedulerService } from './integration-scheduler.service';
import { INT_LIMIT_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

const actorFrom = (r: any) => ({ id: r?.ctx?.userId ?? r?.user?.id ?? undefined, role: r?.ctx?.role ?? r?.user?.role ?? undefined });

@Controller('super-admin/integrations')
@UseGuards(SuperAdminGuard, IntegrationPermissionGuard)
export class IntegrationSchedulerController {
  constructor(private readonly svc: IntegrationSchedulerService) {}

  @RequireIntegrationPermission(P.syncRetry)
  @Post('scheduler/tick')
  async tick(@Req() r: any, @Body(ValidatedBody(INT_LIMIT_BODY, { strict: true })) b: any) { return this.svc.tick(actorFrom(r), { limit: Number(b?.limit) || undefined }); }
}
