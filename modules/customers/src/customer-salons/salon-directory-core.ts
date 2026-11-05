import type { SalonResult } from '@aipowersalon/api-contracts/customer';
export type { SalonResult };   // owned by packages/api-contracts (Constitution 13 §13)
// salon-directory-core.ts — framework-free core for "Find Salons Near Me" (build doc §14–§17).
// Pure functions: haversine distance, the §16 normalized result shape, partner/Google merge (partners FIRST), and
// the flag semantics. Unit-tested in salon-directory-core.vitest.spec.ts; the service tier is a thin shell.


export const APP_FLAG_KEYS = ['public_listing', 'show_on_map', 'customer_app_booking', 'technician_app', 'customer_service_progress', 'tech_live_ticket_edit'] as const;
export type AppFlagKey = typeof APP_FLAG_KEYS[number];
/** Defaults when no explicit row exists: discovery flags are opt-IN, behavior flags stay ON (existing behavior). */
export const APP_FLAG_DEFAULTS: Record<AppFlagKey, boolean> = {
  public_listing: false, show_on_map: false, customer_app_booking: true,
  technician_app: true, customer_service_progress: true, tech_live_ticket_edit: true,
};
export function flagEnabled(key: AppFlagKey, overrides: ReadonlyMap<string, boolean>): boolean {
  return overrides.get(key) ?? APP_FLAG_DEFAULTS[key];
}

const EARTH_RADIUS_MILES = 3958.7613;
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1); const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a)) * 10) / 10;
}

export interface PartnerBranchRow {
  branchId: string; branchName: string; tenantDisplayName: string;
  address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null;
  latitude: number | null; longitude: number | null;
  tenantId?: string;   // the salon's tenant — the app books in-app only within the signed-in tenant (Sep 2026 merge)
  bookable: boolean; servicesPreview: string[];
  averageRating?: number | null; reviewCount?: number; technicianCount?: number;
}

export function partnerToResult(b: PartnerBranchRow, origin?: { lat: number; lng: number }): SalonResult {
  const dist = origin && b.latitude != null && b.longitude != null ? haversineMiles(origin.lat, origin.lng, b.latitude, b.longitude) : null;
  return {
    salon_id: b.branchId, tenant_id: b.tenantId ?? null, source: 'aipowersalon',
    name: b.branchName && b.branchName !== 'Main' ? `${b.tenantDisplayName} — ${b.branchName}` : b.tenantDisplayName,
    address: b.address, city: b.city, state: b.state, zip: b.zip, phone: b.phone,
    latitude: b.latitude, longitude: b.longitude, distance_miles: dist,
    rating: b.averageRating ?? null, review_count: b.reviewCount ?? 0, technician_count: b.technicianCount ?? 0, photos: [],
    is_aipowersalon_partner: true, is_bookable_in_app: b.bookable,
    open_now: null, hours: null, services_preview: b.servicesPreview, price_level: null,
    booking_url_or_route: b.bookable ? `/book/${b.branchId}` : null, google_place_id: null,
  };
}

/** Google Places "nearby" raw item → §16 shape. Non-partner Google salons are NEVER bookable in-app (§16/§18). */
export function googleToResult(g: any, origin?: { lat: number; lng: number }): SalonResult {
  const lat = g?.geometry?.location?.lat ?? null; const lng = g?.geometry?.location?.lng ?? null;
  return {
    salon_id: 'g_' + String(g?.place_id || ''), source: 'google',
    name: String(g?.name || 'Nail salon'),
    address: g?.vicinity || g?.formatted_address || null, city: null, state: null, zip: null,
    phone: g?.formatted_phone_number || null,
    latitude: lat, longitude: lng,
    distance_miles: origin && lat != null && lng != null ? haversineMiles(origin.lat, origin.lng, lat, lng) : null,
    rating: typeof g?.rating === 'number' ? g.rating : null,
    review_count: typeof g?.user_ratings_total === 'number' ? g.user_ratings_total : null,
    photos: [],
    is_aipowersalon_partner: false, is_bookable_in_app: false,
    open_now: typeof g?.opening_hours?.open_now === 'boolean' ? g.opening_hours.open_now : null, hours: null,
    services_preview: [], price_level: typeof g?.price_level === 'number' ? g.price_level : null,
    booking_url_or_route: null, google_place_id: g?.place_id ? String(g.place_id) : null,
  };
}

/** §14 ordering: AIPowerSalon partners FIRST (by distance), then Google results (by distance); radius applied to both. */
export function mergeResults(partners: SalonResult[], google: SalonResult[], radiusMiles: number): SalonResult[] {
  const within = (r: SalonResult) => r.distance_miles == null || r.distance_miles <= radiusMiles;
  const byDist = (a: SalonResult, b: SalonResult) => (a.distance_miles ?? Infinity) - (b.distance_miles ?? Infinity);
  const partnerIds = new Set(partners.map((p) => `${p.latitude},${p.longitude}`));
  const dedupedGoogle = google.filter((g) => !partnerIds.has(`${g.latitude},${g.longitude}`));
  return [...partners.filter(within).sort(byDist), ...dedupedGoogle.filter(within).sort(byDist)];
}

export const GOOGLE_NOT_CONFIGURED_MESSAGE = 'Nearby Google salon search is not configured yet.';

export function clampRadius(requested: number | undefined, def: number, max: number): number {
  const r = Number(requested);
  if (!Number.isFinite(r) || r <= 0) return def;
  return Math.min(r, max);
}
