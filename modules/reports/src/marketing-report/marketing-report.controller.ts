// marketing-report.controller.ts — GET /pos/marketing-report/state (pos.marketing.view).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ListQuery } from '@aipowersalon/database';
import { MarketingReportService, MarketingReportForbiddenError, MarketingReportValidationError } from './marketing-report.service';
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

  // batch 9 decision 2: an optional period (no preset = all time, as before); the service refuses an unknown preset
  @Get('state') @RequirePermission('pos.marketing.view')
  @ListQuery({ filters: { preset: { type: 'enum', values: ['all', 'custom', 'today', 'yesterday', 'week', 'month', 'quarter', 'year', 'last7', 'last30', 'last_month'] } }, search: false, dateRange: { maxDays: 366 } })
  async state(@Req() r: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string) {
    try { return await this.svc.getState(ctxFrom(r), { preset, from, to }); }
    catch (e) {
      if (e instanceof MarketingReportForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      if (e instanceof MarketingReportValidationError) throw new HttpException({ code: (e as Error & { apiCode?: string }).apiCode ?? 'DATE_RANGE_INVALID', message: e.message }, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }
}
