// tenant-locations.controller.ts — /tenant/locations CRUD + geocode + map-pin + confirm + publish.
// Behind TenantAuthGuard + RolePermissionGuard. Tenant scope comes from the session (never the client).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ListQuery } from '@aipowersalon/database';
import { LOC_STATUS_FILTERS, LOC_MAP_FILTERS, LOC_BOOKING_FILTERS } from './location-core';
import { TenantLocationService, LocationError } from './tenant-location.service';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { APPLY_ADDRESS_BODY, GEOCODE_BODY, LOCATION_CREATE_BODY, LOCATION_UPDATE_BODY, MAP_PIN_BODY } from '../request-schemas';

function ctxFrom(req: any) {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof LocationError) throw new HttpException({ ok: false, message: e.message, ...(e.extra || {}) }, e.status); throw e; }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('tenant/locations')
export class TenantLocationsController {
  constructor(private readonly svc: TenantLocationService) {}

  // Salon Locations guide (Nov 9 2026): optional server search / filters / From–To / sort / pages; no `page` = the full list
  @Get('') @RequirePermission('locations.view')
  @ListQuery({ filters: { status: { type: 'enum', values: LOC_STATUS_FILTERS }, map: { type: 'enum', values: LOC_MAP_FILTERS }, booking: { type: 'enum', values: LOC_BOOKING_FILTERS }, dateField: { type: 'enum', values: ['created', 'updated'] } },
    sorts: { newest: null, oldest: null, name_asc: null, name_desc: null, updated: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const)
  list(@Req() r: any, @Query() q: any) { return run(() => this.svc.list(ctxFrom(r), q && Object.keys(q).length ? q : undefined)); }

  @Post('') @RequirePermission('locations.create')
  create(@Req() r: any, @Body(ValidatedBody(LOCATION_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.create(ctxFrom(r), b)); }

  @Post('geocode') @RequirePermission('locations.update')
  geocode(@Req() r: any, @Body(ValidatedBody(GEOCODE_BODY, { strict: true })) b: any) { return run(() => this.svc.geocode(ctxFrom(r), String(b?.query || ''))); }

  @Get(':id') @RequirePermission('locations.view')
  get(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.get(ctxFrom(r), id)); }

  @Patch(':id') @RequirePermission('locations.update')
  update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(LOCATION_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.update(ctxFrom(r), id, b)); }

  @Post(':id/apply-address') @RequirePermission('locations.map.update')
  applyAddress(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(APPLY_ADDRESS_BODY, { strict: true })) b: any) { return run(() => this.svc.applyAddress(ctxFrom(r), id, b?.hit ?? b)); }

  @Patch(':id/map-pin') @RequirePermission('locations.map.update')
  mapPin(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MAP_PIN_BODY, { strict: true })) b: any) { return run(() => this.svc.setMapPin(ctxFrom(r), id, Number(b?.latitude), Number(b?.longitude), b?.source)); }

  @Post(':id/confirm-pin') @RequirePermission('locations.map.update')
  confirmPin(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.confirmPin(ctxFrom(r), id)); }

  @Post(':id/publish') @RequirePermission('locations.publish')
  publish(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.publish(ctxFrom(r), id)); }

  @Post(':id/unpublish') @RequirePermission('locations.unpublish')
  unpublish(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.unpublish(ctxFrom(r), id)); }

  @Get(':id/public-preview') @RequirePermission('locations.view')
  preview(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.publicPreview(ctxFrom(r), id)); }
}
