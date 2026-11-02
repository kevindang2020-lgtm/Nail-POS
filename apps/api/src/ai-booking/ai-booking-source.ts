// ai-booking-source.ts — the canonical booking-SOURCE catalog for the shared AI Booking Assistant (ai_booking). The
// 7 channel sources below are the spec's authoritative list; each maps onto the EXISTING appointments.source values
// (PBSource: walk_in | phone | online | google | ai | customer_app | manual) so we reuse the domain column rather than
// inventing a parallel one, while the richer channel identity is preserved in ai_booking attribution + conversion rows.
// Pure + side-effect-free so validation and mapping are unit-tested without a DB.
export type AiBookingSource =
  | 'AI_PHONE_RECEPTIONIST'
  | 'FRONT_DESK_POS'
  | 'CUSTOMER_MOBILE_APP'
  | 'ONLINE_BOOKING'
  | 'PARTNER_BOOKING_LINK'
  | 'WALK_IN_CONVERSION'
  | 'SUPER_ADMIN_SUPPORT_MODE';

export const AI_BOOKING_SOURCES: readonly AiBookingSource[] = [
  'AI_PHONE_RECEPTIONIST', 'FRONT_DESK_POS', 'CUSTOMER_MOBILE_APP', 'ONLINE_BOOKING',
  'PARTNER_BOOKING_LINK', 'WALK_IN_CONVERSION', 'SUPER_ADMIN_SUPPORT_MODE',
] as const;

export function isAiBookingSource(v: unknown): v is AiBookingSource {
  return typeof v === 'string' && (AI_BOOKING_SOURCES as readonly string[]).includes(v);
}

// Existing domain source column value (PBSource) each channel writes to appointments.source. Preserves existing values.
const DOMAIN_SOURCE: Record<AiBookingSource, string> = {
  AI_PHONE_RECEPTIONIST: 'phone',
  FRONT_DESK_POS: 'manual',
  CUSTOMER_MOBILE_APP: 'customer_app',
  ONLINE_BOOKING: 'online',
  PARTNER_BOOKING_LINK: 'online',
  WALK_IN_CONVERSION: 'walk_in',
  SUPER_ADMIN_SUPPORT_MODE: 'manual',
};
export function domainSourceFor(s: AiBookingSource): string { return DOMAIN_SOURCE[s]; }

// Whether a source's trusted identity comes from a signed/verified context rather than an authenticated app session.
// (Used by the context resolver to require the right proof per channel.)
export function requiresSignedContext(s: AiBookingSource): boolean {
  return s === 'AI_PHONE_RECEPTIONIST' || s === 'ONLINE_BOOKING' || s === 'PARTNER_BOOKING_LINK';
}
export function requiresSupportSession(s: AiBookingSource): boolean { return s === 'SUPER_ADMIN_SUPPORT_MODE'; }
