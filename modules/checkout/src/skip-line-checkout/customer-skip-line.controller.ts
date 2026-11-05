// customer-skip-line.controller.ts — Skip-the-Line Checkout, customer-facing (/customer). Customer is derived from the
// session. "invoiceId" == ticketId; "paymentId" == payment-intent id. Card/app charge (start/confirm) lands next.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { SKIP_CONFIRM_BODY, SKIP_START_BODY } from '../request-schemas';
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { SkipLineCheckoutService } from './skip-line-checkout.service';
import { slcCtx, slcRun } from './skip-line-checkout.http';

@Controller('customer')
export class CustomerSkipLineController {
  constructor(private readonly svc: SkipLineCheckoutService) {}
  @Get('me/active-bill') activeBill(@Req() r: any) { return slcRun(() => this.svc.customerActiveBill(slcCtx(r))); }
  @Post('payments/:invoiceId/pay-cash-to-tech') payCash(@Req() r: any, @Param('invoiceId') id: string) { return slcRun(() => this.svc.payCashToTech(slcCtx(r), id)); }
  @Post('payments/:invoiceId/start') start(@Req() r: any, @Param('invoiceId') id: string, @Body(ValidatedBody(SKIP_START_BODY)) b: any) { return slcRun(() => this.svc.startAppPayment(slcCtx(r), id, b || {})); }
  @Post('payments/:invoiceId/confirm') confirm(@Req() r: any, @Param('invoiceId') id: string, @Body(ValidatedBody(SKIP_CONFIRM_BODY)) b: any) { return slcRun(() => this.svc.confirmAppPayment(slcCtx(r), id, b || {})); }
  @Get('payments/:paymentId/status') status(@Req() r: any, @Param('paymentId') id: string) { return slcRun(() => this.svc.paymentStatus(slcCtx(r), id)); }
}
