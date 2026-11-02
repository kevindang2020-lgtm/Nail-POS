// queue-signals.vitest.spec.ts — BUILD_PLAN Phase 6, audit bug 1/4: the technician signals the engine ranks on
// (availableInMinutes was hard-coded null; rotation had no data). Pure functions over the rows the repository reads.
import { describe, it, expect } from 'vitest';
import { computeTechSignals, rotationOrder, assignedMinutesFor, lateMinutesAt, hhmmToMinutes, type TechSignalInput } from './queue-signals';

const NOW = Date.UTC(2026, 9, 7, 15, 0);   // the instant; nowMinutes (the branch's wall clock) is passed separately
const base = (over: Partial<TechSignalInput> = {}): TechSignalInput => ({
  technicianId: 't', liveStatus: 'available', schedule: { start: '09:00', end: '18:00', lunchStart: '12:30', lunchEnd: '13:15', isWorking: true },
  punch: null, blocks: [], appointments: [], inService: [], rosterActive: true, ...over,
});
const at = (h: number, m = 0) => h * 60 + m;

describe('computeTechSignals', () => {
  // merge Oct 12 2026 (other chat's assignmentInputs: clockedIn was faked from `available`): the REAL clock, tri-state
  it('clockedIn: open punch → true; punched today and clocked out → false; no punch (salon not on the clock) → null', () => {
    expect(computeTechSignals(base({ punch: { startMs: NOW - 3600000, endMs: null, status: 'active' } }), at(11), NOW).clockedIn).toBe(true);
    expect(computeTechSignals(base({ punch: { startMs: NOW - 7200000, endMs: NOW - 600000, status: 'completed' } }), at(11), NOW).clockedIn).toBe(false);
    expect(computeTechSignals(base({ punch: null }), at(11), NOW).clockedIn).toBeNull();
  });
  it('free now, shift ends in 3h, next appointment in 45 min', () => {
    const s = computeTechSignals(base({ appointments: [{ start: '11:45', status: 'confirmed' }, { start: '10:00', status: 'completed' }, { start: '16:00', status: 'booked' }] }), at(11), NOW);
    expect(s).toEqual({ onBreak: false, blocked: false, clockedIn: null, shiftEndsInMinutes: 420, availableInMinutes: 0, nextAppointmentInMinutes: 45, status: 'available' });
  });
  it('serving now: available when the current service ends (start + duration)', () => {
    const s = computeTechSignals(base({ inService: [{ startedAtMs: NOW - 20 * 60000, durationMinutes: 45 }] }), at(11), NOW);
    expect(s.availableInMinutes).toBe(25);
    expect(s.status).toBe('in_service');
  });
  it('an over-running service is "available now", never negative', () => {
    expect(computeTechSignals(base({ inService: [{ startedAtMs: NOW - 90 * 60000, durationMinutes: 45 }] }), at(11), NOW).availableInMinutes).toBe(0);
  });
  it('lunch window = on break, back at lunch end; a manual break has no known end', () => {
    expect(computeTechSignals(base(), at(12, 45), NOW)).toMatchObject({ onBreak: true, availableInMinutes: 30, status: 'on_break' });
    expect(computeTechSignals(base({ liveStatus: 'on_break' }), at(11), NOW)).toMatchObject({ onBreak: true, availableInMinutes: null });
  });
  it('blocked time: blocked until the block ends', () => {
    expect(computeTechSignals(base({ blocks: [{ start: '10:30', end: '11:30' }] }), at(11), NOW)).toMatchObject({ blocked: true, availableInMinutes: 30, status: 'blocked' });
    expect(computeTechSignals(base({ blocks: [{ start: '13:30', end: '14:30' }] }), at(11), NOW).blocked).toBe(false);
  });
  it('before the shift: available at its start; after it: off shift, unknown', () => {
    expect(computeTechSignals(base(), at(8), NOW)).toMatchObject({ availableInMinutes: 60, status: 'off_shift' });
    expect(computeTechSignals(base(), at(18, 30), NOW)).toMatchObject({ availableInMinutes: null, shiftEndsInMinutes: 0, status: 'off_shift' });
  });
  it('clocked in without a schedule: working, shift end unknown', () => {
    const s = computeTechSignals(base({ schedule: null, punch: { startMs: NOW - 3600000, endMs: null, status: 'active' } }), at(11), NOW);
    expect(s).toMatchObject({ availableInMinutes: 0, shiftEndsInMinutes: null, status: 'available' });
  });
  it('nothing known about an inactive technician → off shift, null', () => {
    expect(computeTechSignals(base({ schedule: null, liveStatus: null, rosterActive: false }), at(11), NOW)).toMatchObject({ availableInMinutes: null, status: 'off_shift' });
  });
});

describe('rotationOrder', () => {
  const techs = [{ technicianId: 'a', name: 'Ann', lastServedAtMs: 300 }, { technicianId: 'b', name: 'Bea', lastServedAtMs: null }, { technicianId: 'c', name: 'Cal', lastServedAtMs: 100 }];
  it('longest since last served goes first (never served today first)', () => { expect(rotationOrder(techs, [])).toEqual({ b: 0, c: 1, a: 2 }); });
  it('a fixed order wins; the others follow by last served', () => { expect(rotationOrder(techs, ['a', 'zzz'])).toEqual({ a: 0, b: 1, c: 2 }); });
});

describe('assignedMinutesFor / lateMinutesAt / hhmmToMinutes', () => {
  it('queued work in full + what is left of the running service; finished visits ignored', () => {
    expect(assignedMinutesFor([{ status: 'assigned', durationMinutes: 45, startedAtMs: null }, { status: 'in_service', durationMinutes: 60, startedAtMs: NOW - 40 * 60000 }, { status: 'completed', durationMinutes: 99, startedAtMs: null }], NOW)).toBe(65);
  });
  it('lateness at check-in', () => {
    expect(lateMinutesAt(NOW, NOW - 12 * 60000)).toBe(12);
    expect(lateMinutesAt(NOW, NOW + 5 * 60000)).toBe(0);
    expect(lateMinutesAt(NOW, null)).toBeNull();
  });
  it("'HH:MM' and 'HH:MM:SS' parse; junk is null", () => {
    expect(hhmmToMinutes('09:30')).toBe(570); expect(hhmmToMinutes('17:05:00')).toBe(1025); expect(hhmmToMinutes('nope')).toBeNull(); expect(hhmmToMinutes(null)).toBeNull();
  });
});
