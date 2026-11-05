/* owner.dto.vitest.spec.ts — pure-helper unit tests for the Owner dashboard math (no DB). */
import { describe, it, expect } from 'vitest';
import { pct, pctOf, weekStart, ranges, periodRange } from './owner.dto';

describe('owner.dto helpers', () => {
  it('pct: normal change rounds to 1 decimal', () => {
    expect(pct(110, 100)).toBe(10);
    expect(pct(125, 100)).toBe(25);
    expect(pct(80, 100)).toBe(-20);
  });
  it('pct: prev=0 yields 100 if curr>0 else 0 (never Infinity/NaN)', () => {
    expect(pct(50, 0)).toBe(100);
    expect(pct(0, 0)).toBe(0);
    expect(Number.isFinite(pct(999, 0))).toBe(true);
  });
  it('weekStart anchors to Monday at midnight in its zone (UTC by default)', () => {
    // UTC getters: the default zone is UTC, so the machine's own time zone must not decide the result (this read local
    // getters and failed on any machine not set to UTC — e.g. a developer in New York)
    const wed = new Date(Date.UTC(2026, 5, 10, 14, 30)); // Wed Jun 10 2026
    const ws = weekStart(wed);
    expect(ws.getUTCDay()).toBe(1); // Monday
    expect(ws.getUTCHours()).toBe(0);
    expect(ws.getUTCDate()).toBe(8); // Mon Jun 8 2026
  });
  it('ranges: today is half-open [midnight, nextMidnight) and week has 7 day buckets', () => {
    const now = new Date(2026, 5, 10, 14, 0);
    const r = ranges(now);
    expect(r.today.fromIso <= now.toISOString()).toBe(true);
    expect(r.weekDays.length).toBe(7);
    // prior-week window length equals the elapsed week-to-date window length
    const wk = Date.parse(r.week.toIso) - Date.parse(r.week.fromIso);
    const pwk = Date.parse(r.priorWeek.toIso) - Date.parse(r.priorWeek.fromIso);
    expect(Math.abs(wk - pwk)).toBeLessThan(1000);
  });
  it('periodRange: comparison window equals current elapsed length (month + week)', () => {
    const now = new Date(2026, 5, 10, 14, 0); // Wed Jun 10 2026
    for (const period of ['week', 'month', 'quarter', 'year'] as const) {
      const { from, prev } = periodRange(now, period);
      const cur = Date.parse(from.toIso) - Date.parse(from.fromIso);
      const cmp = Date.parse(prev.toIso) - Date.parse(prev.fromIso);
      expect(Math.abs(cur - cmp)).toBeLessThan(1000);
      expect(Date.parse(prev.fromIso)).toBeLessThan(Date.parse(from.fromIso));
    }
  });
  it('periodRange today = yesterday comparison', () => {
    const now = new Date(2026, 5, 10, 14, 0);
    const { from, prev } = periodRange(now, 'today');
    expect(from.fromIso.slice(0, 10)).toBe('2026-06-10');
    expect(prev.fromIso.slice(0, 10)).toBe('2026-06-09');
  });
  it('pctOf: share of total to 1 decimal; total=0 → 0 (never NaN)', () => {
    expect(pctOf(96, 128)).toBe(75);
    expect(pctOf(4, 7)).toBe(57.1);
    expect(pctOf(5, 0)).toBe(0);
    expect(Number.isNaN(pctOf(1, 0))).toBe(false);
  });
  it('weekStart respects the timezone (Monday at local midnight)', () => {
    const now = new Date('2026-06-10T06:30:00Z'); // Wed in UTC; in LA it is still Tue Jun 9 23:30 PDT
    expect(weekStart(now, 'UTC').toISOString()).toBe('2026-06-08T00:00:00.000Z');         // UTC Monday Jun 8 00:00
    expect(weekStart(now, 'America/Los_Angeles').toISOString()).toBe('2026-06-08T07:00:00.000Z'); // LA Monday Jun 8 00:00 PDT
  });
  it('ranges/periodRange compute day boundaries in the tenant timezone (cross-midnight)', () => {
    const now = new Date('2026-06-10T06:30:00Z'); // 06:30 UTC = 23:30 PDT on Jun 9 (LA) / 15:30 JST on Jun 10 (Tokyo)
    expect(ranges(now, 'UTC').today.fromIso).toBe('2026-06-10T00:00:00.000Z');
    // Los Angeles (UTC-7 PDT in June): "today" began at local midnight Jun 9 = 07:00 UTC — a UTC bucket would wrongly say Jun 10
    expect(ranges(now, 'America/Los_Angeles').today.fromIso).toBe('2026-06-09T07:00:00.000Z');
    expect(periodRange(now, 'today', 'America/Los_Angeles').from.fromIso).toBe('2026-06-09T07:00:00.000Z');
    expect(periodRange(now, 'month', 'America/Los_Angeles').from.fromIso).toBe('2026-06-01T07:00:00.000Z');
    // a zone AHEAD of UTC: Tokyo (UTC+9) local midnight Jun 10 = Jun 9 15:00 UTC
    expect(ranges(now, 'Asia/Tokyo').today.fromIso).toBe('2026-06-09T15:00:00.000Z');
  });
  it('ranges/periodRange carry tenant-local date bounds for DATE-column (appt_date) filtering', () => {
    const now = new Date('2026-06-10T06:30:00Z'); // LA: still Tue Jun 9 23:30 PDT
    const rUTC = ranges(now, 'UTC');
    expect([rUTC.today.fromDate, rUTC.today.toDate]).toEqual(['2026-06-10', '2026-06-10']);
    const rLA = ranges(now, 'America/Los_Angeles');
    expect([rLA.today.fromDate, rLA.today.toDate]).toEqual(['2026-06-09', '2026-06-09']); // local day is Jun 9
    expect([rLA.week.fromDate, rLA.week.toDate]).toEqual(['2026-06-08', '2026-06-09']);    // Mon Jun 8 .. today Jun 9
    const pmLA = periodRange(now, 'month', 'America/Los_Angeles');
    expect([pmLA.from.fromDate, pmLA.from.toDate]).toEqual(['2026-06-01', '2026-06-09']);
  });
});