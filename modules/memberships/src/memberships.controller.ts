// memberships.controller.ts — tenant Memberships HTTP surface (`/pos/memberships/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role come from req.ctx (session) — never the body.
// Permissions are pos.memberships.* which security-core maps onto the existing customers capability (reuse, no new grants).
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { PLAN_CREATE_BODY, PLAN_VERSION_BODY } from './request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { MembershipsService, ForbiddenError, ValidationError } from './memberships.service';
import type { MembershipsContext } from './memberships.repository';
import type { OverviewFilters, CreatePlanRequest, PublishVersionRequest } from './memberships.dto';
import type { PlanVersionChangePreview } from '@aipowersalon/api-contracts/tenant';
import { ListQueries } from '@aipowersalon/database';
import { MembershipsControllerListQueries } from './memberships.list-queries';

function ctxFrom(req: any): MembershipsContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], authz: c.authz ?? null };
}
function overviewFilters(q: any): OverviewFilters {
  return {
    branchId: q?.branchId || undefined,
    rangeDays: q?.rangeDays != null ? Number(q.rangeDays) : undefined,
    expiringWindowDays: q?.expiringWindowDays != null ? Number(q.expiringWindowDays) : undefined,
  };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('memberships')   // BUILD_PLAN Phase 12 (#13): plan-gated — observe by default (feature-entitlement.ts)
@ListQueries(MembershipsControllerListQueries)
@Controller('pos/memberships')
export class MembershipsController {
  constructor(private readonly svc: MembershipsService) {}

  @Get('overview') @RequirePermission('pos.memberships.view')
  overview(@Req() r: any, @Query() q: any) { return run(() => this.svc.getOverview(ctxFrom(r), overviewFilters(q))); }

  @AsyncExport({ kind: 'pos.memberships.export-members' }) @Get('export/members') @RequirePermission('pos.memberships.view')
  exportMembers(@Req() r: any, @Query() q: any) { return run(() => this.svc.exportMembers(ctxFrom(r), q?.branchId)); }

  @AsyncExport({ kind: 'pos.memberships.export-payments' }) @Get('export/payments') @RequirePermission('pos.memberships.view')
  exportPayments(@Req() r: any, @Query() q: any) { return run(() => this.svc.exportPayments(ctxFrom(r), q?.branchId)); }

  @AsyncExport({ kind: 'pos.memberships.export-redemptions' }) @Get('export/redemptions') @RequirePermission('pos.memberships.view')
  exportRedemptions(@Req() r: any, @Query() q: any) { return run(() => this.svc.exportRedemptions(ctxFrom(r), q?.branchId)); }

  @Get('plans') @RequirePermission('pos.memberships.view')
  listPlans(@Req() r: any, @Query() q: any) { return run(() => this.svc.listPlans(ctxFrom(r), q?.branchId)); }

  @Post('plans') @RequirePermission('pos.memberships.manage')
  createPlan(@Req() r: any, @Body(ValidatedBody(PLAN_CREATE_BODY, { strict: true })) b: CreatePlanRequest) { return run(() => this.svc.createPlan(ctxFrom(r), b)); }

  @Get('plans/:planId') @RequirePermission('pos.memberships.view')
  getPlan(@Req() r: any, @Param('planId') id: string) { return run(() => this.svc.getPlan(ctxFrom(r), id)); }

  @Post('plans/:planId/versions') @RequirePermission('pos.memberships.manage')
  publishVersion(@Req() r: any, @Param('planId') id: string, @Body(ValidatedBody(PLAN_VERSION_BODY, { strict: true })) b: PublishVersionRequest) { return run(() => this.svc.publishVersion(ctxFrom(r), id, b)); }

  /** extras Membership Overview 13 · 10: preview a plan change (same validation as publishing) — current vs future
   *  subscribers; writes nothing */
  @Post('plans/:planId/versions/preview') @RequirePermission('pos.memberships.manage')
  previewVersion(@Req() r: any, @Param('planId') id: string, @Body(ValidatedBody(PLAN_VERSION_BODY, { strict: true })) b: PublishVersionRequest): Promise<PlanVersionChangePreview> { return run(() => this.svc.previewVersion(ctxFrom(r), id, b)); }
}
