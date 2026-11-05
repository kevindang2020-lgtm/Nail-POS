// ai-scheduling-day.vitest.spec.ts — BUILD_PLAN Phase 7: the day model every optimizer decision reads. Each case pins a
// bug from the Oct 6 audit: lunch counted as a gap, services summed into one block, the session branch treated as every
// technician's branch, 'in_progress' (not a status) as the only started lock, client-supplied simulation, no time off, no
// holds, no lead time, no rule-based fallback, a second utilization formula.
import { describe, it, expect } from 'vitest';
import {
  type DayData, type DayAppt, isLockedAppt, serviceDurationFor, visitBlocks, checkMove, dayMetrics, withMove, detectDay,
  enumerateOptions, touchesConfirmed, utilizationPct, hhmm, toMin,
} from './ai-scheduling-day';
import { PLATFORM_DEFAULTS } from './ai-scheduling-settings';

const appt = (o: Partial<DayAppt> & { id: string }): DayAppt => ({
  technicianId: 't1', customerId: 'c1', status: 'booked', source: 'manual', date: '2026-10-09', startMin: 600, endMin: 645, version: 3,
  depositStatus: 'not_required', serviceIds: ['mani'], manualLock: false, ...o,
});
const day = (o: Partial<DayData> = {}): DayData => ({
  date: '2026-10-09', branchId: 'b1', timeZone: 'America/New_York', branchHours: { start: 540, end: 1080 }, bufferMin: 0, slotIntervalMin: 15,
  techs: [
    { technicianId: 't1', name: 'Ann', available: true, branchIds: ['b1'], skills: ['Manicure', 'Pedicure'], shifts: [{ start: 540, end: 1020 }], breaks: [{ start: 720, end: 780 }], timeOff: [] },
    { technicianId: 't2', name: 'Bo', available: true, branchIds: ['b1'], skills: ['Manicure'], shifts: [{ start: 540, end: 1020 }], breaks: [], timeOff: [] },
  ],
  services: {
    mani: { serviceId: 'mani', name: 'Manicure', categoryName: 'Manicure', durationMin: 45, setupMin: 0, cleanupMin: 0, maxGroupSize: null },
    pedi: { serviceId: 'pedi', name: 'Pedicure', categoryName: 'Pedicure', durationMin: 60, setupMin: 0, cleanupMin: 0, maxGroupSize: null },
  },
  durationByTechService: {}, durationByService: {},
  appts: [appt({ id: 'a1' })], holds: [], nowMin: null, isPast: false, ...o,
});

describe('locks', () => {
  it('started statuses (arrived/checked_in/waiting/in_service/completed), a paid deposit and a manual lock are locked; booked/confirmed are not', () => {
    for (const s of ['arrived', 'checked_in', 'waiting', 'in_service', 'completed']) expect(isLockedAppt(appt({ id: 'x', status: s }))).toBe(true);
    for (const s of ['booked', 'confirmed']) expect(isLockedAppt(appt({ id: 'x', status: s }))).toBe(false);
    expect(isLockedAppt(appt({ id: 'x', depositStatus: 'paid' }))).toBe(true);
    expect(isLockedAppt(appt({ id: 'x', manualLock: true }))).toBe(true);
  });
});

describe('durations + per-service blocks', () => {
  it('hierarchy: approved (tech, service) → (service, branch) → catalog', () => {
    const d = day({ durationByTechService: { 't1:mani': 50 }, durationByService: { mani: 40 } });
    expect(serviceDurationFor(d, 't1', 'mani')).toBe(50);
    expect(serviceDurationFor(d, 't2', 'mani')).toBe(40);
    expect(serviceDurationFor(day(), 't2', 'mani')).toBe(45);
  });
  it('chains each service as its own block, in order, with setup/cleanup around the visit (not one summed block)', () => {
    const d = day(); d.services.mani.setupMin = 5; d.services.pedi.cleanupMin = 10;
    const v = visitBlocks(d, 't1', ['mani', 'pedi'], 600);
    expect(v.services).toEqual([{ serviceId: 'mani', start: 600, end: 645 }, { serviceId: 'pedi', start: 645, end: 705 }]);
    expect(v.span).toEqual({ start: 595, end: 715 });
  });
});

describe('hard gate on the real context', () => {
  it('lunch, time off, branch membership, skills, group size and holds are enforced', () => {
    const a = day().appts[0];
    expect(checkMove(day(), a, { date: a.date, startMin: 735, technicianId: 't1' }).map((v) => v.code)).toContain('BREAK_CONFLICT');
    const off = day(); off.techs[0].timeOff = [{ start: 840, end: 1020 }];
    expect(checkMove(off, a, { date: a.date, startMin: 900, technicianId: 't1' }).map((v) => v.code)).toContain('ON_TIME_OFF');
    const elsewhere = day(); elsewhere.techs[1].branchIds = ['b2'];
    expect(checkMove(elsewhere, a, { date: a.date, startMin: 600, technicianId: 't2' }).map((v) => v.code)).toContain('TECH_NOT_AT_BRANCH');
    const pedi = { ...a, serviceIds: ['pedi'] };
    expect(checkMove(day(), pedi, { date: a.date, startMin: 600, technicianId: 't2' }).map((v) => v.code)).toContain('MISSING_SKILL');
    const grp = day(); grp.services.mani.maxGroupSize = 2;
    expect(checkMove(grp, a, { date: a.date, startMin: 900, technicianId: 't1' }, { groupSize: 3 }).map((v) => v.code)).toContain('GROUP_CAPACITY_EXCEEDED');
    expect(checkMove(day(), a, { date: a.date, startMin: 900, technicianId: 't1' })).toEqual([]);
  });
  it('the moved appointment does not collide with itself; buffers apply on both sides of other appointments', () => {
    const d = day({ bufferMin: 10, appts: [appt({ id: 'a1' }), appt({ id: 'a2', startMin: 660, endMin: 705 })] });
    expect(checkMove(d, d.appts[0], { date: d.date, startMin: 605, technicianId: 't1' })).toEqual([]);      // ends 650 + 10 = 660 = a2 start
    expect(checkMove(d, d.appts[0], { date: d.date, startMin: 610, technicianId: 't1' }).map((v) => v.code)).toContain('APPOINTMENT_OVERLAP');
    expect(checkMove(d, d.appts[0], { date: d.date, startMin: 710, technicianId: 't1' }).map((v) => v.code)).toContain('APPOINTMENT_OVERLAP');   // a2 ends 705 + 10
    expect(checkMove(d, d.appts[0], { date: d.date, startMin: 795, technicianId: 't1' })).toEqual([]);
  });
  it('locked appointment → LOCK_VIOLATION', () => {
    const d = day({ appts: [appt({ id: 'a1', status: 'arrived' })] });
    expect(checkMove(d, d.appts[0], { date: d.date, startMin: 900, technicianId: 't1' }).map((v) => v.code)).toContain('LOCK_VIOLATION');
  });
});

describe('metrics (server-side simulation)', () => {
  it('lunch is never a gap; idle = stranded free time before the last appointment', () => {
    const d = day({ appts: [appt({ id: 'a1', startMin: 540, endMin: 585 }), appt({ id: 'a2', startMin: 780, endMin: 825 })] });
    const m = dayMetrics(d, PLATFORM_DEFAULTS);
    // t1 free 585–720 (135, lunch 720–780 removed) before the last appointment (ends 825)
    expect(m.idleMin).toBe(135);
    expect(m.gapCount).toBe(1);
  });
  it('withMove re-measures the day: moving a2 next to a1 removes the gap', () => {
    const d = day({ appts: [appt({ id: 'a1', startMin: 540, endMin: 585 }), appt({ id: 'a2', startMin: 780, endMin: 825 })] });
    const after = dayMetrics(withMove(d, 'a2', { date: d.date, startMin: 585, endMin: 630, technicianId: 't1' }), PLATFORM_DEFAULTS);
    expect(after.idleMin).toBe(0);
    expect(after.gapCount).toBe(0);
  });
  it('utilization is the canonical formula: min(100, round(busy / (shift − breaks − time off) × 100)), null without time', () => {
    expect(utilizationPct(90, 420)).toBe(21);
    expect(utilizationPct(900, 420)).toBe(100);
    expect(utilizationPct(10, 0)).toBeNull();
    const m = dayMetrics(day(), PLATFORM_DEFAULTS);
    // t1: 45 busy / (480 − 60 lunch); t2: 0 / 480 → (45) / (420 + 480)
    expect(m.utilizationPct).toBe(Math.round((45 / 900) * 100));
  });
  it('a double booking raises lateness risk; detection reports it as a conflict', () => {
    const d = day({ appts: [appt({ id: 'a1' }), appt({ id: 'a2', startMin: 620, endMin: 665 })] });
    expect(dayMetrics(d, PLATFORM_DEFAULTS).latenessRiskPct).toBe(100);
    const det = detectDay(d, PLATFORM_DEFAULTS);
    expect(det.conflicts.map((c) => c.type)).toContain('DOUBLE_BOOK');
    expect(det.gaps.every((g) => !(g.startMin < 780 && g.endMin > 720 && g.technicianId === 't1'))).toBe(true);   // lunch not a gap
  });
});

describe('options', () => {
  const req = { date: '2026-10-09', serviceIds: ['mani'] };
  it('every option passes the gate, carries per-service blocks, and live holds make a slot unavailable', () => {
    const d = day({ holds: [{ technicianId: 't2', range: { start: 540, end: 600 } }] });
    const r = enumerateOptions(d, { ...req, preferredTime: '09:00' }, PLATFORM_DEFAULTS, 50);
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.options.find((o) => o.technicianId === 't2' && o.startTime === '09:00')).toBeUndefined();
    const first = r.options[0];
    expect(first.blocks).toEqual([{ serviceId: 'mani', startTime: first.startTime, endTime: first.endTime }]);
    expect(r.options.find((o) => o.technicianId === 't1' && o.startTime === '12:00')).toBeUndefined();   // lunch
    expect(r.options.find((o) => o.technicianId === 't1' && o.startTime === '10:00')).toBeUndefined();   // a1
  });
  it('honours lead time on today and the booking interval', () => {
    const d = day({ nowMin: 600 });
    const r = enumerateOptions(d, req, { ...PLATFORM_DEFAULTS, minLeadTimeMin: 60, bookingIntervalMin: 30 }, 50);
    expect(r.options.every((o) => toMin(o.startTime) >= 660 && toMin(o.startTime) % 30 === 0)).toBe(true);
  });
  it('excludeAppointmentId frees that appointment’s slot', () => {
    const r = enumerateOptions(day(), { ...req, technicianId: 't1', excludeAppointmentId: 'a1' }, PLATFORM_DEFAULTS, 50);
    expect(r.options.find((o) => o.startTime === '10:00')).toBeDefined();
  });
  it('flat signals → rule-based fallback (fallback:true); a preferred time gives weighted scoring', () => {
    const flat = day({ appts: [], techs: [day().techs[1]] });
    flat.techs[0].shifts = [{ start: 540, end: 600 }];
    const fb = enumerateOptions(flat, { ...req, technicianId: 't2' }, PLATFORM_DEFAULTS, 5);
    expect(fb.options.every((o) => o.fallback)).toBe(true);
    const scored = enumerateOptions(day(), { ...req, preferredTime: '14:00' }, PLATFORM_DEFAULTS, 5);
    expect(scored.options.every((o) => !o.fallback)).toBe(true);
    expect(scored.options[0].score).toBeGreaterThanOrEqual(scored.options[scored.options.length - 1].score);
  });
  it('limit caps the list', () => {
    expect(enumerateOptions(day(), req, PLATFORM_DEFAULTS, 3).options).toHaveLength(3);
  });
});

describe('touches a confirmed appointment (server-derived)', () => {
  const a = appt({ id: 'a1' });
  it('customer + time change → true; tech change only when the customer requested the tech; never for cancelled/completed', () => {
    expect(touchesConfirmed(a, { date: a.date, startMin: 700, technicianId: 't1' })).toBe(true);
    expect(touchesConfirmed(a, { date: a.date, startMin: 600, technicianId: 't2' })).toBe(false);                    // staff-assigned
    expect(touchesConfirmed({ ...a, source: 'online' }, { date: a.date, startMin: 600, technicianId: 't2' })).toBe(true);
    expect(touchesConfirmed({ ...a, customerId: null }, { date: a.date, startMin: 700, technicianId: 't1' })).toBe(false);
    expect(touchesConfirmed({ ...a, status: 'cancelled' }, { date: a.date, startMin: 700, technicianId: 't1' })).toBe(false);
  });
  it('hhmm / toMin round-trip', () => { expect(hhmm(toMin('09:05'))).toBe('09:05'); });
});
