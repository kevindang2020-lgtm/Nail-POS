// bundles.controller.ts — tenant POS Bundles HTTP surface (`/pos/bundles/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role come from req.ctx (session) — never the body.
// Literal routes (state/kpis) are declared BEFORE ':bundleId' so the param route never shadows them.
// Permissions are pos.bundles.* which security-core maps onto the existing services capability (reuse, no new grants).
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { BUNDLE_CREATE_BODY, BUNDLE_UPDATE_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { BundlesService, ForbiddenError, ValidationError } from './bundles.service';
import type { BundlesContext } from './bundles.repository';
import type { BundleFilters, CreateBundleRequest, UpdateBundleRequest } from './bundles.dto';
import { ListQueries } from '@aipowersalon/database';
import { BundlesControllerListQueries } from './bundles.list-queries';

function ctxFrom(req: any): BundlesContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): BundleFilters {
  return { search: q?.search, kind: q?.kind, status: q?.status, onlineOnly: q?.onlineOnly === 'true' || q?.onlineOnly === true };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(BundlesControllerListQueries)
@Controller('pos/bundles')
export class BundlesController {
  constructor(private readonly svc: BundlesService) {}

  // --- literal GETs first ---
  @Get('state') @RequirePermission('pos.bundles.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get('kpis') @RequirePermission('pos.bundles.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }

  // --- collection ---
  @Get('') @RequirePermission('pos.bundles.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.list(ctxFrom(r), filtersFrom(q))); }
  @Post('') @RequirePermission('pos.bundles.create') create(@Req() r: any, @Body(ValidatedBody(BUNDLE_CREATE_BODY, { strict: true })) b: CreateBundleRequest) { return run(() => this.svc.create(ctxFrom(r), b)); }

  // --- per-bundle lifecycle (literal sub-paths before the bare :bundleId) ---
  @Post(':bundleId/archive') @RequirePermission('pos.bundles.archive') archive(@Req() r: any, @Param('bundleId') id: string) { return run(() => this.svc.archive(ctxFrom(r), id)); }
  @Post(':bundleId/reactivate') @RequirePermission('pos.bundles.archive') reactivate(@Req() r: any, @Param('bundleId') id: string) { return run(() => this.svc.reactivate(ctxFrom(r), id)); }

  // --- item routes ---
  @Get(':bundleId') @RequirePermission('pos.bundles.view') detail(@Req() r: any, @Param('bundleId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }
  @Patch(':bundleId') @RequirePermission('pos.bundles.edit') update(@Req() r: any, @Param('bundleId') id: string, @Body(ValidatedBody(BUNDLE_UPDATE_BODY, { strict: true })) b: UpdateBundleRequest) { return run(() => this.svc.update(ctxFrom(r), id, b)); }
}
