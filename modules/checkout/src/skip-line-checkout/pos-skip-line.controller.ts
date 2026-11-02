import { RequirePermission } from '@aipowersalon/permissions/guards';
// pos-skip-line.controller.ts — Skip-the-Line surfacing for POS (/pos). Front-desk visibility + control over app payments.
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { SkipLineCheckoutService } from './skip-line-checkout.service';
import type { AppPaymentVerifyResponse } from '@aipowersalon/api-contracts/tenant';
import { slcCtx, slcRun } from './skip-line-checkout.http';

@Controller('pos')
export class PosSkipLineController {
  constructor(private readonly svc: SkipLineCheckoutService) {}
  @RequirePermission('checkout.view') @Get('checkout/skip-line/state') state(@Req() r: any) { return slcRun(() => this.svc.posSkipLineState(slcCtx(r))); }
  @RequirePermission('checkout.view') @Get('tickets/:ticketId/payment-status') paymentStatus(@Req() r: any, @Param('ticketId') id: string) { return slcRun(() => this.svc.posTicketPaymentStatus(slcCtx(r), id)); }
  @RequirePermission('checkout.process_payment') @Post('tickets/:ticketId/send-app-payment') send(@Req() r: any, @Param('ticketId') id: string) { return slcRun(() => this.svc.sendAppPayment(slcCtx(r), id)); }
  /** B-80 (Oct 23 2026): Verify a Skip-the-Line app charge whose answer was lost — asks the processor, never charges. */
  @RequirePermission('checkout.process_payment') @Post('tickets/:ticketId/verify-app-payment') verify(@Req() r: any, @Param('ticketId') id: string): Promise<AppPaymentVerifyResponse> { return slcRun(() => this.svc.posVerifyAppPayment(slcCtx(r), id)); }
  @RequirePermission('checkout.process_payment') @Post('tickets/:ticketId/cancel-app-payment') cancel(@Req() r: any, @Param('ticketId') id: string) { return slcRun(() => this.svc.cancelAppPayment(slcCtx(r), id)); }
  @RequirePermission('checkout.process_payment') @Post('tickets/:ticketId/move-to-front-desk-checkout') moveFrontDesk(@Req() r: any, @Param('ticketId') id: string) { return slcRun(() => this.svc.cancelAppPayment(slcCtx(r), id)); }
}
