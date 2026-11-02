import { describe, it, expect } from 'vitest';
import { buildNearbyFeed, clampRadius, type NearbyDealRow } from './deals-nearby-core';

const row = (id: string, lat: number | null, lng: number | null, extra: Partial<NearbyDealRow> = {}): NearbyDealRow => ({
  id, title: 'Deal ' + id, shortDescription: null, imageUrl: null, ownerType: 'salon', technicianId: null, technicianName: null,
  discountType: 'percent', discountPercent: 20, discountCents: null, originalPriceCents: 5000, finalPriceCents: 4000, endsAt: null,
  branchId: 'b' + id, branchName: 'Br', address: null, salonName: 'Salon', latitude: lat, longitude: lng, ...extra,
});

// NYC origin; a near point (~same block) and a far point (LA-ish).
const NYC = { lat: 40.7128, lng: -74.006 };

describe('buildNearbyFeed', () => {
  it('computes distance and sorts nearest-first', () => {
    const near = row('near', 40.7130, -74.0055);
    const far = row('far', 40.9, -74.2);
    const feed = buildNearbyFeed([far, near], NYC, 50, 'nearest');
    expect(feed[0].id).toBe('near');
    expect(feed[0].distanceMiles).toBeGreaterThanOrEqual(0);
    expect(feed[1].distanceMiles!).toBeGreaterThan(feed[0].distanceMiles!);
  });
  it('drops rows outside the radius when an origin is given', () => {
    const near = row('near', 40.7130, -74.0055);
    const la = row('la', 34.05, -118.24);
    const feed = buildNearbyFeed([near, la], NYC, 25);
    expect(feed.map((c) => c.id)).toEqual(['near']); // LA is filtered out
  });
  it('no origin → distance is null and nothing is radius-filtered (ZIP/city or denied)', () => {
    const feed = buildNearbyFeed([row('a', 40.71, -74.0), row('b', 34.05, -118.24)], null, 25);
    expect(feed.length).toBe(2);
    expect(feed.every((c) => c.distanceMiles === null)).toBe(true);
  });
  it('best_value sort orders by savings desc', () => {
    const small = row('small', 40.713, -74.005, { originalPriceCents: 5000, finalPriceCents: 4500 }); // save 500
    const big = row('big', 40.714, -74.004, { originalPriceCents: 8000, finalPriceCents: 5000 });     // save 3000
    const feed = buildNearbyFeed([small, big], NYC, 50, 'best_value');
    expect(feed[0].id).toBe('big');
  });
  it('savings never negative and is exposed on each card', () => {
    const feed = buildNearbyFeed([row('x', 40.713, -74.005)], NYC, 50);
    expect(feed[0].savingsCents).toBe(1000);
  });
});

describe('clampRadius', () => {
  it('defaults and clamps', () => {
    expect(clampRadius(undefined)).toBe(25);
    expect(clampRadius(0)).toBe(25);
    expect(clampRadius(5)).toBe(5);
    expect(clampRadius(9999)).toBe(100);
    expect(clampRadius('abc')).toBe(25);
  });
});
