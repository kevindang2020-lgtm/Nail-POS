// super-admin-analytics.controller.ts — SuperAdminGuard-only. Read-only consolidated Analytics +
// audited multi-format export. Tenant scope is server-derived via parseScope (raw client tenantId is
// never trusted — the guard restricts this surface to SUPER_ADMIN principals).

import { safeInet, parseScope, ListQueries } from '@aipowersalon/database';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, AsyncExport } from '@aipowersalon/permissions/guards';
import { SuperAdminAnalyticsService, type AnalyticsRange, type CompareMode, type ExportFormat } from './super-admin-analytics.service';
import { SuperAdminAnalyticsControllerListQueries } from './super-admin-analytics.list-queries';

const RANGES: AnalyticsRange[] = ['7d', '30d', '90d', '6m', '12m'];
const COMPARES: CompareMode[] = ['none', 'previous_period', 'previous_month', 'previous_quarter', 'previous_year'];
const FORMATS: ExportFormat[] = ['csv', 'xlsx', 'pdf'];
const pick = <T extends string>(allowed: T[], v: unknown, dflt: T): T => {
  const s = Array.isArray(v) ? v[0] : v;
  return (allowed as string[]).includes(String(s)) ? (String(s) as T) : dflt;
};
function ctxFrom(r: any) {
  return { userId: r?.user?.id ?? r?.user?.userId, email: r?.user?.email, ip: safeInet(r?.ip) ?? undefined };
}

@ListQueries(SuperAdminAnalyticsControllerListQueries)
@Controller('super-admin/analytics')
@UseGuards(SuperAdminGuard)
export class SuperAdminAnalyticsController {
  constructor(private readonly svc: SuperAdminAnalyticsService) {}

  @Get()
  analytics(@Req() r: any, @Query('range') range: unknown, @Query('tenantId') tenantId: unknown, @Query('compareTo') compareTo: unknown) {
    return this.svc.analytics(ctxFrom(r), pick(RANGES, range, '30d'), parseScope(tenantId), pick(COMPARES, compareTo, 'previous_period'));
  }

  @AsyncExport({ kind: 'super-admin.analytics.export' }) @Get('export')
  export(@Req() r: any, @Query('format') format: unknown, @Query('range') range: unknown, @Query('tenantId') tenantId: unknown, @Query('compareTo') compareTo: unknown) {
    return this.svc.exportData(ctxFrom(r), pick(FORMATS, format, 'csv'), pick(RANGES, range, '30d'), parseScope(tenantId), pick(COMPARES, compareTo, 'previous_period'));
  }
}
