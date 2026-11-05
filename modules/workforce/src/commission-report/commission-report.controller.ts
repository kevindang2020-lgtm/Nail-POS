// commission-report.controller.ts — GET /pos/commission-report/state (pos.reports.view). Tenant/branch
// server-derived from req.ctx.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { CommissionReportService, CommissionReportForbiddenError } from './commission-report.service';
import type { CommissionReportContext } from './commission-report.dto';
import { ListQueries } from '@aipowersalon/database';
import { CommissionReportControllerListQueries } from './commission-report.list-queries';

function ctxFrom(req: any): CommissionReportContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(CommissionReportControllerListQueries)
@Controller('pos/commission-report')
export class CommissionReportController {
  constructor(private readonly svc: CommissionReportService) {}

  @Get('state') @RequirePermission('pos.reports.view')
  async state(@Req() r: any, @Query() q: any) {
    try { return await this.svc.getState(ctxFrom(r), q?.preset); }
    catch (e) { if (e instanceof CommissionReportForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN); throw e; }
  }
}
