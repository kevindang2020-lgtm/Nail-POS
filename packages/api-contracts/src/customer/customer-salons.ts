// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: customer. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface SalonResult {
  salon_id: string;
  source: 'aipowersalon' | 'google';
  name: string;
  address: string | null; city: string | null; state: string | null; zip: string | null;
  phone: string | null;
  latitude: number | null; longitude: number | null;
  distance_miles: number | null;
  rating: number | null; review_count: number | null;
  technician_count?: number;
  photos: string[];
  is_aipowersalon_partner: boolean;
  is_bookable_in_app: boolean;
  tenant_id?: string | null;   // partner salons only: which tenant the branch belongs to (in-app booking works within the signed-in tenant)
  open_now: boolean | null; hours: unknown | null;
  services_preview: string[];
  price_level: number | null;
  booking_url_or_route: string | null;
  google_place_id: string | null;
}
