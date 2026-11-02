// split-payments.controller.ts — GET /pos/payments/split-payments/state (pos.checkout.view).
// Split Payments mandate (Oct 29 2026): RETIRED — it grouped the newest 2,000 payment rows in memory and answered an empty
// list (a verified-looking 0) on a read error. The screen reads /pos/payments/split-payments/{summary,list,:id/detail}
// (finance-screens/split-payments-screen.*). The route stays declared (manifest) and answers 410 ENDPOINT_RETIRED.
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
    if (!ctxFrom(r).tenantId || !this.svc) throw new HttpException(new SplitPaymentsForbiddenError('Not authenticated').message, HttpStatus.FORBIDDEN);
    throw new HttpException({ code: 'ENDPOINT_RETIRED', message: 'Split payments are read from /pos/payments/split-payments/summary, /list and /:ticketId/detail.' }, HttpStatus.GONE);
  }
}
