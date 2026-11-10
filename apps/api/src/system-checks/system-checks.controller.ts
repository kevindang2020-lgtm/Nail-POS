// system-checks.controller.ts — the shared read-only "Check … System" (extras arc, Nov 9 2026). One route per page, each
// behind THAT page's own read permission, so a check never shows counts to someone who cannot open the page. Read-only:
// GET, no body, nothing written.
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import type { SystemCheckResult } from '@aipowersalon/api-contracts/tenant';
import { SystemChecksService } from './system-checks.service';

const ctxOf = (req: any) => { const c = req?.ctx || {}; return { tenantId: c.tenantId as string | undefined, branchId: (c.branchId as string | null | undefined) ?? null }; };

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/system-checks')
export class SystemChecksController {
  constructor(private readonly svc: SystemChecksService) {}

  @RequirePermission('owner.expenses.view') @Get('expenses')
  expenses(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('expenses', ctxOf(req)); }

  @RequirePermission('pos.checkout.view') @Get('invoices')
  invoices(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('invoices', ctxOf(req)); }

  @RequirePermission('reconciliation.view') @Get('settlements')
  settlements(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('settlements', ctxOf(req)); }

  @RequirePermission('pos.reports.view') @Get('payments')
  payments(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('payments', ctxOf(req)); }

  @RequirePermission('pos.marketing.view') @Get('discounts')
  discounts(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('discounts', ctxOf(req)); }

  @RequirePermission('pos.services.view') @Get('catalog')
  catalog(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('catalog', ctxOf(req)); }

  @RequirePermission('inventory.view') @Get('inventory')
  inventory(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('inventory', ctxOf(req)); }

  @RequirePermission('pos.technicians.view') @Get('technicians')
  technicians(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('technicians', ctxOf(req)); }

  @RequirePermission('pos.memberships.view') @Get('memberships')
  memberships(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('memberships', ctxOf(req)); }
  @RequirePermission('pos.serving.view') @Get('service-flow')
  serviceFlow(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('service-flow', ctxOf(req)); }

  @RequirePermission('settings.view') @Get('terminals')
  terminals(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('terminals', ctxOf(req)); }

  @RequirePermission('approvals.view') @Get('approvals')
  approvals(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('approvals', ctxOf(req)); }


  @RequirePermission('pos.reports.view') @Get('reports')
  reports(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('reports', ctxOf(req)); }
}
