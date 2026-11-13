/**
 * dashboard.controller.ts — tenant POS Dashboard HTTP surface (`/pos/dashboard/*`).
 * Behind TenantAuthGuard (POS roles only) + RolePermissionGuard (`pos.dashboard.view`).
 * Scope is taken from req.ctx (session), never the client. Super Admin is rejected by TenantAuthGuard.
 */
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { DashboardService, type TenantContext } from './dashboard.service';
import type { DashboardQuery } from './dashboard.repository';
import { ListQueries } from '@aipowersalon/database';
import { DashboardControllerListQueries } from './dashboard.list-queries';
import type { LiveOpsKpiCheck } from '@aipowersalon/api-contracts/tenant';

function tcFrom(req: any): TenantContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [], branchIds: Array.isArray(c.authz?.branchIds) ? c.authz.branchIds : null };
}
function opts(q: any): DashboardQuery { return { date: q?.date, range: q?.range }; }

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(DashboardControllerListQueries)
@Controller('pos/dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('state')
  @RequirePermission('pos.dashboard.view')
  state(@Query() q: any, @Req() req: any) {
    if (q && q.shape === 'summary') return this.svc.getSummary(tcFrom(req), opts(q));
    return this.svc.getState(tcFrom(req), opts(q));
  }

  /** Live Operations 04 — KPI Accuracy & Reconciliation Checker (read only) */
  @Get('kpi-check') @RequirePermission('pos.dashboard.view') kpiCheck(@Query() q: any, @Req() req: any): Promise<LiveOpsKpiCheck> { return this.svc.kpiCheck(tcFrom(req), { date: q?.date }); }
  @Get('kpis') @RequirePermission('pos.dashboard.view') kpis(@Query() q: any, @Req() req: any) { return this.svc.getKpis(tcFrom(req), opts(q)); }
  @Get('operations') @RequirePermission('pos.dashboard.view') operations(@Query() q: any, @Req() req: any) { return this.svc.getOperations(tcFrom(req), opts(q)); }
  @Get('appointments') @RequirePermission('pos.dashboard.view') appointments(@Query() q: any, @Req() req: any) { return this.svc.getAppointments(tcFrom(req), opts(q)); }
  @Get('queue') @RequirePermission('pos.dashboard.view') queue(@Query() q: any, @Req() req: any) { return this.svc.getQueue(tcFrom(req), opts(q)); }
  @Get('serving') @RequirePermission('pos.dashboard.view') serving(@Query() q: any, @Req() req: any) { return this.svc.getServing(tcFrom(req), opts(q)); }
  @Get('checkout') @RequirePermission('pos.dashboard.view') checkout(@Query() q: any, @Req() req: any) { return this.svc.getCheckout(tcFrom(req), opts(q)); }
  @Get('revenue-trend') @RequirePermission('pos.dashboard.view') revenueTrend(@Query() q: any, @Req() req: any) { return this.svc.getRevenueTrend(tcFrom(req), opts(q)); }
  @Get('top-services') @RequirePermission('pos.dashboard.view') topServices(@Query() q: any, @Req() req: any) { return this.svc.getTopServices(tcFrom(req), opts(q)); }
  @Get('top-technicians') @RequirePermission('pos.dashboard.view') topTechnicians(@Query() q: any, @Req() req: any) { return this.svc.getTopTechnicians(tcFrom(req), opts(q)); }
  @Get('payment-mix') @RequirePermission('pos.dashboard.view') paymentMix(@Query() q: any, @Req() req: any) { return this.svc.getPaymentMix(tcFrom(req), opts(q)); }
  @Get('customers') @RequirePermission('pos.dashboard.view') customers(@Query() q: any, @Req() req: any) { return this.svc.getCustomers(tcFrom(req), opts(q)); }
  @Get('insights') @RequirePermission('pos.dashboard.view') insights(@Query() q: any, @Req() req: any) { return this.svc.getInsights(tcFrom(req), opts(q)); }
  @Get('alerts') @RequirePermission('pos.dashboard.view') alerts(@Query() q: any, @Req() req: any) { return this.svc.getAlerts(tcFrom(req), opts(q)); }
}
