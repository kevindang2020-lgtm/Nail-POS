// marketing-report.controller.ts — GET /pos/marketing-report/state (pos.marketing.view).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature } from '@aipowersalon/permissions/guards';
import { Controller, Get, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { MarketingReportService, MarketingReportForbiddenError } from './marketing-report.service';
import type { MarketingReportContext } from './marketing-report.dto';

function ctxFrom(req: any): MarketingReportContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('marketing')   // BUILD_PLAN Phase 12 (#13): plan-gated — observe by default (feature-entitlement.ts)
@Controller('pos/marketing-report')
export class MarketingReportController {
  constructor(private readonly svc: MarketingReportService) {}

  @Get('state') @RequirePermission('pos.marketing.view')
  async state(@Req() r: any) {
    try { return await this.svc.getState(ctxFrom(r)); }
    catch (e) { if (e instanceof MarketingReportForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN); throw e; }
  }
}
