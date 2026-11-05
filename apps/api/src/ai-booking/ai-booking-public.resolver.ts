// ai-booking-public.resolver.ts — resolves a TRUSTED, scoped AiBookingContext for the non-authenticated channels:
// ONLINE_BOOKING / PARTNER_BOOKING_LINK from a signed context token, and AI_PHONE_RECEPTIONIST from the called phone
// number (reusing the existing tenant_messaging_numbers phone→tenant mapping). Tenant/branch always come from the
// verified token payload or the DB mapping — never from the caller. Permissions are the minimal scoped set per channel.
import { Injectable } from '@nestjs/common';
import { AiBookingError, type AiBookingContext } from './ai-booking-context';
import { verifyBookingContext, scopedPermissionsFor } from './ai-booking-signed-context';

@Injectable()
export class AiBookingPublicResolver {
  private secret(): string { return process.env.AI_BOOKING_LINK_SECRET || ''; }

  /** ONLINE_BOOKING / PARTNER_BOOKING_LINK: verify the signed token → trusted scoped context. Rejects forged/expired. */
  resolveFromToken(token: unknown, correlationId?: string): AiBookingContext & { allowedServiceIds?: string[]; partnerId?: string; campaignId?: string; jti?: string } {
    if (!this.secret()) throw new AiBookingError('INVALID_BOOKING_SOURCE', 'Signed booking links are not configured.');
    if (typeof token !== 'string' || !token) throw new AiBookingError('INVALID_PARTNER_LINK', 'A signed booking token is required.');
    const v = verifyBookingContext(token, { secret: this.secret() });
    if (!v.valid) throw new AiBookingError('INVALID_PARTNER_LINK', v.reason === 'expired' ? 'This booking link has expired.' : 'This booking link is invalid.');
    const p = v.payload;
    return {
      tenantId: p.tenantId, branchId: p.branchId ?? null, userId: p.partnerId ? `partner:${p.partnerId}` : 'online:public',
      role: 'PUBLIC_BOOKING', permissions: scopedPermissionsFor(p.source), source: p.source,
      correlationId: correlationId && /^[A-Za-z0-9_-]{1,64}$/.test(correlationId) ? correlationId : 'aib_' + Math.random().toString(36).slice(2, 10),
      supportSessionId: null, allowedServiceIds: p.allowedServiceIds, partnerId: p.partnerId, campaignId: p.campaignId, jti: p.jti,
    };
  }
}
// NOTE: AI_PHONE_RECEPTIONIST is NOT resolved here. That channel already has a mature, dedicated adapter — the Voice
// Booking Gateway (voice-booking/, `api/ai-receptionist/v1`, VoiceAuthGuard → hashed vk_ key → server-derived
// tenant/branch, idempotent + caller-verified + confirm-gated, delegating to BookingService with source:'ai'). Adding a
// second phone path here would duplicate it, which the spec forbids. ai_booking complements that gateway for the
// online/partner channels and the shared source/conversion layer; the phone channel remains owned by voice-booking.
