// shift-overrides — F4 (Finish the Five, 30 Oct 2026): the date override laid over the weekly template, as Booking's ONE
// schedule reader uses it (precedence override > weekly template > store hours; overnight carry; breaks; lunch at 13:15).
import { describe, it, expect } from 'vitest';
import { effectiveDaySchedule, addLocalDays } from './shift-overrides';
import { pbTechDayWindows, pbComputeAvailabilityInWindows } from './booking.dto';

const weekly = { isWorking: true, startTime: '09:00', endTime: '19:00', lunchStartTime: '12:00', lunchEndTime: '12:30' };
const ov = (o: any = {}) => ({ technicianId: 'm', localDate: '2026-11-06', overrideType: 'CUSTOM_SHIFT' as const, startLocalTime: '10:00', endLocalTime: '18:00', endsNextDay: false, breaks: [], version: 1, ...o });

describe('effectiveDaySchedule', () => {
  it('no override → the weekly template exactly', () => { expect(effectiveDaySchedule(weekly, null, null)).toBe(weekly); });
  it('a custom shift replaces the window and the weekly lunch', () => {
    const d = effectiveDaySchedule(weekly, ov(), null)!;
    expect(pbTechDayWindows('08:00', '20:00', d, [])).toEqual([{ start: 600, end: 1080 }]);
  });
  it('a day off removes the day; last night\'s overnight shift still owns its early morning', () => {
    expect(pbTechDayWindows('00:00', '23:59', effectiveDaySchedule(weekly, ov({ overrideType: 'DAY_OFF', startLocalTime: null, endLocalTime: null }), null)!, [])).toEqual([]);
    const prev = ov({ localDate: '2026-11-05', startLocalTime: '20:00', endLocalTime: '02:00', endsNextDay: true, breaks: [{ type: 'unpaid', startLocalTime: '00:30', endLocalTime: '00:45' }] });
    const d = effectiveDaySchedule(weekly, ov({ overrideType: 'DAY_OFF', startLocalTime: null, endLocalTime: null }), prev)!;
    expect(pbTechDayWindows('00:00', '23:59', d, [])).toEqual([{ start: 0, end: 30 }, { start: 45, end: 120 }]);
  });
  it('a 13:00–13:30 lunch is never offered at 13:15', () => {
    const d = effectiveDaySchedule(weekly, ov({ startLocalTime: '09:00', endLocalTime: '19:00', breaks: [{ type: 'lunch', startLocalTime: '13:00', endLocalTime: '13:30' }] }), null)!;
    const slots = pbComputeAvailabilityInWindows(pbTechDayWindows('08:00', '20:00', d, []), 15, 15, 0, []);
    expect(slots).not.toContain('13:15'); expect(slots).not.toContain('13:00'); expect(slots).toContain('12:00'); expect(slots).toContain('13:30');
  });
  it('an overnight shift owns start → midnight on its date (breaks after midnight move to the next date)', () => {
    const d = effectiveDaySchedule(weekly, ov({ startLocalTime: '20:00', endLocalTime: '02:00', endsNextDay: true, breaks: [{ type: 'paid', startLocalTime: '22:00', endLocalTime: '22:15' }, { type: 'unpaid', startLocalTime: '01:00', endLocalTime: '01:15' }] }), null)!;
    expect(d.shifts).toEqual([{ startTime: '20:00', endTime: '24:00' }]);
    expect(d.breaks).toEqual([{ startTime: '22:00', endTime: '22:15', type: 'paid' }]);
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01'); expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
