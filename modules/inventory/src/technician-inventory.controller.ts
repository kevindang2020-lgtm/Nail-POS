// technician-inventory.controller.ts — technician-facing inventory (limited). Technicians can search,
// report issues, open a replacement bottle, and submit usage — but never see cost/value/vendor data.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { TECH_INVENTORY_REPORT_BODY, INV_PRODUCT_USAGE_BODY } from './request-schemas';
import { Idempotent } from '@aipowersalon/database/nest';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Headers, HttpException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InventoryService, InventoryError } from './inventory.service';
import { ListQueries } from '@aipowersalon/database';
import { TechnicianInventoryControllerListQueries } from './technician-inventory.list-queries';

function ctx(req: any) { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { if (e instanceof InventoryError) throw new HttpException({ ok: false, message: e.message, ...(e.extra || {}) }, e.status); throw e; } }

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(TechnicianInventoryControllerListQueries)
@Controller('technician/inventory')
export class TechnicianInventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Get('search') @RequirePermission('inventory.view_limited') search(@Req() r: any, @Query() q: any) { return run(() => this.svc.listProducts(ctx(r), q)); }
  @Post('reports') @RequirePermission('inventory.technician_report.submit') report(@Req() r: any, @Body(ValidatedBody(TECH_INVENTORY_REPORT_BODY, { strict: true })) b: any) { return run(() => this.svc.submitReport(ctx(r), b)); }
  @Get('reports/mine') @RequirePermission('inventory.technician_report.submit') mine(@Req() r: any) { return run(() => this.svc.myReports(ctx(r))); }
  @Post('units/:unitId/open') @RequirePermission('inventory.bottle.open') open(@Req() r: any, @Param('unitId') id: string) { return run(() => this.svc.openUnit(ctx(r), id)); }
  // Stock Alerts + Technician Product Usage (Oct 29 2026): the technician records their OWN use from the Tech app (never
  // someone else's — technicianId / onBehalfReason are dropped here), same writer, same idempotency, source technician_app.
  @Idempotent() @Post('usage') @RequirePermission('inventory.product_usage.submit')
  usage(@Req() r: any, @Headers('idempotency-key') key: string | undefined, @Body(ValidatedBody(INV_PRODUCT_USAGE_BODY, { strict: true })) b: any) {
    return run(() => this.svc.recordProductUsage(ctx(r), { productId: b?.productId, quantity: b?.quantity, occurredAt: b?.occurredAt, unitId: b?.unitId, serviceTicketId: b?.serviceTicketId, note: b?.note, source: 'technician_app' }, key ?? null));
  }
}
