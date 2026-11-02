// scheduled-reports-core.vitest.spec.ts — cadence math + due logic. nextRunAt must advance correctly (incl. month/year
// rollover); isDue must respect enabled + the next-run instant.
import { describe, it, expect } from 'vitest';
import { nextRunAt, isDue, isCadence, isSupportedReport } from './scheduled-reports-core';

describe('nextRunAt', () => {
  it('advances daily / weekly', () => {
    const from = new Date('2026-06-30T09:00:00Z');
    expect(nextRunAt('daily', from).toISOString()).toBe('2026-07-01T09:00:00.000Z');
    expect(nextRunAt('weekly', from).toISOString()).toBe('2026-07-07T09:00:00.000Z');
  });
  it('advances monthly across a year boundary', () => {
    expect(nextRunAt('monthly', new Date('2026-12-15T00:00:00Z')).toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });
});

describe('isDue', () => {
  const now = new Date('2026-06-30T12:00:00Z');
  it('due when enabled and next run is in the past/now', () => {
    expect(isDue({ enabled: true, nextRunAt: '2026-06-30T11:00:00Z' }, now)).toBe(true);
    expect(isDue({ enabled: true, nextRunAt: now.toISOString() }, now)).toBe(true);
  });
  it('not due when disabled, in the future, or unset', () => {
    expect(isDue({ enabled: false, nextRunAt: '2026-06-30T11:00:00Z' }, now)).toBe(false);
    expect(isDue({ enabled: true, nextRunAt: '2026-06-30T13:00:00Z' }, now)).toBe(false);
    expect(isDue({ enabled: true, nextRunAt: null }, now)).toBe(false);
  });
});

describe('validators', () => {
  it('isCadence / isSupportedReport gate inputs', () => {
    expect(isCadence('weekly')).toBe(true);
    expect(isCadence('hourly')).toBe(false);
    expect(isSupportedReport('users')).toBe(true);
    expect(isSupportedReport('payroll')).toBe(false);
  });
});
