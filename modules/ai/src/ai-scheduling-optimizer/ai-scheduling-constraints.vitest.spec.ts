// ai-scheduling-constraints.vitest.spec.ts — the deterministic, fail-closed hard-constraint gate. Runs before any AI
// scoring; the AI can never bypass it. Missing data (no hours, no shift) is a violation, not a silent pass. Confirmed/
// locked appointments are immovable inputs.
import { describe, it, expect } from 'vitest';
import { checkHardConstraints, checkServiceOrder, type Placement, type ConstraintContext } from './ai-scheduling-constraints';

const base = (o: Partial<Placement> = {}): Placement => ({ technicianId: 't1', branchId: 'b1', serviceIds: ['s1'], blocks: [{ start: 540, end: 600 }], span: { start: 540, end: 600 }, ...o });
const ctx = (o: Partial<ConstraintContext> = {}): ConstraintContext => ({ branchHours: { start: 540, end: 1020 }, techBranchIds: ['b1'], techShifts: [{ start: 540, end: 1020 }], techSkills: { s1: true, s2: true }, breaks: [], timeOff: [], existingAppointments: [], ...o });
const has = (vs: { code: string }[], code: string) => vs.some((x) => x.code === code);

describe('hard constraints (fail-closed)', () => {
  it('passes a fully valid placement', () => {
    const r = checkHardConstraints(base(), ctx());
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });
  it('rejects each violated constraint', () => {
    expect(has(checkHardConstraints(base({ blocks: [{ start: 1000, end: 1080 }], span: { start: 1000, end: 1080 } }), ctx()).violations, 'OUTSIDE_HOURS')).toBe(true);
    expect(has(checkHardConstraints(base({ branchId: 'bX' }), ctx()).violations, 'TECH_NOT_AT_BRANCH')).toBe(true);
    expect(has(checkHardConstraints(base(), ctx({ techShifts: [] })).violations, 'TECH_NOT_SCHEDULED')).toBe(true);
    expect(has(checkHardConstraints(base({ serviceIds: ['s3'] }), ctx()).violations, 'MISSING_SKILL')).toBe(true);
    expect(has(checkHardConstraints(base(), ctx({ timeOff: [{ start: 500, end: 600 }] })).violations, 'ON_TIME_OFF')).toBe(true);
    expect(has(checkHardConstraints(base(), ctx({ breaks: [{ start: 570, end: 600 }] })).violations, 'BREAK_CONFLICT')).toBe(true);
    expect(has(checkHardConstraints(base(), ctx({ existingAppointments: [{ range: { start: 550, end: 610 }, technicianId: 't1' }] })).violations, 'APPOINTMENT_OVERLAP')).toBe(true);
    expect(has(checkHardConstraints(base({ requiredTechnicianId: 'tZ' }), ctx()).violations, 'PREFERENCE_VIOLATION')).toBe(true);
    expect(has(checkHardConstraints(base({ groupSize: 8 }), ctx({ groupCapacity: 5 })).violations, 'GROUP_CAPACITY_EXCEEDED')).toBe(true);
    expect(has(checkHardConstraints(base({ movesAppointmentId: 'a9' }), ctx({ existingAppointments: [{ id: 'a9', range: { start: 0, end: 1 }, technicianId: 't1', locked: true }] })).violations, 'LOCK_VIOLATION')).toBe(true);
  });
  it('honors overlap allowance, different techs, station capacity, and fails closed on unknown hours', () => {
    expect(has(checkHardConstraints(base({ allowServiceOverlap: true }), ctx({ existingAppointments: [{ range: { start: 550, end: 610 }, technicianId: 't1' }] })).violations, 'APPOINTMENT_OVERLAP')).toBe(false);
    expect(has(checkHardConstraints(base(), ctx({ existingAppointments: [{ range: { start: 550, end: 610 }, technicianId: 't2' }] })).violations, 'APPOINTMENT_OVERLAP')).toBe(false);
    expect(has(checkHardConstraints(base({ stationId: 'st1' }), ctx({ stationCapacity: { st1: 1 }, existingAppointments: [{ range: { start: 550, end: 610 }, technicianId: 't2', stationId: 'st1' }] })).violations, 'STATION_UNAVAILABLE')).toBe(true);
    expect(has(checkHardConstraints(base(), ctx({ branchHours: null })).violations, 'OUTSIDE_HOURS')).toBe(true);
    expect(checkHardConstraints(base({ branchId: 'bX', serviceIds: ['s3'] }), ctx({ timeOff: [{ start: 500, end: 600 }] })).violations.length).toBeGreaterThanOrEqual(3);
  });
});

describe('multi-service ordering', () => {
  it('accepts ordered blocks and rejects overlaps/out-of-order', () => {
    expect(checkServiceOrder([{ start: 600, end: 620 }, { start: 625, end: 685 }], [0, 1])).toHaveLength(0);
    expect(checkServiceOrder([{ start: 600, end: 660 }, { start: 640, end: 700 }], [0, 1]).some((x) => x.code === 'MULTI_SERVICE_ORDER')).toBe(true);
  });
});
