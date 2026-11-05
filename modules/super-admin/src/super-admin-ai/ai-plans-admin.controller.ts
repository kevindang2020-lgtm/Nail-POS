// ai-plans-admin.controller.ts — SuperAdminGuard routes under super-admin/ai-plans for managing the five AI plans
// (list with pricing + member packages; set price override / discount / active). Separate path from super-admin/ai.
import { Body, Controller, Get, NotFoundException, BadRequestException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AiPlansAdminService, AiPlansAdminError, type PlansAdminCtx } from './ai-plans-admin.service';
import { isAiPlanCode } from '@aipowersalon/ai';
import { AI_PLAN_ASSIGN_BODY, AI_PLAN_CONVERT_BODY, AI_PLAN_UNASSIGN_BODY, AI_PLAN_UPDATE_BODY } from '../request-schemas-ai';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): PlansAdminCtx { return { userId: req?.ctx?.userId ?? req?.user?.id, ip: safeInet(req?.ip) ?? undefined }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof AiPlansAdminError) { if (e.code === 'not_found') throw new NotFoundException(e.message); throw new BadRequestException(e.message); }
    throw e;
  }
}

@Controller('super-admin/ai-plans')
@UseGuards(SuperAdminGuard)
export class AiPlansAdminController {
  constructor(private readonly svc: AiPlansAdminService) {}

  @Get() list() { return run(() => this.svc.listPlans()); }
  @Get('tenant/:tenantId') tenantPlans(@Param('tenantId') tid: string) { return run(() => this.svc.tenantPlans(tid)); }
  @Post('convert-expired-trials') convertExpired(@Req() r: any) { return run(() => this.svc.convertExpiredTrials(ctxFrom(r))); }
  @Patch(':code') update(@Req() r: any, @Param('code') code: string, @Body(ValidatedBody(AI_PLAN_UPDATE_BODY)) b: any) {
    if (!isAiPlanCode(code)) throw new NotFoundException('unknown_ai_plan');
    return run(() => this.svc.updatePlan(ctxFrom(r), code, b || {}));
  }
  @Post(':code/assign') assign(@Req() r: any, @Param('code') code: string, @Body(ValidatedBody(AI_PLAN_ASSIGN_BODY)) b: any) {
    if (!isAiPlanCode(code)) throw new NotFoundException('unknown_ai_plan');
    return run(() => this.svc.assignPlanToTenant(ctxFrom(r), code, String(b?.tenantId ?? ''), { trial: !!b?.trial, billingPeriod: b?.billingPeriod === 'yearly' ? 'yearly' : 'monthly' }));
  }
  @Post(':code/convert') convert(@Req() r: any, @Param('code') code: string, @Body(ValidatedBody(AI_PLAN_CONVERT_BODY)) b: any) {
    if (!isAiPlanCode(code)) throw new NotFoundException('unknown_ai_plan');
    return run(() => this.svc.convertPlanToPaid(ctxFrom(r), code, String(b?.tenantId ?? ''), { billingPeriod: b?.billingPeriod === 'yearly' ? 'yearly' : b?.billingPeriod === 'monthly' ? 'monthly' : undefined }));
  }
  @Patch(':code/unassign') unassign(@Req() r: any, @Param('code') code: string, @Body(ValidatedBody(AI_PLAN_UNASSIGN_BODY)) b: any) {
    if (!isAiPlanCode(code)) throw new NotFoundException('unknown_ai_plan');
    return run(() => this.svc.cancelTenantPlan(ctxFrom(r), code, String(b?.tenantId ?? '')));
  }
}
