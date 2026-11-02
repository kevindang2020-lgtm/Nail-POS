import { describe, it, expect } from 'vitest';
import { zonedParts, businessDate, utcDate, localHour, tzOffsetMs, localDateTimeToEpochMs, epochToLocalDate, isYmd, addDays, minutesSinceMidnight, dayStartMs, monthStartMs } from './index';
const NJ = 'America/New_York';
describe('the salon day is not the UTC day', () => {
  it('8:30 pm in New Jersey on Jan 5 is Jan 6 in UTC — businessDate says Jan 5, utcDate says Jan 6', () => {
    const t = new Date('2026-01-06T01:30:00Z');
    expect(businessDate(NJ, t)).toBe('2026-01-05'); expect(utcDate(t)).toBe('2026-01-06'); expect(localHour(t, NJ)).toBe(20);
  });
  it('zonedParts weekday and hour across DST (EDT −4 in July, EST −5 in January)', () => {
    expect(zonedParts(new Date('2026-07-04T16:00:00Z'), NJ)).toMatchObject({ hour: 12, weekday: 6 });
    expect(tzOffsetMs(new Date('2026-07-04T16:00:00Z'), NJ)).toBe(-4 * 3600e3); expect(tzOffsetMs(new Date('2026-01-04T16:00:00Z'), NJ)).toBe(-5 * 3600e3);
  });
  it('an unknown zone falls back instead of throwing (queue ticket numbering relied on this)', () => { expect(() => businessDate('Not/AZone')).not.toThrow(); expect(businessDate('Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/); });
});
describe('wall-clock ↔ epoch (reminders)', () => {
  it('9:00 on a DST-change day resolves correctly both sides of the change', () => {
    expect(new Date(localDateTimeToEpochMs('2026-03-08', '09:00', NJ)).toISOString()).toBe('2026-03-08T13:00:00.000Z');   // after spring-forward: EDT
    expect(new Date(localDateTimeToEpochMs('2026-03-07', '09:00', NJ)).toISOString()).toBe('2026-03-07T14:00:00.000Z');   // day before: EST
  });
  it('round-trips through epochToLocalDate; malformed → NaN', () => { expect(epochToLocalDate(localDateTimeToEpochMs('2026-11-01', '23:30', NJ), NJ)).toBe('2026-11-01'); expect(localDateTimeToEpochMs('nope', '9', NJ)).toBeNaN(); });
});
describe('YMD arithmetic and parsing', () => {
  it('addDays over month end and leap day', () => { expect(addDays('2026-01-31', 1)).toBe('2026-02-01'); expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); expect(addDays('2026-03-01', -1)).toBe('2026-02-28'); });
  it('isYmd', () => { expect(isYmd('2026-09-23')).toBe(true); expect(isYmd('9/23/2026')).toBe(false); expect(isYmd(null)).toBe(false); });
  it('minutesSinceMidnight', () => { expect(minutesSinceMidnight('9:05')).toBe(545); expect(minutesSinceMidnight('23:59')).toBe(1439); expect(minutesSinceMidnight('24:00')).toBeNull(); expect(minutesSinceMidnight('')).toBeNull(); });
});

describe('the salon\'s day and month began at ITS midnight (what date_trunc(\'day\', now()) meant to say)', () => {
  it('9:30 pm in New Jersey: today began at 04:00 UTC this morning — not at the UTC midnight that has just passed', () => {
    const now = new Date('2026-10-06T01:30:00Z');   // Oct 5, 9:30 pm EDT
    expect(new Date(dayStartMs('America/New_York', now)).toISOString()).toBe('2026-10-05T04:00:00.000Z');
    expect(new Date(dayStartMs('America/Los_Angeles', now)).toISOString()).toBe('2026-10-05T07:00:00.000Z');
    expect(new Date(dayStartMs('UTC', now)).toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });
  it('the month: Oct 31, 9 pm in New Jersey is still October; daylight saving changes inside a month are honoured', () => {
    expect(new Date(monthStartMs('America/New_York', new Date('2026-11-01T01:00:00Z'))).toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(new Date(monthStartMs('America/New_York', new Date('2026-11-20T15:00:00Z'))).toISOString()).toBe('2026-11-01T04:00:00.000Z');   // EDT on Nov 1 at midnight
    expect(new Date(dayStartMs('America/New_York', new Date('2026-11-02T15:00:00Z'))).toISOString()).toBe('2026-11-02T05:00:00.000Z');   // EST after the change
  });
});

describe('dateColumnYmd — a Postgres DATE as YYYY-MM-DD (Oct 23 2026)', async () => {
  const { dateColumnYmd } = await import('./index');
  it('a driver Date (local midnight) → its calendar day; a string passes; junk → null', () => {
    expect(dateColumnYmd(new Date(2026, 9, 23))).toBe('2026-10-23');      // what node-postgres returns for DATE '2026-10-23'
    expect(String(new Date(2026, 9, 23)).slice(0, 10)).not.toBe('2026-10-23');   // the bug it replaces
    expect(dateColumnYmd('2026-10-23')).toBe('2026-10-23');
    expect(dateColumnYmd('2026-10-23T00:00:00.000Z')).toBe('2026-10-23');
    expect(dateColumnYmd(null)).toBeNull(); expect(dateColumnYmd('')).toBeNull(); expect(dateColumnYmd('nope')).toBeNull(); expect(dateColumnYmd(new Date('x'))).toBeNull();
  });
});
