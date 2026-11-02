import { describe, it, expect, beforeEach } from 'vitest';
import { syncUserLocale, businessTimeZone, setBusinessTimeZone, fmtDate, fmtTime, fmtDateTime, fmtMonthDay, fmtYmd, resetLocaleForTests } from './locale';
import { getLanguage, resetI18nForTests } from './i18n';

beforeEach(() => { resetI18nForTests(); resetLocaleForTests(); try { localStorage.clear(); } catch { /* */ } });

describe('user locale sync (C6 §98–99)', () => {
  it('applies the server language AND the branch time zone', async () => {
    await syncUserLocale(async () => ({ language: 'vi', timeZone: 'America/New_York' }));
    expect(getLanguage()).toBe('vi');
    expect(businessTimeZone()).toBe('America/New_York');
  });
  it('a failed load keeps the device language and leaves the zone unset (device zone = today\'s behaviour)', async () => {
    await syncUserLocale(async () => { throw new Error('offline'); }, 'en-US');
    expect(getLanguage()).toBe('en');
    expect(businessTimeZone()).toBeUndefined();
  });
  it('sign-out clears the business zone', async () => {
    setBusinessTimeZone('America/Chicago'); setBusinessTimeZone(null);
    expect(businessTimeZone()).toBeUndefined();
  });
});

describe('business formatters bind the branch zone (§99)', () => {
  it('a NJ salon\'s 3:05 PM shows as 3:05 PM on a phone set to any zone', () => {
    setBusinessTimeZone('America/New_York');
    expect(fmtTime('2026-10-09T19:05:00Z')).toBe('3:05 PM');
    expect(fmtDate('2026-10-10T01:30:00Z')).toBe('Oct 9, 2026');
    expect(fmtMonthDay('2026-10-10T01:30:00Z')).toBe('Oct 9');
    expect(fmtDateTime('2026-10-09T19:05:00Z')).toBe('Oct 9, 3:05 PM');
    expect(fmtYmd('2026-10-09')).toBe('Oct 9, 2026');
  });
  it('no branch zone → the device zone (exactly the old local formatters)', () => {
    const iso = '2026-10-09T19:05:00Z';
    expect(fmtTime(iso)).toBe(new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    expect(fmtDate(iso)).toBe(new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  });
});
