// inventory-screen.controller.ts — Inventory + Products mandates (Oct 29 2026): `/tenant/inventory/screen/*`, the read model behind
// POS Inventory (/tenant/inventory, all eight tabs) and Products (/tenant/products). TenantAuthGuard + RolePermissionGuard;
// tenant / branch / user from the session. Each tab has its own paged, searchable, dated list; the metrics are "now".
//   inventory.view                          metrics · products · products/:id · movements · catalog · recipes
//   inventory.purchase_order.view           purchase-orders · purchase-orders/:id
//   inventory.transfer                      transfers
//   inventory.stock.count                   counts
//   inventory.technician_report.approve     reports (the bottle-report review queue)
//   inventory.archive                       products/:id/restore
//   inventory.stock.adjust                  products/:id/recount (rebuild the cached stock row from the bottle records)
//   inventory.reports.view                  products/export (CSV, every matching row)
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Header, HttpException, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InventoryService, InventoryError, type InvCtx } from './inventory.service';
import { InventoryScreenRepository, STOCK_STATUSES, PRODUCT_DATE_FIELDS, PRODUCT_SORTS, PO_STATUSES, PO_DATE_FIELDS } from './inventory-screen.repository';
import { paging, csv } from './stock-alerts.repository';

export const INVENTORY_SCREEN_REPOSITORY = 'InventoryScreenRepository';
function ctx(req: any): InvCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { if (e instanceof InventoryError) throw new HttpException({ ok: false, message: e.message, ...(e.extra || {}) }, e.status); throw e; } }

const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const PRODUCT_FILTERS = {
  preset: PRESET, status: { type: 'enum', values: [...STOCK_STATUSES, 'needs_reorder', 'all'] }, lifecycle: { type: 'enum', values: ['active', 'archived', 'all'] },
  brandId: { type: 'id' }, categoryId: { type: 'id' }, vendorId: { type: 'id' }, technicianId: { type: 'id' },
  dateField: { type: 'enum', values: [...PRODUCT_DATE_FIELDS] }, sort: { type: 'enum', values: [...PRODUCT_SORTS] },
} as const;
const PRODUCT_LIST = { filters: PRODUCT_FILTERS, search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const PRODUCT_EXPORT = { filters: PRODUCT_FILTERS, search: { params: ['search'], maxLength: 100 }, dateRange: { maxDays: 3700 } } as const;
const MOVES_LIST = { filters: { preset: PRESET, productId: { type: 'id' }, type: { type: 'text', maxLength: 40 } }, search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const PO_LIST = { filters: { preset: PRESET, status: { type: 'enum', values: [...PO_STATUSES, 'open', 'active', 'all'] }, vendorId: { type: 'id' }, productId: { type: 'id' },
  dateField: { type: 'enum', values: [...PO_DATE_FIELDS] }, sort: { type: 'enum', values: ['newest', 'expected', 'value'] }, unlinked: { type: 'enum', values: ['true', 'false'] } },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const TRANSFER_LIST = { filters: { preset: PRESET, status: { type: 'text', maxLength: 20 }, direction: { type: 'enum', values: ['inbound', 'outbound', 'all'] } }, search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const COUNT_LIST = { filters: { preset: PRESET, status: { type: 'text', maxLength: 20 }, dateField: { type: 'enum', values: ['created', 'reconciled'] } }, search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const CATALOG_LIST = { filters: { kind: { type: 'enum', values: ['brand', 'category'] } }, search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;
const RECIPE_LIST = { filters: { withRecipe: { type: 'enum', values: ['true', 'false'] } }, search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;
const REPORT_LIST = { filters: { preset: PRESET, status: { type: 'enum', values: ['pending', 'approved', 'rejected', 'all'] } }, search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('tenant/inventory/screen')
export class InventoryScreenController {
  constructor(private readonly svc: InventoryService, @Inject(INVENTORY_SCREEN_REPOSITORY) private readonly repo: InventoryScreenRepository | null) {}
  private r(): InventoryScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Inventory needs the database.' }, 503); return this.repo; }

  @Get('metrics') @RequirePermission('inventory.view')
  metrics(@Req() req: any) { return run(() => this.r().metrics(ctx(req))); }

  @Get('products') @RequirePermission('inventory.view') @ListQuery(PRODUCT_LIST)
  products(@Req() req: any, @Query() q: Record<string, string>) { return run(async () => this.r().products(ctx(req), q, await this.r().period(ctx(req), q), paging(q.page, q.pageSize))); }

  @AsyncExport({ kind: 'inventory.products.export' }) @Get('products/export') @RequirePermission('inventory.reports.view') @ListQuery(PRODUCT_EXPORT)
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="inventory-products.csv"')
  exportProducts(@Req() req: any, @Query() q: Record<string, string>) {
    return run(async () => {
      const c = ctx(req); const r = await this.r().products(c, q, await this.r().period(c, q), { page: 1, pageSize: 100000 });
      await this.svc.recordAudit(c, 'inventory_products_exported', null, { rows: r.rows.length });
      return csv(['Product', 'SKU', 'Barcode', 'Brand', 'Category', 'Supplier', 'Unit', 'On hand', 'Available', 'Open', 'Unopened', 'Expiring soon', 'Reorder level', 'Status', 'Last used by', 'Last used at', 'Created'],
        r.rows.map((x) => [x.name, x.sku, x.barcode, x.brand, x.category, x.vendor, x.unit, x.onHand, x.available, x.open, x.unopened, x.expiring, x.reorderLevel, x.severity, x.lastUsedLabel, x.lastUsedAt, x.createdAt]));
    });
  }

  @Get('products/:productId') @RequirePermission('inventory.view')
  product(@Req() req: any, @Param('productId') id: string) { return run(() => this.r().product(ctx(req), String(id))); }

  @Post('products/:productId/restore') @RequirePermission('inventory.archive')
  restore(@Req() req: any, @Param('productId') id: string) { return run(() => this.svc.restoreProduct(ctx(req), String(id))); }

  @Post('products/:productId/recount') @RequirePermission('inventory.stock.adjust')
  recount(@Req() req: any, @Param('productId') id: string) { return run(() => this.svc.recountProduct(ctx(req), String(id))); }

  @Get('movements') @RequirePermission('inventory.view') @ListQuery(MOVES_LIST)
  movements(@Req() req: any, @Query() q: Record<string, string>) { return run(async () => this.r().movements(ctx(req), q, await this.r().period(ctx(req), q), paging(q.page, q.pageSize, 10))); }

  @Get('purchase-orders') @RequirePermission('inventory.purchase_order.view') @ListQuery(PO_LIST)
  purchaseOrders(@Req() req: any, @Query() q: Record<string, string>) { return run(async () => this.r().purchaseOrders(ctx(req), q, await this.r().period(ctx(req), q), paging(q.page, q.pageSize, 10))); }

  @Get('purchase-orders/:poId') @RequirePermission('inventory.purchase_order.view')
  purchaseOrder(@Req() req: any, @Param('poId') id: string) { return run(() => this.r().purchaseOrder(ctx(req), String(id))); }

  @Get('transfers') @RequirePermission('inventory.transfer') @ListQuery(TRANSFER_LIST)
  transfers(@Req() req: any, @Query() q: Record<string, string>) { return run(async () => this.r().transfers(ctx(req), q, await this.r().period(ctx(req), q), paging(q.page, q.pageSize, 10))); }

  @Get('counts') @RequirePermission('inventory.stock.count') @ListQuery(COUNT_LIST)
  counts(@Req() req: any, @Query() q: Record<string, string>) { return run(async () => this.r().counts(ctx(req), q, await this.r().period(ctx(req), q), paging(q.page, q.pageSize, 10))); }

  @Get('catalog') @RequirePermission('inventory.view') @ListQuery(CATALOG_LIST)
  catalog(@Req() req: any, @Query() q: Record<string, string>) { return run(() => this.r().catalog(ctx(req), q, paging(q.page, q.pageSize, 10))); }

  @Get('recipes') @RequirePermission('inventory.view') @ListQuery(RECIPE_LIST)
  recipes(@Req() req: any, @Query() q: Record<string, string>) { return run(() => this.r().recipes(ctx(req), q, paging(q.page, q.pageSize, 10))); }

  @Get('reports') @RequirePermission('inventory.technician_report.approve') @ListQuery(REPORT_LIST)
  reports(@Req() req: any, @Query() q: Record<string, string>) { return run(async () => this.r().reports(ctx(req), q, await this.r().period(ctx(req), q), paging(q.page, q.pageSize, 10))); }
}
