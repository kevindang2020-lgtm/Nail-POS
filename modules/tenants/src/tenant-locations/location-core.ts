// location-core.ts — framework-free core for tenant Salon Location management. Pure helpers for
// publish-readiness gating, verification-status transitions, map-pin accuracy, duplicate detection,
// public-shape projection, and coordinate validation. Unit-tested in location-core.spec.ts.
// Distance math is reused from the existing salon-directory-core (haversineMiles).
import { haversineMiles } from '@aipowersalon/customers';

export type VerificationStatus =
  | 'draft' | 'manager_confirmed' | 'pending_review' | 'verified' | 'rejected' | 'suspended' | 'unpublished';
export type MapAccuracy =
  | 'exact' | 'rooftop' | 'approximate' | 'manually_adjusted' | 'needs_confirmation' | 'rejected';

export interface LocationRow {
  id: string; tenant_id: string;
  name: string | null; public_display_name: string | null; salon_code: string | null;
  description: string | null; phone: string | null; public_email: string | null; website: string | null;
  address: string | null; address_line2: string | null; suite_unit: string | null;
  city: string | null; state: string | null; zip: string | null; country_code: string | null;
  formatted_address: string | null; google_place_id: string | null;
  latitude: number | null; longitude: number | null; map_accuracy: MapAccuracy | null;
  map_pin_confirmed_at: string | null; timezone: string | null;
  status: string | null; verification_status: VerificationStatus | null;
  is_public: boolean | null; is_online_booking_enabled: boolean | null; accepts_walk_ins: boolean | null;
  show_phone_publicly: boolean | null; show_address_publicly: boolean | null; show_prices_publicly: boolean | null;
  booking_lead_minutes: number | null;
  published_at: string | null; verified_at: string | null; updated_at: string | null;
  manager_name?: string | null; manager_phone?: string | null; manager_email?: string | null; internal_notes?: string | null;
}

// ---- coordinate validation ----
export function validCoords(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0); // 0,0 (null island) treated as missing
}

// ---- publish readiness (§8) ----
export interface PublishCheck { ok: boolean; missing: string[] }
export function publishReadiness(loc: Partial<LocationRow>): PublishCheck {
  const missing: string[] = [];
  if (!validCoords(loc.latitude, loc.longitude)) missing.push('valid map pin (latitude/longitude)');
  if (!loc.map_pin_confirmed_at) missing.push('confirmed map pin');
  if (!(loc.address || loc.formatted_address)) missing.push('public address');
  if (!loc.phone && !loc.public_email) missing.push('public phone or email');
  const vs = loc.verification_status;
  if (vs === 'suspended' || vs === 'rejected') missing.push('not suspended/rejected by review');
  return { ok: missing.length === 0, missing };
}

// ---- verification status transitions ----
const ALLOWED: Record<VerificationStatus, VerificationStatus[]> = {
  draft: ['manager_confirmed', 'pending_review'],
  manager_confirmed: ['pending_review', 'verified', 'rejected', 'draft'],
  pending_review: ['verified', 'rejected', 'suspended'],
  verified: ['suspended', 'unpublished', 'pending_review'],
  rejected: ['draft', 'pending_review'],
  suspended: ['pending_review', 'unpublished'],
  unpublished: ['pending_review', 'manager_confirmed', 'draft'],
};
export function canTransition(from: VerificationStatus, to: VerificationStatus): boolean {
  if (from === to) return true;
  return (ALLOWED[from] || []).includes(to);
}

// ---- map-pin accuracy after a manual drag (§7) ----
export function accuracyAfterDrag(addressLat: number | null, addressLng: number | null, pinLat: number, pinLng: number): { accuracy: MapAccuracy; farFromAddress: boolean; metersOff: number | null } {
  if (addressLat == null || addressLng == null) return { accuracy: 'manually_adjusted', farFromAddress: false, metersOff: null };
  const miles = haversineMiles(addressLat, addressLng, pinLat, pinLng);
  const meters = Math.round(miles * 1609.34);
  return { accuracy: 'manually_adjusted', farFromAddress: miles > 0.2, metersOff: meters };
}

// ---- duplicate detection (§17) ----
export type DuplicateVerdict = 'none' | 'exact_block' | 'probable_warn' | 'cross_tenant_review';
export interface DupCandidate {
  id: string; tenant_id: string; google_place_id: string | null; phone: string | null;
  salon_code: string | null; name: string | null; city: string | null; state: string | null;
  latitude: number | null; longitude: number | null;
}
const normPhone = (p?: string | null) => (p || '').replace(/[^\d]/g, '');
const normText = (s?: string | null) => (s || '').trim().toLowerCase();
export function detectDuplicate(
  candidate: { tenant_id: string; google_place_id?: string | null; phone?: string | null; salon_code?: string | null; name?: string | null; city?: string | null; state?: string | null; latitude?: number | null; longitude?: number | null },
  existing: DupCandidate[],
  selfId?: string,
): { verdict: DuplicateVerdict; matchId?: string; reason?: string } {
  for (const e of existing) {
    if (selfId && e.id === selfId) continue;
    const sameTenant = e.tenant_id === candidate.tenant_id;
    // exact: same google place id, or same tenant + same salon code
    if (candidate.google_place_id && e.google_place_id && candidate.google_place_id === e.google_place_id) {
      return sameTenant
        ? { verdict: 'exact_block', matchId: e.id, reason: 'Same Google Place already exists for this business' }
        : { verdict: 'cross_tenant_review', matchId: e.id, reason: 'Another business already claims this Google Place' };
    }
    if (sameTenant && candidate.salon_code && normText(candidate.salon_code) === normText(e.salon_code)) {
      return { verdict: 'exact_block', matchId: e.id, reason: 'Salon code already used by another branch' };
    }
    // probable: same phone, or near-identical coordinates (~12m), or same name+city
    if (candidate.phone && normPhone(candidate.phone) && normPhone(candidate.phone) === normPhone(e.phone)) {
      return sameTenant ? { verdict: 'probable_warn', matchId: e.id, reason: 'Another branch uses this phone number' }
                        : { verdict: 'cross_tenant_review', matchId: e.id, reason: 'Phone number used by another business' };
    }
    if (candidate.latitude != null && candidate.longitude != null && e.latitude != null && e.longitude != null) {
      const m = haversineMiles(candidate.latitude, candidate.longitude, e.latitude, e.longitude) * 1609.34;
      if (m < 12) {
        return sameTenant ? { verdict: 'probable_warn', matchId: e.id, reason: 'A branch already sits at almost this exact spot' }
                          : { verdict: 'cross_tenant_review', matchId: e.id, reason: 'Another business is pinned at this exact spot' };
      }
    }
    if (sameTenant && candidate.name && normText(candidate.name) === normText(e.name) && normText(candidate.city) === normText(e.city) && normText(candidate.state) === normText(e.state)) {
      return { verdict: 'probable_warn', matchId: e.id, reason: 'A branch with this name already exists in this city' };
    }
  }
  return { verdict: 'none' };
}

// ---- public projection (§12) — strips internal/manager fields ----
export interface PublicLocation {
  publicLocationId: string; salonName: string; branchName: string; publicDisplayName: string;
  address: string | null; city: string | null; state: string | null; zip: string | null;
  latitude: number | null; longitude: number | null; phone: string | null; website: string | null;
  acceptsWalkIns: boolean; onlineBookingEnabled: boolean; bookingRoute: string | null; timezone: string | null;
}
export function toPublicLocation(loc: LocationRow, tenantDisplayName: string): PublicLocation {
  const branch = loc.name && loc.name !== 'Main' ? loc.name : '';
  return {
    publicLocationId: loc.id,
    salonName: tenantDisplayName,
    branchName: branch,
    publicDisplayName: loc.public_display_name || (branch ? `${tenantDisplayName} — ${branch}` : tenantDisplayName),
    address: loc.show_address_publicly === false ? null : (loc.formatted_address || loc.address),
    city: loc.city, state: loc.state, zip: loc.zip,
    latitude: loc.latitude, longitude: loc.longitude,
    phone: loc.show_phone_publicly === false ? null : loc.phone,
    website: loc.website,
    acceptsWalkIns: loc.accepts_walk_ins !== false,
    onlineBookingEnabled: loc.is_online_booking_enabled !== false,
    bookingRoute: loc.is_online_booking_enabled !== false ? `/book/${loc.id}` : null,
    timezone: loc.timezone,
  };
}

// ---- summary KPIs for the Locations page (§5) ----
export function summarize(rows: LocationRow[]) {
  const active = rows.filter((r) => (r.status || 'active') !== 'archived' && !(r as any).deleted_at);
  return {
    total: active.length,
    active: active.filter((r) => (r.status || 'active') === 'active').length,
    published: active.filter((r) => r.verification_status === 'verified' && r.is_public === true).length,
    unverified: active.filter((r) => r.verification_status !== 'verified').length,
    missingPins: active.filter((r) => !validCoords(r.latitude, r.longitude)).length,
    acceptingBookings: active.filter((r) => r.is_online_booking_enabled !== false).length,
  };
}
