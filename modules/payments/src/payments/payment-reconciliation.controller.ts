// payment-reconciliation.controller.ts — `GET /pos/payments/reconciliation?from&to`.
// Tenant-scoped via the session (req.ctx.tenantId); a POS user only ever sees its own gateway reconciliation.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { PaymentReconciliationService } from '../payments/payment-reconciliation.service';
import { ListQueries } from '@aipowersalon/database';
import { PaymentReconciliationControllerListQueries } from './payment-reconciliation.list-queries';

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(PaymentReconciliationControllerListQueries)
@Controller('pos/payments')
export class PaymentReconciliationController {
  constructor(private readonly svc: PaymentReconciliationService) {}

  @Get('reconciliation') @RequirePermission('pos.reports.view')
  reconciliation(@Req() req: any, @Query() q: any) {
    return this.svc.summary(req?.ctx?.tenantId, q?.from, q?.to);
  }

  @Get('overview') @RequirePermission('pos.reports.view')
  overview(@Req() req: any) {
    return this.svc.overview(req?.ctx?.tenantId, req?.ctx?.branchId);
  }
}
