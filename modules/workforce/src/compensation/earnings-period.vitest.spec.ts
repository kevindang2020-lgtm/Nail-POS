// earnings-period.vitest.spec.ts — the ONE earnings window resolver: tenant civil calendar, half-open, capped custom,
// pay_period from a payroll row (Payroll mandate §126–§128). Fixed instants only — no "now" dependence.
import { describe, it, expect } from 'vitest';
import { resolveEarningsWindow, inWindow, MAX_CUSTOM_RANGE_DAYS } from './earnings-period';

const NY = 'America/New_York';
// 2026-07-04 03:30 UTC == 2026-07-03 23:30 in New York (EDT)
const LATE_NJ_EVENING = Date.parse('2026-07-04T03:30:00.000Z');

describe('resolveEarningsWindow', () => {
  it('"today" is the TENANT\'s civil day, not the server\'s UTC day', () => {
    const w = resolveEarningsWindow({ period: 'day', timezone: NY, nowMs: LATE_NJ_EVENING });
    expect(w.fromIso).toBe('2026-07-03T04:00:00.000Z');   // Jul 3 00:00 EDT
    expect(w.toIso).toBe('2026-07-04T04:00:00.000Z');     // Jul 4 00:00 EDT (exclusive)
    expect(w.timezone).toBe(NY);
    const utc = resolveEarningsWindow({ period: 'day', timezone: 'UTC', nowMs: LATE_NJ_EVENING });
    expect(utc.fromIso).toBe('2026-07-04T00:00:00.000Z');
  });
  it('windows are HALF-OPEN: an instant exactly at the upper bound belongs to the NEXT period only', () => {
    const w = resolveEarningsWindow({ period: 'day', timezone: NY, nowMs: LATE_NJ_EVENING });
    expect(inWindow('2026-07-04T04:00:00.000Z', w)).toBe(false);
    expect(inWindow('2026-07-04T03:59:59.999Z', w)).toBe(true);
    expect(inWindow(w.fromIso, w)).toBe(true);
  });
  it('week starts Monday in the tenant zone; month starts on the 1st; both end exclusive at the next boundary', () => {
    const wk = resolveEarningsWindow({ period: 'week', timezone: NY, dateIso: '2026-07-04T03:30:00.000Z' });   // Fri Jul 3 NY
    expect(wk.fromIso).toBe('2026-06-29T04:00:00.000Z');   // Mon Jun 29 00:00 EDT
    expect(wk.toIso).toBe('2026-07-06T04:00:00.000Z');     // Mon Jul 6 00:00 EDT
    const mo = resolveEarningsWindow({ period: 'month', timezone: NY, dateIso: '2026-07-04T03:30:00.000Z' });
    expect(mo.fromIso).toBe('2026-07-01T04:00:00.000Z');
    expect(mo.toIso).toBe('2026-08-01T04:00:00.000Z');
    const dec = resolveEarningsWindow({ period: 'month', timezone: 'UTC', dateIso: '2026-12-15T12:00:00.000Z' });
    expect(dec.toIso).toBe('2027-01-01T00:00:00.000Z');   // year rollover
  });
  it('a DST change inside the week changes the window length, never the boundaries (mandate §127)', () => {
    const w = resolveEarningsWindow({ period: 'week', timezone: NY, dateIso: '2026-03-10T12:00:00.000Z' });   // DST starts Mar 8 2026
    expect(w.fromIso).toBe('2026-03-09T04:00:00.000Z');   // Mon Mar 9 00:00 EDT (−4)
    expect(w.toIso).toBe('2026-03-16T04:00:00.000Z');
    const before = resolveEarningsWindow({ period: 'week', timezone: NY, dateIso: '2026-03-04T12:00:00.000Z' });
    expect(before.fromIso).toBe('2026-03-02T05:00:00.000Z');   // Mon Mar 2 00:00 EST (−5)
    expect(before.toIso).toBe('2026-03-09T04:00:00.000Z');     // the Monday AFTER the switch: 00:00 EDT — 167-hour week, exact boundary
  });
  it('custom requires date < dateTo and is clamped to MAX_CUSTOM_RANGE_DAYS from the start', () => {
    expect(() => resolveEarningsWindow({ period: 'custom', timezone: NY, dateIso: '2026-07-04T00:00:00Z', dateToIso: '2026-07-01T00:00:00Z' })).toThrow(/date < dateTo/);
    expect(() => resolveEarningsWindow({ period: 'custom', timezone: NY })).toThrow();
    const c = resolveEarningsWindow({ period: 'custom', timezone: NY, dateIso: '2026-01-01T00:00:00.000Z', dateToIso: '2026-12-31T00:00:00.000Z' });
    expect(c.clamped).toBe(true);
    expect(Date.parse(c.toIso) - Date.parse(c.fromIso)).toBe(MAX_CUSTOM_RANGE_DAYS * 86_400_000);
    const ok = resolveEarningsWindow({ period: 'custom', timezone: NY, dateIso: '2026-01-01T00:00:00.000Z', dateToIso: '2026-01-15T00:00:00.000Z' });
    expect(ok.clamped).toBe(false);
  });
  it('pay_period maps the payroll row\'s inclusive DATE range onto [start 00:00, end + 1 day 00:00) in the tenant zone', () => {
    const w = resolveEarningsWindow({ period: 'pay_period', timezone: NY, payPeriod: { id: 'pp1', periodStart: '2026-09-28', periodEnd: '2026-10-11' } });
    expect(w.fromIso).toBe('2026-09-28T04:00:00.000Z');
    expect(w.toIso).toBe('2026-10-12T04:00:00.000Z');
    expect(w.payPeriodId).toBe('pp1');
    expect(() => resolveEarningsWindow({ period: 'pay_period', timezone: NY })).toThrow(/payroll period/);
  });
  it('an unknown period falls back to day; an unparsable date anchors on now', () => {
    const w = resolveEarningsWindow({ period: 'bogus', timezone: 'UTC', dateIso: 'not-a-date', nowMs: Date.parse('2026-02-02T10:00:00Z') });
    expect(w.period).toBe('day'); expect(w.fromIso).toBe('2026-02-02T00:00:00.000Z');
  });
});
