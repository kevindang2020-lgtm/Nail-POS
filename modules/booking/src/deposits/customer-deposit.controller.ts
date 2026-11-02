// customer-deposit.controller.ts — D11 (Oct 21 2026): the customer pays the deposit the salon asked for at booking, from the
// app, with the hosted tokenizer's token (the raw card never reaches us). Only the customer's OWN appointment.
import { Body, Controller, Get, HttpException, Param, Post, Req } from '@nestjs/common';
import { Idempotent } from '@aipowersalon/database/nest';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CUSTOMER_DEPOSIT_PAY_BODY } from '../request-schemas';
import { BookingDepositService, DepositError } from './booking-deposit.service';
import type { CustomerBookingDataPort, CustomerBookingContext } from '../customer-booking/customer-booking.repository';
import { Inject } from '@nestjs/common';

function ctxFrom(req: any): CustomerBookingContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId }; }

@Controller('customer/booking')
export class CustomerDepositController {
  constructor(private readonly deposits: BookingDepositService, @Inject('CustomerBookingDataPort') private readonly repo: CustomerBookingDataPort) {}

  private async own(ctx: CustomerBookingContext, appointmentId: string) {
    const customer = await this.repo.resolveCustomerId(ctx);
    if (!customer) throw new HttpException('No customer profile is linked to this account.', 403);
    const d = await this.deposits.forAppointment(ctx, appointmentId);
    if (!d) throw new HttpException('No deposit on this booking.', 404);
    const mine = this.repo.appointmentBelongsToCustomer ? await this.repo.appointmentBelongsToCustomer(ctx, appointmentId, customer.id) : true;
    if (!mine) throw new HttpException('No deposit on this booking.', 404);
    return d;
  }

  @Get('appointments/:id/deposit')
  async status(@Req() r: any, @Param('id') id: string) { return this.own(ctxFrom(r), id); }

  @Post('appointments/:id/deposit') @Idempotent()
  async pay(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(CUSTOMER_DEPOSIT_PAY_BODY, { strict: true })) b: any) {
    const ctx = ctxFrom(r);
    const d = await this.own(ctx, id);
    try { return await this.deposits.pay(ctx, d.depositId, { token: String(b?.cardToken ?? ''), expiry: b?.expiry ? String(b.expiry) : undefined, cvv: b?.cvv ? String(b.cvv) : undefined, name: b?.cardholderName ? String(b.cardholderName) : undefined }); }
    catch (e) { if (e instanceof DepositError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; }
  }
}
