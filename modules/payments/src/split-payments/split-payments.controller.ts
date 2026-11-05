// split-payments.controller.ts — GET /pos/payments/split-payments/state (pos.checkout.view).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SplitPaymentsService, SplitPaymentsForbiddenError } from './split-payments.service';
import type { SplitPaymentsContext } from './split-payments.dto';

function ctxFrom(req: any): SplitPaymentsContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/payments/split-payments')
export class SplitPaymentsController {
  constructor(private readonly svc: SplitPaymentsService) {}
  @Get('state') @RequirePermission('pos.checkout.view')
  async state(@Req() r: any) {
    try { return await this.svc.getState(ctxFrom(r)); }
    catch (e) { if (e instanceof SplitPaymentsForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN); throw e; }
  }
}
