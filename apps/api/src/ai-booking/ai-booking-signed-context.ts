// ai-booking-signed-context.ts — signed, expiring, scoped booking-context tokens for the channels that have NO
// authenticated session: ONLINE_BOOKING and PARTNER_BOOKING_LINK. A token is `base64url(payloadJSON).base64url(hmac)`,
// exactly mirroring auth-session-token. It carries ONLY the trusted context the server minted (tenant, branch, source,
// and optional partner/campaign/allowed-service scope) plus iat/exp. Because tenant/branch live inside the signed
// payload, the client cannot edit them without invalidating the signature — this is the spec's "the client must not be
// able to edit the signed context". Verification is constant-time and never throws. Pure; the secret comes from env at
// the controller. No secrets are stored in the token (signed, not encrypted).
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import type { AiBookingSource } from './ai-booking-source';

export interface SignedBookingClaims {
  tenantId: string; branchId: string | null; source: Extract<AiBookingSource, 'ONLINE_BOOKING' | 'PARTNER_BOOKING_LINK'>;
  allowedServiceIds?: string[];   // partner/campaign restriction: only these services may be booked
  partnerId?: string; campaignId?: string;
}
export interface SignedBookingPayload extends SignedBookingClaims { jti: string; iat: number; exp: number }

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (payloadB64: string, secret: string) => b64url(createHmac('sha256', secret).update(payloadB64).digest());

export function signBookingContext(claims: SignedBookingClaims, opts: { secret: string; ttlSeconds?: number; now?: number; jti?: string }): string {
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const body: SignedBookingPayload = { ...claims, jti: opts.jti ?? randomUUID(), iat: now, exp: now + (opts.ttlSeconds ?? 60 * 60 * 24 * 7) };   // default 7-day link
  const p = b64url(JSON.stringify(body));
  return `${p}.${sign(p, opts.secret)}`;
}

export type VerifyResult = { valid: true; payload: SignedBookingPayload } | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyBookingContext(token: string, opts: { secret: string; now?: number }): VerifyResult {
  try {
    if (!opts.secret) return { valid: false, reason: 'bad_signature' };
    const [p, sig] = String(token).split('.');
    if (!p || !sig) return { valid: false, reason: 'malformed' };
    const expectSig = sign(p, opts.secret);
    const a = Buffer.from(sig), b = Buffer.from(expectSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: 'bad_signature' };
    let payload: SignedBookingPayload;
    try { payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as SignedBookingPayload; }
    catch { return { valid: false, reason: 'malformed' }; }   // hardening (Jul 29 sweep): verifiers report, never throw
    const now = Math.floor((opts.now ?? Date.now()) / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return { valid: false, reason: 'expired' };
    if (!payload.tenantId || (payload.source !== 'ONLINE_BOOKING' && payload.source !== 'PARTNER_BOOKING_LINK')) return { valid: false, reason: 'malformed' };
    return { valid: true, payload };
  } catch { return { valid: false, reason: 'malformed' }; }
}

// Scoped permission set per channel — deliberately minimal. Public/link channels may search + create only; they never
// receive admin booking permissions (assign technician, manager override, cancel arbitrary appointments).
export function scopedPermissionsFor(source: AiBookingSource): string[] {
  switch (source) {
    case 'ONLINE_BOOKING':
    case 'PARTNER_BOOKING_LINK':
      return ['pos.booking.view', 'pos.booking.create', 'ai_booking.search_availability', 'ai_booking.create'];
    case 'AI_PHONE_RECEPTIONIST':
      return ['pos.booking.view', 'pos.booking.create', 'ai_booking.search_availability', 'ai_booking.create'];   // reschedule/cancel require customer verification (next slice)
    default:
      return ['pos.booking.view', 'ai_booking.search_availability'];
  }
}
