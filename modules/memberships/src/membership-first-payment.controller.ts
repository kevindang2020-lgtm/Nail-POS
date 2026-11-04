// membership-first-payment.controller.ts — D6 Membership guide §16 (Nov 4 2026): a membership with a price and no trial
// starts PENDING and is activated only by a CONFIRMED first payment:
//   GET  /pos/memberships/members/:membershipId/first-payment   pos.memberships.view    what is owed + how it can be paid
//   POST /pos/memberships/members/:membershipId/first-payment   pos.memberships.manage  collect it (card on file | paid invoice)
// Idempotent (Idempotency-Key, and the payment row's own key per membership): a double tap never charges twice.
import { Idempotent } from '@aipowersalon/database/nest';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { MembershipBillingService, FirstPaymentError, type FirstPaymentCtx } from './membership-billing.service';
import { FIRST_PAYMENT_BODY } from './request-schemas';

const ctxFrom = (req: any): FirstPaymentCtx => ({ tenantId: req?.ctx?.tenantId, userId: req?.ctx?.userId ?? null, role: req?.ctx?.role ?? null });
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof FirstPaymentError || (e?.apiCode && Number.isInteger(e?.status))) throw new HttpException({ code: e.apiCode, message: e.message, ...(e.details ?? {}) }, e.status);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('memberships')
@Controller('pos/memberships/members')
export class MembershipFirstPaymentController {
  constructor(private readonly svc: MembershipBillingService) {}

  @Get(':membershipId/first-payment') @RequirePermission('pos.memberships.view')
  state(@Req() r: any, @Param('membershipId') id: string) { return run(() => this.svc.firstPaymentState(ctxFrom(r), id)); }

  @Idempotent() @Post(':membershipId/first-payment') @RequirePermission('pos.memberships.manage')
  collect(@Req() r: any, @Param('membershipId') id: string, @Body(ValidatedBody(FIRST_PAYMENT_BODY, { strict: true })) b: any) { return run(() => this.svc.collectFirstPayment(ctxFrom(r), id, b ?? {})); }
}
