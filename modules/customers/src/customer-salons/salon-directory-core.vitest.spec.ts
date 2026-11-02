import { describe, expect, it } from 'vitest';
import {
  APP_FLAG_DEFAULTS, GOOGLE_NOT_CONFIGURED_MESSAGE, clampRadius, flagEnabled, googleToResult,
  haversineMiles, mergeResults, partnerToResult,
} from './salon-directory-core';

describe('salon-directory-core (build doc §14–§17)', () => {
  it('haversine: 1° of longitude at the equator ≈ 69.1 miles, rounded to 0.1', () => {
    expect(haversineMiles(0, 0, 0, 1)).toBe(69.1);
    expect(haversineMiles(39.9268, -75.0246, 39.9268, -75.0246)).toBe(0);
  });

  it('flag defaults: discovery is opt-IN, behavior flags stay ON', () => {
    expect(APP_FLAG_DEFAULTS.public_listing).toBe(false);
    expect(APP_FLAG_DEFAULTS.show_on_map).toBe(false);
    expect(APP_FLAG_DEFAULTS.customer_app_booking).toBe(true);
    expect(flagEnabled('public_listing', new Map([['public_listing', true]]))).toBe(true);
    expect(flagEnabled('customer_app_booking', new Map([['customer_app_booking', false]]))).toBe(false);
  });

  it('partnerToResult: tenant — branch naming, partner + booking route only when bookable', () => {
    const base = { branchId: 'b1', branchName: 'Cherry Hill', tenantDisplayName: 'Luxe Nails', address: '1 Main St', city: 'Cherry Hill', state: 'NJ', zip: '08002', phone: null, latitude: 39.9, longitude: -75.0, bookable: true, servicesPreview: ['Gel'] };
    const r = partnerToResult(base, { lat: 39.9, lng: -75.0 });
    expect(r.name).toBe('Luxe Nails — Cherry Hill');
    expect(r.source).toBe('aipowersalon');
    expect(r.is_aipowersalon_partner).toBe(true);
    expect(r.booking_url_or_route).toBe('/book/b1');
    expect(r.distance_miles).toBe(0);
    const main = partnerToResult({ ...base, branchName: 'Main', bookable: false });
    expect(main.name).toBe('Luxe Nails');
    expect(main.booking_url_or_route).toBeNull();
    expect(main.is_bookable_in_app).toBe(false);
  });

  it('googleToResult: NEVER bookable in app (§16/§18), carries rating + place id', () => {
    const r = googleToResult({ place_id: 'abc', name: 'Polish Spot', geometry: { location: { lat: 39.95, lng: -75.16 } }, rating: 4.4, user_ratings_total: 120, vicinity: '2 Market St' }, { lat: 39.95, lng: -75.16 });
    expect(r.salon_id).toBe('g_abc');
    expect(r.source).toBe('google');
    expect(r.is_aipowersalon_partner).toBe(false);
    expect(r.is_bookable_in_app).toBe(false);
    expect(r.booking_url_or_route).toBeNull();
    expect(r.rating).toBe(4.4);
    expect(r.google_place_id).toBe('abc');
  });

  it('mergeResults: partners FIRST sorted by distance, Google after, radius applied, coord-dupes removed', () => {
    const p = (id: string, d: number) => ({ ...googleToResult({ place_id: id, geometry: { location: { lat: d, lng: 0 } } }), salon_id: id, source: 'aipowersalon' as const, is_aipowersalon_partner: true, distance_miles: d, latitude: d, longitude: 0 });
    const g = (id: string, d: number, lat = d) => ({ ...googleToResult({ place_id: id, geometry: { location: { lat, lng: 0 } } }), distance_miles: d, latitude: lat, longitude: 0 });
    const out = mergeResults([p('p2', 8), p('p1', 2), p('pFar', 30)], [g('g1', 1), g('gDup', 5, 8), g('gFar', 40)], 10);
    expect(out.map((r) => r.salon_id)).toEqual(['p1', 'p2', 'g_g1']);
  });

  it('clampRadius + verbatim Google message', () => {
    expect(clampRadius(undefined, 10, 50)).toBe(10);
    expect(clampRadius(0, 10, 50)).toBe(10);
    expect(clampRadius(100, 10, 50)).toBe(50);
    expect(clampRadius(25, 10, 50)).toBe(25);
    expect(GOOGLE_NOT_CONFIGURED_MESSAGE).toBe('Nearby Google salon search is not configured yet.');
  });
});
