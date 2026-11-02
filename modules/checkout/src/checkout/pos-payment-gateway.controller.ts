// pos-payment-gateway.controller.ts — tenant POS read of its OWN payment gateway (masked).
// Behind TenantAuthGuard (POS roles only) + RolePermissionGuard. The tenant is taken from the server-derived session
// (req.ctx.tenantId) and is NEVER accepted from the client, so a POS user can only ever see their own tenant's gateway
// — they cannot read another tenant's by guessing an id (Payment Gateway Isolation §6/§13). Secrets are never returned.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { PaymentGatewayResolver } from '@aipowersalon/payments';

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/payment-gateway')
export class PosPaymentGatewayController {
  constructor(private readonly gateway: PaymentGatewayResolver) {}

  @Get('status') @RequirePermission('settings.view')
  status(@Req() req: any) {
    return this.gateway.getMasked(req?.ctx?.tenantId);
  }
}
