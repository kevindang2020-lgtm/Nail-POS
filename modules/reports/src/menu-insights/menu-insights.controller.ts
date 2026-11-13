// menu-insights.controller.ts — AI Pricing & Menu Insights HTTP surface (`/pos/menu-insights`). Mounted on its own
// path (NOT under pos/services) so it can never be shadowed by the services `:serviceId` param route. Reuses the
// services view permission. Guards derive tenant/branch/role from req.ctx (session) — never the client.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards, HttpException, HttpStatus, Optional } from '@nestjs/common';
import type { AddOnProfitabilityResponse } from '@aipowersalon/api-contracts/tenant';
import { AddOnProfitabilityReport } from './add-on-profitability';
import { MenuInsightsService, ForbiddenError } from './menu-insights.service';
import type { InsightsContext } from './menu-insights.repository';
import { ListQueries } from '@aipowersalon/database';
import { MenuInsightsControllerListQueries } from './menu-insights.list-queries';

function ctxFrom(req: any): InsightsContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN); throw e; }
}
const windowFrom = (q: any): number => { const n = Number(q?.windowDays ?? q?.days); return Number.isFinite(n) && n > 0 ? n : 30; };

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(MenuInsightsControllerListQueries)
@Controller('pos/menu-insights')
export class MenuInsightsController {
  constructor(private readonly svc: MenuInsightsService, @Optional() private readonly addOnProfit?: AddOnProfitabilityReport) {}

  @Get('') @RequirePermission('pos.services.view') get(@Req() r: any, @Query() q: any) { return run(() => this.svc.getInsights(ctxFrom(r), windowFrom(q))); }
  @Get('state') @RequirePermission('pos.services.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getInsights(ctxFrom(r), windowFrom(q))); }
  /** Extras · ADD-ONS 09: sold add-ons and their recipe cost, with the basis stated — cost data, so inventory.cost.view only */
  @Get('add-on-profitability') @RequirePermission('inventory.cost.view') async addOnProfitability(@Req() r: any, @Query() q: any): Promise<AddOnProfitabilityResponse> {
    const rep = this.addOnProfit;
    if (!rep) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Add-on profitability needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE);
    const c = ctxFrom(r);
    return run(() => rep.report({ tenantId: c.tenantId, branchId: c.branchId || null }, { days: q?.days, page: q?.page, pageSize: q?.pageSize }));
  }
}
