// deals.owner.controller.ts — BUILD_PLAN Phase 5: deals in the Owner App. Route: owner/deals. The owner sees what deals
// gave away (net of refunds), what is live and the approval queue across the salon, and can approve, reject (with a
// reason the technician sees) or pause. Building and editing deals stays on the POS (pos/deals) — the owner app is the
// oversight-and-decide surface. Tenant/user come from the session; reads need owner.dashboard.view like the rest of
// the owner app, decisions need pos.marketing.manage like the same actions on the POS.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { REASON_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { DealsService, DealForbiddenError, DealValidationError, DealConflictError } from './deals.service';
import type { DealContext } from './deals.dto';
import { ListQueries } from '@aipowersalon/database';
import { DealsOwnerControllerListQueries } from './deals.owner.list-queries';

function ctxFrom(req: any): DealContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], technicianId: null };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof DealForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof DealValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof DealConflictError) throw new HttpException(e.message, HttpStatus.CONFLICT);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(DealsOwnerControllerListQueries)
@Controller('owner/deals')
export class DealsOwnerController {
  constructor(private readonly svc: DealsService) {}

  @Get('summary') @RequirePermission('owner.dashboard.view')
  summary(@Req() r: any, @Query('days') days?: string) { return run(() => this.svc.ownerSummary(ctxFrom(r), Number(days) || 30)); }

  @Post(':id/approve') @RequirePermission('pos.marketing.manage')
  approve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.approve(ctxFrom(r), id, b?.reason)); }

  @Post(':id/reject') @RequirePermission('pos.marketing.manage')
  reject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.reject(ctxFrom(r), id, b?.reason)); }

  @Post(':id/pause') @RequirePermission('pos.marketing.manage')
  pause(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.pause(ctxFrom(r), id)); }
}
