// refunds-voids.controller.ts — GET /pos/refunds-voids/state (pos.checkout.view). Tenant/branch
// server-derived from req.ctx.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { RefundsVoidsService, RefundsVoidsForbiddenError } from './refunds-voids.service';
import type { RefundsVoidsContext } from './refunds-voids.dto';

function ctxFrom(req: any): RefundsVoidsContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/refunds-voids')
export class RefundsVoidsController {
  constructor(private readonly svc: RefundsVoidsService) {}

  @Get('state') @RequirePermission('pos.checkout.view')
  async state(@Req() r: any) {
    try { return await this.svc.getState(ctxFrom(r)); }
    catch (e) { if (e instanceof RefundsVoidsForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN); throw e; }
  }
}
