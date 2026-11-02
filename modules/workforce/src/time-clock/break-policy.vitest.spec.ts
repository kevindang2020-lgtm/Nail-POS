// break-policy — Fair Turn §35–40: the salon's break policy classifies each break (paid rest / unpaid meal / …); the
// queue never decides pay. Pure.
import { describe, it, expect } from 'vitest';
import { DEFAULT_BREAK_POLICY, validateBreakPolicy, mergeBreakPolicy, classifyBreak, dailyHours } from './break-policy';
import { deriveTechClock } from './time-clock.dto';

describe('classifyBreak — U.S. federal default', () => {
  const P = mergeBreakPolicy({ salon: null, branch: null });
  it('a short rest break is paid; the excess of a long rest break is unpaid', () => {
    expect(classifyBreak(P, { kind: 'break', minutes: 15, interrupted: false })).toEqual({ classification: 'paid_rest', paidMinutes: 15, unpaidMinutes: 0 });
    expect(classifyBreak(P, { kind: 'break', minutes: 20, interrupted: false })).toEqual({ classification: 'paid_rest', paidMinutes: 20, unpaidMinutes: 0 });
    expect(classifyBreak(P, { kind: 'break', minutes: 35, interrupted: false })).toEqual({ classification: 'unpaid_rest_excess', paidMinutes: 20, unpaidMinutes: 15 });
  });
  it('a bona fide meal (30+ min, relieved of duty) is unpaid; a short meal is paid', () => {
    expect(classifyBreak(P, { kind: 'lunch', minutes: 30, interrupted: false })).toEqual({ classification: 'unpaid_meal', paidMinutes: 0, unpaidMinutes: 30 });
    expect(classifyBreak(P, { kind: 'lunch', minutes: 29, interrupted: false })).toEqual({ classification: 'paid_meal_short', paidMinutes: 29, unpaidMinutes: 0 });
  });
  it('an interrupted meal is never recorded as a full uninterrupted meal (§36)', () => {
    expect(classifyBreak(P, { kind: 'lunch', minutes: 45, interrupted: true })).toEqual({ classification: 'paid_meal_interrupted', paidMinutes: 45, unpaidMinutes: 0 });
    const strict = mergeBreakPolicy({ salon: { interruptedMealCompensable: false }, branch: null });
    expect(classifyBreak(strict, { kind: 'lunch', minutes: 45, interrupted: true }).classification).toBe('unpaid_meal');
  });
  it('rounds and floors odd minute values', () => {
    expect(classifyBreak(P, { kind: 'break', minutes: -3, interrupted: false })).toEqual({ classification: 'paid_rest', paidMinutes: 0, unpaidMinutes: 0 });
    expect(classifyBreak(P, { kind: 'break', minutes: 14.6, interrupted: false }).paidMinutes).toBe(15);
  });
});

describe('policy layers and validation', () => {
  it('a branch layer overrides the salon layer; kindDefaults merge per kind', () => {
    const p = mergeBreakPolicy({ salon: { jurisdiction: 'US-NJ', restBreakPaidUpToMinutes: 15 }, branch: { restBreakPaidUpToMinutes: 10, kindDefaults: { lunch: 'rest' } } });
    expect(p.jurisdiction).toBe('US-NJ');
    expect(p.restBreakPaidUpToMinutes).toBe(10);
    expect(p.kindDefaults).toEqual({ break: 'rest', lunch: 'rest' });
    expect(classifyBreak(p, { kind: 'lunch', minutes: 30, interrupted: false })).toEqual({ classification: 'unpaid_rest_excess', paidMinutes: 10, unpaidMinutes: 20 });
  });
  it('an invalid stored layer is ignored, never half-applied; JSON text layers parse', () => {
    expect(mergeBreakPolicy({ salon: { restBreakPaidUpToMinutes: 999, mealBreakMinMinutes: 45 }, branch: null })).toEqual({ ...DEFAULT_BREAK_POLICY, kindDefaults: { ...DEFAULT_BREAK_POLICY.kindDefaults } });
    expect(mergeBreakPolicy({ salon: '{"mealBreakMinMinutes":45}', branch: null }).mealBreakMinMinutes).toBe(45);
  });
  it('validateBreakPolicy names each problem', () => {
    expect(validateBreakPolicy({})).toEqual([]);
    expect(validateBreakPolicy(null)).toEqual(['The break policy must be an object.']);
    expect(validateBreakPolicy({ bogus: 1 })).toEqual(['Unknown break policy setting "bogus".']);
    expect(validateBreakPolicy({ jurisdiction: 'new jersey' })[0]).toMatch(/jurisdiction/);
    expect(validateBreakPolicy({ restBreakPaidUpToMinutes: 121 })[0]).toMatch(/0 to 120/);
    expect(validateBreakPolicy({ interruptedMealCompensable: 'yes' })[0]).toMatch(/true or false/);
    expect(validateBreakPolicy({ kindDefaults: { break: 'nap' } })[0]).toMatch(/kindDefaults/);
  });
});

describe('dailyHours (§40) and the roster break list', () => {
  it('eligible worked time = clocked − unpaid break; paid and unpaid kept apart; an open punch runs to now', () => {
    const t0 = Date.parse('2026-03-02T14:00:00Z');
    expect(dailyHours([{ startMs: t0, endMs: t0 + 8 * 3600000 }], [{ paidMinutes: 15, unpaidMinutes: 0 }, { paidMinutes: 0, unpaidMinutes: 30 }], t0))
      .toEqual({ clockedMinutes: 480, paidBreakMinutes: 15, unpaidBreakMinutes: 30, eligibleWorkedMinutes: 450 });
    expect(dailyHours([{ startMs: t0, endMs: null }], [], t0 + 90 * 60000).clockedMinutes).toBe(90);
  });
  it('the time clock row carries only this technician\'s breaks, oldest first, with the classification', () => {
    const row = deriveTechClock('A', 'Ana', [{ id: 's1', technicianId: 'A', startTime: '2026-03-02T14:00:00Z', endTime: null, status: 'active' }], '2026-03-02T19:00:00Z', [
      { id: 'b2', technicianId: 'A', shiftId: 's1', kind: 'lunch', reason: null, startedAt: '2026-03-02T17:00:00Z', endedAt: '2026-03-02T17:40:00Z', startedBy: null, endedBy: null, classification: 'unpaid_meal', paidMinutes: 0, unpaidMinutes: 40, interruptedAt: null },
      { id: 'b1', technicianId: 'A', shiftId: 's1', kind: 'break', reason: null, startedAt: '2026-03-02T15:00:00Z', endedAt: '2026-03-02T15:10:00Z', startedBy: null, endedBy: null, classification: 'paid_rest', paidMinutes: 10, unpaidMinutes: 0, interruptedAt: null },
      { id: 'bx', technicianId: 'B', shiftId: null, kind: 'break', reason: null, startedAt: '2026-03-02T15:00:00Z', endedAt: null, startedBy: null, endedBy: null },
    ]);
    expect(row.breaks!.map((b) => [b.id, b.classification, b.interrupted])).toEqual([['b1', 'paid_rest', false], ['b2', 'unpaid_meal', false]]);
  });
});
