// shift-overrides.ts — F4 (Finish the Five, 30 Oct 2026): a technician's DATE-SPECIFIC shift (technician_shift_overrides,
// migration 719) laid over the weekly template (technician_schedules). PURE: minutes-of-day arithmetic only.
//
// Precedence (documented): date override  >  weekly recurring template  >  store hours. Approved time off and blocked
// times are subtracted afterwards by the existing reader (blockedTimes), and actual clock-in / clock-out stays separate
// (technician_shifts) — "off shift" and "available now" are different facts.
//
//   DAY_OFF        the technician does not work that salon-local date (a previous night's overnight shift that runs past
//                  midnight still owns its early-morning part);
//   CUSTOM_SHIFT   one window start → end with its own breaks (the weekly lunch does NOT carry over — the override says
//                  exactly what the day is). An overnight shift (ends_next_day) owns start → 24:00 on its date and
//                  00:00 → end on the NEXT date; a break after midnight belongs to the next date's part;
//   no override    the weekly template exactly as before (plus the early-morning part of last night's overnight override).
import { pbMinutesOf, type PBTechDaySchedule } from './booking.dto';
import { addDays } from '@aipowersalon/date-time';

export type ShiftOverrideType = 'CUSTOM_SHIFT' | 'DAY_OFF';
export interface ShiftOverrideBreak { type: string; startLocalTime: string; endLocalTime: string }
export interface ShiftOverride {
  technicianId: string; localDate: string; overrideType: ShiftOverrideType;
  startLocalTime: string | null; endLocalTime: string | null; endsNextDay: boolean; breaks: ShiftOverrideBreak[]; version: number;
}
const hm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : null);
const bType = (t: string): 'lunch' | 'paid' | 'unpaid' => (t === 'lunch' ? 'lunch' : t === 'paid' ? 'paid' : 'unpaid');

/** the part of an overnight override that falls on the NEXT date (00:00 → end), with its after-midnight breaks */
function carryPart(prev: ShiftOverride | null | undefined): { shift: { startTime: string; endTime: string } | null; breaks: { startTime: string; endTime: string; type: 'lunch' | 'paid' | 'unpaid' }[] } {
  if (!prev || prev.overrideType !== 'CUSTOM_SHIFT' || !prev.endsNextDay || !prev.endLocalTime || !prev.startLocalTime) return { shift: null, breaks: [] };
  const start = pbMinutesOf(hm(prev.startLocalTime)!);
  const after = (prev.breaks ?? []).filter((b) => pbMinutesOf(b.startLocalTime) < start);
  return { shift: { startTime: '00:00', endTime: hm(prev.endLocalTime)! }, breaks: after.map((b) => ({ startTime: b.startLocalTime, endTime: b.endLocalTime, type: bType(b.type) })) };
}

/** The effective day for booking availability (the shape pbTechDayWindows already understands). */
export function effectiveDaySchedule(recurring: PBTechDaySchedule | null | undefined, override: ShiftOverride | null | undefined, previousDay: ShiftOverride | null | undefined): PBTechDaySchedule | null | undefined {
  const carry = carryPart(previousDay);
  if (!override) {
    if (!carry.shift) return recurring;
    if (!recurring) return recurring;   // no weekly row → store hours already cover the early morning
    const base = recurring.isWorking ? (recurring.shifts?.length ? recurring.shifts : recurring.startTime && recurring.endTime ? [{ startTime: recurring.startTime, endTime: recurring.endTime }] : []) : [];
    const baseBreaks = recurring.breaks?.length ? recurring.breaks : recurring.lunchStartTime && recurring.lunchEndTime ? [{ startTime: recurring.lunchStartTime, endTime: recurring.lunchEndTime, type: 'lunch' as const }] : [];
    return { isWorking: true, shifts: [carry.shift, ...base], breaks: [...carry.breaks, ...baseBreaks] };
  }
  if (override.overrideType === 'DAY_OFF') {
    return carry.shift ? { isWorking: true, shifts: [carry.shift], breaks: carry.breaks } : { isWorking: false, shifts: null, breaks: null };
  }
  const start = hm(override.startLocalTime)!; const end = override.endsNextDay ? '24:00' : hm(override.endLocalTime)!;
  const s = pbMinutesOf(start);
  const today = (override.breaks ?? []).filter((b) => !override.endsNextDay || pbMinutesOf(b.startLocalTime) >= s)
    .map((b) => ({ startTime: b.startLocalTime, endTime: b.endLocalTime, type: bType(b.type) }));
  return { isWorking: true, shifts: [...(carry.shift ? [carry.shift] : []), { startTime: start, endTime: end }], breaks: [...carry.breaks, ...today],
    startTime: start, endTime: end, lunchStartTime: null, lunchEndTime: null };
}

/** salon-local date ± n days (YYYY-MM-DD, calendar arithmetic — no time zone involved) */
export function addLocalDays(date: string, n: number): string {
  return addDays(date, n);
}
