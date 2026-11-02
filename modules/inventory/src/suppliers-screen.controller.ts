// suppliers-screen.controller.ts — Suppliers & Purchasing mandate (Oct 29 2026): `/tenant/inventory/suppliers/*`, the server side
// of POS Services & Products → Suppliers (/tenant/inventory/vendors). Create / edit / deactivate of the supplier itself stays on
// the existing /tenant/inventory/vendors routes (now with the full profile and the duplicate warning); purchase orders stay on
// the existing purchase-order routes (draft → approve → receive, one engine). TenantAuthGuard + RolePermissionGuard.
//   inventory.view                    kpis · directory · :id · :id/products · :id/receiving
//   inventory.purchase_order.view     :id/purchase-orders (the shared paged PO list, this supplier)
//   inventory.vendor.manage           :id/restore · contacts (add / edit / deactivate) · product links (link / update / unlink)
//   inventory.purchase_order.create   purchase-orders/:poId/vendor (link an order with no supplier to a supplier record)
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InventoryService, InventoryError, type InvCtx } from './inventory.service';
import { SuppliersScreenRepository, SUPPLIER_STATUS_FILTERS, SUPPLIER_SORTS } from './suppliers-screen.repository';
import { PO_STATUSES, PO_DATE_FIELDS } from './inventory-screen.repository';
import { paging } from './stock-alerts.repository';
import { INV_VENDOR_CONTACT_BODY, INV_VENDOR_PRODUCT_BODY, INV_PO_VENDOR_BODY } from './request-schemas';

export const SUPPLIERS_SCREEN_REPOSITORY = 'SuppliersScreenRepository';
function ctx(req: any): InvCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { if (e instanceof InventoryError) throw new HttpException({ ok: false, message: e.message, ...(e.extra || {}) }, e.status); throw e; } }

const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const DIRECTORY_LIST = { filters: { status: { type: 'enum', values: [...SUPPLIER_STATUS_FILTERS] }, sort: { type: 'enum', values: [...SUPPLIER_SORTS] }, brandId: { type: 'id' } },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;
const PRODUCTS_LIST = { search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 8, params: ['page'] } as const;
const RECEIVING_LIST = { filters: { preset: PRESET }, maxLimit: 50, defaultLimit: 8, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const PO_LIST = { filters: { preset: PRESET, status: { type: 'enum', values: [...PO_STATUSES, 'open', 'active', 'all'] }, dateField: { type: 'enum', values: [...PO_DATE_FIELDS] }, sort: { type: 'enum', values: ['newest', 'expected', 'value'] } },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 8, dateRange: { maxDays: 3700 }, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('tenant/inventory/suppliers')
export class SuppliersScreenController {
  constructor(private readonly svc: InventoryService, @Inject(SUPPLIERS_SCREEN_REPOSITORY) private readonly repo: SuppliersScreenRepository | null) {}
  private r(): SuppliersScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Suppliers need the database.' }, 503); return this.repo; }

  @Get('kpis') @RequirePermission('inventory.view')
  kpis(@Req() req: any) { return run(() => this.r().supplierKpis(ctx(req))); }

  @Get('directory') @RequirePermission('inventory.view') @ListQuery(DIRECTORY_LIST)
  directory(@Req() req: any, @Query() q: Record<string, string>) { return run(() => this.r().directory(ctx(req), q, paging(q.page, q.pageSize, 10))); }

  @Get(':vendorId') @RequirePermission('inventory.view')
  supplier(@Req() req: any, @Param('vendorId') id: string) { return run(() => this.r().supplier(ctx(req), String(id))); }

  @Get(':vendorId/products') @RequirePermission('inventory.view') @ListQuery(PRODUCTS_LIST)
  products(@Req() req: any, @Param('vendorId') id: string, @Query() q: Record<string, string>) { return run(() => this.r().supplierProducts(ctx(req), String(id), q, paging(q.page, q.pageSize, 8))); }

  @Get(':vendorId/receiving') @RequirePermission('inventory.view') @ListQuery(RECEIVING_LIST)
  receiving(@Req() req: any, @Param('vendorId') id: string, @Query() q: Record<string, string>) { return run(async () => this.r().supplierReceiving(ctx(req), String(id), await this.r().period(ctx(req), q), paging(q.page, q.pageSize, 8))); }

  @Get(':vendorId/purchase-orders') @RequirePermission('inventory.purchase_order.view') @ListQuery(PO_LIST)
  purchaseOrders(@Req() req: any, @Param('vendorId') id: string, @Query() q: Record<string, string>) {
    return run(async () => this.r().purchaseOrders(ctx(req), { ...q, vendorId: String(id) }, await this.r().period(ctx(req), q), paging(q.page, q.pageSize, 8)));
  }

  @Post(':vendorId/restore') @RequirePermission('inventory.vendor.manage')
  restore(@Req() req: any, @Param('vendorId') id: string) { return run(() => this.svc.restoreVendor(ctx(req), String(id))); }

  @Post(':vendorId/contacts') @RequirePermission('inventory.vendor.manage')
  addContact(@Req() req: any, @Param('vendorId') id: string, @Body(ValidatedBody(INV_VENDOR_CONTACT_BODY, { strict: true })) b: any) { return run(() => this.svc.saveVendorContact(ctx(req), String(id), null, b)); }

  @Patch(':vendorId/contacts/:contactId') @RequirePermission('inventory.vendor.manage')
  editContact(@Req() req: any, @Param('vendorId') id: string, @Param('contactId') cid: string, @Body(ValidatedBody(INV_VENDOR_CONTACT_BODY, { strict: true })) b: any) { return run(() => this.svc.saveVendorContact(ctx(req), String(id), String(cid), b)); }

  @Post(':vendorId/contacts/:contactId/deactivate') @RequirePermission('inventory.vendor.manage')
  deactivateContact(@Req() req: any, @Param('vendorId') id: string, @Param('contactId') cid: string) { return run(() => this.svc.deactivateVendorContact(ctx(req), String(id), String(cid))); }

  @Post(':vendorId/products') @RequirePermission('inventory.vendor.manage')
  link(@Req() req: any, @Param('vendorId') id: string, @Body(ValidatedBody(INV_VENDOR_PRODUCT_BODY, { strict: true })) b: any) { return run(() => this.svc.linkVendorProduct(ctx(req), String(id), b)); }

  @Post(':vendorId/products/:productId/unlink') @RequirePermission('inventory.vendor.manage')
  unlink(@Req() req: any, @Param('vendorId') id: string, @Param('productId') pid: string) { return run(() => this.svc.unlinkVendorProduct(ctx(req), String(id), String(pid))); }

  @Post('purchase-orders/:poId/vendor') @RequirePermission('inventory.purchase_order.create')
  linkPo(@Req() req: any, @Param('poId') poId: string, @Body(ValidatedBody(INV_PO_VENDOR_BODY, { strict: true })) b: any) { return run(() => this.svc.linkPurchaseOrderVendor(ctx(req), String(poId), String(b?.vendorId ?? ''))); }
}
