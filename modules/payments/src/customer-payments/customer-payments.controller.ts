// customer-payments.controller.ts — /customer payment-methods + wallet/top-up. Customer resolved from the session.
import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { CustomerPaymentMethodsService, WalletTopupService, type PayCtx, type TopUpIntent } from './customer-payments.service';
import type { TopUpIntentList, TopUpIntentView, TopUpResult } from '@aipowersalon/api-contracts/customer';
import { PaymentGatewayResolver } from '../payments/payment-gateway.resolver';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { ADD_CUSTOMER_PAYMENT_METHOD_BODY, WALLET_TOP_UP_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
function ctxFrom(req: any): PayCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, userId: c.userId }; }
/** The wire view of an intent: money, status, processor reference — never the card token or the payment method's internals. */
export const topUpView = (i: TopUpIntent): TopUpIntentView => ({ id: i.id, amountCents: i.amountCents, currency: i.currency, status: i.status, createdAt: i.createdAt, settledAt: i.settledAt, processorTransactionId: i.processorTransactionId, respText: i.respText });

@Controller('customer')
export class CustomerPaymentsController {
  constructor(private readonly methods: CustomerPaymentMethodsService, private readonly topup: WalletTopupService, private readonly gateway: PaymentGatewayResolver) {}

  @Get('payment-methods') list(@Req() r: any) { return this.methods.list(ctxFrom(r)); }
  /** The salon's hosted card tokenizer (CardSecure iFrame) — where the add-card form is typed, so no card number reaches us. */
  @Get('payment-methods/tokenizer') tokenizer(@Req() r: any) { return this.gateway.tokenizerUrl(ctxFrom(r).tenantId); }
  @Post('payment-methods') add(@Req() r: any, @Body(ValidatedBody(ADD_CUSTOMER_PAYMENT_METHOD_BODY, { strict: true })) b: any) { return this.methods.add(ctxFrom(r), b); }
  @Delete('payment-methods/:id') remove(@Req() r: any, @Param('id') id: string) { return this.methods.remove(ctxFrom(r), id); }
  @Post('payment-methods/:id/default') setDefault(@Req() r: any, @Param('id') id: string) { return this.methods.setDefault(ctxFrom(r), id); }
  @Post('wallet/top-up') topUp(@Req() r: any, @Body(ValidatedBody(WALLET_TOP_UP_BODY, { strict: true })) b: any) { return this.topup.topUp(ctxFrom(r), b); }
  /** B-79 (Oct 23 2026): my top-up intents, and "Check status" for one that is still being confirmed — asks the processor, never charges. */
  @Get('wallet/top-ups') async topUps(@Req() r: any): Promise<TopUpIntentList> { return { items: (await this.topup.myTopUps(ctxFrom(r))).map(topUpView) }; }
  @Post('wallet/top-ups/:id/verify') verifyTopUp(@Req() r: any, @Param('id') id: string): Promise<TopUpResult> { return this.topup.verifyMine(ctxFrom(r), id); }
}
