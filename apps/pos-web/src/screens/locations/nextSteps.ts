// nextSteps.ts — Salon Locations "Next actions" (extras #07): what a draft / incomplete location still needs, in the SAME
// order and with the SAME rules as the server's publishReadiness (modules/tenants/src/tenant-locations/location-core.ts).
// A location is never shown as published unless the server says it is; nothing here saves, verifies or publishes.
export type LocationStep = 'set_pin' | 'confirm_pin' | 'add_address' | 'add_contact' | 'blocked_by_review' | 'publish' | 'awaiting_review';
export interface LocationLike {
  latitude?: number | string | null; longitude?: number | string | null; map_pin_confirmed_at?: string | null;
  address?: string | null; formatted_address?: string | null; phone?: string | null; public_email?: string | null;
  verification_status?: string | null; is_public?: boolean | null;
}
const coord = (v: unknown) => (v == null || v === '' ? NaN : Number(v));
/** mirrors validCoords: finite, in range, and not the 0,0 placeholder */
export function validPin(lat: unknown, lng: unknown): boolean {
  const a = coord(lat), o = coord(lng);
  return Number.isFinite(a) && Number.isFinite(o) && Math.abs(a) <= 90 && Math.abs(o) <= 180 && !(a === 0 && o === 0);
}
export function locationNextSteps(l: LocationLike): LocationStep[] {
  const vs = l.verification_status ?? 'draft';
  if (l.is_public === true) return vs === 'verified' ? [] : ['awaiting_review'];
  const out: LocationStep[] = [];
  if (!validPin(l.latitude, l.longitude)) out.push('set_pin');
  else if (!l.map_pin_confirmed_at) out.push('confirm_pin');
  if (!(l.address || l.formatted_address)) out.push('add_address');
  if (!l.phone && !l.public_email) out.push('add_contact');
  if (vs === 'suspended' || vs === 'rejected') out.push('blocked_by_review');
  if (!out.length) out.push('publish');
  return out;
}
