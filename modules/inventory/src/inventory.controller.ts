// inventory.controller.ts — tenant manager Inventory API. TenantAuthGuard + RolePermissionGuard.
// Tenant + branch come from the session (req.ctx); never from the client.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { INV_ADD_STOCK_BODY, INV_BRAND_BODY, INV_CATEGORY_BODY, INV_CONSUME_BODY, INV_COUNT_CREATE_BODY, INV_COUNT_LINES_BODY, INV_NOTE_BODY, INV_PO_CREATE_BODY, INV_PO_RECEIVE_BODY, INV_PRODUCT_CREATE_BODY, INV_PRODUCT_UPDATE_BODY, INV_RECEIPT_EXPENSE_BODY, INV_RECIPE_BODY, INV_STOCK_OVERRIDES_BODY, INV_TRANSFER_BODY, INV_VENDOR_BODY } from './request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { InventoryService, InventoryError } from './inventory.service';
import { ListQueries } from '@aipowersalon/database';
import { InventoryControllerListQueries } from './inventory.list-queries';

function ctx(req: any) { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { if (e instanceof InventoryError) throw new HttpException({ ok: false, message: e.message, ...(e.extra || {}) }, e.status); throw e; } }

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(InventoryControllerListQueries)
@Controller('tenant/inventory')
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Get('summary') @RequirePermission('inventory.view') summary(@Req() r: any) { return run(() => this.svc.summary(ctx(r))); }
  @Get('alerts') @RequirePermission('inventory.view') alerts(@Req() r: any) { return run(() => this.svc.alerts(ctx(r))); }

  @Get('categories') @RequirePermission('inventory.view') cats(@Req() r: any) { return run(() => this.svc.listCategories(ctx(r))); }
  @Post('categories') @RequirePermission('inventory.category.manage') addCat(@Req() r: any, @Body(ValidatedBody(INV_CATEGORY_BODY, { strict: true })) b: any) { return run(() => this.svc.createCategory(ctx(r), b)); }
  @Get('brands') @RequirePermission('inventory.view') brands(@Req() r: any) { return run(() => this.svc.listBrands(ctx(r))); }
  @Post('brands') @RequirePermission('inventory.brand.manage') addBrand(@Req() r: any, @Body(ValidatedBody(INV_BRAND_BODY, { strict: true })) b: any) { return run(() => this.svc.createBrand(ctx(r), b)); }
  @Get('vendors') @RequirePermission('inventory.view') vendors(@Req() r: any) { return run(() => this.svc.listVendors(ctx(r))); }
  @Post('vendors') @RequirePermission('inventory.vendor.manage') addVendor(@Req() r: any, @Body(ValidatedBody(INV_VENDOR_BODY, { strict: true })) b: any) { return run(() => this.svc.createVendor(ctx(r), b)); }
  @Patch('categories/:id') @RequirePermission('inventory.category.manage') updCat(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INV_CATEGORY_BODY, { strict: true })) b: any) { return run(() => this.svc.updateCategory(ctx(r), id, b)); }
  @Post('categories/:id/archive') @RequirePermission('inventory.category.manage') archCat(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.archiveCategory(ctx(r), id)); }
  @Patch('brands/:id') @RequirePermission('inventory.brand.manage') updBrand(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INV_BRAND_BODY, { strict: true })) b: any) { return run(() => this.svc.updateBrand(ctx(r), id, b)); }
  @Post('brands/:id/archive') @RequirePermission('inventory.brand.manage') archBrand(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.archiveBrand(ctx(r), id)); }
  @Patch('vendors/:id') @RequirePermission('inventory.vendor.manage') updVendor(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INV_VENDOR_BODY, { strict: true })) b: any) { return run(() => this.svc.updateVendor(ctx(r), id, b)); }
  @Post('vendors/:id/archive') @RequirePermission('inventory.vendor.manage') archVendor(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.archiveVendor(ctx(r), id)); }

  @Get('products') @RequirePermission('inventory.view') products(@Req() r: any, @Query() q: any) { return run(() => this.svc.listProducts(ctx(r), q)); }
  @Get('products/:id') @RequirePermission('inventory.view') product(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.getProduct(ctx(r), id)); }
  @Post('products') @RequirePermission('inventory.create') create(@Req() r: any, @Body(ValidatedBody(INV_PRODUCT_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.createProduct(ctx(r), b)); }
  @Patch('products/:id') @RequirePermission('inventory.update') update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INV_PRODUCT_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.updateProduct(ctx(r), id, b)); }
  @Patch('products/:id/stock-overrides') @RequirePermission('inventory.update') setStockOverrides(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INV_STOCK_OVERRIDES_BODY, { strict: true })) b: any) { return run(() => this.svc.setLocationStockOverrides(ctx(r), id, b)); }
  @Post('products/:id/archive') @RequirePermission('inventory.archive') archive(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.archiveProduct(ctx(r), id)); }

  @Post('products/:id/stock/add') @RequirePermission('inventory.stock.add') addStock(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INV_ADD_STOCK_BODY, { strict: true })) b: any) { return run(() => this.svc.addStock(ctx(r), id, b)); }

  @Post('units/:unitId/open') @RequirePermission('inventory.update') open(@Req() r: any, @Param('unitId') id: string) { return run(() => this.svc.openUnit(ctx(r), id)); }
  @Post('units/:unitId/mark-low') @RequirePermission('inventory.update') low(@Req() r: any, @Param('unitId') id: string) { return run(() => this.svc.markLow(ctx(r), id)); }
  @Post('units/:unitId/mark-empty') @RequirePermission('inventory.update') empty(@Req() r: any, @Param('unitId') id: string) { return run(() => this.svc.markEmpty(ctx(r), id)); }
  @Post('units/:unitId/mark-damaged') @RequirePermission('inventory.update') damaged(@Req() r: any, @Param('unitId') id: string) { return run(() => this.svc.markDamaged(ctx(r), id)); }

  @Get('technician-reports') @RequirePermission('inventory.technician_report.approve') reports(@Req() r: any, @Query() q: any) { return run(() => this.svc.listReports(ctx(r), q?.status)); }
  @Post('technician-reports/:id/approve') @RequirePermission('inventory.technician_report.approve') approve(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.approveReport(ctx(r), id)); }
  @Post('technician-reports/:id/reject') @RequirePermission('inventory.technician_report.approve') reject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INV_NOTE_BODY, { strict: true })) b: any) { return run(() => this.svc.rejectReport(ctx(r), id, b?.note)); }

  // ---- purchase orders (§18) ----
  @Get('purchase-orders') @RequirePermission('inventory.purchase_order.view') listPOs(@Req() r: any, @Query() q: any) { return run(() => this.svc.listPurchaseOrders(ctx(r), q?.status)); }
  @Get('purchase-orders/:id') @RequirePermission('inventory.purchase_order.view') getPO(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.getPurchaseOrder(ctx(r), id)); }
  @Post('purchase-orders') @RequirePermission('inventory.purchase_order.create') createPO(@Req() r: any, @Body(ValidatedBody(INV_PO_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.createPurchaseOrder(ctx(r), b)); }
  @Post('purchase-orders/:id/approve') @RequirePermission('inventory.purchase_order.approve') approvePO(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.approvePurchaseOrder(ctx(r), id)); }
  @Post('purchase-orders/:id/receive') @RequirePermission('inventory.purchase_order.receive') receivePO(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INV_PO_RECEIVE_BODY, { strict: true })) b: any) { return run(() => this.svc.receivePurchaseOrder(ctx(r), id, b)); }
  @Post('purchase-orders/:id/cancel') @RequirePermission('inventory.purchase_order.create') cancelPO(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INV_NOTE_BODY, { strict: true })) b: any) { return run(() => this.svc.cancelPurchaseOrder(ctx(r), id, b?.note)); }

  // ---- branch transfers (§19) ----
  @Get('transfers') @RequirePermission('inventory.transfer') listTransfers(@Req() r: any) { return run(() => this.svc.listTransfers(ctx(r))); }
  @Get('transfers/branches') @RequirePermission('inventory.transfer') transferBranches(@Req() r: any) { return run(() => this.svc.listTransferBranches(ctx(r))); }
  @Get('transfers/:id') @RequirePermission('inventory.transfer') getTransfer(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.getTransfer(ctx(r), id)); }
  @Post('transfers') @RequirePermission('inventory.transfer') createTransfer(@Req() r: any, @Body(ValidatedBody(INV_TRANSFER_BODY, { strict: true })) b: any) { return run(() => this.svc.createTransfer(ctx(r), b)); }

  // ---- physical inventory counts (§20) ----
  @Get('counts') @RequirePermission('inventory.stock.count') listCounts(@Req() r: any, @Query() q: any) { return run(() => this.svc.listCounts(ctx(r), q?.status)); }
  @Get('counts/:id') @RequirePermission('inventory.stock.count') getCount(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.getCount(ctx(r), id)); }
  @Post('counts') @RequirePermission('inventory.stock.count') createCount(@Req() r: any, @Body(ValidatedBody(INV_COUNT_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.createCount(ctx(r), b)); }
  @Post('counts/:id/lines') @RequirePermission('inventory.stock.count') enterCount(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INV_COUNT_LINES_BODY, { strict: true })) b: any) { return run(() => this.svc.enterCount(ctx(r), id, b)); }
  @Post('counts/:id/submit') @RequirePermission('inventory.stock.count') submitCount(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.submitCount(ctx(r), id)); }
  @Post('counts/:id/reconcile') @RequirePermission('inventory.stock.adjust') reconcileCount(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.reconcileCount(ctx(r), id)); }
  @Post('counts/:id/cancel') @RequirePermission('inventory.stock.count') cancelCount(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.cancelCount(ctx(r), id)); }

  // ---- service recipes (§13) ----
  @Get('recipes') @RequirePermission('inventory.view') listRecipes(@Req() r: any) { return run(() => this.svc.listServicesForRecipes(ctx(r))); }
  @Get('recipes/:serviceId') @RequirePermission('inventory.view') getRecipe(@Req() r: any, @Param('serviceId') id: string) { return run(() => this.svc.getServiceRecipe(ctx(r), id)); }
  @Put('recipes/:serviceId') @RequirePermission('inventory.update') setRecipe(@Req() r: any, @Param('serviceId') id: string, @Body(ValidatedBody(INV_RECIPE_BODY, { strict: true })) b: any) { return run(() => this.svc.setServiceRecipe(ctx(r), id, b)); }
  @Post('recipes/:serviceId/consume') @RequirePermission('inventory.product_usage.submit') consumeRecipe(@Req() r: any, @Param('serviceId') id: string, @Body(ValidatedBody(INV_CONSUME_BODY, { strict: true })) b: any) { return run(() => this.svc.consumeServiceRecipe(ctx(r), id, b?.multiplier)); }

  // ---- stock-threshold alert feed (§17) — persisted, acknowledgeable (distinct from live /alerts) ----
  @Get('alert-feed') @RequirePermission('inventory.view') listAlerts(@Req() r: any, @Query() q: any) { return run(() => this.svc.listAlerts(ctx(r), q?.includeAcknowledged !== 'false')); }
  @Post('alert-feed/:id/acknowledge') @RequirePermission('inventory.view') ackAlert(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.acknowledgeAlert(ctx(r), id)); }

  // ---- OCR receipt → expense (ai_ocr_receipt_scanner) ----
  @Post('receipt-expense') @RequirePermission('inventory.create') saveReceiptExpense(@Req() r: any, @Body(ValidatedBody(INV_RECEIPT_EXPENSE_BODY, { strict: true })) b: any) { return run(() => this.svc.saveReceiptExpense(ctx(r), b)); }
}
