// stock-alerts.controller.ts — Stock Alerts + Technician Product Usage mandate (Oct 29 2026): `/tenant/inventory/stock-alerts*`,
// the server side of POS Inventory → Stock Alerts. TenantAuthGuard + RolePermissionGuard; tenant / branch / user from the session.
//   reads     inventory.view                  summary · active · history · usage · usage/products/:id · technicians · pickers · events/:id
//   ack       inventory.view                  active/:productId/acknowledge (the same key the old alert-feed acknowledge used)
//   record    inventory.product_usage.submit  usage (Idempotency-Key; for another technician also inventory.stock.adjust + a reason)
//   correct   inventory.stock.adjust          usage/:eventId/adjustments (signed delta + reason; never an edit)
//   export    inventory.reports.view          export?tab=active|history|usage|technicians (CSV, every matching row)
import { ListQuery } from '@aipowersalon/database';
import { Idempotent } from '@aipowersalon/database/nest';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Header, Headers, HttpException, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InventoryService, InventoryError, type InvCtx } from './inventory.service';
import { StockAlertsRepository, paging } from './stock-alerts.repository';
import type { InventoryLowStockCause } from '@aipowersalon/api-contracts/tenant';
import { INV_ALERT_ACK_BODY, INV_PRODUCT_USAGE_ADJUST_BODY, INV_PRODUCT_USAGE_BODY } from './request-schemas';

export const STOCK_ALERTS_REPOSITORY = 'StockAlertsRepository';
function ctx(req: any): InvCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { if (e instanceof InventoryError) throw new HttpException({ ok: false, message: e.message, ...(e.extra || {}) }, e.status); throw e; } }

const PERIOD = { preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] }, dateBasis: { type: 'enum', values: ['occurred', 'recorded'] } } as const;
const ACTIVE_LIST = { filters: { severity: { type: 'enum', values: ['out_of_stock', 'critical', 'low', 'all'] }, showAcknowledged: { type: 'enum', values: ['true', 'false'] }, rank: { type: 'enum', values: ['newest', 'priority'] } }, search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, params: ['page'] } as const;
const HISTORY_LIST = { filters: { ...PERIOD, severity: { type: 'enum', values: ['out_of_stock', 'critical', 'low', 'all'] } }, search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const USAGE_LIST = { filters: { ...PERIOD, technicianId: { type: 'id' } }, search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const PICKER_LIST = { search: { params: ['search'], maxLength: 100 }, maxLimit: 25, defaultLimit: 25 } as const;
const EXPORT_LIST = { filters: { ...PERIOD, tab: { type: 'enum', values: ['active', 'history', 'usage', 'technicians', 'events'] }, severity: { type: 'enum', values: ['out_of_stock', 'critical', 'low', 'all'] }, showAcknowledged: { type: 'enum', values: ['true', 'false'] }, technicianId: { type: 'id' } }, search: { params: ['search'], maxLength: 100 }, dateRange: { maxDays: 3700 } } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('tenant/inventory/stock-alerts')
export class StockAlertsController {
  constructor(private readonly svc: InventoryService, @Inject(STOCK_ALERTS_REPOSITORY) private readonly repo: StockAlertsRepository | null) {}
  private r(): StockAlertsRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Stock alerts need the database.' }, 503); return this.repo; }

  @Get('summary') @RequirePermission('inventory.view')
  summary(@Req() req: any) { return run(() => this.r().summary(ctx(req))); }

  @Get('active') @RequirePermission('inventory.view') @ListQuery(ACTIVE_LIST)
  active(@Req() req: any, @Query() q: Record<string, string>) { return run(() => this.r().activeAlerts(ctx(req), q, paging(q.page, q.pageSize))); }

  @Post('active/:productId/acknowledge') @RequirePermission('inventory.view')
  acknowledge(@Req() req: any, @Param('productId') productId: string, @Body(ValidatedBody(INV_ALERT_ACK_BODY, { strict: true })) b: any) {
    return run(async () => {
      const c = ctx(req); const note = b?.note ? String(b.note).slice(0, 500) : null;
      const out = await this.r().acknowledge(c, String(productId), note);
      if (!out.alreadyAcknowledged) await this.svc.recordAudit(c, 'inventory_alert_acknowledged', String(productId), { alertId: out.alertId, severity: out.severity, onHand: out.onHand, note });
      return { ok: true, alertId: out.alertId, alreadyAcknowledged: out.alreadyAcknowledged };
    });
  }

  @Get('history') @RequirePermission('inventory.view') @ListQuery(HISTORY_LIST)
  history(@Req() req: any, @Query() q: Record<string, string>) { return run(async () => this.r().history(ctx(req), q, await this.r().period(ctx(req), q), paging(q.page, q.pageSize))); }

  @Get('usage') @RequirePermission('inventory.view') @ListQuery(USAGE_LIST)
  usage(@Req() req: any, @Query() q: Record<string, string>) { return run(async () => this.r().productUsage(ctx(req), q, await this.r().period(ctx(req), q), paging(q.page, q.pageSize))); }

  @Get('usage/products/:productId') @RequirePermission('inventory.view') @ListQuery(USAGE_LIST)
  ledger(@Req() req: any, @Param('productId') productId: string, @Query() q: Record<string, string>) { return run(async () => this.r().productLedger(ctx(req), String(productId), q, await this.r().period(ctx(req), q), paging(q.page, q.pageSize, 10))); }

  // Low-Stock Cause Explanation (Extras · Stock Alerts 12): measured movements, open orders and ledger agreement — read-only
  @Get('products/:productId/cause') @RequirePermission('inventory.view')
  cause(@Req() req: any, @Param('productId') productId: string): Promise<InventoryLowStockCause> { return run(() => this.r().lowStockCause(ctx(req), String(productId))); }
  @Get('technicians') @RequirePermission('inventory.view') @ListQuery(USAGE_LIST)
  technicians(@Req() req: any, @Query() q: Record<string, string>) { return run(async () => this.r().technicians(ctx(req), q, await this.r().period(ctx(req), q), paging(q.page, q.pageSize))); }

  @Get('pickers') @RequirePermission('inventory.view') @ListQuery(PICKER_LIST)
  pickers(@Req() req: any, @Query('search') search?: string) { return run(() => this.r().pickers(ctx(req), search)); }

  @Get('events/:eventId') @RequirePermission('inventory.view')
  event(@Req() req: any, @Param('eventId') eventId: string) { return run(() => this.svc.usageEvent(ctx(req), String(eventId))); }

  @Idempotent() @Post('usage') @RequirePermission('inventory.product_usage.submit')
  record(@Req() req: any, @Headers('idempotency-key') key: string | undefined, @Body(ValidatedBody(INV_PRODUCT_USAGE_BODY, { strict: true })) b: any) {
    return run(() => this.svc.recordProductUsage(ctx(req), { ...b, source: b?.source === 'scan' ? 'scan' : 'front_desk' }, key ?? null));
  }

  @Idempotent() @Post('usage/:eventId/adjustments') @RequirePermission('inventory.stock.adjust')
  adjust(@Req() req: any, @Param('eventId') eventId: string, @Headers('idempotency-key') key: string | undefined, @Body(ValidatedBody(INV_PRODUCT_USAGE_ADJUST_BODY, { strict: true })) b: any) {
    return run(() => this.svc.adjustProductUsage(ctx(req), String(eventId), b, key ?? null));
  }

  @AsyncExport({ kind: 'inventory.stock-alerts.export' }) @Get('export') @RequirePermission('inventory.reports.view') @ListQuery(EXPORT_LIST)
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="stock-alerts.csv"')
  exportCsv(@Req() req: any, @Query() q: Record<string, string>) {
    return run(async () => {
      const c = ctx(req); const tab = ['active', 'history', 'usage', 'technicians', 'events'].includes(q.tab) ? q.tab : 'active';
      const text = await this.r().exportCsv(c, tab, q, await this.r().period(c, q));
      await this.svc.recordAudit(c, 'inventory_stock_alerts_exported', null, { tab, rows: text.split('\r\n').length - 2 });
      return text;
    });
  }
}
