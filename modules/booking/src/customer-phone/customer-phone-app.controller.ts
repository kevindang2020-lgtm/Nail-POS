// customer-phone-app.controller.ts — the CUSTOMER changes their own number, from the app.
//
// Same canonical service as the receptionist. The ONLY difference is `source: 'customer_app'`, which the pure core
// turns into a different activation policy:
//
//     staff_pos     -> save_pending_then_verify   (the customer is standing there; a mistype can be retyped)
//     customer_app  -> verify_then_activate       (the customer is ALONE with their phone)
//
// That difference is the whole safety argument for this surface. If the customer mistypes a digit and we swapped
// the number immediately, we would have cut them off from their own account AND from every future code -- including
// the one that would let them fix it. The old number stays live until the new one answers.
//
// ── The line that must never move ───────────────────────────────────────────────────────────────────────
// The customer is resolved from the SESSION. Never from the body, never from a path parameter. A customerId taken
// from the request is a customerId an attacker chooses -- and this endpoint changes where a person's booking codes
// and appointment reminders are delivered.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { LOGIN_NUMBER_BODY, PHONE_CODE_BODY, PHONE_SEND_BODY, PHONE_SESSION_BODY, PHONE_START_BODY, PHONE_VERIFY_BODY } from '../request-schemas';
import { phoneUpdateHttpError } from './customer-phone-http';
import { Body, Controller, Get, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { CustomerPhoneUpdateService, PhoneUpdateError } from './customer-phone-update.service';
import { CustomerIdentityPhoneService, IdentityPhoneError } from './customer-identity-phone.service';

/**
 * Resolves the SIGNED-IN customer's own customer record for this tenant.
 *
 * A port, so the controller cannot be handed a customerId from the request. That is the whole point: a customerId
 * taken from the body is a customerId an ATTACKER chooses, on an endpoint that decides where a person's booking
 * codes and appointment reminders are delivered.
 */
export interface SessionCustomerResolver {
  resolveCustomerId(ctx: { tenantId: string; userId: string }): Promise<string | null>;
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof PhoneUpdateError) throw phoneUpdateHttpError(e);   // one mapping for both controllers
    throw e;
  }
}

@Controller('customer/profile/phone')
export class CustomerPhoneAppController {
  constructor(
    private readonly svc: CustomerPhoneUpdateService,
    @Inject('SessionCustomerResolver') private readonly customers: SessionCustomerResolver,
    private readonly identity: CustomerIdentityPhoneService,
  ) {}

  /**
   * Change the number you SIGN IN with.
   *
   * Separate from the contact-number change above, because it is a different thing with a different threat. That
   * one risks a mistyped digit. This one risks ACCOUNT TAKEOVER: an attacker on a stolen session moves the login
   * phone to their own and owns the account.
   *
   * So: reauthenticate (a session is not enough), require a number ALREADY proved by SMS upstream, notify the OLD
   * number BEFORE the change, and revoke every session after it.
   */
  @Post('login-number')
  async changeLoginNumber(@Req() r: any, @Body(ValidatedBody(LOGIN_NUMBER_BODY, { strict: true })) b: any) {
    const c = r?.ctx || {};
    try {
      return await this.identity.changeLoginPhone({
        userId: c.userId,
        tenantId: c.tenantId ?? null,
        currentPassword: String(b?.currentPassword ?? ''),
        // Must already have been verified by the flow above. This endpoint does not send or check a code -- so
        // there is no path here that can move a login credential without a completed verification before it.
        verifiedNewPhone: String(b?.phone ?? ''),
      });
    } catch (e: any) {
      if (e instanceof IdentityPhoneError) {
        const status =
          e.code === 'reauth_required' ? HttpStatus.UNAUTHORIZED
          : e.code === 'in_use' ? HttpStatus.CONFLICT
          : e.code === 'forbidden' ? HttpStatus.FORBIDDEN
          : e.code === 'not_verified' ? HttpStatus.CONFLICT
          : e.code === 'notify_unavailable' ? HttpStatus.SERVICE_UNAVAILABLE
          : HttpStatus.BAD_REQUEST;
        throw new HttpException({ code: e.code, message: e.message }, status);
      }
      throw e;
    }
  }

  /**
   * The customer's own customer record for THIS tenant.
   *
   * Resolved from the session. This is the check that makes "change my phone" mean *mine* -- without it, the
   * endpoint would happily change somebody else's.
   */
  private async me(r: any): Promise<{ tenantId: string; branchId: string | null; customerId: string; userId: string }> {
    const c = r?.ctx || {};
    const customerId = await this.customers.resolveCustomerId({ tenantId: c.tenantId, userId: c.userId });
    if (!customerId) throw new HttpException('Not a customer account.', HttpStatus.FORBIDDEN);
    return { tenantId: c.tenantId, branchId: c.branchId || null, customerId, userId: c.userId ?? '' };   // '' means no branch
  }

  private ctx(m: { tenantId: string; branchId: string | null; userId: string }) {
    return {
      tenantId: m.tenantId,
      branchId: m.branchId,
      userId: m.userId,
      // The customer may change their OWN number. They may not resolve a duplicate or manually confirm anything --
      // those are judgements about somebody ELSE's record, and the capability matrix refuses them.
      role: 'CUSTOMER' as const,
      source: 'customer_app' as const,
    };
  }

  /**
   * BUILD_PLAN Phase 4: "verify the number I already have" — the canonical home of what was /customer/verify/phone
   * (removed: a second route family for the same flow). A code to the number on the profile, through the one change
   * service: on the salon's Twilio, with the same limits; the number becomes active_verified.
   */
  @Post('verify-current/request')
  async verifyCurrentRequest(@Req() r: any) {
    const m = await this.me(r);
    return run(async () => { const x = await this.svc.requestCurrentVerification(this.ctx(m), m.customerId); return { ok: x.ok, ...(x.verified ? { verified: true } : {}), ...(x.message ? { message: x.message } : {}) }; });
  }

  @Post('verify-current/confirm')
  async verifyCurrentConfirm(@Req() r: any, @Body(ValidatedBody(PHONE_CODE_BODY, { strict: true })) b: any) {
    const m = await this.me(r);
    return run(() => this.svc.confirmCurrentVerification(this.ctx(m), m.customerId, String(b?.code ?? '').trim()));
  }

  /** My number (masked), whether it is verified, and any change in flight. */
  @Get('status')
  async status(@Req() r: any) {
    const m = await this.me(r);
    return run(() => this.svc.status(this.ctx(m), m.customerId));
  }

  /** Start: validate + duplicate-check. NOTHING is saved yet -- the old number stays live. */
  @Post()
  async start(@Req() r: any, @Body(ValidatedBody(PHONE_START_BODY, { strict: true })) b: any) {
    const m = await this.me(r);
    // Reauthentication (tenant setting require_reauthentication, default on): the password, checked here by the
    // platform's own verifier; the SERVICE decides whether it was required.
    // Always checked: an account with NO password reports 'no_password' (the SMS proof and the old-number warning still apply).
    const reauth = await this.identity.reauthenticate(m.userId, String(b?.currentPassword ?? ''));
    return run(() => this.svc.start(this.ctx(m), {
      customerId: m.customerId,
      newPhone: String(b?.phone ?? ''),
      reauth,
      expectedVersion: b?.expectedVersion != null ? Number(b.expectedVersion) : undefined,
      idempotencyKey: b?.idempotencyKey ?? undefined,
    }));
  }

  @Post(':sessionId/send')
  async send(@Req() r: any, @Body(ValidatedBody(PHONE_SEND_BODY, { strict: true })) b: any) {
    const m = await this.me(r);
    return run(() => this.svc.sendCode(this.ctx(m), String(r.params?.sessionId ?? b?.sessionId ?? ''), String(b?.phone ?? ''), m.customerId));
  }

  /** Verify. ONLY on success does the new number become the customer's number. */
  @Post(':sessionId/verify')
  async verify(@Req() r: any, @Body(ValidatedBody(PHONE_VERIFY_BODY, { strict: true })) b: any) {
    const m = await this.me(r);
    return run(() => this.svc.verify(this.ctx(m), String(r.params?.sessionId ?? b?.sessionId ?? ''), String(b?.phone ?? ''), String(b?.code ?? ''), m.customerId));
  }

  /** Cancel. Nothing was replaced, so the old number is simply still there -- there is nothing to roll back. */
  @Post(':sessionId/cancel')
  async cancel(@Req() r: any, @Body(ValidatedBody(PHONE_SESSION_BODY, { strict: true })) b: any) {
    const m = await this.me(r);
    return run(async () => { await this.svc.cancel(this.ctx(m), String(r.params?.sessionId ?? b?.sessionId ?? ''), m.customerId); return { ok: true }; });
  }
}
