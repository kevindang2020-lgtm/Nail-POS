// ai-scheduling-capacity.vitest.spec.ts — Extras "Capacity Risk Heatmap" (AI Scheduling Optimizer 07): the per-hour risk words
// and the per-skill shortage are computed from the gate's day model and the one workforce skill rule; nothing else.
import { describe, it, expect } from 'vitest';
import { capacityHeatmap, CAPACITY_TIGHT_PCT } from './ai-scheduling-capacity';
import type { DayData, DayAppt } from './ai-scheduling-day';

const appt = (o: Partial<DayAppt> & { id: string }): DayAppt => ({
  technicianId: 't1', customerId: 'c1', status: 'booked', source: 'manual', date: '2026-10-09', startMin: 600, endMin: 660, version: 1,
  depositStatus: 'not_required', serviceIds: ['mani'], manualLock: false, ...o,
});
const day = (o: Partial<DayData> = {}): DayData => ({
  date: '2026-10-09', branchId: 'b1', timeZone: 'America/New_York', branchHours: { start: 540, end: 720 }, bufferMin: 0, slotIntervalMin: 15,
  techs: [
    { technicianId: 't1', name: 'Ann', available: true, branchIds: ['b1'], skills: ['Manicure', 'Pedicure'], shifts: [{ start: 540, end: 720 }], breaks: [], timeOff: [] },
    { technicianId: 't2', name: 'Bo', available: true, branchIds: ['b1'], skills: ['Manicure'], shifts: [{ start: 600, end: 720 }], breaks: [], timeOff: [] },
    { technicianId: 't3', name: 'Cy', available: false, branchIds: ['b1'], skills: ['Pedicure'], shifts: [{ start: 540, end: 720 }], breaks: [], timeOff: [] },
  ],
  services: {
    mani: { serviceId: 'mani', name: 'Manicure', categoryName: 'Manicure', durationMin: 60, setupMin: 0, cleanupMin: 0, maxGroupSize: null },
    pedi: { serviceId: 'pedi', name: 'Pedicure', categoryName: 'Pedicure', durationMin: 60, setupMin: 0, cleanupMin: 0, maxGroupSize: null },
  },
  durationByTechService: {}, durationByService: {}, appts: [], holds: [], nowMin: null, isPast: false, ...o,
});

describe('capacityHeatmap', () => {
  it('ok / tight / over by booked + held minutes against staffed minutes; an unavailable technician is not staff', () => {
    const h = capacityHeatmap(day({
      appts: [
        appt({ id: 'a', startMin: 540, endMin: 570 }),                                             // 09: 30 of 60 → ok
        appt({ id: 'b', startMin: 600, endMin: 660 }), appt({ id: 'c', technicianId: 't2', startMin: 600, endMin: 645 }),   // 10: 105 of 120 → tight (88%)
        appt({ id: 'd', startMin: 660, endMin: 720 }), appt({ id: 'e', technicianId: 't2', startMin: 660, endMin: 720 }),
        appt({ id: 'f', technicianId: null, startMin: 690, endMin: 720 }),                          // 11: 150 of 120 → over (30 unassigned)
        appt({ id: 'x', status: 'cancelled', startMin: 540, endMin: 600 }),                         // never counted
      ],
    }));
    const by = Object.fromEntries(h.hours.map((x) => [x.hour, x]));
    expect(h.hours.map((x) => x.hour)).toEqual(['09:00', '10:00', '11:00']);
    expect(by['09:00']).toMatchObject({ techsOnShift: 1, staffedMin: 60, bookedMin: 30, utilizationPct: 50, risk: 'ok' });
    expect(by['10:00']).toMatchObject({ techsOnShift: 2, staffedMin: 120, bookedMin: 105, risk: 'tight' });
    expect(by['10:00'].utilizationPct).toBeGreaterThanOrEqual(CAPACITY_TIGHT_PCT);
    expect(by['11:00']).toMatchObject({ bookedMin: 150, unassignedMin: 30, utilizationPct: 100, risk: 'over' });
    expect(h.totals).toMatchObject({ staffedMin: 300, bookedMin: 285, overHours: 1, tightHours: 1 });
  });
  it('per-skill demand vs qualified technicians on shift: Pedicure demand with only one qualified → short; holds count as load', () => {
    const h = capacityHeatmap(day({
      appts: [appt({ id: 'p1', serviceIds: ['pedi'], startMin: 600, endMin: 660 }), appt({ id: 'p2', technicianId: null, serviceIds: ['pedi'], startMin: 600, endMin: 660 })],
      holds: [{ technicianId: 't2', range: { start: 600, end: 630 } }],
    }));
    const ten = h.hours.find((x) => x.hour === '10:00')!;
    expect(ten.skills).toEqual([{ category: 'Pedicure', demandMin: 120, techsNeeded: 2, qualifiedOnShift: 1, short: true }]);   // Bo is not a pedicurist; Cy is unavailable
    expect(ten).toMatchObject({ heldMin: 30, bookedMin: 120, skillShort: true, risk: 'over' });
    expect(h.totals.skillShortHours).toBe(1);
  });
  it('demand with nobody on shift is "unstaffed"; an empty hour with nobody is "closed"; the hours widen to an appointment outside them', () => {
    const h = capacityHeatmap(day({ techs: [], appts: [appt({ id: 'late', technicianId: null, startMin: 750, endMin: 780 })] }));
    const by = Object.fromEntries(h.hours.map((x) => [x.hour, x]));
    expect(by['09:00'].risk).toBe('closed');
    expect(by['12:00']).toMatchObject({ staffedMin: 0, bookedMin: 30, risk: 'unstaffed', utilizationPct: null });
    expect(h.totals.unstaffedHours).toBe(1);
  });
});
