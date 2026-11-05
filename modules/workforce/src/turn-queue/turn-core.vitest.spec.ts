// turn-core.vitest.spec.ts — the pure Fair Turn rules (mandate §196–§201, §209 analytics, §58 tie-breakers, §166 validation).
import { describe, it, expect } from 'vitest';
import {
  RECOMMENDED_TURN_POLICY, mergeTurnPolicy, validateTurnPolicyPatch, rotationOrder, positionAfterAssignment, joinPlacement, breakReturn,
  unitsForAssignment, assignmentKindOf, resolveVisitUnits, resolveServiceUnits, declineConsequence, offerTimeoutConsequence, techQueueView,
  turnsToUnits, ageBoostUnits, previewTurnPolicyChange, boardStatusOf, boardColumnOf, friendlyTurnError, type TurnStateLike, type TurnUnitRule,
} from './turn-core';
import { computeFairness, explainTimeline } from './turn-fairness';

const NOW = Date.parse('2026-03-02T15:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
const st = (id: string, pos: number, o: Partial<TurnStateLike> = {}): TurnStateLike => ({
  technicianId: id, name: id, status: 'READY', inRotation: true, rotationPosition: pos, accumulatedUnits: 0, provisionalUnits: 0, pendingUnits: 0,
  baselineUnits: 0, specialUnits: 0, serviceMinutes: 0, baselineMinutes: 0, readySince: ago(10), ...o,
});
const P = mergeTurnPolicy({});
const ids = (r: { technicianId: string }[]) => r.map((x) => x.technicianId);

describe('§196 traditional rotation — a full turn moves the technician to the back', () => {
  it('Lisa, Mary, Anna → Lisa takes a full turn → Mary, Anna, Lisa', () => {
    const team = [st('lisa', 1), st('mary', 2), st('anna', 3)];
    const moved = positionAfterAssignment('traditional_weighted_rotation', P, team[0], 100, team);
    expect(moved).toEqual({ position: 4, pending: 0, moved: 'back' });
    const after = team.map((s) => (s.technicianId === 'lisa' ? { ...s, rotationPosition: moved.position } : s));
    expect(ids(rotationOrder('traditional_weighted_rotation', P, after, NOW))).toEqual(['mary', 'anna', 'lisa']);
  });
  it('a requested guest that consumes 0 units moves nobody (§200)', () => {
    const team = [st('lisa', 1), st('mary', 2)];
    expect(positionAfterAssignment('traditional_weighted_rotation', P, team[0], 0, team)).toEqual({ position: 1, pending: 0, moved: 'none' });
  });
  it('manual order never moves anyone on assignment', () => {
    const team = [st('lisa', 1), st('mary', 2)];
    expect(positionAfterAssignment('manual_order', P, team[0], 100, team).moved).toBe('none');
  });
});

describe('§201 half turns accumulate (fixed point) and move at a full turn', () => {
  it('0.5 + 0.5 → back on the second half turn; 0.75 carries 0.25', () => {
    const team = [st('lisa', 1), st('mary', 2), st('anna', 3)];
    const first = positionAfterAssignment('traditional_weighted_rotation', P, team[0], 50, team);
    expect(first).toEqual({ position: 1, pending: 50, moved: 'none' });
    const second = positionAfterAssignment('traditional_weighted_rotation', P, { ...team[0], pendingUnits: 50 }, 50, team);
    expect(second).toEqual({ position: 4, pending: 0, moved: 'back' });
    const carry = positionAfterAssignment('traditional_weighted_rotation', P, { ...team[0], pendingUnits: 50 }, 75, team);
    expect(carry.pending).toBe(25);
  });
  it('MOVE_PARTIALLY moves back by the share of the line behind', () => {
    const pol = mergeTurnPolicy({ halfTurnBehavior: 'MOVE_PARTIALLY' });
    const team = [st('lisa', 1), st('mary', 2), st('anna', 3), st('kim', 4), st('ivy', 5)];
    const r = positionAfterAssignment('traditional_weighted_rotation', pol, team[0], 50, team);
    expect(r.moved).toBe('partial');
    expect(r.position).toBe(3.5);   // 0.5 × 4 behind = 2 places → between anna (3) and kim (4)
  });
  it('turnsToUnits refuses float drift and sub-hundredths', () => {
    expect(turnsToUnits(1.5)).toBe(150); expect(turnsToUnits('0.25')).toBe(25);
    expect(() => turnsToUnits(0.333)).toThrow(/hundredths/);
  });
});

describe('§58 deterministic tie-breakers (never random)', () => {
  it('equal units → longest ready wait → earliest position → id', () => {
    const team = [st('b', 2, { readySince: ago(5) }), st('a', 3, { readySince: ago(30) }), st('c', 1, { readySince: ago(5) })];
    expect(ids(rotationOrder('lowest_turn_units', P, team, NOW))).toEqual(['a', 'c', 'b']);
    const tie = [st('z', 1, { readySince: ago(5) }), st('y', 1, { readySince: ago(5) })];
    expect(ids(rotationOrder('lowest_turn_units', P, tie, NOW))).toEqual(['y', 'z']);
    // identical input → identical output, every time
    expect(ids(rotationOrder('lowest_turn_units', P, team, NOW))).toEqual(ids(rotationOrder('lowest_turn_units', P, [...team].reverse(), NOW)));
  });
  it('lowest turn units ranks by effective units (credited + in progress + baseline)', () => {
    const team = [st('lisa', 1, { accumulatedUnits: 200 }), st('mary', 2, { accumulatedUnits: 100, provisionalUnits: 50 }), st('anna', 3, { baselineUnits: 160 })];
    expect(ids(rotationOrder('lowest_turn_units', P, team, NOW))).toEqual(['mary', 'anna', 'lisa']);
  });
  it('§168 simulation example — Lisa 2 turns ready 20 min, Mary 1.5 turns ready 8 min → Mary', () => {
    const team = [st('lisa', 1, { accumulatedUnits: 200, readySince: ago(20) }), st('mary', 2, { accumulatedUnits: 150, readySince: ago(8) })];
    const r = rotationOrder('lowest_turn_units', P, team, NOW);
    expect(r[0].technicianId).toBe('mary');
    expect(r[0].basis).toMatch(/Lowest turns: 1.5/);
  });
  it('workload balanced ranks by service minutes', () => {
    const team = [st('lisa', 1, { serviceMinutes: 120 }), st('mary', 2, { serviceMinutes: 45 })];
    expect(ids(rotationOrder('workload_balanced', P, team, NOW))).toEqual(['mary', 'lisa']);
  });
  it('technicians outside the rotation are not ranked', () => {
    expect(ids(rotationOrder('traditional_weighted_rotation', P, [st('a', 1), st('b', 2, { inRotation: false })], NOW))).toEqual(['a']);
  });
});

describe('§59–60 starvation protection: the age boost is capped and deterministic', () => {
  it('no boost before the threshold, steps after it, never above the cap, none in position modes', () => {
    expect(ageBoostUnits(P, 'lowest_turn_units', 45)).toBe(0);
    expect(ageBoostUnits(P, 'lowest_turn_units', 46)).toBe(25);
    expect(ageBoostUnits(P, 'lowest_turn_units', 61)).toBe(50);
    expect(ageBoostUnits(P, 'lowest_turn_units', 600)).toBe(100);
    expect(ageBoostUnits(P, 'traditional_weighted_rotation', 600)).toBe(0);
    expect(ageBoostUnits(mergeTurnPolicy({ ageBoostEnabled: false }), 'hybrid_fairness', 600)).toBe(0);
  });
  it('a long-waiting technician with 0.5 more turns overtakes in hybrid mode', () => {
    const team = [st('fresh', 1, { readySince: ago(1) }), st('waited', 2, { accumulatedUnits: 50, readySince: ago(80) })];
    expect(ids(rotationOrder('hybrid_fairness', P, team, NOW))[0]).toBe('waited');
  });
});

describe('§27–29, §128 joining the rotation', () => {
  it('late arrival in traditional mode joins at the back', () => {
    const team = [st('lisa', 1, { accumulatedUnits: 300 }), st('mary', 2, { accumulatedUnits: 300 })];
    const j = joinPlacement('traditional_weighted_rotation', P, 'kim', team, { dayStarted: true });
    expect(j).toMatchObject({ position: 3, baselineUnits: 0, status: 'READY' });
  });
  it('late arrival in lowest-turn mode starts level with the busiest — no four guests in a row', () => {
    const team = [st('lisa', 1, { accumulatedUnits: 300 }), st('mary', 2, { accumulatedUnits: 400 })];
    const j = joinPlacement('lowest_turn_units', P, 'kim', team, { dayStarted: true });
    expect(j.baselineUnits).toBe(400);
    const avg = joinPlacement('lowest_turn_units', mergeTurnPolicy({ clockInJoinPosition: 'FAIRNESS_ENGINE_BASELINE' }), 'kim', team, { dayStarted: true });
    expect(avg.baselineUnits).toBe(350);
  });
  it('MANAGER_SELECTED_POSITION joins on hold; MANAGER_DEFINED start of day uses the starting rotation', () => {
    expect(joinPlacement('traditional_weighted_rotation', mergeTurnPolicy({ clockInJoinPosition: 'MANAGER_SELECTED_POSITION' }), 'kim', [], { dayStarted: false }))
      .toMatchObject({ status: 'HOLD', holdReason: 'AWAITING_MANAGER_POSITION' });
    const ids3 = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const pol = mergeTurnPolicy({}, { startOfDayOrder: 'MANAGER_DEFINED', startingRotation: ids3 });
    expect(joinPlacement('traditional_weighted_rotation', pol, ids3[1], [], { dayStarted: false }).position).toBe(0.02);
    expect(joinPlacement('traditional_weighted_rotation', pol, ids3[1], [st(ids3[0], 5)], { dayStarted: true }).position).toBe(6);
  });
  it('carry-over: FULL adds yesterday’s imbalance, PARTIAL half, NONE nothing', () => {
    expect(joinPlacement('traditional_weighted_rotation', mergeTurnPolicy({ dailyFairnessCarryover: 'FULL' }), 'k', [], { dayStarted: false, carryoverUnits: 80 }).baselineUnits).toBe(80);
    expect(joinPlacement('traditional_weighted_rotation', mergeTurnPolicy({ dailyFairnessCarryover: 'PARTIAL' }), 'k', [], { dayStarted: false, carryoverUnits: 80 }).baselineUnits).toBe(40);
    expect(joinPlacement('traditional_weighted_rotation', P, 'k', [], { dayStarted: false, carryoverUnits: 80 }).baselineUnits).toBe(0);
  });
});

describe('§198 break return under the position policy', () => {
  const team = [st('lisa', 1, { status: 'BREAK' }), st('mary', 2), st('anna', 3)];
  it('PRESERVE_POSITION keeps her place for a short break', () => {
    expect(breakReturn('traditional_weighted_rotation', P, team[0], 15, team)).toMatchObject({ position: 1, status: 'READY' });
  });
  it('beyond preservePositionForMinutes → afterPreserveWindow (default MOVE_BACK)', () => {
    expect(breakReturn('traditional_weighted_rotation', P, team[0], 45, team)).toMatchObject({ position: 4, status: 'READY' });
    expect(breakReturn('traditional_weighted_rotation', mergeTurnPolicy({ afterPreserveWindow: 'MANAGER_DECIDES' }), team[0], 45, team)).toMatchObject({ status: 'HOLD' });
  });
  it('MOVE_TO_BACK_ON_RETURN and MANAGER_DECIDES', () => {
    expect(breakReturn('traditional_weighted_rotation', mergeTurnPolicy({ breakPositionPolicy: 'MOVE_TO_BACK_ON_RETURN' }), team[0], 5, team).position).toBe(4);
    expect(breakReturn('traditional_weighted_rotation', mergeTurnPolicy({ breakPositionPolicy: 'MANAGER_DECIDES' }), team[0], 5, team).status).toBe('HOLD');
  });
});

describe('§17–19, §200 turn consumption by assignment kind', () => {
  it('kinds', () => {
    expect(assignmentKindOf({ isAppointment: false, requestedTechnicianId: null, technicianId: 'a' })).toBe('walk_in_shared');
    expect(assignmentKindOf({ isAppointment: false, requestedTechnicianId: 'a', technicianId: 'a' })).toBe('walk_in_requested');
    expect(assignmentKindOf({ isAppointment: false, requestedTechnicianId: 'b', technicianId: 'a' })).toBe('walk_in_shared');
    expect(assignmentKindOf({ isAppointment: true, requestedTechnicianId: 'a', technicianId: 'a', appointmentAnyTechnician: true })).toBe('appointment_any');
    expect(assignmentKindOf({ isAppointment: true, requestedTechnicianId: 'a', technicianId: 'a', appointmentAnyTechnician: null })).toBe('appointment_requested');
  });
  it('defaults: shared walk-in by weight, requested 0, any-tech appointment by weight, requested appointment 0', () => {
    expect(unitsForAssignment('walk_in_shared', 50, P).units).toBe(50);
    expect(unitsForAssignment('walk_in_requested', 100, P).units).toBe(0);
    expect(unitsForAssignment('appointment_any', 100, P).units).toBe(100);
    expect(unitsForAssignment('appointment_requested', 100, P).units).toBe(0);
  });
  it('salon rules change it', () => {
    expect(unitsForAssignment('walk_in_requested', 50, mergeTurnPolicy({ requestedClientTurnPolicy: 'COUNT_FULL_TURN' })).units).toBe(100);
    expect(unitsForAssignment('walk_in_requested', 50, mergeTurnPolicy({ requestedClientTurnPolicy: 'COUNT_WEIGHTED_TURN' })).units).toBe(50);
    expect(unitsForAssignment('walk_in_requested', 50, mergeTurnPolicy({ requestedClientTurnPolicy: 'MANAGER_DECIDES' }))).toMatchObject({ units: 0, needsManagerDecision: true });
    expect(unitsForAssignment('appointment_requested', 50, mergeTurnPolicy({ appointmentTurnPolicy: 'COUNT_ALL' })).units).toBe(100);
    expect(unitsForAssignment('appointment_any', 50, mergeTurnPolicy({ appointmentTurnPolicy: 'DO_NOT_COUNT' })).units).toBe(0);
    expect(unitsForAssignment('walk_in_shared', 100, mergeTurnPolicy({ manualAssignmentTurnPolicy: 'DO_NOT_COUNT' }), { manualOverride: true }).units).toBe(0);
  });
});

describe('§44 turn rule hierarchy (service → category → duration → default)', () => {
  const R = (o: Partial<TurnUnitRule>): TurnUnitRule => ({ id: 'r' + Math.random().toString(36).slice(2), ruleKey: 'k', version: 1, scope: 'service', serviceId: null, category: null, maxDurationMinutes: null, turnUnits: 100, specialRotation: false, ...o });
  const rules = [R({ id: 'svc', scope: 'service', serviceId: 's1', turnUnits: 25 }), R({ id: 'cat', scope: 'category', category: 'Pedicure', turnUnits: 100 }),
    R({ id: 'd15', scope: 'duration', maxDurationMinutes: 15, turnUnits: 50 }), R({ id: 'd90', scope: 'duration', maxDurationMinutes: 90, turnUnits: 150 })];
  it('precedence', () => {
    expect(resolveServiceUnits({ serviceId: 's1', category: 'Pedicure', durationMinutes: 10 }, rules, 100)).toMatchObject({ units: 25, source: 'service', ruleId: 'svc' });
    expect(resolveServiceUnits({ serviceId: 's2', category: 'pedicure ', durationMinutes: 10 }, rules, 100)).toMatchObject({ units: 100, source: 'category' });
    expect(resolveServiceUnits({ serviceId: 's2', category: 'Gel', durationMinutes: 10 }, rules, 100)).toMatchObject({ units: 50, source: 'duration', ruleId: 'd15' });
    expect(resolveServiceUnits({ serviceId: 's2', category: 'Gel', durationMinutes: 60 }, rules, 100)).toMatchObject({ units: 150, ruleId: 'd90' });
    expect(resolveServiceUnits({ serviceId: 's2', category: 'Gel', durationMinutes: 120 }, rules, 100)).toMatchObject({ units: 100, source: 'default', ruleId: null });
  });
  it('a visit sums its services (each its own rule)', () => {
    expect(resolveVisitUnits([{ serviceId: 's1', category: null, durationMinutes: 10 }, { serviceId: 's9', category: 'Pedicure', durationMinutes: 45 }], rules, 100).units).toBe(125);
  });
});

describe('§64–66, §153 decline and timeout consequences', () => {
  it('safety reasons are never penalised, whatever the policy', () => {
    const harsh = mergeTurnPolicy({ technicianDeclinePolicy: 'CHARGE_FULL_TURN' });
    for (const r of ['NOT_LICENSED', 'NOT_SKILLED', 'MEDICAL_RESTRICTION', 'EQUIPMENT_UNAVAILABLE', 'APPOINTMENT_CONFLICT', 'MANAGER_DECISION']) expect(declineConsequence(harsh, r)).toMatchObject({ penalized: false, chargeUnits: 0 });
    expect(declineConsequence(harsh, 'PERSONAL_PREFERENCE')).toMatchObject({ action: 'CHARGE', chargeUnits: 100, penalized: true });
    expect(declineConsequence(mergeTurnPolicy({ technicianDeclinePolicy: 'CHARGE_HALF_TURN' }), 'OTHER').chargeUnits).toBe(50);
    expect(declineConsequence(P, 'PERSONAL_PREFERENCE')).toMatchObject({ action: 'KEEP_POSITION', penalized: false });
  });
  it('timeouts', () => {
    expect(offerTimeoutConsequence(P).action).toBe('KEEP_POSITION');
    expect(offerTimeoutConsequence(mergeTurnPolicy({ offerTimeoutPolicy: 'MANAGER_REVIEW' })).action).toBe('HOLD');
  });
});

describe('§166 policy validation and §167 preview', () => {
  it('refuses unknown keys, bad enums, out-of-range numbers and a salon-wide starting rotation', () => {
    expect(validateTurnPolicyPatch({ bogus: 1 })).toEqual(['Unknown turn policy setting "bogus".']);
    expect(validateTurnPolicyPatch({ breakPositionPolicy: 'FORGET' })[0]).toMatch(/breakPositionPolicy must be one of/);
    expect(validateTurnPolicyPatch({ appointmentProtectionBufferMinutes: 500 })[0]).toMatch(/0 to 120/);
    expect(validateTurnPolicyPatch({ startingRotation: ['11111111-1111-4111-8111-111111111111'] }, 'salon')[0]).toMatch(/location/);
    expect(validateTurnPolicyPatch({ defaultTurnUnits: 50, ageBoostEnabled: false })).toEqual([]);
  });
  it('merge: defaults ← salon ← branch; an invalid stored value falls back', () => {
    const m = mergeTurnPolicy({ defaultTurnUnits: 75, breakPositionPolicy: 'NOPE' }, { defaultTurnUnits: 50 });
    expect(m.defaultTurnUnits).toBe(50); expect(m.breakPositionPolicy).toBe(RECOMMENDED_TURN_POLICY.breakPositionPolicy);
  });
  it('preview says what changes in plain words', () => {
    const c = previewTurnPolicyChange(P, mergeTurnPolicy({ appointmentTurnPolicy: 'COUNT_ALL' }), { currentMode: 'RECOMMEND_AND_CONFIRM', nextMode: 'AUTOMATIC' });
    expect(c.map((x) => x.key)).toEqual(['assignmentMode', 'appointmentTurnPolicy']);
    expect(c[1].outcome).toMatch(/full 1.0 turn/);
  });
});

describe('§25, §91, §94–96 board status and Technician App visibility', () => {
  it('board statuses and columns', () => {
    expect(boardStatusOf({ status: 'READY', inRotation: true }, { isNext: true, appointmentSoon: false, offerPending: false })).toBe('NEXT_UP');
    expect(boardStatusOf({ status: 'READY', inRotation: true }, { isNext: true, appointmentSoon: true, offerPending: false })).toBe('APPOINTMENT_SOON');
    expect(boardStatusOf({ status: 'ASSIGNED', inRotation: true }, { isNext: false, appointmentSoon: false, offerPending: true })).toBe('ASSIGNMENT_OFFERED');
    expect(boardColumnOf('HOLD')).toBe('BREAK_HOLD'); expect(boardColumnOf('CLOCKED_OUT')).toBe('OFF_SHIFT');
  });
  const order = [{ technicianId: 'a', name: 'Anna', rank: 1, status: 'NEXT_UP' as const }, { technicianId: 'b', name: 'Bea', rank: 2, status: 'READY' as const }, { technicianId: 'c', name: 'Cat', rank: 3, status: 'READY' as const }];
  it('each visibility shows exactly what it promises — and never money', () => {
    const full = techQueueView(mergeTurnPolicy({ technicianQueueVisibility: 'FULL_TEAM_QUEUE' }), order, 'c');
    expect(full.team.map((t) => t.name)).toEqual(['Anna', 'Bea', 'Cat']); expect(full.myRank).toBe(3);
    expect(JSON.stringify(full)).not.toMatch(/cents|earning|commission|tip/i);
    expect(techQueueView(mergeTurnPolicy({ technicianQueueVisibility: 'NEXT_FEW', nextFewCount: 2 }), order, 'c').team.map((t) => t.name)).toEqual(['Anna', 'Bea']);
    expect(techQueueView(P, order, 'c')).toMatchObject({ myRank: 3, queueLength: 3, team: [] });
    expect(techQueueView(mergeTurnPolicy({ technicianQueueVisibility: 'PRIVATE_POSITION' }), order, 'c')).toMatchObject({ myRank: 3, queueLength: null, team: [] });
  });
  it('§195 friendly errors name the technician', () => {
    expect(friendlyTurnError('APPOINTMENT_CONFLICT', 'Lisa')).toBe('Lisa has an appointment soon and cannot take this service without creating a scheduling conflict.');
  });
});

describe('§209 fairness analytics on known sample data (deterministic)', () => {
  const day = '2026-03-02T';
  const ev = (id: string, tech: string, type: string, at: string, o: any = {}) => ({ id, technicianId: tech, eventType: type, statusAfter: o.statusAfter ?? null, occurredAt: day + at + ':00.000Z',
    turnUnits: o.units ?? 0, turnUnitsDelta: o.delta ?? 0, assignmentKind: o.kind ?? null, assignmentSource: o.source ?? null, assignmentRef: o.ref ?? null, reasonCode: o.reason ?? null, metadata: o.meta ?? {} });
  const events = [
    ev('1', 'lisa', 'JOIN', '09:00', { statusAfter: 'READY' }), ev('2', 'mary', 'JOIN', '09:00', { statusAfter: 'READY' }),
    ev('3', 'lisa', 'ASSIGN', '10:00', { statusAfter: 'ASSIGNED', units: 100, kind: 'walk_in_shared', source: 'auto_assign', meta: { eligiblePool: ['lisa', 'mary'], readyWaitMinutes: 60 } }),
    ev('4', 'mary', 'SKIP', '10:00', { statusAfter: 'READY', reason: 'SKILL_INELIGIBLE' }),
    ev('5', 'lisa', 'TURN_CREDIT', '11:00', { statusAfter: 'READY', delta: 100, ref: '3' }),
    ev('6', 'mary', 'ASSIGN', '11:30', { statusAfter: 'ASSIGNED', units: 100, kind: 'walk_in_shared', source: 'ai_suggestion', meta: { eligiblePool: ['lisa', 'mary'], readyWaitMinutes: 150 } }),
    ev('7', 'lisa', 'MANUAL_ASSIGN', '11:45', { statusAfter: 'ASSIGNED', units: 100, kind: 'walk_in_shared', source: 'staff', reason: 'TRAINING', meta: { eligiblePool: ['lisa'] } }),
    ev('8', 'lisa', 'CORRECTION', '11:50', { statusAfter: 'READY', ref: '7' }),
    ev('9', 'mary', 'ADJUST', '12:00', { delta: -50, statusAfter: 'ASSIGNED' }),
  ];
  const r = computeFairness(events, { lisa: 'Lisa', mary: 'Mary' }, { startMs: Date.parse(day + '09:00:00.000Z'), endMs: Date.parse(day + '12:00:00.000Z') }, { fairRangeUnits: 20, fairRangePercent: 0 });
  const lisa = r.rows.find((x) => x.technicianId === 'lisa')!; const mary = r.rows.find((x) => x.technicianId === 'mary')!;
  it('expected share, actual, gap and labels', () => {
    expect(r.team.opportunities).toBe(2);
    expect(lisa.expectedUnits).toBe(100); expect(mary.expectedUnits).toBe(100);
    expect(lisa.actualUnits).toBe(100);   // the corrected manual assignment does not count
    expect(mary.actualUnits).toBe(50);    // 100 shared − 50 manager adjustment
    expect(lisa.indicator).toBe('WITHIN_FAIR_RANGE');
    expect(mary.indicator).toBe('BELOW_EXPECTED_OPPORTUNITY'); expect(mary.indicatorLabel).toBe('0.5 below expected opportunity');
  });
  it('ready time, skips, waits, override analytics', () => {
    expect(lisa.readyMinutes).toBe(60 + 45 + 10);   // 9–10, 11–11:45, 11:50–12
    expect(mary.readyMinutes).toBe(150);            // 9–11:30
    expect(mary.skipsByReason).toEqual({ SKILL_INELIGIBLE: 1 });
    expect(lisa.averageReadyWaitMinutes).toBe(60);
    expect(r.team.overrides).toBe(0);               // the only override was corrected
    expect(r.team.automaticAssignments).toBe(1);
  });
  it('§137 the dispute timeline reads in sequence', () => {
    const t = explainTimeline(events.map((e, i) => ({ ...e, sequenceNumber: i + 1 })), { lisa: 'Lisa', mary: 'Mary' });
    expect(t[3].text).toBe('Mary skipped — skill ineligible; position preserved');
  });
});

// Oct 13 2026 (FLOW T1): the legacy scoring policies map onto the fairness modes — one engine.
describe('normalizeRotationPolicy (T1)', () => {
  it('maps every legacy policy to its fairness mode, keeps fairness modes, and defaults the unknown to the recommended mode', async () => {
    const { normalizeRotationPolicy } = await import('./turn-core');
    expect(normalizeRotationPolicy('hybrid')).toBe('hybrid_fairness');
    expect(normalizeRotationPolicy('least_minutes')).toBe('workload_balanced');
    expect(normalizeRotationPolicy('least_customers')).toBe('lowest_turn_units');
    expect(normalizeRotationPolicy('first_available')).toBe('traditional_weighted_rotation');
    expect(normalizeRotationPolicy('fixed_order')).toBe('manual_order');
    expect(normalizeRotationPolicy('manual_order')).toBe('manual_order');
    expect(normalizeRotationPolicy(null)).toBe('traditional_weighted_rotation');
    expect(normalizeRotationPolicy('nonsense')).toBe('traditional_weighted_rotation');
  });
});
