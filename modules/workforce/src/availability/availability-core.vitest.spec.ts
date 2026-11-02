// availability-core.vitest.spec.ts — ported from the other chat (merge Oct 12 2026); statuses in OUR 528/582 vocabulary
// ('approved' | 'pending' | 'rejected' | 'cancelled'). Fixed instants only — no date-dependent assertions.
import { describe, it, expect } from 'vitest';
import { isTechnicianAvailableAt, workingWindows, hhmmToMin, dowOfDate, type ScheduleFacts } from './availability-core';

// 2026-10-12 is a Monday. Salon in America/New_York (EDT, UTC-4): 10:00 local = 14:00Z.
const MON_10 = '2026-10-12T14:00:00.000Z';
const base: ScheduleFacts = {
  timezone: 'America/New_York',
  weekly: {
    monday: { isWorking: true, startTime: '09:00', endTime: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
    tuesday: { isWorking: false, startTime: '09:00', endTime: '18:00' },
    wednesday: { isWorking: true, startTime: '09:00', endTime: '20:00', shifts: [{ startTime: '09:00', endTime: '13:00' }, { startTime: '16:00', endTime: '20:00' }], breaks: [{ startTime: '17:00', endTime: '17:15', type: 'paid' }] },
  },
  branchId: 'b1',
};

describe('availability-core — shift / lunch', () => {
  it('inside the shift and away from lunch → available', () => expect(isTechnicianAvailableAt(base, MON_10, 45)).toEqual({ available: true }));
  it('window overlapping lunch → LUNCH', () => expect(isTechnicianAvailableAt(base, '2026-10-12T15:30:00.000Z', 45).reason).toBe('LUNCH'));
  it('window that would end after the shift → OUTSIDE_SHIFT', () => expect(isTechnicianAvailableAt(base, '2026-10-12T21:30:00.000Z', 45).reason).toBe('OUTSIDE_SHIFT'));
  it('before the shift → OUTSIDE_SHIFT', () => expect(isTechnicianAvailableAt(base, '2026-10-12T12:30:00.000Z', 30).reason).toBe('OUTSIDE_SHIFT'));
  it('a non-working day → OFF_DAY; a day with no entry → OFF_DAY; an empty schedule → NO_SCHEDULE', () => {
    expect(isTechnicianAvailableAt(base, '2026-10-13T14:00:00.000Z', 30).reason).toBe('OFF_DAY');
    expect(isTechnicianAvailableAt(base, '2026-10-15T14:00:00.000Z', 30).reason).toBe('OFF_DAY');
    expect(isTechnicianAvailableAt({ ...base, weekly: {} }, MON_10, 30).reason).toBe('NO_SCHEDULE');
  });
  it('the day is the SALON-LOCAL day: 23:30 EDT Monday (03:30Z Tuesday) is still Monday', () => {
    const late: ScheduleFacts = { ...base, weekly: { monday: { isWorking: true, startTime: '09:00', endTime: '23:59' } } };
    expect(isTechnicianAvailableAt(late, '2026-10-13T03:30:00.000Z', 15)).toEqual({ available: true });
  });
  it('multi-shift days: the gap between shifts is OUTSIDE_SHIFT, each shift is bookable, scheduled breaks block', () => {
    expect(isTechnicianAvailableAt(base, '2026-10-14T14:00:00.000Z', 30)).toEqual({ available: true });
    expect(isTechnicianAvailableAt(base, '2026-10-14T18:00:00.000Z', 30).reason).toBe('OUTSIDE_SHIFT');
    expect(isTechnicianAvailableAt(base, '2026-10-14T20:30:00.000Z', 30)).toEqual({ available: true });
    expect(isTechnicianAvailableAt(base, '2026-10-14T20:50:00.000Z', 30).reason).toBe('SCHEDULED_BREAK');
    expect(workingWindows(base.weekly.wednesday)).toEqual([{ s: 540, e: 780 }, { s: 960, e: 1200 }]);
  });
});

describe('availability-core — time off / blocked / live break / branch', () => {
  it('APPROVED time off overlapping the window → TIME_OFF; pending / rejected / cancelled do not block', () => {
    const off = (status: string): ScheduleFacts => ({ ...base, timeOff: [{ startsAt: '2026-10-12T00:00:00.000Z', endsAt: '2026-10-13T00:00:00.000Z', status }] });
    expect(isTechnicianAvailableAt(off('approved'), MON_10, 30).reason).toBe('TIME_OFF');
    expect(isTechnicianAvailableAt(off('pending'), MON_10, 30).available).toBe(true);
    expect(isTechnicianAvailableAt(off('rejected'), MON_10, 30).available).toBe(true);
    expect(isTechnicianAvailableAt(off('cancelled'), MON_10, 30).available).toBe(true);
  });
  it('time off scoped to another branch does not block a booking at this branch; unscoped time off blocks everywhere', () => {
    const scoped: ScheduleFacts = { ...base, requestedBranchId: 'b1', timeOff: [{ startsAt: '2026-10-12T00:00:00.000Z', endsAt: '2026-10-13T00:00:00.000Z', status: 'approved', branchId: 'b2' }] };
    expect(isTechnicianAvailableAt(scoped, MON_10, 30).available).toBe(true);
    const everywhere: ScheduleFacts = { ...scoped, timeOff: [{ ...scoped.timeOff![0], branchId: null }] };
    expect(isTechnicianAvailableAt(everywhere, MON_10, 30).reason).toBe('TIME_OFF');
  });
  it('a blocked time on that date → BLOCKED; on another date it is ignored', () => {
    expect(isTechnicianAvailableAt({ ...base, blockedTimes: [{ date: '2026-10-12', startTime: '10:15', endTime: '11:00' }] }, MON_10, 30).reason).toBe('BLOCKED');
    expect(isTechnicianAvailableAt({ ...base, blockedTimes: [{ date: '2026-10-19', startTime: '10:15', endTime: '11:00' }] }, MON_10, 30).available).toBe(true);
  });
  it('a LIVE open break at the window start → ON_BREAK; a closed one does not block', () => {
    expect(isTechnicianAvailableAt({ ...base, liveBreaks: [{ startedAt: '2026-10-12T13:50:00.000Z', endedAt: null }] }, MON_10, 30).reason).toBe('ON_BREAK');
    expect(isTechnicianAvailableAt({ ...base, liveBreaks: [{ startedAt: '2026-10-12T13:50:00.000Z', endedAt: '2026-10-12T13:59:00.000Z' }] }, MON_10, 30).available).toBe(true);
  });
  it('a booking at another branch than the technician works at → BRANCH_MISMATCH (checked first)', () => {
    expect(isTechnicianAvailableAt({ ...base, requestedBranchId: 'b2' }, MON_10, 30).reason).toBe('BRANCH_MISMATCH');
    expect(isTechnicianAvailableAt({ ...base, requestedBranchId: 'b1' }, MON_10, 30).available).toBe(true);
    expect(isTechnicianAvailableAt({ ...base, branchId: null, requestedBranchId: 'b2' }, MON_10, 30).available).toBe(true);
  });
  it('helpers', () => {
    expect(hhmmToMin('09:30')).toBe(570); expect(hhmmToMin('9:05')).toBe(545); expect(hhmmToMin('25:00')).toBeNull(); expect(hhmmToMin('')).toBeNull();
    expect(dowOfDate('2026-10-12')).toBe(1); expect(dowOfDate('2026-10-11')).toBe(0);
    expect(isTechnicianAvailableAt(base, 'garbage', 30).available).toBe(false);
  });
});
