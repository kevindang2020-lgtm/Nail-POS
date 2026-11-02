// maps-geocoding.provider.ts — provider adapter for address↔coordinate operations used by the tenant
// map-pin editor (searchAddress / geocode / reverseGeocode / placeDetails / directionsLink). The SERVER
// key lives ONLY in env (GOOGLE_MAPS_SERVER_API_KEY) and is NEVER returned to any frontend. When no key is
// configured the provider reports configured:false so the UI falls back to manual address + pin entry,
// and the POS can still save drafts (§8/§19/§20). `fetchImpl` is injectable for tests.
import { Inject, Injectable, Optional } from '@nestjs/common';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { GeocodeHit } from '@aipowersalon/api-contracts/tenant';
import type { GeocodeHit } from '@aipowersalon/api-contracts/tenant';

export const MAPS_FETCH = 'MAPS_FETCH';


@Injectable()
export class MapsGeocodingProvider {
  private cache = new Map<string, { at: number; hits: GeocodeHit[] }>();
  private static readonly TTL = 24 * 60 * 60 * 1000; // cache geocodes 24h (§19 avoid repeat calls)
  private readonly fetchImpl: typeof fetch;
  constructor(@Optional() @Inject(MAPS_FETCH) fetchImpl?: typeof fetch) { this.fetchImpl = fetchImpl ?? fetch; }

  configured(): boolean { return !!process.env.GOOGLE_MAPS_SERVER_API_KEY; }

  private parseComponents(comps: any[]): Pick<GeocodeHit, 'city' | 'state' | 'zip' | 'country'> {
    const get = (type: string, short = false) => {
      const c = (comps || []).find((x: any) => Array.isArray(x.types) && x.types.includes(type));
      return c ? (short ? c.short_name : c.long_name) : null;
    };
    return {
      city: get('locality') || get('postal_town') || get('sublocality'),
      state: get('administrative_area_level_1', true),
      zip: get('postal_code'),
      country: get('country', true),
    };
  }

  /** Forward geocode / address autocomplete-style search. Returns up to `limit` candidates. */
  async searchAddress(query: string, limit = 5): Promise<{ configured: boolean; hits: GeocodeHit[] }> {
    if (!this.configured()) return { configured: false, hits: [] };
    if (!query || query.trim().length < 3) return { configured: true, hits: [] };
    const key = 'q:' + query.trim().toLowerCase();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < MapsGeocodingProvider.TTL) return { configured: true, hits: cached.hits.slice(0, limit) };
    try {
      const country = process.env.GOOGLE_MAPS_DEFAULT_COUNTRY || 'US';
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:${country}&key=${process.env.GOOGLE_MAPS_SERVER_API_KEY}`;
      const res = await this.fetchImpl(url);
      if (!res.ok) return { configured: true, hits: [] };
      const body: any = await res.json();
      const hits: GeocodeHit[] = (Array.isArray(body?.results) ? body.results : []).map((r: any) => ({
        formattedAddress: r.formatted_address,
        latitude: r.geometry?.location?.lat, longitude: r.geometry?.location?.lng,
        placeId: r.place_id || null,
        accuracy: r.geometry?.location_type || null,
        ...this.parseComponents(r.address_components),
      })).filter((h: GeocodeHit) => typeof h.latitude === 'number' && typeof h.longitude === 'number');
      this.cache.set(key, { at: Date.now(), hits });
      return { configured: true, hits: hits.slice(0, limit) };
    } catch { return { configured: true, hits: [] }; }
  }

  /** Reverse geocode after the manager drags the pin (§7). */
  async reverseGeocode(lat: number, lng: number): Promise<{ configured: boolean; hit: GeocodeHit | null }> {
    if (!this.configured()) return { configured: false, hit: null };
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_MAPS_SERVER_API_KEY}`;
      const res = await this.fetchImpl(url);
      if (!res.ok) return { configured: true, hit: null };
      const body: any = await res.json();
      const r = (Array.isArray(body?.results) ? body.results : [])[0];
      if (!r) return { configured: true, hit: null };
      return {
        configured: true,
        hit: {
          formattedAddress: r.formatted_address, latitude: lat, longitude: lng,
          placeId: r.place_id || null, accuracy: r.geometry?.location_type || null,
          ...this.parseComponents(r.address_components),
        },
      };
    } catch { return { configured: true, hit: null }; }
  }

  /** A Google Maps directions deep-link (no API call, safe to expose). */
  directionsLink(lat: number, lng: number, placeId?: string | null): string {
    const dest = `${lat},${lng}`;
    const pid = placeId ? `&destination_place_id=${encodeURIComponent(placeId)}` : '';
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}${pid}`;
  }
}
