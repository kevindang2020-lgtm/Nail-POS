// location-core.ts — framework-free core for tenant Salon Location management. Pure helpers for
// publish-readiness gating, verification-status transitions, map-pin accuracy, duplicate detection,
// public-shape projection, and coordinate validation. Unit-tested in location-core.spec.ts.
// Distance math is reused from the existing salon-directory-core (haversineMiles).
import { haversineMiles } from '@aipowersalon/customers';
import { withCode } from '@aipowersalon/api-contracts';

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

// ---- Salon Locations SUNMI guide (Nov 9 2026): server-side search / filters / From–To / sort / pages ----
// Runs over the tenant's own branches (the query above is tenant-scoped); summary KPIs stay over ALL authorized rows.
export const LOC_STATUS_FILTERS = ['all', 'active', 'inactive', 'draft', 'unverified', 'verified', 'published'] as const;
export const LOC_MAP_FILTERS = ['all', 'pin_set', 'pin_confirmed', 'missing_pin'] as const;
export const LOC_BOOKING_FILTERS = ['all', 'accepting', 'disabled'] as const;
export const LOC_SORTS = ['newest', 'oldest', 'name_asc', 'name_desc', 'updated'] as const;
export interface LocQuery { q?: string; status?: string; map?: string; booking?: string; dateField?: string; from?: string; to?: string; sort?: string; page?: number | string; pageSize?: number | string }
export class LocationQueryError extends Error {}
const foldLoc = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_ZONES = new Set<string>((Intl as unknown as { supportedValuesOf: (k: 'timeZone') => string[] }).supportedValuesOf('timeZone'));
/** local calendar day (YYYY-MM-DD) of an instant in a zone — inclusive day filters use the salon's own day */
function localDay(iso: unknown, tz: string): string | null {
  if (!iso) return null; const d = new Date(iso as string); if (Number.isNaN(d.getTime())) return null;
  if (tz !== 'UTC' && !KNOWN_ZONES.has(tz)) return null;   // an unknown zone matches nothing rather than the UTC day
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function queryLocations<R extends LocationRow & { created_at?: unknown }>(rows: R[], q: LocQuery, tz = 'UTC') {
  const pick = <T extends readonly string[]>(v: unknown, list: T): T[number] => { const s = String(v ?? list[0]); if (!(list as readonly string[]).includes(s)) throw withCode(new LocationQueryError('That filter or sort is not available.'), 'LOCATIONS_INVALID_FILTER'); return s as T[number]; };
  const status = pick(q.status, LOC_STATUS_FILTERS);
  const map = pick(q.map, LOC_MAP_FILTERS);
  const booking = pick(q.booking, LOC_BOOKING_FILTERS);
  const sort = pick(q.sort, LOC_SORTS);
  const dateField = pick(q.dateField, ['created', 'updated'] as const);
  const from = q.from ? String(q.from) : undefined; const to = q.to ? String(q.to) : undefined;
  if ((from && !DAY.test(from)) || (to && !DAY.test(to)) || (from && to && from > to)) throw withCode(new LocationQueryError('Pick a From date on or before the To date.'), 'LOCATIONS_INVALID_PERIOD');
  const term = String(q.q ?? '').trim();
  if (term && term.length < 2) throw withCode(new LocationQueryError('Type at least 2 characters to search.'), 'LOCATIONS_SEARCH_TOO_SHORT');
  const pageSize = [10, 25, 50].includes(Number(q.pageSize)) ? Number(q.pageSize) : 10;
  let out = rows.filter((r) => (r.status || 'active') !== 'archived');
  if (term) {
    const f = foldLoc(term); const dg = digits(term);
    out = out.filter((r) => [r.name, r.public_display_name, r.salon_code, r.address, r.city, r.state, r.zip, r.formatted_address, r.manager_name].some((v) => foldLoc(v).includes(f))
      || (dg.length >= 3 && [r.phone, r.manager_phone].some((v) => digits(v).includes(dg))));
  }
  const pub = (r: R) => r.verification_status === 'verified' && r.is_public === true;
  if (status !== 'all') out = out.filter((r) => status === 'published' ? pub(r) : status === 'verified' ? r.verification_status === 'verified' : status === 'unverified' ? r.verification_status !== 'verified'
    : status === 'draft' ? r.verification_status === 'draft' : (r.status || 'active') === status);
  if (map !== 'all') out = out.filter((r) => map === 'missing_pin' ? !validCoords(r.latitude, r.longitude) : map === 'pin_confirmed' ? validCoords(r.latitude, r.longitude) && !!r.map_pin_confirmed_at : validCoords(r.latitude, r.longitude));
  if (booking !== 'all') out = out.filter((r) => booking === 'accepting' ? r.is_online_booking_enabled !== false : r.is_online_booking_enabled === false);
  if (from || to) out = out.filter((r) => { const d = localDay(dateField === 'updated' ? r.updated_at : r.created_at, tz); return !!d && (!from || d >= from) && (!to || d <= to); });
  const t = (v: unknown) => (v ? new Date(v as string).getTime() || 0 : 0);
  const name = (r: R) => foldLoc(r.public_display_name || r.name);
  out = [...out].sort((a, b) => sort === 'oldest' ? t(a.created_at) - t(b.created_at) || a.id.localeCompare(b.id)
    : sort === 'name_asc' ? name(a).localeCompare(name(b)) : sort === 'name_desc' ? name(b).localeCompare(name(a))
    : sort === 'updated' ? t(b.updated_at) - t(a.updated_at) || b.id.localeCompare(a.id)
    : t(b.created_at) - t(a.created_at) || b.id.localeCompare(a.id));
  const total = out.length; const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(Number(q.page) || 1)), totalPages);
  return { items: out.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total, totalPages };
}
