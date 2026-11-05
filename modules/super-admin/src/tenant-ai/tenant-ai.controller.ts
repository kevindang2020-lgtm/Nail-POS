// tenant-ai.controller.ts — tenant-owner AI surface under /tenant/ai. Session-derived ctx (tenantId/role/permissions),
// mirroring the owner controller; the server scopes everything to the caller's own tenant.
import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import { TenantAiService, TenantAiError, type TenantCtx } from './tenant-ai.service';
import { TENANT_AI_TRIAL_BODY } from '../request-schemas-ai';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): TenantCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof TenantAiError) {
      if (e.code === 'forbidden') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@Controller('tenant/ai')
export class TenantAiController {
  constructor(private readonly svc: TenantAiService) {}
  @RequirePermission('ai.use') @Get('packages') packages(@Req() r: any) { return run(() => this.svc.catalog(ctxFrom(r))); }
  @RequirePermission('ai.use') @Get('plans') plans(@Req() r: any) { return run(() => this.svc.listPlans(ctxFrom(r))); }
  @RequirePermission('ai.manage') @Post('plans/:code/trial') planTrial(@Req() r: any, @Param('code') code: string) { return run(() => this.svc.startPlanTrial(ctxFrom(r), code)); }
  @RequirePermission('ai.manage') @Patch('plans/:code/cancel') planCancel(@Req() r: any, @Param('code') code: string) { return run(() => this.svc.cancelPlan(ctxFrom(r), code)); }
  @RequirePermission('ai.use') @Get('subscriptions') subscriptions(@Req() r: any) { return run(() => this.svc.subscriptions(ctxFrom(r))); }
  @RequirePermission('ai.use') @Get('usage') usage(@Req() r: any) { return run(() => this.svc.usage(ctxFrom(r))); }
  @RequirePermission('ai.manage') @Post('subscriptions') subscribe(@Req() r: any, @Body(ValidatedBody(TENANT_AI_TRIAL_BODY)) b: any) { return run(() => this.svc.startTrial(ctxFrom(r), String(b?.packageCode ?? ''))); }
  @RequirePermission('ai.manage') @Patch('subscriptions/:code/cancel') cancel(@Req() r: any, @Param('code') code: string) { return run(() => this.svc.cancel(ctxFrom(r), code)); }
}
