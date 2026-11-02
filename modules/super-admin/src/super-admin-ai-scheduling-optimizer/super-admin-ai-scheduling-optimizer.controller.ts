// super-admin-ai-scheduling-optimizer.controller.ts — BUILD_PLAN Phase 7 (agent B): platform oversight of the AI
// Scheduling Optimizer, behind SuperAdminGuard (mirrors Phase 6's super-admin/ai-queue-assignment).
//   GET  overview                                              super_admin.operations.view → SaSchedOverview
//   GET  tenants?search&limit                                  super_admin.operations.view → SaSchedTenantRow[]
//   GET  tenants/:tenantId                                     super_admin.operations.view → SaSchedTenantDetail (active support session)
//   POST tenants/:tenantId/recommendations/:id/retry           super_admin.ai.manage + step-up (SaSchedActionRequest)
//   POST tenants/:tenantId/recommendations/:id/rollback        super_admin.ai.manage + step-up (SaSchedActionRequest)
//   POST tenants/:tenantId/disable                             super_admin.ai.manage + step-up (SaSchedActionRequest)
//   PUT  platform-switch                                       super_admin.ai.manage + step-up (SaSchedPlatformSwitch)
import { Body, Controller, Get, HttpException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import type { SaSchedActionRequest, SaSchedOverview, SaSchedPlatformSwitch, SaSchedTenantDetail, SaSchedTenantRow } from '@aipowersalon/api-contracts/platform';
import { SuperAdminAiSchedulingOptimizerService, SaSchedError, type SaActor } from './super-admin-ai-scheduling-optimizer.service';
import { ListQueries } from '@aipowersalon/database';
import { SuperAdminAiSchedulingOptimizerControllerListQueries } from './super-admin-ai-scheduling-optimizer.list-queries';
import { AI_SCHED_ACTION_BODY, AI_SCHED_SWITCH_BODY } from '../request-schemas-ai';   // BUILD_PLAN Phase 12 (#17)

const actor = (req: any): SaActor => ({ userId: req?.ctx?.userId ?? null });
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof SaSchedError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.status);
    if (e?.name === 'SchedError' && typeof e?.status === 'number') throw new HttpException({ ok: false, code: e.code, message: e.message, ...(e.extra || {}) }, e.status);
    throw e;
  }
}

@ListQueries(SuperAdminAiSchedulingOptimizerControllerListQueries)
@Controller('super-admin/ai-scheduling-optimizer')
@UseGuards(SuperAdminGuard)
export class SuperAdminAiSchedulingOptimizerController {
  constructor(private readonly svc: SuperAdminAiSchedulingOptimizerService) {}

  @Get('overview') @RequirePermission('super_admin.operations.view')
  overview(): Promise<SaSchedOverview> { return run(() => this.svc.overview()); }

  @Get('tenants') @RequirePermission('super_admin.operations.view')
  tenants(@Query('search') search?: string, @Query('limit') limit?: string): Promise<SaSchedTenantRow[]> { return run(() => this.svc.tenants({ search, limit })); }

  @Get('tenants/:tenantId') @RequirePermission('super_admin.operations.view')
  tenant(@Req() r: any, @Param('tenantId') tenantId: string): Promise<SaSchedTenantDetail> { return run(() => this.svc.tenantDetail(actor(r), String(tenantId))); }

  @RequireStepUp()
  @Post('tenants/:tenantId/recommendations/:id/retry') @RequirePermission('super_admin.ai.manage')
  retry(@Req() r: any, @Param('tenantId') tenantId: string, @Param('id') id: string, @Body(ValidatedBody(AI_SCHED_ACTION_BODY, { strict: true })) b: SaSchedActionRequest) {
    return run(() => this.svc.recommendationAction(actor(r), String(tenantId), String(id), 'retry', b?.reason));
  }

  @RequireStepUp()
  @Post('tenants/:tenantId/recommendations/:id/rollback') @RequirePermission('super_admin.ai.manage')
  rollback(@Req() r: any, @Param('tenantId') tenantId: string, @Param('id') id: string, @Body(ValidatedBody(AI_SCHED_ACTION_BODY, { strict: true })) b: SaSchedActionRequest) {
    return run(() => this.svc.recommendationAction(actor(r), String(tenantId), String(id), 'rollback', b?.reason));
  }

  @RequireStepUp()
  @Post('tenants/:tenantId/disable') @RequirePermission('super_admin.ai.manage')
  disable(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(AI_SCHED_ACTION_BODY, { strict: true })) b: SaSchedActionRequest) { return run(() => this.svc.disable(actor(r), String(tenantId), b?.reason)); }

  @RequireStepUp()
  @Put('platform-switch') @RequirePermission('super_admin.ai.manage')
  platformSwitch(@Req() r: any, @Body(ValidatedBody(AI_SCHED_SWITCH_BODY, { strict: true })) b: SaSchedPlatformSwitch) { return run(() => this.svc.platformSwitch(actor(r), b?.killed, b?.reason)); }
}
