// system-checks.controller.ts — the shared read-only "Check … System" (extras arc, Nov 9 2026). One route per page, each
// behind THAT page's own read permission, so a check never shows counts to someone who cannot open the page. Read-only:
// GET, no body, nothing written.
import { Controller, Get, HttpException, Param, Req, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import type { SystemCheckResult, SystemCheckRows } from '@aipowersalon/api-contracts/tenant';
import { SystemChecksService, SystemCheckNotFound } from './system-checks.service';

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

  @RequirePermission('inventory.view') @Get('suppliers')
  suppliers(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('suppliers', ctxOf(req)); }

  @RequirePermission('pos.technicians.view') @Get('technicians')
  technicians(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('technicians', ctxOf(req)); }

  @RequirePermission('pos.memberships.view') @Get('memberships')
  memberships(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('memberships', ctxOf(req)); }
  /** extras Membership Overview 16 · 15 — Reconciliation Drill-Down: the source rows (payment / ledger entry / redemption /
   *  benefit balance / membership) behind one discrepant check; same permission as the page; read-only */
  @RequirePermission('pos.memberships.view') @Get('memberships/:checkKey/rows')
  membershipCheckRows(@Req() req: any, @Param('checkKey') checkKey: string): Promise<SystemCheckRows> {
    // money in the source rows is shown only to a viewer of the salon's financials (a role that may open the page but not see
    // sales figures — e.g. a technician with membership view — gets the rows with amounts hidden, never a guessed 0)
    const money = hasPermission(req?.ctx ?? {}, 'pos.reports.financial_view');
    return this.svc.rows('memberships', String(checkKey ?? ''), ctxOf(req)).then((r) => (money ? r : { ...r, moneyHidden: true, rows: r.rows.map((x) => ({ ...x, amountCents: null })) }))
      .catch((e: unknown) => {
        if (e instanceof SystemCheckNotFound) throw new HttpException({ code: e.code, message: e.message }, 404);
        throw e;
      });
  }
  @RequirePermission('pos.serving.view') @Get('service-flow')
  serviceFlow(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('service-flow', ctxOf(req)); }

  @RequirePermission('settings.view') @Get('terminals')
  terminals(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('terminals', ctxOf(req)); }

  @RequirePermission('approvals.view') @Get('approvals')
  approvals(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('approvals', ctxOf(req)); }


  @RequirePermission('pos.reports.view') @Get('reports')
  reports(@Req() req: any): Promise<SystemCheckResult> { return this.svc.run('reports', ctxOf(req)); }
}
