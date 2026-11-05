// google-places.provider.ts — backend proxy for Google nearby nail-salon search (build doc §16/§23).
// The API key lives ONLY in env (GOOGLE_PLACES_API_KEY); never sent to any frontend. Disabled unless
// ENABLE_GOOGLE_NEARBY_SALON_SEARCH=true. Results are cached briefly (per rounded lat/lng + radius) and normalized
// to the §16 shape by the core. `fetchImpl` is injectable so the harness can verify the proxy without Google.
import { Inject, Injectable, Optional } from '@nestjs/common';

/** DI token for injecting a fetch implementation (tests); production falls back to global fetch. */
export const GOOGLE_FETCH = 'GOOGLE_FETCH';
import { googleToResult, SalonResult } from './salon-directory-core';

@Injectable()
export class GooglePlacesProvider {
  private cache = new Map<string, { at: number; results: SalonResult[] }>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  private readonly fetchImpl: typeof fetch;

  constructor(@Optional() @Inject(GOOGLE_FETCH) fetchImpl?: typeof fetch) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  enabled(): boolean {
    return String(process.env.ENABLE_GOOGLE_NEARBY_SALON_SEARCH || '').toLowerCase() === 'true' && !!process.env.GOOGLE_PLACES_API_KEY;
  }

  /** Nearby nail salons around (lat,lng). Returns [] on any provider error — never breaks partner results. */
  async nearby(lat: number, lng: number, radiusMiles: number, origin: { lat: number; lng: number }): Promise<{ results: SalonResult[]; attribution: string | null }> {
    if (!this.enabled()) return { results: [], attribution: null };
    const key = `${lat.toFixed(2)},${lng.toFixed(2)},${Math.round(radiusMiles)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < GooglePlacesProvider.CACHE_TTL_MS) return { results: hit.results, attribution: 'Powered by Google' };
    try {
      const radiusMeters = Math.min(Math.round(radiusMiles * 1609.34), 50000);
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&keyword=${encodeURIComponent('nail salon')}&type=beauty_salon&key=${process.env.GOOGLE_PLACES_API_KEY}`;
      const res = await this.fetchImpl(url);
      if (!res.ok) return { results: [], attribution: null };
      const body: any = await res.json();
      const results = Array.isArray(body?.results) ? body.results.map((g: any) => googleToResult(g, origin)) : [];
      this.cache.set(key, { at: Date.now(), results });
      return { results, attribution: 'Powered by Google' };
    } catch {
      return { results: [], attribution: null };
    }
  }
}
