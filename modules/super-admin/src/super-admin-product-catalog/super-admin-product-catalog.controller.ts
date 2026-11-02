import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { CatalogOversightService, type CatalogQuery } from './super-admin-product-catalog.service';
import { MasterProductService } from './product-master.service';
import { ProductImportService } from './product-import.service';
import { ProductDistributionService } from './product-distribution.service';
import { ProductBarcodeService } from './product-barcode.service';
import { ListQueries } from '@aipowersalon/database';
import { SuperAdminProductCatalogControllerListQueries } from './super-admin-product-catalog.list-queries';
import { PC_BARCODE_BODY, PC_DISTRIBUTE_BODY, PC_IMPORT_BODY, PC_MASTER_BODY, PC_RETIRE_BODY } from '../request-schemas-ops';   // BUILD_PLAN Phase 12 (#17)

const int = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const centsOrNull = (v: unknown): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? Math.round(n) : NaN as unknown as number; };
const actorId = (req: any): string | null => req?.ctx?.userId || req?.user?.id || null;

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminProductCatalogControllerListQueries)
@Controller('super-admin')
export class SuperAdminProductCatalogController {
  constructor(private readonly svc: CatalogOversightService, private readonly master: MasterProductService, private readonly imports: ProductImportService, private readonly distribution: ProductDistributionService, private readonly barcodes: ProductBarcodeService) {}

  @Get('product-catalog/overview')
  async overview(@Query() q: any) {
    const query: CatalogQuery = {
      tenantId: q?.tenantId || undefined, categoryId: q?.categoryId || undefined, brandId: q?.brandId || undefined,
      vendorId: q?.vendorId || undefined, status: q?.status || undefined, search: q?.search || undefined,
      duplicateOnly: q?.duplicateOnly === 'true' || q?.duplicateOnly === true,
      sort: q?.sort || undefined, direction: q?.direction === 'desc' ? 'desc' : 'asc',
      page: int(q?.page), pageSize: int(q?.pageSize),
    };
    const importErrors = await this.imports.openErrorCount();
    return this.svc.getOverview(query, { importErrors });
  }

  // ---- Import pipeline ----
  @Get('product-catalog/imports')
  listImports(@Query() q: any) { return this.imports.listJobs({ status: q?.status || undefined, cap: int(q?.cap) }); }

  @Get('product-catalog/imports/errors')
  listImportErrors(@Query() q: any) { return this.imports.listErrors({ jobId: q?.jobId || undefined, status: q?.status || undefined, cap: int(q?.cap) }); }

  @Post('product-catalog/imports')
  createImport(@Body(ValidatedBody(PC_IMPORT_BODY, { strict: true })) body: any, @Req() req: any) {
    return this.imports.createImport({
      source: body?.source, filename: body?.filename ?? null, rows: Array.isArray(body?.rows) ? body.rows : [],
      requireBarcode: body?.requireBarcode === true, idempotencyKey: body?.idempotencyKey ?? null, createdByUserId: actorId(req),
    });
  }

  @Post('product-catalog/imports/:id/approve')
  approveImport(@Param('id') id: string) { return this.imports.approveImport(id); }

  @Post('product-catalog/imports/errors/:id/retry')
  retryImportError(@Param('id') id: string) { return this.imports.retryError(id); }

  // ---- Distribution (push optional products to tenants) ----
  @Get('product-catalog/distributions')
  listDistributions(@Query() q: any) { return this.distribution.list({ masterProductId: q?.masterProductId || undefined, tenantId: q?.tenantId || undefined, cap: int(q?.cap) }); }

  @Post('product-catalog/distributions')
  distribute(@Body(ValidatedBody(PC_DISTRIBUTE_BODY, { strict: true })) body: any, @Req() req: any) {
    return this.distribution.distribute({
      masterProductId: body?.masterProductId, tenantIds: Array.isArray(body?.tenantIds) ? body.tenantIds : [],
      reason: body?.reason, skipExisting: body?.skipExisting !== false, createdByUserId: actorId(req),
    });
  }

  // ---- Barcode management ----
  @Get('product-catalog/products/:id/barcodes')
  listBarcodes(@Param('id') id: string) { return this.barcodes.list(id); }

  @Post('product-catalog/products/:id/barcodes')
  addBarcode(@Param('id') id: string, @Body(ValidatedBody(PC_BARCODE_BODY, { strict: true })) body: any, @Req() req: any) {
    return this.barcodes.addBarcode({
      masterProductId: id, barcode: body?.barcode, reason: body?.reason, isPrimary: body?.isPrimary === true,
      source: body?.source, requireChecksum: body?.requireChecksum === true, createdByUserId: actorId(req),
    });
  }

  @Get('product-catalog/products')
  listMasters(@Query() q: any) { return this.master.list({ status: q?.status || undefined, search: q?.search || undefined, cap: int(q?.cap) }); }

  @Post('product-catalog/products')
  createMaster(@Body(ValidatedBody(PC_MASTER_BODY, { strict: true })) body: any, @Req() req: any) {
    return this.master.create({
      name: body?.name, code: body?.code, brandName: body?.brandName, sku: body?.sku, manufacturerSku: body?.manufacturerSku,
      upc: body?.upc, barcode: body?.barcode, categoryName: body?.categoryName, productType: body?.productType,
      description: body?.description, costCents: centsOrNull(body?.costCents), suggestedRetailCents: centsOrNull(body?.suggestedRetailCents),
      currency: body?.currency, taxCategory: body?.taxCategory, inventoryUnit: body?.inventoryUnit, vendorName: body?.vendorName,
      confirmDuplicates: body?.confirmDuplicates === true || body?.confirmDuplicates === 'true',
      createdByUserId: actorId(req),
    });
  }

  @Post('product-catalog/products/:id/retire')
  retireMaster(@Param('id') id: string, @Body(ValidatedBody(PC_RETIRE_BODY, { strict: true })) body: any, @Req() req: any) {
    return this.master.retire(id, body?.reason || '', actorId(req));
  }
}
