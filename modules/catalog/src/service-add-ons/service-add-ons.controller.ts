// service-add-ons.controller.ts — GET /pos/service-add-ons/state (pos.services.view).
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { ADD_ON_CREATE_BODY, ADD_ON_UPDATE_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Param, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ServiceAddOnsService, ServiceAddOnsForbiddenError, ServiceAddOnsValidationError } from './service-add-ons.service';
import type { ServiceAddOnsContext, CreateAddOnRequest, UpdateAddOnRequest } from './service-add-ons.dto';

function ctxFrom(req: any): ServiceAddOnsContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ServiceAddOnsForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ServiceAddOnsValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/service-add-ons')
export class ServiceAddOnsController {
  constructor(private readonly svc: ServiceAddOnsService) {}

  @Get('state') @RequirePermission('pos.services.view')
  async state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }

  @Post('') @RequirePermission('pos.services.edit')
  async create(@Req() r: any, @Body(ValidatedBody(ADD_ON_CREATE_BODY, { strict: true })) b: CreateAddOnRequest) { return run(() => this.svc.create(ctxFrom(r), b)); }

  @Patch(':addOnId') @RequirePermission('pos.services.edit')
  async update(@Req() r: any, @Param('addOnId') id: string, @Body(ValidatedBody(ADD_ON_UPDATE_BODY, { strict: true })) b: UpdateAddOnRequest) { return run(() => this.svc.update(ctxFrom(r), id, b)); }

  @Post(':addOnId/archive') @RequirePermission('pos.services.edit')
  async archive(@Req() r: any, @Param('addOnId') id: string) { return run(() => this.svc.archive(ctxFrom(r), id)); }

  @Post(':addOnId/reactivate') @RequirePermission('pos.services.edit')
  async reactivate(@Req() r: any, @Param('addOnId') id: string) { return run(() => this.svc.reactivate(ctxFrom(r), id)); }
}
