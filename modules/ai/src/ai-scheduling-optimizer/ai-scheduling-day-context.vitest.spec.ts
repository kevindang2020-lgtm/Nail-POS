// ai-scheduling-day-context — A5 (Nov 6 2026): the technician's full day and the before / after neighbour preview.
import { describe, it, expect } from 'vitest';
import { technicianDayContext } from './ai-scheduling-day-context';
import type { DayData, DayAppt } from './ai-scheduling-day';

const appt = (id: string, tech: string | null, s: number, e: number, o: Partial<DayAppt> = {}): DayAppt =>
  ({ id, technicianId: tech, customerId: 'c', status: 'confirmed', source: 'staff', date: '2026-11-10', startMin: s, endMin: e, version: 1, depositStatus: null, serviceIds: ['gel'], manualLock: false, ...o });
const day = (appts: DayAppt[]): DayData => ({
  date: '2026-11-10', branchId: 'b', timeZone: 'America/New_York', branchHours: { start: 540, end: 1140 }, bufferMin: 0, slotIntervalMin: 15,
  techs: [{ technicianId: 'lisa', name: 'Lisa', available: true, branchIds: ['b'], skills: [], shifts: [{ start: 540, end: 1080 }], breaks: [{ start: 720, end: 750 }], timeOff: [] },
    { technicianId: 'mary', name: 'Mary', available: true, branchIds: ['b'], skills: [], shifts: [{ start: 540, end: 1080 }], breaks: [], timeOff: [] }],
  services: { gel: { serviceId: 'gel', name: 'Gel manicure', categoryName: 'Nails', durationMin: 60, setupMin: 0, cleanupMin: 0, maxGroupSize: null } },
  durationByTechService: {}, durationByService: {}, appts, holds: [], nowMin: null, isPast: false,
});

describe('A5 technician day context', () => {
  it('DC-01 moving a 3 pm booking into Lisa\'s 1–2 pm gap: neighbours, gaps closed, nothing new conflicts; the full day is listed', () => {
    const d = day([appt('a1', 'lisa', 600, 660), appt('a2', 'lisa', 750, 780), appt('a3', 'lisa', 840, 900), appt('mv', 'lisa', 900, 960), appt('x', 'mary', 600, 660, { status: 'cancelled' })]);
    const c = technicianDayContext(d, d.appts.find((a) => a.id === 'mv')!, { startMin: 780, endMin: 840, technicianId: 'lisa' });
    expect(c.proposed).toEqual({ start: '13:00', end: '14:00', technicianId: 'lisa' });
    expect(c.neighbours).toMatchObject({ previous: { appointmentId: 'a2', start: '12:30', end: '13:00' }, next: { appointmentId: 'a3', start: '14:00' }, gapBeforeMin: 0, gapAfterMin: 0 });
    expect(c.before.items.map((i) => i.start)).toEqual(['10:00', '12:30', '14:00', '15:00']);
    expect(c.after.items.map((i) => `${i.start}${i.moving ? '*' : ''}`)).toEqual(['10:00', '12:30', '13:00*', '14:00']);
    expect(c.after.items[2].services).toEqual(['Gel manicure']);
    expect(c.before.breaks).toEqual([{ start: '12:00', end: '12:30' }]);
    expect(c.after.technicianName).toBe('Lisa');
    expect(c.change.closedGaps).toBeGreaterThanOrEqual(1);
    expect(c.change.newConflicts).toBe(0);
  });
  it('DC-02 a slot that overlaps a booking shows the new conflict in the after-day', () => {
    const d = day([appt('a1', 'mary', 600, 660), appt('mv', 'lisa', 900, 960)]);
    const c = technicianDayContext(d, d.appts.find((a) => a.id === 'mv')!, { startMin: 630, endMin: 690, technicianId: 'mary' });
    expect(c.change.newConflicts).toBeGreaterThanOrEqual(1);
    expect(c.after.conflicts.some((x) => x.type === 'DOUBLE_BOOK')).toBe(true);
    expect(c.neighbours.previous).toBeNull();
    expect(c.before.items.map((i) => i.appointmentId)).toEqual(['a1']);   // Mary's day before: the moving booking is Lisa's
  });
  it('DC-03 a booking that comes from another day is placed on the target day', () => {
    const d = day([appt('a1', 'lisa', 600, 660)]);
    const moving = appt('mv', 'lisa', 900, 960, { date: '2026-11-09' });
    const c = technicianDayContext(d, moving, { startMin: 660, endMin: 720, technicianId: 'lisa' });
    expect(c.after.items.map((i) => i.appointmentId)).toEqual(['a1', 'mv']);
    expect(c.neighbours.previous?.appointmentId).toBe('a1');
  });
});
