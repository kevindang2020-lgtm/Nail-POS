// booking-schedule-core.vitest.spec.ts — locks the schedule-aware availability core (booking calendar upgrade).
// Pure minute arithmetic: store hours ∩ technician_schedules − lunch − technician_blocked_times, then open-range
// gap math and grid-aligned slot generation. Covers the §20 availability matrix: closed-before-open, late start,
// early leave, lunch split, blocked time, adjacent appointments, buffers, fully booked, off day, missing schedule.
import { describe, expect, it } from 'vitest';
import {
  pbComputeAvailabilityInWindows, pbOpenRanges, pbTechDayWindows, pbWithinTechWindows, pbDetectTechnicianConflict, type PBStatus,
} from './booking.dto';

const A = (startTime: string, endTime: string, status: PBStatus = 'booked') => ({ startTime, endTime, status });

describe('pbTechDayWindows', () => {
  it('no schedule row → plain store hours (legacy behavior preserved)', () => {
    expect(pbTechDayWindows('09:00', '18:00', null, [])).toEqual([{ start: 540, end: 1080 }]);
  });
  it('is_working=false → no windows (Off today)', () => {
    expect(pbTechDayWindows('09:00', '18:00', { isWorking: false }, [])).toEqual([]);
  });
  it('late start + early leave clamps inside store hours', () => {
    expect(pbTechDayWindows('09:00', '18:00', { isWorking: true, startTime: '10:00', endTime: '16:00' }, []))
      .toEqual([{ start: 600, end: 960 }]);
  });
  it('schedule wider than store hours clamps to store hours', () => {
    expect(pbTechDayWindows('09:00', '18:00', { isWorking: true, startTime: '07:00', endTime: '21:00' }, []))
      .toEqual([{ start: 540, end: 1080 }]);
  });
  it('lunch splits the day into two windows', () => {
    expect(pbTechDayWindows('09:00', '18:00', { isWorking: true, startTime: '09:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00' }, []))
      .toEqual([{ start: 540, end: 720 }, { start: 780, end: 1080 }]);
  });
  it('blocked times are subtracted — including one that overlaps a window edge', () => {
    const w = pbTechDayWindows('09:00', '18:00', { isWorking: true, startTime: '09:00', endTime: '17:00' },
      [{ startTime: '10:00', endTime: '10:30' }, { startTime: '16:30', endTime: '18:00' }]);
    expect(w).toEqual([{ start: 540, end: 600 }, { start: 630, end: 990 }]);
  });
  it('degenerate store hours produce nothing', () => {
    expect(pbTechDayWindows('18:00', '09:00', null, [])).toEqual([]);
  });
});

describe('pbOpenRanges (gap minutes)', () => {
  const windows = [{ start: 540, end: 1080 }]; // 9:00–18:00
  it('the spec example: appt ends 11:15, next starts 12:00 → 45 min open (buffer 0)', () => {
    const r = pbOpenRanges(windows, 0, [A('09:00', '11:15'), A('12:00', '18:00')]);
    expect(r).toEqual([{ start: 675, end: 720, minutes: 45 }]);
  });
  it('buffer shrinks gaps on both sides', () => {
    const r = pbOpenRanges(windows, 10, [A('09:00', '11:15'), A('12:00', '18:00')]);
    expect(r).toEqual([{ start: 685, end: 710, minutes: 25 }]);
  });
  it('cancelled and no-show appointments do not consume time', () => {
    const r = pbOpenRanges(windows, 0, [A('10:00', '12:00', 'cancelled'), A('13:00', '15:00', 'no_show')]);
    expect(r).toEqual([{ start: 540, end: 1080, minutes: 540 }]);
  });
  it('fully booked → no open ranges', () => {
    expect(pbOpenRanges(windows, 0, [A('09:00', '18:00')])).toEqual([]);
  });
  it('adjacent appointments leave no phantom gap', () => {
    const r = pbOpenRanges(windows, 0, [A('09:00', '12:00'), A('12:00', '15:00')]);
    expect(r).toEqual([{ start: 900, end: 1080, minutes: 180 }]);
  });
});

describe('pbComputeAvailabilityInWindows', () => {
  it('slot starts align to the 15-minute grid even when a window starts off-grid', () => {
    // window starts 9:10, ends 10:40 → first aligned slot 9:15; 10:15 would end past 10:40 so the last is 10:00
    const slots = pbComputeAvailabilityInWindows([{ start: 550, end: 640 }], 15, 30, 0, []);
    expect(slots).toEqual(['09:15', '09:30', '09:45', '10:00']);
  });
  it('duration must fit inside the window', () => {
    const slots = pbComputeAvailabilityInWindows([{ start: 540, end: 600 }], 15, 45, 0, []);
    expect(slots).toEqual(['09:00', '09:15']);
  });
  it('buffered conflicts remove slots around a busy appointment', () => {
    const slots = pbComputeAvailabilityInWindows([{ start: 540, end: 720 }], 30, 30, 15, [A('10:00', '10:30')]);
    expect(slots).toEqual(['09:00', '11:00', '11:30']);
  });
  it('off day (no windows) yields nothing', () => {
    expect(pbComputeAvailabilityInWindows([], 15, 30, 0, [])).toEqual([]);
  });
});

describe('pbWithinTechWindows', () => {
  const windows = [{ start: 540, end: 720 }, { start: 780, end: 1080 }]; // 9–12, 13–18 (lunch split)
  it('accepts a booking fully inside a window', () => {
    expect(pbWithinTechWindows('09:30', '10:15', windows)).toBe(true);
  });
  it('rejects a booking that straddles the lunch break', () => {
    expect(pbWithinTechWindows('11:30', '13:30', windows)).toBe(false);
  });
  it('rejects a booking outside every window', () => {
    expect(pbWithinTechWindows('12:15', '12:45', windows)).toBe(false);
  });
  it('boundary-exact booking is allowed (end == window end)', () => {
    expect(pbWithinTechWindows('17:00', '18:00', windows)).toBe(true);
  });
});

// §6 same-day clamp: minutes already in the past are never open. `notBeforeMinute` trims or drops ranges.
describe('pbOpenRanges notBeforeMinute (same-day past-time exclusion)', () => {
  const windows = [{ start: 540, end: 1080 }]; // 9:00–18:00
  const A = (s: string, e: string, st: PBStatus = 'booked') => ({ startTime: s, endTime: e, status: st });
  it('clamps a range that started in the past to begin now', () => {
    const r = pbOpenRanges(windows, 0, [A('12:00', '13:00')], 600); // now = 10:00
    expect(r[0]).toEqual({ start: 600, end: 720, minutes: 120 });   // 10:00–12:00, not 9:00–12:00
  });
  it('drops ranges that ended entirely in the past', () => {
    const r = pbOpenRanges(windows, 0, [A('11:00', '18:00')], 720); // free 9–11 only; now = 12:00
    expect(r).toEqual([]);
  });
  it('null / 0 leaves ranges untouched (other dates)', () => {
    expect(pbOpenRanges(windows, 0, [], null)).toEqual([{ start: 540, end: 1080, minutes: 540 }]);
    expect(pbOpenRanges(windows, 0, [], 0)).toEqual([{ start: 540, end: 1080, minutes: 540 }]);
  });
  it('future-day ranges pass through when now is before opening', () => {
    expect(pbOpenRanges(windows, 0, [], 300)).toEqual([{ start: 540, end: 1080, minutes: 540 }]); // now 5:00 < open
  });
});

// extras 200-Technician 59 (round 10): start + estimated duration + cleanup buffer must end at or before the next appointment
describe('appointment protection: duration + cleanup buffer vs the next appointment', () => {
  const next = [{ appointmentId: 'next', technicianId: 't1', startTime: '11:00', endTime: '12:00', status: 'booked' as PBStatus }];
  it('ending exactly when the buffer reaches the next start is allowed; one minute later is refused and names the next appointment', () => {
    expect(pbDetectTechnicianConflict(next, 't1', '10:00', '10:55', 5)).toEqual({ status: 'none' });             // 10:55 + 5 = 11:00
    expect(pbDetectTechnicianConflict(next, 't1', '10:00', '10:56', 5)).toEqual({ status: 'conflict', conflictingAppointmentId: 'next' });
    expect(pbDetectTechnicianConflict(next, 't1', '10:00', '10:56', 0)).toEqual({ status: 'none' });             // no buffer → fits
  });
  it('the buffer protects the end of the previous appointment too; another technician or a cancelled booking never blocks', () => {
    expect(pbDetectTechnicianConflict(next, 't1', '12:04', '12:30', 5).status).toBe('conflict');
    expect(pbDetectTechnicianConflict(next, 't1', '12:05', '12:30', 5).status).toBe('none');
    expect(pbDetectTechnicianConflict(next, 't2', '10:00', '11:30', 5).status).toBe('none');
    expect(pbDetectTechnicianConflict([{ ...next[0], status: 'cancelled' as PBStatus }], 't1', '10:00', '11:30', 5).status).toBe('none');
  });
});
