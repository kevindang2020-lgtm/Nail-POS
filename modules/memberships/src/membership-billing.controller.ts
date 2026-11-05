// membership-billing.controller.ts — internal, shared-secret-guarded ingress for membership background jobs (same pattern
// as the AI-billing cron controllers). Disabled unless MEMBERSHIP_BILLING_SECRET is set AND the request carries the matching
// 'x-membership-billing-secret' header — never anonymous, never tenant-session (it's a system/scheduler surface). With
// no processor configured, run-renewals reports memberships as not-configured rather than charging anything. run-reminders
// sweeps renewal reminders across all tenants (in-app notifications only; cross-tenant read, per-tenant scoped writes).
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { BILLING_APPLY_BODY, BILLING_CARDPOINTE_BODY, BILLING_PRORATION_BODY, BILLING_RUN_BODY } from './request-schemas';
import { requireServiceCaller, ServiceAuthError, type ServiceScope } from '@aipowersalon/auth';
import { Controller, Post, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { MembershipBillingService } from './membership-billing.service';
import { MembershipCommsService } from './membership-comms.service';

/** Constitution 3 Step 6: the shared service-caller check, mapped to this route's HTTP errors. */
function serviceCaller(r: any, scope: ServiceScope, legacy: { name: string; secret: string | undefined; header: string }) {
  try { return requireServiceCaller(r, scope, legacy); }
  catch (e) { if (e instanceof ServiceAuthError) throw new HttpException(e.status === 403 ? 'Forbidden' : e.message, e.status); throw e; }
}

@Controller('internal/membership-billing')
export class MembershipBillingController {
  constructor(private readonly svc: MembershipBillingService, private readonly comms: MembershipCommsService) {}

  private guard(r: any): void {
    serviceCaller(r, 'membership_billing.run', { name: 'MEMBERSHIP_BILLING_SECRET', secret: process.env.MEMBERSHIP_BILLING_SECRET, header: 'x-membership-billing-secret' });
  }

  @Post('run-renewals')
  async run(@Req() r: any, @Body(ValidatedBody(BILLING_RUN_BODY)) b: any) {
    this.guard(r);
    return this.svc.runDueRenewals(new Date(), Math.min(500, Math.max(1, Number(b?.limit) || 100)));
  }

  @Post('run-reminders')
  async runReminders(@Req() r: any, @Body(ValidatedBody(BILLING_RUN_BODY)) b: any) {
    this.guard(r);
    return this.comms.runRenewalRemindersDue(new Date(), Math.min(60, Math.max(1, Number(b?.withinDays) || 7)), Math.min(2000, Math.max(1, Number(b?.limit) || 500)));
  }

  @Post('cardpointe')
  async cardpointe(@Req() r: any, @Body(ValidatedBody(BILLING_CARDPOINTE_BODY)) b: any) {
    this.guard(r);
    if (!b?.membershipId) throw new HttpException('membershipId required', HttpStatus.BAD_REQUEST);
    return this.svc.applyCardpointeRenewal(String(b.membershipId), b?.charge || {}, { attempt: Number(b?.attempt) || 1 });
  }

  @Post('apply')
  async apply(@Req() r: any, @Body(ValidatedBody(BILLING_APPLY_BODY)) b: any) {
    this.guard(r);
    if (!b?.membershipId || !b?.status) throw new HttpException('membershipId and status required', HttpStatus.BAD_REQUEST);
    return this.svc.applyRenewalResult(String(b.membershipId), { status: b.status, amountCents: b?.amountCents, processor: b?.processor, processorRef: b?.processorRef ?? null, declineReason: b?.declineReason ?? null }, { attempt: Number(b?.attempt) || 1 });
  }

  @Post('proration-preview')
  async proration(@Req() r: any, @Body(ValidatedBody(BILLING_PRORATION_BODY)) b: any) {
    this.guard(r);
    if (!b?.membershipId || b?.newPriceCents == null) throw new HttpException('membershipId and newPriceCents required', HttpStatus.BAD_REQUEST);
    return this.svc.previewProration(String(b.membershipId), Number(b.newPriceCents), b?.changeAt);
  }
}
