// reports.controller.ts — tenant POS Reports HTTP surface (`/pos/reports/*`).
// Guards: TenantAuthGuard (authenticated tenant user) + RolePermissionGuard (@RequirePermission).
// Tenant/branch/role come from req.ctx (session) — never from the client.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ReportsService, ForbiddenError, ValidationError } from './reports.service';
import type { ReportsContext } from './reports.repository';
import type { ReportFilters, ExportFormat, DatePreset } from './reports.dto';
import { validateDateRange, DateRangeError } from '@aipowersalon/api-contracts';
import { ListQueries } from '@aipowersalon/database';
import { ReportsControllerListQueries } from './reports.list-queries';

function ctxFrom(req: any): ReportsContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function filtersFrom(q: any): ReportFilters {
  // §10 range cap: only client-supplied custom from/to are bounded (max 90 interactive days). Presets (today/week/
  // month/quarter/year) are server-controlled periods and pass through untouched. A too-large custom range throws a
  // clear error steering the caller to an export job.
  if (q.from || q.to) validateDateRange(q.from, q.to, 'reports');
  return {
    from: q.from, to: q.to, preset: q.preset as DatePreset | undefined,
    branchId: q.branchId, technicianId: q.technicianId, serviceCategory: q.serviceCategory, service: q.service,
    paymentMethod: q.paymentMethod, bookingSource: q.bookingSource, customerType: q.customerType, status: q.status, search: q.search,
  };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof DateRangeError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(ReportsControllerListQueries)
@Controller('pos/reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('state') @RequirePermission('pos.reports.view')
  state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }

  @Get('kpis') @RequirePermission('pos.reports.view')
  kpis(@Req() r: any, @Query() q: any) { return run(() => this.svc.getKpis(ctxFrom(r), filtersFrom(q))); }

  @Get('sales') @RequirePermission('pos.reports.view')
  sales(@Req() r: any, @Query() q: any) { return run(() => this.svc.getSales(ctxFrom(r), filtersFrom(q))); }

  @Get('revenue-trend') @RequirePermission('pos.reports.view')
  revenueTrend(@Req() r: any, @Query() q: any) { return run(() => this.svc.getRevenueTrend(ctxFrom(r), filtersFrom(q))); }

  @Get('services') @RequirePermission('pos.reports.view')
  services(@Req() r: any, @Query() q: any) { return run(() => this.svc.getServices(ctxFrom(r), filtersFrom(q))); }

  @Get('technicians') @RequirePermission('pos.reports.view')
  technicians(@Req() r: any, @Query() q: any) { return run(() => this.svc.getTechnicians(ctxFrom(r), filtersFrom(q))); }

  @Get('customers') @RequirePermission('pos.reports.view')
  customers(@Req() r: any, @Query() q: any) { return run(() => this.svc.getCustomers(ctxFrom(r), filtersFrom(q))); }

  @Get('payments') @RequirePermission('pos.reports.view')
  payments(@Req() r: any, @Query() q: any) { return run(() => this.svc.getPayments(ctxFrom(r), filtersFrom(q))); }

  @Get('tips') @RequirePermission('pos.reports.view')
  tips(@Req() r: any, @Query() q: any) { return run(() => this.svc.getTips(ctxFrom(r), filtersFrom(q))); }

  @Get('tax') @RequirePermission('pos.reports.view')
  tax(@Req() r: any, @Query() q: any) { return run(() => this.svc.getTax(ctxFrom(r), filtersFrom(q))); }

  @Get('discounts') @RequirePermission('pos.reports.view')
  discounts(@Req() r: any, @Query() q: any) { return run(() => this.svc.getDiscounts(ctxFrom(r), filtersFrom(q))); }

  @Get('surcharge') @RequirePermission('pos.reports.view')
  surcharge(@Req() r: any, @Query() q: any) { return run(() => this.svc.getSurcharge(ctxFrom(r), filtersFrom(q))); }

  @Get('booking') @RequirePermission('pos.reports.view')
  booking(@Req() r: any, @Query() q: any) { return run(() => this.svc.getBooking(ctxFrom(r), filtersFrom(q))); }

  @Get('queue') @RequirePermission('pos.reports.view')
  queue(@Req() r: any, @Query() q: any) { return run(() => this.svc.getQueue(ctxFrom(r), filtersFrom(q))); }

  @Get('transactions') @RequirePermission('pos.reports.view')
  transactions(@Req() r: any, @Query() q: any) { return run(() => this.svc.getTransactions(ctxFrom(r), filtersFrom(q))); }

  @Get('detail/:kind/:id') @RequirePermission('pos.reports.view')
  detail(@Req() r: any, @Param('kind') kind: string, @Param('id') id: string) { return run(() => this.svc.detail(ctxFrom(r), kind, id)); }

  @AsyncExport({ kind: 'pos.reports.export' }) @Get('export') @RequirePermission('pos.reports.export')
  export(@Req() r: any, @Query() q: any) {
    return run(() => this.svc.export(ctxFrom(r), q.type || 'transactions', (q.format || 'csv') as ExportFormat, filtersFrom(q)));
  }
}
