import { describe, it, expect } from 'vitest';
import { queryLocations, summarize, LocationQueryError, type LocationRow } from './location-core';

const row = (o: Partial<LocationRow> & { id: string; created_at?: string }): LocationRow & { created_at?: string } => ({
  tenant_id: 't', name: null, public_display_name: null, salon_code: null, description: null, phone: null, public_email: null, website: null,
  address: null, address_line2: null, suite_unit: null, city: null, state: null, zip: null, country_code: null, formatted_address: null, google_place_id: null,
  latitude: null, longitude: null, map_accuracy: null, map_pin_confirmed_at: null, timezone: 'America/New_York', status: 'active', verification_status: 'draft',
  is_public: false, is_online_booking_enabled: true, accepts_walk_ins: true, show_phone_publicly: true, show_address_publicly: true, show_prices_publicly: true,
  booking_lead_minutes: 0, published_at: null, verified_at: null, updated_at: null, ...o,
} as LocationRow & { created_at?: string });

const rows = [
  row({ id: 'a', name: 'Main', city: 'Houston', phone: '(713) 555-0101', created_at: '2026-10-01T15:00:00Z', latitude: 29.7, longitude: -95.3, verification_status: 'verified', is_public: true }),
  row({ id: 'b', name: 'Phú Mỹ', city: 'Dallas', created_at: '2026-11-08T03:59:59Z', is_online_booking_enabled: false }),   // Nov 7 23:59:59 New York
  row({ id: 'c', name: 'Westside', city: 'Austin', created_at: '2026-11-09T12:00:00Z', status: 'inactive' }),
];

describe('Salon Locations — server query (Nov 9 2026 guide)', () => {
  it('defaults to newest first, 10 per page, and the KPIs stay over every row', () => {
    const p = queryLocations(rows, { page: 1 }, 'America/New_York');
    expect(p.items.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(p).toMatchObject({ page: 1, pageSize: 10, total: 3, totalPages: 1 });
    expect(summarize(rows).total).toBe(3);
  });
  it('searches name accent-insensitively and phone by digits', () => {
    expect(queryLocations(rows, { q: 'phu my', page: 1 }).items.map((r) => r.id)).toEqual(['b']);
    expect(queryLocations(rows, { q: '555-0101', page: 1 }).items.map((r) => r.id)).toEqual(['a']);
  });
  it('From/To are inclusive salon-local days', () => {
    expect(queryLocations(rows, { from: '2026-11-07', to: '2026-11-07', page: 1 }, 'America/New_York').items.map((r) => r.id)).toEqual(['b']);
    expect(queryLocations(rows, { from: '2026-11-08', page: 1 }, 'America/New_York').items.map((r) => r.id)).toEqual(['c']);
  });
  it('filters status / map / booking', () => {
    expect(queryLocations(rows, { status: 'published', page: 1 }).items.map((r) => r.id)).toEqual(['a']);
    expect(queryLocations(rows, { map: 'missing_pin', page: 1 }).items.map((r) => r.id)).toEqual(['c', 'b']);
    expect(queryLocations(rows, { booking: 'disabled', page: 1 }).items.map((r) => r.id)).toEqual(['b']);
    expect(queryLocations(rows, { status: 'inactive', page: 1 }).items.map((r) => r.id)).toEqual(['c']);
  });
  it('refuses bad input with a code', () => {
    expect(() => queryLocations(rows, { from: '2026-11-09', to: '2026-11-01', page: 1 })).toThrow(LocationQueryError);
    expect(() => queryLocations(rows, { q: 'a', page: 1 })).toThrow(/at least 2/);
    expect(() => queryLocations(rows, { sort: 'bogus', page: 1 })).toThrow(LocationQueryError);
  });
  it('clamps a page past the end and pages by 10', () => {
    const many = Array.from({ length: 23 }, (_, i) => row({ id: `r${String(i).padStart(2, '0')}`, name: `L${i}`, created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));
    const p = queryLocations(many, { page: 9 });
    expect(p).toMatchObject({ page: 3, totalPages: 3, total: 23 });
    expect(p.items).toHaveLength(3);
  });
});
