import { RequirePermission } from '@aipowersalon/permissions/guards';
// tech-cash-confirmation.controller.ts — Skip-the-Line cash confirmation, technician-facing (/tech). Technician derived
// from the session; backend verifies assignment + tenant/branch before closing the ticket.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { TECH_CASH_NOT_PAID_BODY } from '../request-schemas';
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { SkipLineCheckoutService } from './skip-line-checkout.service';
import { slcCtx, slcRun } from './skip-line-checkout.http';

@Controller('tech')
export class TechCashConfirmationController {
  constructor(private readonly svc: SkipLineCheckoutService) {}
  @RequirePermission('tech.cash.manage') @Get('me/cash-pending') pending(@Req() r: any) { return slcRun(() => this.svc.techCashPending(slcCtx(r))); }
  @RequirePermission('tech.cash.manage') @Get('tickets/:ticketId/cash-payment') cashPayment(@Req() r: any, @Param('ticketId') id: string) { return slcRun(() => this.svc.techCashPaymentForTicket(slcCtx(r), id)); }
  @RequirePermission('tech.cash.manage') @Post('tickets/:ticketId/confirm-cash-received') confirm(@Req() r: any, @Param('ticketId') id: string) { return slcRun(() => this.svc.confirmCashReceived(slcCtx(r), id)); }
  @RequirePermission('tech.cash.manage') @Post('tickets/:ticketId/report-cash-not-paid') notPaid(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(TECH_CASH_NOT_PAID_BODY, { strict: true })) b: any) { return slcRun(() => this.svc.reportCashNotPaid(slcCtx(r), id, b?.notes)); }
}
