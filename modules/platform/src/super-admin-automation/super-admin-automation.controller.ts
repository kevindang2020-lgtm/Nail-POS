import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { AutomationService, type AdminCtx } from './automation.service';
import { AutomationActionsService } from './automation-actions.service';
import { hasPermission } from '@aipowersalon/permissions';
import { SuperAdminAutomationControllerListQueries } from './super-admin-automation.list-queries';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { AUTOMATION_EXCEPTION_BODY, AUTOMATION_RULE_BODY, AUTOMATION_STATUS_BODY, AUTOMATION_TEST_BODY } from '../request-schemas';

function ctxFrom(req: any): AdminCtx {
  return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined, canManageSensitive: !!req?.ctx && hasPermission(req.ctx, 'super_admin.payments.manage') };   // Phase 9: was a key in no catalog (always false)
}
function scopeFrom(req: any): any { return req?.ctx?.tenantId ? { tenantId: req.ctx.tenantId } : undefined; }

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminAutomationControllerListQueries)
@Controller('super-admin/automation-rules')
export class SuperAdminAutomationController {
  constructor(private readonly svc: AutomationService, private readonly actions: AutomationActionsService) {}

  @Get('overview') async overview(@Req() r: any, @Query() _q: any) {
    return { ok: true, ...(await this.svc.getDashboard(ctxFrom(r), { scope: scopeFrom(r) })) };
  }

  @Post('rules') createRule(@Req() r: any, @Body(ValidatedBody(AUTOMATION_RULE_BODY)) b: any) { return this.actions.createRule(ctxFrom(r), b ?? {}); }
  @Post('rules/:id/test') testRule(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AUTOMATION_TEST_BODY)) b: any) { return this.actions.testRule(ctxFrom(r), b ?? {}, id); }
  @Post('test') testInline(@Req() r: any, @Body(ValidatedBody(AUTOMATION_TEST_BODY)) b: any) { return this.actions.testRule(ctxFrom(r), b ?? {}); }
  @Post('rules/:id/status') setStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AUTOMATION_STATUS_BODY)) b: any) { return this.actions.setStatus(ctxFrom(r), id, b?.to, b?.reason); }
  @Post('exceptions') createException(@Req() r: any, @Body(ValidatedBody(AUTOMATION_EXCEPTION_BODY)) b: any) { return this.actions.createException(ctxFrom(r), b ?? {}); }
  @Post('failures/:id/retry') retryFailure(@Req() r: any, @Param('id') id: string) { return this.actions.retryFailure(ctxFrom(r), id); }
}
