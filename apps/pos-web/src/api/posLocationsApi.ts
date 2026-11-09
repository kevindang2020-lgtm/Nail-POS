// posLocationsApi.ts — tenant Salon Locations client (Management → Locations). Server holds the Google
// server key; the browser only ever sends addresses/coords. All routes are tenant-scoped server-side.
import { api } from './client';
import type { GeocodeHit } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)

export interface SalonLocation {
  id: string; tenant_id: string;
  name: string | null; public_display_name: string | null; salon_code: string | null; description: string | null;
  phone: string | null; public_email: string | null; website: string | null;
  address: string | null; address_line2: string | null; suite_unit: string | null;
  city: string | null; state: string | null; zip: string | null; country_code: string | null;
  formatted_address: string | null; google_place_id: string | null;
  latitude: number | null; longitude: number | null; map_accuracy: string | null; map_pin_confirmed_at: string | null;
  timezone: string | null; status: string | null; verification_status: string | null;
  is_public: boolean | null; is_online_booking_enabled: boolean | null; accepts_walk_ins: boolean | null;
  show_phone_publicly: boolean | null; show_address_publicly: boolean | null; show_prices_publicly: boolean | null;
  booking_lead_minutes: number | null; published_at: string | null; verified_at: string | null; updated_at: string | null;
  manager_name?: string | null; manager_phone?: string | null; manager_email?: string | null; internal_notes?: string | null;
}
export interface LocationSummary { total: number; active: number; published: number; unverified: number; missingPins: number; acceptingBookings: number }
/** Salon Locations guide (Nov 9 2026): server search / filters / From–To / sort / pages (summary stays over every branch) */
export interface LocationQuery { q?: string; status?: string; map?: string; booking?: string; dateField?: string; from?: string; to?: string; sort?: string; page: number; pageSize: number }
export interface LocationPage { locations: SalonLocation[]; summary: LocationSummary; page: number; pageSize: number; total: number; totalPages: number }

export const posLocationsApi = {
  list: () => api.get<{ locations: SalonLocation[]; summary: LocationSummary }>('/tenant/locations'),
  page: (q: LocationQuery) => api.get<LocationPage>('/tenant/locations', Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== 'all'))),
  get: (id: string) => api.get<{ location: SalonLocation }>(`/tenant/locations/${id}`),
  create: (body: Partial<SalonLocation>) => api.post<{ location: SalonLocation; warning?: string }>('/tenant/locations', body as any),
  update: (id: string, body: Partial<SalonLocation>) => api.patch<{ location: SalonLocation }>(`/tenant/locations/${id}`, body as any),
  geocode: (query: string) => api.post<{ configured: boolean; candidates: GeocodeHit[] }>('/tenant/locations/geocode', { query }),
  applyAddress: (id: string, hit: GeocodeHit) => api.post<{ location: SalonLocation }>(`/tenant/locations/${id}/apply-address`, { hit } as any),
  setMapPin: (id: string, latitude: number, longitude: number, source = 'manual_drag') =>
    api.patch<{ location: SalonLocation; warning?: string; reverseGeocoded?: string | null }>(`/tenant/locations/${id}/map-pin`, { latitude, longitude, source }),
  confirmPin: (id: string) => api.post<{ location: SalonLocation }>(`/tenant/locations/${id}/confirm-pin`, {}),
  publish: (id: string) => api.post<{ location: SalonLocation }>(`/tenant/locations/${id}/publish`, {}),
  unpublish: (id: string) => api.post<{ location: SalonLocation }>(`/tenant/locations/${id}/unpublish`, {}),
  preview: (id: string) => api.get<{ preview: any }>(`/tenant/locations/${id}/public-preview`),
};
export type { GeocodeHit };
