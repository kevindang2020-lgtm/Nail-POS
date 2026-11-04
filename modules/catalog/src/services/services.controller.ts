// services.controller.ts — tenant POS Services HTTP surface (`/pos/services/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role come from req.ctx (session).
// NOTE: literal routes (state/kpis/search/export/categories/import) are declared BEFORE ':serviceId'
// so the param route never shadows them.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CATEGORY_ARCHIVE_BODY, CATEGORY_CREATE_BODY, CATEGORY_REORDER_BODY, CATEGORY_UPDATE_BODY, SERVICE_ADD_ONS_BODY, SERVICE_COMMISSION_BODY, SERVICE_CREATE_BODY, SERVICE_IMPORT_BODY, SERVICE_MAPPING_BODY, SERVICE_TAX_BODY, SERVICE_UPDATE_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ServicesService, ForbiddenError, ValidationError } from './services.service';
import type { ServicesContext } from './services.repository';
import type { ServiceFilters, CreateServiceRequest, UpdateServiceRequest } from './services.dto';
import { ListQueries } from '@aipowersalon/database';
import { ServicesControllerListQueries } from './services.list-queries';

function ctxFrom(req: any): ServicesContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId || null, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): ServiceFilters {
  const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v));
  return { search: q.search, categoryId: q.categoryId, status: q.status, taxable: q.taxable, bookingEnabled: q.bookingEnabled, checkoutEnabled: q.checkoutEnabled, onlineBookingEnabled: q.onlineBookingEnabled, aiBookingEnabled: q.aiBookingEnabled, priceMin: n(q.priceMin), priceMax: n(q.priceMax), durationMin: n(q.durationMin), durationMax: n(q.durationMax), missingMapping: q.missingMapping, missingPrice: q.missingPrice, missingDuration: q.missingDuration, technicianSkillGroup: q.technicianSkillGroup, page: n(q.page), pageSize: n(q.pageSize) };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError && (e as any).status === 409) throw new HttpException({ code: (e as any).apiCode, message: e.message }, HttpStatus.CONFLICT);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if ((e as any)?.apiCode === 'SERVICE_TAX_NOT_CONFIGURABLE') throw new HttpException({ code: 'SERVICE_TAX_NOT_CONFIGURABLE', message: (e as Error).message }, HttpStatus.CONFLICT);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(ServicesControllerListQueries)
@Controller('pos/services')
export class ServicesController {
  constructor(private readonly svc: ServicesService) {}

  // --- literal GETs first ---
  @Get('state') @RequirePermission('pos.services.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get('kpis') @RequirePermission('pos.services.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }
  @Get('search') @RequirePermission('pos.services.view') search(@Req() r: any, @Query() q: any) { return run(() => this.svc.search(ctxFrom(r), filtersFrom(q))); }
  @AsyncExport({ kind: 'pos.services.export' }) @Get('export') @RequirePermission('pos.services.export') export(@Req() r: any, @Query() q: any) { return run(() => this.svc.export(ctxFrom(r), filtersFrom(q))); }

  // --- categories (literals + params under /categories) ---
  @Get('categories') @RequirePermission('pos.services.view') cats(@Req() r: any) { return run(() => this.svc.listCategories(ctxFrom(r))); }
  @Post('categories') @RequirePermission('pos.services.edit') catCreate(@Req() r: any, @Body(ValidatedBody(CATEGORY_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.createCategory(ctxFrom(r), b?.name, b?.colorKey)); }
  @Post('categories/reorder') @RequirePermission('pos.services.edit') catReorder(@Req() r: any, @Body(ValidatedBody(CATEGORY_REORDER_BODY, { strict: true })) b: any) { return run(() => this.svc.reorderCategories(ctxFrom(r), b?.order || [])); }
  @Patch('categories/:categoryId') @RequirePermission('pos.services.edit') catUpdate(@Req() r: any, @Param('categoryId') id: string, @Body(ValidatedBody(CATEGORY_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.updateCategory(ctxFrom(r), id, b || {})); }
  @Post('categories/:categoryId/archive') @RequirePermission('pos.services.edit') catArchive(@Req() r: any, @Param('categoryId') id: string, @Body(ValidatedBody(CATEGORY_ARCHIVE_BODY, { strict: true })) b: any) { return run(() => this.svc.archiveCategory(ctxFrom(r), id, !!b?.confirm)); }

  // --- list + create + import ---
  @Get('') @RequirePermission('pos.services.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.list(ctxFrom(r), filtersFrom(q))); }
  @Post('') @RequirePermission('pos.services.create') create(@Req() r: any, @Body(ValidatedBody(SERVICE_CREATE_BODY, { strict: true })) b: CreateServiceRequest) { return run(() => this.svc.create(ctxFrom(r), b)); }
  @Post('import') @RequirePermission('pos.services.import') import(@Req() r: any, @Body(ValidatedBody(SERVICE_IMPORT_BODY, { strict: true })) b: any) { return run(() => this.svc.importCommit(ctxFrom(r), b?.csv || '')); }
  @Post('import/preview') @RequirePermission('pos.services.import') importPreview(@Req() r: any, @Body(ValidatedBody(SERVICE_IMPORT_BODY, { strict: true })) b: any) { return run(() => this.svc.importPreview(ctxFrom(r), b?.csv || '')); }
  @Post('import/commit') @RequirePermission('pos.services.import') importCommit(@Req() r: any, @Body(ValidatedBody(SERVICE_IMPORT_BODY, { strict: true })) b: any) { return run(() => this.svc.importCommit(ctxFrom(r), b?.csv || '')); }

  // --- :serviceId sub-resources (before bare :serviceId) ---
  @Get(':serviceId/add-ons') @RequirePermission('pos.services.view') gAddOns(@Req() r: any, @Param('serviceId') id: string) { return run(() => this.svc.getAddOns(ctxFrom(r), id)); }
  @Patch(':serviceId/add-ons') @RequirePermission('pos.services.edit') sAddOns(@Req() r: any, @Param('serviceId') id: string, @Body(ValidatedBody(SERVICE_ADD_ONS_BODY, { strict: true })) b: any) { return run(() => this.svc.setAddOns(ctxFrom(r), id, b?.addOns || [])); }
  @Get(':serviceId/technician-mapping') @RequirePermission('pos.services.view') gMap(@Req() r: any, @Param('serviceId') id: string) { return run(() => this.svc.getMapping(ctxFrom(r), id)); }
  @Patch(':serviceId/technician-mapping') @RequirePermission('pos.services.technician_mapping.edit') sMap(@Req() r: any, @Param('serviceId') id: string, @Body(ValidatedBody(SERVICE_MAPPING_BODY, { strict: true })) b: any) { return run(() => this.svc.setMapping(ctxFrom(r), id, b?.mapping || [])); }
  @Get(':serviceId/commission') @RequirePermission('pos.services.view') gComm(@Req() r: any, @Param('serviceId') id: string) { return run(() => this.svc.getCommission(ctxFrom(r), id)); }
  @Patch(':serviceId/commission') @RequirePermission('pos.services.commission.edit') sComm(@Req() r: any, @Param('serviceId') id: string, @Body(ValidatedBody(SERVICE_COMMISSION_BODY, { strict: true })) b: any) { return run(() => this.svc.setCommission(ctxFrom(r), id, b)); }
  @Get(':serviceId/tax') @RequirePermission('pos.services.view') gTax(@Req() r: any, @Param('serviceId') id: string) { return run(() => this.svc.getTax(ctxFrom(r), id)); }
  @Patch(':serviceId/tax') @RequirePermission('pos.services.edit') sTax(@Req() r: any, @Param('serviceId') id: string, @Body(ValidatedBody(SERVICE_TAX_BODY, { strict: true })) b: any) { return run(() => this.svc.setTax(ctxFrom(r), id, b)); }
  @Post(':serviceId/archive') @RequirePermission('pos.services.archive') archive(@Req() r: any, @Param('serviceId') id: string) { return run(() => this.svc.archive(ctxFrom(r), id)); }
  @Post(':serviceId/reactivate') @RequirePermission('pos.services.archive') reactivate(@Req() r: any, @Param('serviceId') id: string) { return run(() => this.svc.reactivate(ctxFrom(r), id)); }

  // --- bare :serviceId LAST ---
  @Get(':serviceId') @RequirePermission('pos.services.view') detail(@Req() r: any, @Param('serviceId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }
  @Patch(':serviceId') @RequirePermission('pos.services.edit') update(@Req() r: any, @Param('serviceId') id: string, @Body(ValidatedBody(SERVICE_UPDATE_BODY, { strict: true })) b: UpdateServiceRequest) { return run(() => this.svc.update(ctxFrom(r), id, b)); }
}
