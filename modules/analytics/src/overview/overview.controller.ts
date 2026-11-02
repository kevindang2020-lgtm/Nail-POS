/**
 * overview.controller.ts — tenant POS Overview HTTP surface (`/pos/overview/*`).
 * Behind TenantAuthGuard (POS roles only) + RolePermissionGuard (`pos.overview.view`).
 * CROSS-TENANT-SAFE: scope is taken from req.ctx (session), never the client.
 * Super Admin is a separate surface and is rejected by TenantAuthGuard.
 */
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { OverviewService, type TenantContext } from './overview.service';
import type { OverviewQuery } from './overview.repository';
import { ListQueries } from '@aipowersalon/database';
import { OverviewControllerListQueries } from './overview.list-queries';

function tcFrom(req: any): TenantContext {
  const c = req?.ctx || {};
  return {
    tenantId: c.tenantId,
    branchId: c.branchId ?? null,
    userId: c.userId,
    role: c.role,
    permissions: c.permissions || [],
  };
}
function queryOpts(q: any): OverviewQuery {
  return { date: q?.date, range: q?.range };
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(OverviewControllerListQueries)
@Controller('pos/overview')
export class OverviewController {
  constructor(private readonly svc: OverviewService) {}

  @Get('state')
  @RequirePermission('pos.overview.view')
  state(@Query() q: any, @Req() req: any) {
    if (q && q.shape === 'summary') return this.svc.getSummary(tcFrom(req), queryOpts(q));
    return this.svc.getState(tcFrom(req), queryOpts(q));
  }

  @Get('kpis')
  @RequirePermission('pos.overview.view')
  kpis(@Query() q: any, @Req() req: any) { return this.svc.getKpis(tcFrom(req), queryOpts(q)); }

  @Get('today-summary')
  @RequirePermission('pos.overview.view')
  todaySummary(@Query() q: any, @Req() req: any) { return this.svc.getTodaySummary(tcFrom(req), queryOpts(q)); }

  @Get('revenue-trend')
  @RequirePermission('pos.overview.view')
  revenueTrend(@Query() q: any, @Req() req: any) { return this.svc.getRevenueTrend(tcFrom(req), queryOpts(q)); }

  @Get('top-services')
  @RequirePermission('pos.overview.view')
  topServices(@Query() q: any, @Req() req: any) { return this.svc.getTopServices(tcFrom(req), queryOpts(q)); }

  @Get('top-technicians')
  @RequirePermission('pos.overview.view')
  topTechnicians(@Query() q: any, @Req() req: any) { return this.svc.getTopTechnicians(tcFrom(req), queryOpts(q)); }

  @Get('payment-mix')
  @RequirePermission('pos.overview.view')
  paymentMix(@Query() q: any, @Req() req: any) { return this.svc.getPaymentMix(tcFrom(req), queryOpts(q)); }

  @Get('insights')
  @RequirePermission('pos.overview.view')
  insights(@Query() q: any, @Req() req: any) { return this.svc.getInsights(tcFrom(req), queryOpts(q)); }

  @Get('alerts')
  @RequirePermission('pos.overview.view')
  alerts(@Query() q: any, @Req() req: any) { return this.svc.getAlerts(tcFrom(req), queryOpts(q)); }
}
