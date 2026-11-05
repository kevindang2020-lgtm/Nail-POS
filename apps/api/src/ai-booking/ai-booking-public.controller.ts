// ai-booking-public.controller.ts — the entry point for channels WITHOUT an authenticated session. There is no
// TenantAuthGuard here on purpose: trust comes from the signed token (online/partner) or the verified phone-number
// mapping (AI phone), resolved server-side into a scoped AiBookingContext. It then delegates to the SAME channel-
// agnostic AiBookingService / AiBookingMutationService as the authenticated controller — one orchestration layer, many
// context sources. Partner tokens additionally restrict bookable services to the token's allow-list.
import { Controller, Get, Post, Body, Req, HttpException, HttpStatus, Inject, Optional } from '@nestjs/common';
import { BookingVerificationService, RemoteBookingAdmission, screenVerificationSend, captchaClientConfig } from '@aipowersalon/booking';
import { clientIp } from '@aipowersalon/security';
import { AiBookingService } from './ai-booking.service';
import { AiBookingMutationService } from './ai-booking-mutation.service';
import { AiBookingPublicResolver } from './ai-booking-public.resolver';
import { AiBookingRevocationService } from './ai-booking-revocation.service';
import { AiBookingError, type AiBookingContext } from './ai-booking-context';
import type { TenantRateLimiter } from '../common/tenant-rate-limit';
import { TENANT_RATE_LIMITER } from '../common/rate-limit.module';
import { AIB_PUBLIC_CREATE_BODY, AIB_PUBLIC_SEARCH_BODY, AIB_PUBLIC_SERVICES_BODY, AIB_PUBLIC_VERIFY_CHECK_BODY, AIB_PUBLIC_VERIFY_SEND_BODY } from './request-schemas';
import { ValidatedBody } from '@aipowersalon/permissions/guards';

function toHttp(e: unknown): never {
  if (e instanceof AiBookingError) throw new HttpException({ code: e.code, message: e.message }, e.code === 'INVALID_PARTNER_LINK' || e.code === 'TENANT_NOT_FOUND' ? HttpStatus.UNAUTHORIZED : HttpStatus.BAD_REQUEST);
  throw e;
}

@Controller('api/ai-booking/v1/public')
export class AiBookingPublicController {
  constructor(
    private readonly svc: AiBookingService, private readonly mutation: AiBookingMutationService, private readonly resolver: AiBookingPublicResolver,
    @Inject(TENANT_RATE_LIMITER) private readonly limiter: TenantRateLimiter, private readonly revocation: AiBookingRevocationService,
    // Phase 4: the guest's phone verification, on the link's own scope (the audit found the page had no way to send a
    // code at all — the gate refused and nothing could satisfy it).
    @Optional() private readonly verification?: BookingVerificationService,
    @Optional() private readonly admission?: RemoteBookingAdmission,
    @Optional() @Inject('BookingRiskCounters') private readonly counters?: any,
    @Optional() @Inject('CaptchaVerifier') private readonly captcha?: any,
  ) {}

  // Abuse protection for the unauthenticated public surface (§31/§43). Invalid tokens are rejected by the resolver
  // before this runs (cheap HMAC check); valid-token traffic is bucketed PER-TENANT-per-source so one salon's public
  // link (or a leaked one) can never exhaust another salon's budget. Pass-through until the limiter is enabled.
  private async enforceRate(ctx: AiBookingContext): Promise<void> {
    if (!this.limiter.enabled) return;
    const d = await this.limiter.hit(`aib:pub:${ctx.tenantId}:${ctx.source}`);
    if (!d.allowed) throw new HttpException({ code: 'TEMPORARY_CAPACITY_PROTECTION', message: 'Too many booking requests. Please retry shortly.', retryAfterSeconds: Math.ceil((d.retryAfterMs || 1000) / 1000) }, HttpStatus.TOO_MANY_REQUESTS);
  }

  // Targeted revocation (§32): a specific link can be killed without rotating the secret. Checked after signature/expiry.
  private async enforceNotRevoked(ctx: AiBookingContext & { jti?: string }): Promise<void> {
    if (await this.revocation.isRevoked(ctx.tenantId, ctx.jti)) throw new HttpException({ code: 'INVALID_PARTNER_LINK', message: 'This booking link has been revoked.' }, HttpStatus.UNAUTHORIZED);
  }

  /**
   * BUILD_PLAN Phase 4: the services this link can book — from the signed link itself. The page used public DISCOVERY
   * (`/customer/salons/:salonId/services`) with the link's TENANT id where a branch id is expected, behind the salon's
   * public-listing flag, returning a field name it did not read — so no booking link could load a service.
   */
  @Post('services') async services(@Body(ValidatedBody(AIB_PUBLIC_SERVICES_BODY)) b: any) {
    let ctx; try { ctx = this.resolver.resolveFromToken(b?.token, b?.correlationId); } catch (e) { toHttp(e); }
    await this.enforceRate(ctx!);
    await this.enforceNotRevoked(ctx!);
    const allowed = (ctx as any).allowedServiceIds as string[] | undefined;
    const list = (await this.svc.services(ctx!)).filter((s) => !allowed || allowed.includes(s.serviceId));
    return { services: list.map((s) => ({ id: s.serviceId, name: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents })) };
  }

  /** Online/partner availability search from a signed token. */
  @Post('availability/search') async search(@Body(ValidatedBody(AIB_PUBLIC_SEARCH_BODY)) b: any) {
    let ctx; try { ctx = this.resolver.resolveFromToken(b?.token, b?.correlationId); } catch (e) { toHttp(e); }
    await this.enforceRate(ctx!);
    await this.enforceNotRevoked(ctx!);
    return this.svc.searchAvailability(ctx!, { date: b?.date, serviceIds: this.scopeServices(ctx!, b?.serviceIds), technicianId: b?.technicianId });
  }

  /** Online/partner booking from a signed token (still confirm-gated + idempotent + source-stamped in the facade). */
  @Post('appointments') async create(@Req() req: any, @Body(ValidatedBody(AIB_PUBLIC_CREATE_BODY)) b: any) {
    let ctx; try { ctx = this.resolver.resolveFromToken(b?.token, b?.correlationId); } catch (e) { toHttp(e); }
    await this.enforceRate(ctx!);
    await this.enforceNotRevoked(ctx!);
    const requested: string[] = Array.isArray(b?.serviceIds) ? b.serviceIds : [];
    const allowed = (ctx as any).allowedServiceIds as string[] | undefined;
    if (allowed && requested.some((s) => !allowed.includes(s))) throw new HttpException({ code: 'SERVICE_NOT_BOOKABLE', message: 'This link cannot book one or more of the requested services.' }, HttpStatus.BAD_REQUEST);
    return this.mutation.createAppointment(ctx!, { customerName: b?.customerName, customerPhone: b?.customerPhone, serviceIds: requested, date: b?.date, startTime: b?.startTime, technicianId: b?.technicianId, confirm: b?.confirm, idempotencyKey: b?.idempotencyKey,
      bookingSessionId: typeof b?.bookingSessionId === 'string' ? b.bookingSessionId : undefined, deviceId: typeof b?.deviceId === 'string' ? b.deviceId : undefined, requestIp: clientIp(req) ?? null });
  }

  // ── Phase 4: the guest proves the phone on the booking ─────────────────────────────────────────────────────
  // Scoped by the signed link: the tenant and branch come from the token, and the booking session is the one a
  // "verify first" refusal sealed for THIS link — a session from another link or salon opens to nothing, so these
  // routes cannot be used to text arbitrary numbers on a salon's account without first being refused a booking.
  private async verificationScope(req: any, b: any) {
    let ctx; try { ctx = this.resolver.resolveFromToken(b?.token, b?.correlationId); } catch (e) { toHttp(e); }
    await this.enforceRate(ctx!);
    await this.enforceNotRevoked(ctx!);
    if (!this.verification || !this.admission) throw new HttpException({ status: 'verification_failed', message: 'Phone verification is not available.' }, HttpStatus.SERVICE_UNAVAILABLE);
    const session = this.admission.open(ctx!.tenantId, `link:${ctx!.jti ?? ctx!.tenantId}`, b?.bookingSessionId);
    if (!session) throw new HttpException({ status: 'verification_failed', message: 'This verification has expired. Please choose your time again.' }, HttpStatus.BAD_REQUEST);
    const deviceId = typeof b?.deviceId === 'string' ? b.deviceId.slice(0, 200) : null;
    return {
      ctx: ctx!,
      vctx: { tenantId: ctx!.tenantId, branchId: ctx!.branchId ?? '', channel: 'online' as const, bookingSessionId: session, customerId: null,
              requestIp: clientIp(req) ?? null, deviceId, locale: String(req?.headers?.['accept-language'] ?? '') || null },
    };
  }

  /** How to show the human check when a send is challenged (provider + public site key, or none). */
  @Get('verification/captcha') captchaConfig() { return captchaClientConfig(); }

  /** Send (or resend) the code to the number on the booking. */
  @Post('verification/send') async sendCode(@Req() req: any, @Body(ValidatedBody(AIB_PUBLIC_VERIFY_SEND_BODY)) b: any) {
    const { vctx } = await this.verificationScope(req, b);
    await screenVerificationSend({ counters: this.counters, captcha: this.captcha }, vctx.tenantId, req, String(b?.customerPhone ?? ''), b?.captchaToken, vctx.deviceId);
    const out = await this.verification!.send(vctx, String(b?.customerPhone ?? ''));
    switch (out.status) {
      case 'code_sent':
      case 'already_verified': return { status: out.status, maskedPhone: out.maskedPhone, message: out.message };
      case 'too_many_attempts': throw new HttpException({ status: out.status, message: out.message }, HttpStatus.TOO_MANY_REQUESTS);
      case 'rate_limited': throw new HttpException({ status: out.status, message: out.message, retryAfterSeconds: out.retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
      case 'twilio_not_configured': throw new HttpException({ status: out.status, message: out.message }, HttpStatus.SERVICE_UNAVAILABLE);
      case 'invalid_phone_number': throw new HttpException({ status: out.status, message: out.message }, HttpStatus.BAD_REQUEST);
      default: throw new HttpException({ status: out.status, message: out.message }, HttpStatus.BAD_GATEWAY);
    }
  }

  /** Check the code. On success the guest retries the booking with the same bookingSessionId (the proof is claimed once). */
  @Post('verification/check') async checkCode(@Req() req: any, @Body(ValidatedBody(AIB_PUBLIC_VERIFY_CHECK_BODY)) b: any) {
    const { vctx } = await this.verificationScope(req, b);
    const out = await this.verification!.check(vctx, String(b?.customerPhone ?? ''), String(b?.code ?? ''));
    if (out.status === 'phone_verified') return { status: out.status, message: out.message };
    throw new HttpException({ status: out.status, message: out.message }, out.status === 'too_many_attempts' ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.BAD_REQUEST);
  }

  /** AI phone booking is owned by the Voice Booking Gateway (voice-booking/, api/ai-receptionist/v1) — not duplicated here. */

  private scopeServices(ctx: any, serviceIds?: string[]): string[] | undefined {
    const allowed = ctx.allowedServiceIds as string[] | undefined;
    if (!allowed) return serviceIds;
    if (!serviceIds?.length) return allowed;                    // default to the link's allowed services
    return serviceIds.filter((s) => allowed.includes(s));
  }
}
