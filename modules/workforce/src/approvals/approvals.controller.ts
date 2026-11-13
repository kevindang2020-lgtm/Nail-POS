// approvals.controller.ts — BUILD_PLAN Phase 9: the salon approvals engine's routes. POS: pos/approvals; the Owner App's
// mirror: owner/approvals/requests (+ /:id/decide) + owner/approvals/policies (read) (owner/approvals itself is the Owner App's existing payroll +
// alerts queue — analytics OwnerController — so the engine's list lives one level down). Same service, same types, same
// keys. Tenant / branch / user / role / permissions come from req.ctx (server-derived); an empty branch is null.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApprovalError, type ApprovalActor } from './approvals.core';
import { TenantApprovalsService } from './approvals.service';
import { ListQueries } from '@aipowersalon/database';
import { Idempotent } from '@aipowersalon/database/nest';   // BUILD_PLAN Phase 13: one decision per Idempotency-Key
import { PosApprovalsControllerListQueries, OwnerApprovalsControllerListQueries } from './approvals.list-queries';
import { APPROVAL_CANCEL_BODY, APPROVAL_CREATE_BODY, APPROVAL_DECIDE_BODY, APPROVAL_ESCALATE_BODY, APPROVAL_POLICY_BODY } from '../request-schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function approvalActor(req: any): ApprovalActor {
  const c = req?.ctx || {};
  return { tenantId: String(c.tenantId ?? ''), branchId: typeof c.branchId === 'string' && UUID_RE.test(c.branchId) ? c.branchId : null,
    userId: String(c.userId ?? ''), role: String(c.role ?? ''), permissions: Array.isArray(c.permissions) ? c.permissions : [] };
}
export async function approvalRun<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof ApprovalError) throw new HttpException({ ok: false, code: e.code, message: e.message, ...(e.extra || {}) }, e.status); throw e; }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(PosApprovalsControllerListQueries)
@Controller('pos/approvals')
export class PosApprovalsController {
  constructor(@Inject(TenantApprovalsService) private readonly svc: TenantApprovalsService) {}

  @Get() @RequirePermission('approvals.view')
  list(@Req() r: any, @Query() q: any) { return approvalRun(() => this.svc.list(approvalActor(r), q)); }

  @Get('policies') @RequirePermission('approvals.view')
  policies(@Req() r: any) { return approvalRun(() => this.svc.policies(approvalActor(r))); }

  @RequireStepUp()
  @Put('policies') @RequirePermission('approvals.manage_policies')
  updatePolicy(@Req() r: any, @Body(ValidatedBody(APPROVAL_POLICY_BODY, { strict: true })) b: any) { return approvalRun(() => this.svc.updatePolicy(approvalActor(r), b)); }

  @Get(':id') @RequirePermission('approvals.view')
  one(@Req() r: any, @Param('id') id: string) { return approvalRun(() => this.svc.get(approvalActor(r), id)); }

  @Post() @RequirePermission('approvals.request')
  create(@Req() r: any, @Body(ValidatedBody(APPROVAL_CREATE_BODY, { strict: true })) b: any) { return approvalRun(() => this.svc.request(approvalActor(r), b)); }

  @Post(':id/decide') @HttpCode(200) @RequirePermission('approvals.decide') @Idempotent()
  decide(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(APPROVAL_DECIDE_BODY, { strict: true })) b: any) { return approvalRun(() => this.svc.decide(approvalActor(r), id, b)); }

  @Post(':id/cancel') @HttpCode(200) @RequirePermission('approvals.request')
  cancel(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(APPROVAL_CANCEL_BODY, { strict: true })) b: any) { return approvalRun(() => this.svc.cancel(approvalActor(r), id, b)); }

  /** round 10 (Approvals 01 point 2): mark a pending request urgent — it stays pending (never auto-approved); approvers are alerted */
  @Post(':id/escalate') @HttpCode(200) @RequirePermission('approvals.request') @Idempotent()
  escalate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(APPROVAL_ESCALATE_BODY, { strict: true })) b: any) { return approvalRun(() => this.svc.escalate(approvalActor(r), id, b)); }
}

// The Owner App's surface: the queue, the decision and the rules (read). Changing a rule needs a step-up, which the Owner
// App has no prompt for — the owner changes rules on the POS Approvals screen (Rules tab), so there is no owner PUT.
@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(OwnerApprovalsControllerListQueries)
@Controller('owner/approvals')
export class OwnerApprovalsController {
  constructor(@Inject(TenantApprovalsService) private readonly svc: TenantApprovalsService) {}

  @Get('requests') @RequirePermission('approvals.view')
  list(@Req() r: any, @Query() q: any) { return approvalRun(() => this.svc.list(approvalActor(r), q)); }

  @Post('requests/:id/decide') @HttpCode(200) @RequirePermission('approvals.decide') @Idempotent()
  decide(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(APPROVAL_DECIDE_BODY, { strict: true })) b: any) { return approvalRun(() => this.svc.decide(approvalActor(r), id, b)); }

  @Get('policies') @RequirePermission('approvals.view')
  policies(@Req() r: any) { return approvalRun(() => this.svc.policies(approvalActor(r))); }
}
