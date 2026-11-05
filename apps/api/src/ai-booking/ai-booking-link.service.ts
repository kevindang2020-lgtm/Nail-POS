import { randomUUID } from 'crypto';
// ai-booking-link.service.ts — mints the signed booking links the public channel verifies. This is the genuinely-new
// half of the online/partner channel: no existing partner-link system was found in the codebase (the AI-phone and
// customer-mobile channels already exist — voice-booking/ and customer/ respectively — so ai_booking does NOT duplicate
// them). Minting is Super-Admin/tenant-admin authorized; the tenant is server-supplied (path/session), never trusted
// from a link the caller crafted. The secret comes from AI_BOOKING_LINK_SECRET; unset → minting refuses cleanly.
import { Injectable } from '@nestjs/common';
import { signBookingContext } from './ai-booking-signed-context';
import { AiBookingError } from './ai-booking-context';

export interface MintLinkInput {
  source: 'ONLINE_BOOKING' | 'PARTNER_BOOKING_LINK';
  branchId?: string | null; allowedServiceIds?: string[]; partnerId?: string; campaignId?: string; ttlDays?: number;
}
export interface MintedLink { token: string; jti: string; expiresAt: string; bookingUrl: string | null; source: string }

@Injectable()
export class AiBookingLinkService {
  private secret(): string { return process.env.AI_BOOKING_LINK_SECRET || ''; }

  mint(tenantId: string, input: MintLinkInput): MintedLink {
    if (!this.secret()) throw new AiBookingError('INVALID_BOOKING_SOURCE', 'Signed booking links are not configured (set AI_BOOKING_LINK_SECRET).');
    if (input.source !== 'ONLINE_BOOKING' && input.source !== 'PARTNER_BOOKING_LINK') throw new AiBookingError('INVALID_BOOKING_SOURCE', 'source must be ONLINE_BOOKING or PARTNER_BOOKING_LINK.');
    if (input.source === 'PARTNER_BOOKING_LINK' && !input.partnerId) throw new AiBookingError('VALIDATION_ERROR', 'partnerId is required for a partner link.');
    const ttlDays = Math.min(365, Math.max(1, input.ttlDays ?? 30));
    const ttlSeconds = ttlDays * 24 * 60 * 60;
    const jti = randomUUID();
    const token = signBookingContext(
      { tenantId, branchId: input.branchId ?? null, source: input.source, allowedServiceIds: input.allowedServiceIds, partnerId: input.partnerId, campaignId: input.campaignId },
      { secret: this.secret(), ttlSeconds, jti },
    );
    const base = (process.env.PUBLIC_BOOKING_BASE_URL || '').replace(/\/+$/, '');
    return {
      token, jti,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      // `s` carries the salon id so a static booking page can list the salon's services through the PUBLIC
      // /customer/salons/:salonId/services endpoint without inventing a new one. It is not a credential — the
      // token is; the salon id is already public on the discovery surface.
      bookingUrl: base ? `${base}/book?t=${encodeURIComponent(token)}&s=${encodeURIComponent(tenantId)}` : null,
      source: input.source,
    };
  }
}
