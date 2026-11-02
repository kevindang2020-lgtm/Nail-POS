// refunds-voids.controller.ts — GET /pos/refunds-voids/state (pos.checkout.view). Tenant/branch
// server-derived from req.ctx.
// Refunds & Voids mandate (Oct 29 2026): RETIRED — it read only the newest 1,000 reversal PAYMENT rows (so a void counted
// its zero-amount record row, a pending or failed refund was invisible, and the KPIs had no period) and answered an empty
// list (a verified-looking $0.00) on a read error. The screen reads /pos/payments/refunds-voids/{summary,list,find,:kind/:id/detail}
// (finance-screens/refunds-voids-screen.*). The route stays declared (manifest) and answers 410 ENDPOINT_RETIRED.
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
    if (!ctxFrom(r).tenantId || !this.svc) throw new HttpException(new RefundsVoidsForbiddenError('Not authenticated').message, HttpStatus.FORBIDDEN);
    throw new HttpException({ code: 'ENDPOINT_RETIRED', message: 'Refunds & voids are read from /pos/payments/refunds-voids/summary, /list, /find and /:kind/:id/detail.' }, HttpStatus.GONE);
  }
}
