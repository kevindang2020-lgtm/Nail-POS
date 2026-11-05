// pos-customer-payments.controller.ts — POS-staff read-only view of a specific customer's saved cards
// (GET /pos/customers/:customerId/payment-methods, pos.customers.view). Reuses the customer-payments repo
// via listForCustomer. Card management (add/remove/default) stays customer-side for PCI reasons.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { CustomerPaymentMethodsService } from './customer-payments.service';

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customers')
export class PosCustomerPaymentsController {
  constructor(private readonly methods: CustomerPaymentMethodsService) {}
  @Get(':customerId/payment-methods') @RequirePermission('pos.customers.view')
  async list(@Req() r: any, @Param('customerId') customerId: string) {
    const c = r?.ctx || {};
    if (!c.tenantId || !c.userId) throw new HttpException('Not authenticated', HttpStatus.FORBIDDEN);
    const cards = await this.methods.listForCustomer(c.tenantId, customerId);
    return { customerId, cards };
  }
}
