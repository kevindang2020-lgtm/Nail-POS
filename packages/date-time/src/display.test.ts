// Phase 13: the display helpers print EXACTLY what the replaced local formatters printed (device zone = the branch zone),
// and with a branch zone they print the SALON's wall clock wherever the phone is (§99).
import { describe, it, expect } from 'vitest';
import { formatShortDate, formatMonthDay, formatTimeOfDay, formatMonthDayTime, formatYmd, formatHhmm12, formatInZone } from './index';

const ISO = ['2026-10-09T19:05:00Z', '2026-01-01T00:30:00Z', '2026-03-08T07:30:00Z', '2026-12-31T23:59:59Z'];
describe('byte-identical to the replaced formatters when tz is the device zone', () => {
  it('short date / month-day / time / month-day-time', () => {
    for (const i of ISO) {
      const d = new Date(i);
      expect(formatShortDate(i)).toBe(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
      expect(formatMonthDay(i)).toBe(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      expect(formatTimeOfDay(i)).toBe(d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
      expect(formatMonthDayTime(i)).toBe(d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
    }
  });
  it('a calendar date is never shifted (new Date(ymd + "T00:00:00") rule)', () => {
    for (const y of ['2026-10-09', '2026-01-01', '2026-03-08']) {
      expect(formatYmd(y)).toBe(new Date(y + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
    }
    expect(formatYmd('nope')).toBe('');
    expect(formatYmd('nope', undefined, 'en-US', 'nope')).toBe('nope');
  });
  it('invalid / empty → ""', () => { for (const x of ['', null, undefined, 'garbage']) expect(formatShortDate(x as any)).toBe(''); });
  it('HH:MM → 12-hour', () => {
    expect(formatHhmm12('00:05')).toBe('12:05 AM'); expect(formatHhmm12('12:00')).toBe('12:00 PM'); expect(formatHhmm12('14:30')).toBe('2:30 PM'); expect(formatHhmm12('x')).toBe('');
  });
});

describe('§99 the branch zone wins over the phone', () => {
  it('7:05 PM UTC is 3:05 PM at a New Jersey salon and 12:05 PM in Los Angeles', () => {
    expect(formatTimeOfDay('2026-10-09T19:05:00Z', 'America/New_York')).toBe('3:05 PM');
    expect(formatTimeOfDay('2026-10-09T19:05:00Z', 'America/Los_Angeles')).toBe('12:05 PM');
  });
  it('the salon\'s DATE after 8 pm Eastern is still today, not tomorrow (UTC)', () => {
    expect(formatShortDate('2026-10-10T01:30:00Z', 'America/New_York')).toBe('Oct 9, 2026');
  });
  it('an unknown zone falls back to the device zone, never throws', () => {
    expect(formatInZone('2026-10-09T19:05:00Z', { hour: 'numeric' }, 'Mars/Olympus')).toBe(new Date('2026-10-09T19:05:00Z').toLocaleString('en-US', { hour: 'numeric' }));
  });
  it('Vietnamese display locale', () => { expect(formatShortDate('2026-10-09T19:05:00Z', 'Asia/Ho_Chi_Minh', 'vi-VN')).toMatch(/2026/); });
});
