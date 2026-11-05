// catalog-screens.controller.ts — `/pos/catalog/*`, the read model + audited writes behind Services & Products, Service
// Categories, Service Pricing and Add-Ons (Oct 30 2026). TenantAuthGuard + RolePermissionGuard; tenant / branch / user
// from the session, never from the request.
//   pos.services.view           dashboard · charts · services · services/:id · history · categories(*) · add-ons(*)
//   pos.services.pricing.edit   PATCH services/:id/pricing (price / duration with a reason, conflict-checked)
//   pos.services.edit           POST categories/:id/reassign · add-on create / edit / archive / restore
//   customers.view              customer-history (what a customer was actually charged — PII)
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CATALOG_ADD_ON_CREATE_BODY, CATALOG_ADD_ON_STATE_BODY, CATALOG_ADD_ON_UPDATE_BODY, CATALOG_PRICING_BODY, CATALOG_PRICING_REVERT_BODY, CATALOG_PRICING_SCHEDULE_BODY, CATALOG_PRICING_SCHEDULE_CANCEL_BODY, CATALOG_REASSIGN_BODY } from '../request-schemas';
import { CatalogScreensRepository, SERVICE_STATUSES, SERVICE_SORTS, CATEGORY_SORTS, ADD_ON_SORTS, HISTORY_FIELDS, type CatCtx } from './catalog-screens.repository';

export const CATALOG_SCREENS = 'CatalogScreensRepository';
function ctxFrom(req: any): CatCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const per = (q: any) => ({ preset: s(q?.preset), from: s(q?.from), to: s(q?.to) });
const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const DATE = { type: 'enum', values: ['created', 'updated'] } as const;
const SERVICES_LIST = { filters: { preset: PRESET, status: { type: 'enum', values: SERVICE_STATUSES }, categoryId: { type: 'text', maxLength: 40 }, technician: { type: 'text', maxLength: 100 }, online: { type: 'enum', values: ['true', 'false'] },
  minPrice: { type: 'int', min: 0, max: 100000000 }, maxPrice: { type: 'int', min: 0, max: 100000000 }, minDuration: { type: 'int', min: 0, max: 1440 }, maxDuration: { type: 'int', min: 0, max: 1440 },
  dateField: DATE, sort: { type: 'enum', values: SERVICE_SORTS } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const HISTORY_LIST = { filters: { preset: PRESET, serviceId: { type: 'uuid' }, categoryId: { type: 'uuid' }, addOnKey: { type: 'text', maxLength: 64 }, field: { type: 'enum', values: HISTORY_FIELDS } },
  search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const CUSTOMER_LIST = { filters: { preset: PRESET, kind: { type: 'enum', values: ['service', 'add_on', 'retail', 'all'] } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const CATEGORY_LIST = { filters: { preset: PRESET, status: { type: 'enum', values: ['current', 'archived', 'all'] }, dateField: DATE, sort: { type: 'enum', values: CATEGORY_SORTS } },
  search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const ADD_ON_LIST = { filters: { preset: PRESET, status: { type: 'enum', values: ['active', 'inactive', 'all'] }, serviceId: { type: 'uuid' }, categoryId: { type: 'uuid' }, taxable: { type: 'enum', values: ['true', 'false'] },
  minPrice: { type: 'int', min: 0, max: 100000000 }, maxPrice: { type: 'int', min: 0, max: 100000000 }, dateField: DATE, sort: { type: 'enum', values: ADD_ON_SORTS } },
  search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const USAGE_LIST = { filters: { preset: PRESET, key: { type: 'text', maxLength: 64 }, dateField: { type: 'enum', values: ['paid', 'added'] } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/catalog')
export class CatalogScreensController {
  constructor(@Inject(CATALOG_SCREENS) private readonly repo: CatalogScreensRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The catalog needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('dashboard') @RequirePermission('pos.services.view')
  dashboard(@Req() req: any, @Query() q: any) { return this.r().dashboard(ctxFrom(req), per(q)); }

  @Get('charts') @RequirePermission('pos.services.view')
  charts(@Req() req: any, @Query() q: any) { return this.r().charts(ctxFrom(req), per(q)); }

  @Get('services') @RequirePermission('pos.services.view') @ListQuery(SERVICES_LIST)
  services(@Req() req: any, @Query() q: any) {
    return this.r().services(ctxFrom(req), { q: s(q?.q), technician: s(q?.technician), categoryId: s(q?.categoryId), status: s(q?.status), online: s(q?.online), minPrice: q?.minPrice, maxPrice: q?.maxPrice, minDuration: q?.minDuration, maxDuration: q?.maxDuration,
      dateField: s(q?.dateField), sort: s(q?.sort), ...per(q), page: q?.page, pageSize: q?.pageSize });
  }

  @Get('services/:serviceId') @RequirePermission('pos.services.view')
  service(@Req() req: any, @Param('serviceId') id: string) { return this.r().serviceDetail(ctxFrom(req), id); }

  @Patch('services/:serviceId/pricing') @RequirePermission('pos.services.pricing.edit')
  pricing(@Req() req: any, @Param('serviceId') id: string, @Body(ValidatedBody(CATALOG_PRICING_BODY, { strict: true })) b: any) { return this.r().updatePricing(ctxFrom(req), id, b || {}); }

  // D4 gaps (Nov 5 2026): the upcoming bookings a price / duration change would touch (read only), and revert of a change
  @Get('services/:serviceId/pricing-impact') @RequirePermission('pos.services.view') @ListQuery({ filters: { priceCents: { type: 'text', maxLength: 10 }, durationMinutes: { type: 'text', maxLength: 5 } } })
  pricingImpact(@Req() req: any, @Param('serviceId') id: string, @Query() q: any) { return this.r().pricingImpact(ctxFrom(req), id, { priceCents: s(q?.priceCents), durationMinutes: s(q?.durationMinutes) }); }

  @Post('services/:serviceId/pricing/schedule') @RequirePermission('pos.services.pricing.edit')
  schedulePricing(@Req() req: any, @Param('serviceId') id: string, @Body(ValidatedBody(CATALOG_PRICING_SCHEDULE_BODY, { strict: true })) b: any) { return this.r().schedulePricing(ctxFrom(req), id, b || {}); }

  @Post('services/:serviceId/pricing/schedule/cancel') @RequirePermission('pos.services.pricing.edit')
  cancelSchedule(@Req() req: any, @Param('serviceId') id: string, @Body(ValidatedBody(CATALOG_PRICING_SCHEDULE_CANCEL_BODY, { strict: true })) b: any) { return this.r().cancelScheduledPricing(ctxFrom(req), id, b || {}); }

  @Post('services/:serviceId/pricing/revert') @RequirePermission('pos.services.pricing.edit')
  revertPricing(@Req() req: any, @Param('serviceId') id: string, @Body(ValidatedBody(CATALOG_PRICING_REVERT_BODY, { strict: true })) b: any) { return this.r().revertPricing(ctxFrom(req), id, b || {}); }

  @Get('history') @RequirePermission('pos.services.view') @ListQuery(HISTORY_LIST)
  history(@Req() req: any, @Query() q: any) { return this.r().history(ctxFrom(req), { serviceId: s(q?.serviceId), categoryId: s(q?.categoryId), addOnKey: s(q?.addOnKey), field: s(q?.field), q: s(q?.q), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('customer-history') @RequirePermission('customers.view') @ListQuery(CUSTOMER_LIST)
  customerHistory(@Req() req: any, @Query() q: any) { return this.r().customerHistory(ctxFrom(req), { q: s(q?.q), kind: s(q?.kind), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('categories/summary') @RequirePermission('pos.services.view')
  categorySummary(@Req() req: any) { return this.r().categorySummary(ctxFrom(req)); }

  @Get('categories') @RequirePermission('pos.services.view') @ListQuery(CATEGORY_LIST)
  categories(@Req() req: any, @Query() q: any) { return this.r().categories(ctxFrom(req), { q: s(q?.q), status: s(q?.status), dateField: s(q?.dateField), sort: s(q?.sort), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('categories/:categoryId') @RequirePermission('pos.services.view') @ListQuery({ maxLimit: 50, defaultLimit: 8, params: ['page'] })
  category(@Req() req: any, @Param('categoryId') id: string, @Query() q: any) { return this.r().categoryDetail(ctxFrom(req), id, { page: q?.page, pageSize: q?.pageSize }); }

  @Post('categories/:categoryId/reassign') @RequirePermission('pos.services.edit')
  reassign(@Req() req: any, @Param('categoryId') id: string, @Body(ValidatedBody(CATALOG_REASSIGN_BODY, { strict: true })) b: any) { return this.r().reassign(ctxFrom(req), id, b || {}); }

  @Get('add-ons/summary') @RequirePermission('pos.services.view')
  addOnSummary(@Req() req: any) { return this.r().addOnSummary(ctxFrom(req)); }

  @Get('add-ons/usage') @RequirePermission('pos.services.view') @ListQuery(USAGE_LIST)
  addOnUsage(@Req() req: any, @Query() q: any) { return this.r().addOnUsage(ctxFrom(req), { q: s(q?.q), key: s(q?.key), dateField: s(q?.dateField), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('add-ons') @RequirePermission('pos.services.view') @ListQuery(ADD_ON_LIST)
  addOns(@Req() req: any, @Query() q: any) {
    return this.r().addOns(ctxFrom(req), { q: s(q?.q), status: s(q?.status), serviceId: s(q?.serviceId), categoryId: s(q?.categoryId), taxable: s(q?.taxable), minPrice: q?.minPrice, maxPrice: q?.maxPrice,
      dateField: s(q?.dateField), sort: s(q?.sort), ...per(q), page: q?.page, pageSize: q?.pageSize });
  }

  @Post('add-ons') @RequirePermission('pos.services.edit')
  createAddOn(@Req() req: any, @Body(ValidatedBody(CATALOG_ADD_ON_CREATE_BODY, { strict: true })) b: any) { return this.r().createAddOn(ctxFrom(req), b || {}); }

  @Get('add-ons/:key') @RequirePermission('pos.services.view')
  addOn(@Req() req: any, @Param('key') key: string) { return this.r().addOnDetail(ctxFrom(req), key); }

  @Patch('add-ons/:key') @RequirePermission('pos.services.edit')
  updateAddOn(@Req() req: any, @Param('key') key: string, @Body(ValidatedBody(CATALOG_ADD_ON_UPDATE_BODY, { strict: true })) b: any) { return this.r().updateAddOn(ctxFrom(req), key, b || {}); }

  @Post('add-ons/:key/archive') @RequirePermission('pos.services.edit')
  archiveAddOn(@Req() req: any, @Param('key') key: string, @Body(ValidatedBody(CATALOG_ADD_ON_STATE_BODY, { strict: true })) b: any) { return this.r().setAddOnActive(ctxFrom(req), key, false, b || {}); }

  @Post('add-ons/:key/restore') @RequirePermission('pos.services.edit')
  restoreAddOn(@Req() req: any, @Param('key') key: string, @Body(ValidatedBody(CATALOG_ADD_ON_STATE_BODY, { strict: true })) b: any) { return this.r().setAddOnActive(ctxFrom(req), key, true, b || {}); }
}
