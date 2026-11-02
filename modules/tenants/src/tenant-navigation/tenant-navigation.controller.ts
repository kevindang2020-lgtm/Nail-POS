import { RequirePermission } from '@aipowersalon/permissions/guards';
// tenant-navigation.controller.ts — sidebar endpoints (tenant-session scoped via TenantContextMiddleware).
import { Controller, Get, Req } from '@nestjs/common';
import { TenantNavigationService, type NavCtx } from './tenant-navigation.service';

function ctxFrom(r: any): NavCtx {
  const c = r?.ctx || {};
  return { tenantId: c.tenantId || '', branchId: c.branchId || '', role: c.role || '', permissions: c.permissions || [] };
}

@Controller('tenant')
export class TenantNavigationController {
  constructor(private readonly svc: TenantNavigationService) {}
  @RequirePermission('dashboard.view') @Get('navigation') navigation(@Req() r: any) { return this.svc.navigation(ctxFrom(r)); }
  @RequirePermission('dashboard.view') @Get('navigation/badges') badges(@Req() r: any) { return this.svc.badges(ctxFrom(r)); }
  @RequirePermission('dashboard.view') @Get('system-status') systemStatus() { return this.svc.systemStatus(); }
  @RequirePermission('help.view') @Get('help/dashboard') helpDashboard(@Req() r: any) { return this.svc.helpDashboard(ctxFrom(r)); }
}
