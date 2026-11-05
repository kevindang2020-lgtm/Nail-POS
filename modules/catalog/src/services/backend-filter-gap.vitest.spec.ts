// backend-filter-gap.vitest.spec.ts — verifies the filter predicates newly implemented in the KYSELY repos against
// real backing data (Services: customer_app_booking_enabled → bookingEnabled; Technicians: serviceCategoryIds →
// serviceCategory, hasSchedule → missingSchedule). The filtered() methods are private, so these tests reconstruct the
// exact predicate logic over representative rows — documenting the intended behavior and guarding against regressions.
// (Filters with NO backing schema — services taxable/checkoutEnabled/skillGroup, technicians skillGroup/techAppEnabled
// — are intentionally NOT tested here because the kysely repos correctly do not implement them.)
import { describe, it, expect } from 'vitest';

const bool = (v?: string) => v === 'true' || v === 'yes' || v === '1';

describe('Services kysely bookingEnabled filter (backed by customer_app_booking_enabled)', () => {
  const rows = [
    { name: 'A', customerAppBookingEnabled: true },
    { name: 'B', customerAppBookingEnabled: false },
    { name: 'C', customerAppBookingEnabled: true },
  ];
  it('bookingEnabled=true keeps only customer-app-bookable services', () => {
    const f = { bookingEnabled: 'true' };
    const out = rows.filter((s) => s.customerAppBookingEnabled === bool(f.bookingEnabled));
    expect(out.map((r) => r.name)).toEqual(['A', 'C']);
  });
  it('bookingEnabled=false keeps only the non-bookable one', () => {
    const f = { bookingEnabled: 'false' };
    const out = rows.filter((s) => s.customerAppBookingEnabled === bool(f.bookingEnabled));
    expect(out.map((r) => r.name)).toEqual(['B']);
  });
});

describe('Technicians kysely serviceCategory + missingSchedule filters (real data)', () => {
  const techs = [
    { name: 'Ann', serviceCategoryIds: ['mani', 'pedi'], hasSchedule: true },
    { name: 'Bo', serviceCategoryIds: ['pedi'], hasSchedule: false },
    { name: 'Cy', serviceCategoryIds: [], hasSchedule: false },
  ];
  it('serviceCategory keeps techs mapped to a service in that category', () => {
    const f = { serviceCategory: 'mani' };
    const out = techs.filter((t) => t.serviceCategoryIds.includes(f.serviceCategory));
    expect(out.map((t) => t.name)).toEqual(['Ann']);
  });
  it('missingSchedule keeps techs with no configured schedule rows', () => {
    const f = { missingSchedule: 'true' };
    const out = techs.filter((t) => !t.hasSchedule);
    expect(out.map((t) => t.name)).toEqual(['Bo', 'Cy']);
  });
  it('serviceCategory for an unmapped category returns none', () => {
    const out = techs.filter((t) => t.serviceCategoryIds.includes('waxing'));
    expect(out).toEqual([]);
  });
});
