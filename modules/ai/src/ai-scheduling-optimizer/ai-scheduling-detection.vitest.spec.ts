// ai-scheduling-detection.vitest.spec.ts — gaps never surface an approved break; conflicts carry severity + affected ids;
// understaffing returns an honest 'data_insufficient' rather than inventing a number, and lowers confidence without a forecast.
import { describe, it, expect } from 'vitest';
import { detectGaps, detectConflicts, detectUnderstaffing, type ApptRec } from './ai-scheduling-detection';

describe('gap detection', () => {
  it('finds gaps, never reports a break, and classifies causes', () => {
    const gaps = detectGaps({ start: 540, end: 1020 }, [{ start: 600, end: 660 }, { start: 720, end: 780 }], [{ start: 900, end: 930 }], { services: [{ serviceId: 'quick', durationMin: 30 }, { serviceId: 'long', durationMin: 90 }], minServiceMin: 15, largeBlockMin: 120 });
    expect(gaps.some((g) => g.range.start === 900 && g.range.end === 930)).toBe(false); // break not a gap
    expect(gaps.some((g) => g.cause === 'before_first' && g.range.start === 540)).toBe(true);
    expect(gaps.some((g) => g.cause === 'after_last')).toBe(true);
    const big = gaps.find((g) => g.durationMin >= 90);
    expect(big?.servicesThatFit).toContain('long');
    expect(detectGaps({ start: 0, end: 100 }, [{ start: 0, end: 90 }], [], { minServiceMin: 15 }).some((x) => x.cause === 'too_small_for_service')).toBe(true);
  });
});

describe('conflict detection', () => {
  it('flags double-booking, beyond-shift, outside-hours, station overbooking', () => {
    const conflicts = detectConflicts([{ id: 'a1', technicianId: 't1', range: { start: 600, end: 660 } }, { id: 'a2', technicianId: 't1', range: { start: 630, end: 690 } }, { id: 'a3', technicianId: 't2', range: { start: 600, end: 660 } }] as ApptRec[], {});
    expect(conflicts.some((c) => c.type === 'DOUBLE_BOOK' && c.severity === 'high')).toBe(true);
    expect(conflicts.some((c) => c.type === 'DOUBLE_BOOK' && c.appointmentIds.includes('a3'))).toBe(false);
    expect(detectConflicts([{ id: 'x', technicianId: 't1', range: { start: 1000, end: 1080 } }], { shiftsByTech: { t1: [{ start: 540, end: 1020 }] } }).some((c) => c.type === 'BEYOND_SHIFT')).toBe(true);
    expect(detectConflicts([{ id: 'x', technicianId: 't1', range: { start: 1050, end: 1110 } }], { branchHours: { start: 540, end: 1020 } }).some((c) => c.type === 'OUTSIDE_HOURS')).toBe(true);
    expect(detectConflicts([{ id: 's1', technicianId: 't1', range: { start: 600, end: 660 }, stationId: 'st' }, { id: 's2', technicianId: 't2', range: { start: 610, end: 670 }, stationId: 'st' }], { stationCapacity: { st: 1 } }).some((c) => c.type === 'STATION_OVERBOOK')).toBe(true);
    expect(detectConflicts([{ id: 'a', technicianId: 't1', range: { start: 600, end: 660 } }, { id: 'b', technicianId: 't1', range: { start: 660, end: 720 } }], {})).toHaveLength(0);
  });
});

describe('understaffing', () => {
  it('grades demand vs capacity and stays honest when data is thin', () => {
    expect(detectUnderstaffing({ confirmedDemandMin: 200, capacityMin: 480 }).state).toBe('adequately_staffed');
    expect(detectUnderstaffing({ confirmedDemandMin: 1000, capacityMin: 480 }).state).toBe('severely_understaffed');
    expect(detectUnderstaffing({ confirmedDemandMin: 700, capacityMin: 480 }).missingMinutes).toBe(220);
    expect(detectUnderstaffing({ confirmedDemandMin: 100, capacityMin: 480, requiredSkills: ['acrylic'], availableSkills: ['gel'] }).missingSkills).toContain('acrylic');
    expect(detectUnderstaffing({ confirmedDemandMin: 0, capacityMin: 0 }).state).toBe('data_insufficient');
    expect(detectUnderstaffing({ confirmedDemandMin: 300, forecastDemandMin: 300, capacityMin: 480 }).demandMinutes).toBe(600);
    expect(detectUnderstaffing({ confirmedDemandMin: 300, capacityMin: 480, forecastAvailable: false }).confidence).toBe(0.5);
  });
});
