// ai-booking-metrics.vitest.spec.ts — the documented conversion formulas (§27). Pure, DB-free.
import { describe, it, expect } from 'vitest';
import { computeConversionMetrics } from './ai-booking-metrics-core';

const rows = [
  // ONLINE: 3 searches, 2 attempts, 1 success, 1 fail (NO_AVAILABILITY)
  { source: 'ONLINE_BOOKING', stage: 'AVAILABILITY_SEARCHED' },
  { source: 'ONLINE_BOOKING', stage: 'AVAILABILITY_SEARCHED' },
  { source: 'ONLINE_BOOKING', stage: 'AVAILABILITY_SEARCHED' },
  { source: 'ONLINE_BOOKING', stage: 'BOOKING_ATTEMPTED' },
  { source: 'ONLINE_BOOKING', stage: 'BOOKING_ATTEMPTED' },
  { source: 'ONLINE_BOOKING', stage: 'BOOKING_SUCCEEDED', outcome: 'succeeded' },
  { source: 'ONLINE_BOOKING', stage: 'BOOKING_FAILED', outcome: 'failed', failureReason: 'NO_AVAILABILITY' },
  // PARTNER: 1 attempt, 1 success (100%)
  { source: 'PARTNER_BOOKING_LINK', stage: 'BOOKING_ATTEMPTED' },
  { source: 'PARTNER_BOOKING_LINK', stage: 'BOOKING_SUCCEEDED', outcome: 'succeeded' },
];

describe('computeConversionMetrics', () => {
  it('computes overall attempt→booking conversion and search→booking rate', () => {
    const m = computeConversionMetrics(rows);
    expect(m.overall.attempts).toBe(3);
    expect(m.overall.successes).toBe(2);
    expect(m.overall.searches).toBe(3);
    expect(m.overall.bookingConversionRate).toBe(0.6667);   // 2/3
    expect(m.overall.searchToBookingRate).toBe(0.6667);      // 2/3
  });
  it('breaks metrics down by source', () => {
    const m = computeConversionMetrics(rows);
    const online = m.bySource.find((s) => s.source === 'ONLINE_BOOKING')!;
    const partner = m.bySource.find((s) => s.source === 'PARTNER_BOOKING_LINK')!;
    expect(online.bookingConversionRate).toBe(0.5);          // 1 success / 2 attempts
    expect(partner.bookingConversionRate).toBe(1);           // 1/1
  });
  it('aggregates failure reasons', () => {
    const m = computeConversionMetrics(rows);
    expect(m.failureReasons).toEqual([{ reason: 'NO_AVAILABILITY', count: 1 }]);
  });
  it('never divides by zero (no attempts → rate 0, not NaN)', () => {
    const m = computeConversionMetrics([{ source: 'ONLINE_BOOKING', stage: 'AVAILABILITY_SEARCHED' }]);
    expect(m.overall.bookingConversionRate).toBe(0);
    expect(Number.isNaN(m.overall.searchToBookingRate)).toBe(false);
  });
});
