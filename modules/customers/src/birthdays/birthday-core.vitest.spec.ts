// birthday-core — Birthday Campaigns guide §05–§08 (B05, B06, B09): the ONE birthday → occurrence rule.
import { describe, it, expect } from 'vitest';
import { parts, storedDateString, monthDayOf, parseBirthdayInput, occurrence, nextOccurrence, occurrencesIn, occasionYear, inMonth, toStorage, addDays, daysBetween } from './birthday-core';

describe('a DATE is a calendar date, never an instant (the profile display P0)', () => {
  it('node-postgres hands DATE back as a local-midnight Date: its calendar parts are read, not String(Date).slice', () => {
    const d = new Date(2026, 9, 1);   // what pg gives for 2026-10-01
    expect(String(d).slice(0, 10)).not.toBe('2026-10-01');   // the old code printed "Thu Oct 01"
    expect(storedDateString(d)).toBe('2026-10-01');
    expect(monthDayOf(d)).toEqual({ month: 10, day: 1 });
  });
  it('PGlite hands DATE back as UTC midnight: also read as the stored calendar date, in any server timezone', () => {
    expect(storedDateString(new Date('2000-10-05T00:00:00Z'))).toBe('2000-10-05');
  });
  it('strings are read as written; impossible dates are null', () => {
    expect(storedDateString('1990-10-15')).toBe('1990-10-15');
    expect(parts('2026-02-30')).toBeNull(); expect(parts('2025-02-29')).toBeNull(); expect(parts('2024-02-29')).not.toBeNull();
    expect(storedDateString(null)).toBeNull(); expect(storedDateString('not a date')).toBeNull();
  });
});

describe('input validation (B03, B04)', () => {
  const today = '2026-10-31';
  it('YYYY-MM-DD with a real year; MM-DD / --MM-DD = year unknown (stored on 2000, the leap year)', () => {
    expect(parseBirthdayInput('1990-10-15', today)).toEqual({ ok: true, value: { date: '1990-10-15', yearKnown: true, month: 10, day: 15 } });
    expect(parseBirthdayInput('02-29', today)).toEqual({ ok: true, value: { date: '2000-02-29', yearKnown: false, month: 2, day: 29 } });
    expect(parseBirthdayInput('--12-31', today)).toMatchObject({ ok: true, value: { date: '2000-12-31', yearKnown: false } });
  });
  it('refuses impossible dates, future dates, the 1900 sentinel and junk — never guesses', () => {
    for (const bad of ['2026-02-30', '1991-02-29', '02-30', '13-01', '2026-11-01', '1900-05-05', '1899-01-01', 'Oct 15', '', '10/15/1990'])
      expect(parseBirthdayInput(bad, today).ok).toBe(false);
  });
  it('the CSV import month/day form maps to year-unknown storage', () => {
    expect(toStorage('--02-29')).toEqual({ date: '2000-02-29', yearKnown: false });
    expect(toStorage('1985-07-04')).toEqual({ date: '1985-07-04', yearKnown: true });
    expect(toStorage('')).toBeNull(); expect(toStorage('1985-02-30')).toBeNull();
  });
});

describe('annual recurrence (B05) and Feb 29 policy (B06)', () => {
  it('a June 15 birthday recurs every June 15, whatever the birth year', () => {
    expect(occurrence({ month: 6, day: 15 }, 2027)).toBe('2027-06-15');
    expect(occurrence(monthDayOf('1962-06-15')!, 2031)).toBe('2031-06-15');
  });
  it('02-29: itself in a leap year; Feb 28 (default) or Mar 1 in other years — the stored date is never rewritten', () => {
    const leap = { month: 2, day: 29 };
    expect(occurrence(leap, 2028)).toBe('2028-02-29');
    expect(occurrence(leap, 2027)).toBe('2027-02-28');
    expect(occurrence(leap, 2027, 'mar1')).toBe('2027-03-01');
    expect(inMonth(leap, 2, 2027, 'feb28')).toBe(true); expect(inMonth(leap, 3, 2027, 'mar1')).toBe(true); expect(inMonth(leap, 2, 2027, 'mar1')).toBe(false);
  });
});

describe('year rollover and ranges (B09, B11)', () => {
  it('next occurrence wraps Dec 31 → Jan 1; today counts as 0 days', () => {
    expect(nextOccurrence({ month: 1, day: 2 }, '2026-12-30')).toEqual({ date: '2027-01-02', daysUntil: 3 });
    expect(nextOccurrence({ month: 12, day: 30 }, '2026-12-30')).toEqual({ date: '2026-12-30', daysUntil: 0 });
    expect(nextOccurrence({ month: 2, day: 29 }, '2027-02-28')).toEqual({ date: '2027-02-28', daysUntil: 0 });
  });
  it('a cross-year range finds the occurrence in either year; the To date is inclusive', () => {
    expect(occurrencesIn({ month: 1, day: 2 }, '2026-12-25', '2027-01-05')).toEqual(['2027-01-02']);
    expect(occurrencesIn({ month: 12, day: 31 }, '2026-12-25', '2027-01-05')).toEqual(['2026-12-31']);
    expect(occurrencesIn({ month: 1, day: 5 }, '2026-12-25', '2027-01-05')).toEqual(['2027-01-05']);
  });
  it('occasion year = the occurrence closest to the send date (a Dec 28 send for a Jan 2 birthday is next year\'s)', () => {
    expect(occasionYear({ month: 1, day: 2 }, '2026-12-28')).toBe(2027);
    expect(occasionYear({ month: 12, day: 31 }, '2027-01-03')).toBe(2026);
    expect(occasionYear({ month: 6, day: 15 }, '2026-06-01')).toBe(2026);
  });
  it('date arithmetic stays on the calendar (no DST / timezone drift)', () => {
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');   // across the US DST change
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});
