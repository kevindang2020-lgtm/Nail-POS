// customer-payments.controller.ts — /customer payment-methods + wallet/top-up. Customer resolved from the session.
import { Body, Controller, Delete, Get, HttpException, Param, Post, Req } from '@nestjs/common';
import { CustomerPaymentMethodsService, WalletTopupService, SavedCardError, SAVED_CARD_CONSENT_VERSION, type PayCtx, type TopUpIntent } from './customer-payments.service';
import type { TopUpIntentList, TopUpIntentView, TopUpResult } from '@aipowersalon/api-contracts/customer';
import { PaymentGatewayResolver } from '../payments/payment-gateway.resolver';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { ADD_CUSTOMER_PAYMENT_METHOD_BODY, WALLET_TOP_UP_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
function ctxFrom(req: any): PayCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, userId: c.userId, branchId: c.branchId ?? null }; }
const mapErr = (e: unknown): never => { if (e instanceof SavedCardError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; };
/** The wire view of an intent: money, status, processor reference — never the card token or the payment method's internals. */
export const topUpView = (i: TopUpIntent): TopUpIntentView => ({ id: i.id, amountCents: i.amountCents, currency: i.currency, status: i.status, createdAt: i.createdAt, settledAt: i.settledAt, processorTransactionId: i.processorTransactionId, respText: i.respText });

@Controller('customer')
export class CustomerPaymentsController {
  constructor(private readonly methods: CustomerPaymentMethodsService, private readonly topup: WalletTopupService, private readonly gateway: PaymentGatewayResolver) {}

  @Get('payment-methods') list(@Req() r: any) { return this.methods.list(ctxFrom(r)); }
  /** The salon's hosted card tokenizer (CardSecure iFrame) — where the add-card form is typed, so no card number reaches us. */
  // Fiserv §8: the tokenizer of the SAME merchant that will verify/charge the token, plus the consent text version the
  // app must show. available:false (with a reason) when the salon's gateway cannot be used — the app then shows
  // "card saving unavailable" and collects nothing.
  @Get('payment-methods/tokenizer') async tokenizer(@Req() r: any) { const c = ctxFrom(r); const t = await this.gateway.tokenizerUrl(c.tenantId, c.branchId); return { ...t, consentVersion: SAVED_CARD_CONSENT_VERSION }; }
  @Post('payment-methods') add(@Req() r: any, @Body(ValidatedBody(ADD_CUSTOMER_PAYMENT_METHOD_BODY, { strict: true })) b: any) { return this.methods.add(ctxFrom(r), b).catch(mapErr); }
  @Delete('payment-methods/:id') remove(@Req() r: any, @Param('id') id: string) { return this.methods.remove(ctxFrom(r), id); }
  @Post('payment-methods/:id/default') setDefault(@Req() r: any, @Param('id') id: string) { return this.methods.setDefault(ctxFrom(r), id); }
  @Post('wallet/top-up') topUp(@Req() r: any, @Body(ValidatedBody(WALLET_TOP_UP_BODY, { strict: true })) b: any) { return this.topup.topUp(ctxFrom(r), b); }
  /** B-79 (Oct 23 2026): my top-up intents, and "Check status" for one that is still being confirmed — asks the processor, never charges. */
  @Get('wallet/top-ups') async topUps(@Req() r: any): Promise<TopUpIntentList> { return { items: (await this.topup.myTopUps(ctxFrom(r))).map(topUpView) }; }
  @Post('wallet/top-ups/:id/verify') verifyTopUp(@Req() r: any, @Param('id') id: string): Promise<TopUpResult> { return this.topup.verifyMine(ctxFrom(r), id); }
}
