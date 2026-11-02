// pos-customer-payments.controller.ts — POS-staff read-only view of a specific customer's saved cards
// (GET /pos/customers/:customerId/payment-methods, pos.customers.view). Reuses the customer-payments repo
// via listForCustomer. Card management (add/remove/default) stays customer-side for PCI reasons.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Param, Post, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { CustomerPaymentMethodsService, WalletTopupService } from './customer-payments.service';
import { topUpView } from './customer-payments.controller';
import type { TopUpIntentList, TopUpResult } from '@aipowersalon/api-contracts/customer';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customers')
export class PosCustomerPaymentsController {
  constructor(private readonly methods: CustomerPaymentMethodsService, private readonly topup: WalletTopupService) {}
  @Get(':customerId/payment-methods') @RequirePermission('pos.customers.view')
  async list(@Req() r: any, @Param('customerId') customerId: string) {
    const c = r?.ctx || {};
    if (!c.tenantId || !c.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.FORBIDDEN), 'PERMISSION_DENIED');
    const cards = await this.methods.listForCustomer(c.tenantId, customerId);
    return { customerId, cards };
  }
  /** B-79 (Oct 23 2026): a customer's wallet top-ups and the staff Verify of one stuck in PROCESSING / UNKNOWN. Verify asks
   *  the salon's processor for ITS record of the intent (order id) and settles the intent — it never charges the card. */
  // pos.checkout.view, not pos.customers.view: a technician sees saved cards (masked) but never a customer's wallet funding
  @Get(':customerId/wallet/top-ups') @RequirePermission('pos.checkout.view')
  async topUps(@Req() r: any, @Param('customerId') customerId: string): Promise<TopUpIntentList> {
    const c = r?.ctx || {};
    if (!c.tenantId || !c.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.FORBIDDEN), 'PERMISSION_DENIED');
    return { customerId, items: (await this.topup.topUpsForCustomer(c.tenantId, customerId)).map(topUpView) };
  }
  @Post(':customerId/wallet/top-ups/:id/verify') @RequirePermission('pos.checkout.take_payment')
  async verifyTopUp(@Req() r: any, @Param('customerId') customerId: string, @Param('id') id: string): Promise<TopUpResult> {
    const c = r?.ctx || {};
    if (!c.tenantId || !c.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.FORBIDDEN), 'PERMISSION_DENIED');
    return this.topup.verifyForStaff(c.tenantId, customerId, id, c.userId);
  }
}
