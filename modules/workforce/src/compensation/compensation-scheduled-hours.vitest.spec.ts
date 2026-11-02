// compensation-scheduled-hours.vitest.spec.ts — the scheduled-hours derivation used by guarantee proration.
// Jul 1, 2026 is a WEDNESDAY; Jul 1–7 covers Wed..Tue (one of each weekday).
import { describe, it, expect } from 'vitest';
import { computeScheduledHours, type WeeklyTemplateRow } from './compensation-scheduled-hours';

const day = (dayOfWeek: number, over: Partial<WeeklyTemplateRow> = {}): WeeklyTemplateRow => ({
  dayOfWeek, startTime: '09:00', endTime: '18:00', lunchStart: '12:00', lunchEnd: '13:00', isWorking: true, ...over,
});

describe('scheduled hours from the weekly template (migration 003) + blocked windows (035)', () => {
  it('Mon–Fri 9–6 with a 1h lunch over Jul 1–7 → 5 days × 8h = 40h', () => {
    const tmpl = [1, 2, 3, 4, 5].map((d) => day(d));
    expect(computeScheduledHours(tmpl, [], '2026-07-01', '2026-07-07')).toEqual({ scheduledHours: 40, scheduledDays: 5 });
  });

  it('is_working=false and weekend days contribute nothing', () => {
    const tmpl = [day(0, { isWorking: false }), day(3)]; // only Wednesday works
    expect(computeScheduledHours(tmpl, [], '2026-07-01', '2026-07-07')).toEqual({ scheduledHours: 8, scheduledDays: 1 });
  });

  it('a missing lunch bound means no lunch subtraction; HH:MM:SS times parse', () => {
    const tmpl = [day(3, { startTime: '09:00:00', endTime: '17:00:00', lunchStart: '12:00', lunchEnd: null })];
    expect(computeScheduledHours(tmpl, [], '2026-07-01', '2026-07-07')).toEqual({ scheduledHours: 8, scheduledDays: 1 });
  });

  it('a block subtracts its window from that date only', () => {
    const tmpl = [day(3), day(4)]; // Wed + Thu, 8h each
    const blocks = [{ date: '2026-07-01', startTime: '14:00', endTime: '16:00' }]; // 2h off Wednesday
    expect(computeScheduledHours(tmpl, blocks, '2026-07-01', '2026-07-07')).toEqual({ scheduledHours: 14, scheduledDays: 2 });
  });

  it('a full-day block zeroes the day AND drops it from scheduledDays (never negative)', () => {
    const tmpl = [day(3), day(4)];
    const blocks = [{ date: '2026-07-01', startTime: '00:00', endTime: '23:59' }];
    expect(computeScheduledHours(tmpl, blocks, '2026-07-01', '2026-07-07')).toEqual({ scheduledHours: 8, scheduledDays: 1 });
  });

  it('two template rows on the same weekday SUM (multi-branch schedule on a tenant-wide period)', () => {
    const tmpl = [day(3, { lunchStart: null, lunchEnd: null, startTime: '09:00', endTime: '12:00' }),
                  day(3, { lunchStart: null, lunchEnd: null, startTime: '14:00', endTime: '18:00' })];
    expect(computeScheduledHours(tmpl, [], '2026-07-01', '2026-07-07')).toEqual({ scheduledHours: 7, scheduledDays: 1 });
  });

  it('returns null honestly: empty template, no working rows, overnight-only rows, or a fully blocked period', () => {
    expect(computeScheduledHours([], [], '2026-07-01', '2026-07-07')).toBeNull();
    expect(computeScheduledHours([day(3, { isWorking: false })], [], '2026-07-01', '2026-07-07')).toBeNull();
    expect(computeScheduledHours([day(3, { startTime: '18:00', endTime: '09:00' })], [], '2026-07-01', '2026-07-07')).toBeNull();
    expect(computeScheduledHours([day(3)], [{ date: '2026-07-01', startTime: '00:00', endTime: '23:59' }], '2026-07-01', '2026-07-07')).toBeNull();
  });

  it('date-only vs timestamp bounds both work; reversed bounds → null', () => {
    expect(computeScheduledHours([day(3)], [], '2026-07-01T00:00:00.000Z', '2026-07-07T23:59:59.999Z'))
      .toEqual({ scheduledHours: 8, scheduledDays: 1 });
    expect(computeScheduledHours([day(3)], [], '2026-07-07', '2026-07-01')).toBeNull();
  });
});
