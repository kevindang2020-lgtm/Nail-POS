// turn-coded-text.vitest.spec.ts — Vietnamese POS §21 (Oct 27 2026): every English sentence the turn queue writes for staff
// ("why this place", the history line) also travels as a code + vars the POS words in the cashier's language. The English
// field is unchanged (older clients), the code is stable, and the vars carry no English words (reasons / kinds are "@key"
// references the POS resolves).
import { describe, it, expect } from 'vitest';
import { fairnessKeyOf, rotationOrder, mergeTurnPolicy, type TurnStateLike } from './turn-core';
import { explainTimeline } from './turn-fairness';

const NOW = Date.parse('2026-03-02T15:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
const st = (o: Partial<TurnStateLike> = {}): TurnStateLike => ({ technicianId: 'a', name: 'Trần Mỹ Linh', status: 'READY', inRotation: true, rotationPosition: 1, accumulatedUnits: 150, provisionalUnits: 0, pendingUnits: 50,
  baselineUnits: 0, specialUnits: 0, serviceMinutes: 90, baselineMinutes: 0, readySince: ago(10), ...o });
const P = mergeTurnPolicy({});

describe('turn "why this place" — basisText', () => {
  it('one code per mode / sentence shape, vars language-neutral, English unchanged', () => {
    const cases: [string, string][] = [['lowest_turn_units', 'TURN_BASIS.LOWEST_TURNS'], ['workload_balanced', 'TURN_BASIS.WORKLOAD'], ['hybrid_fairness', 'TURN_BASIS.HYBRID'], ['manual_order', 'TURN_BASIS.MANUAL_ORDER'], ['traditional_weighted_rotation', 'TURN_BASIS.ROTATION_PARTIAL']];
    for (const [mode, code] of cases) {
      const k = fairnessKeyOf(mode as any, P, st(), NOW);
      expect(k.basisText.code, mode).toBe(code);
      for (const v of Object.values(k.basisText.vars ?? {})) expect(String(v)).toMatch(/^[\d.\-−]+$/);   // numbers only
    }
    expect(fairnessKeyOf('lowest_turn_units', P, st(), NOW).basis).toBe('Lowest turns: 1.5 turn units today');
    expect(fairnessKeyOf('lowest_turn_units', P, st(), NOW).basisText).toEqual({ code: 'TURN_BASIS.LOWEST_TURNS', vars: { turns: '1.5' } });
    expect(fairnessKeyOf('traditional_weighted_rotation', P, st({ pendingUnits: 0 }), NOW).basisText).toEqual({ code: 'TURN_BASIS.ROTATION' });
    expect(fairnessKeyOf('lowest_turn_units', P, st(), NOW, { specialPool: true }).basisText.code).toBe('TURN_BASIS.SPECIAL');
  });
  it('a waiting boost switches to the _BOOST sentence', () => {
    const k = fairnessKeyOf('lowest_turn_units', P, st({ readySince: ago(240) }), NOW);
    if (k.ageBoost) expect(k.basisText.code).toBe('TURN_BASIS.LOWEST_TURNS_BOOST'); else expect(k.basisText.code).toBe('TURN_BASIS.LOWEST_TURNS');
  });
  it('rotationOrder carries basisText on every ranked row', () => {
    const r = rotationOrder('lowest_turn_units', P, [st(), st({ technicianId: 'b', name: 'Lan', accumulatedUnits: 0 })], NOW);
    expect(r.every((x) => x.basisText && x.basisText.code.startsWith('TURN_BASIS.'))).toBe(true);
  });
});

describe('turn history — textCoded', () => {
  const ev = (o: any) => ({ id: o.id, technicianId: 'lisa', eventType: 'READY', statusAfter: null, occurredAt: '2026-03-02T15:00:00Z', turnUnits: 0, turnUnitsDelta: 0, assignmentKind: null, assignmentSource: null, assignmentRef: null, reasonCode: null, ...o });
  it('codes every event type, references reasons and kinds, keeps the English text and the event id', () => {
    const t = explainTimeline([
      ev({ id: 'e2', sequenceNumber: 2, eventType: 'SKIP', reasonCode: 'ON_BREAK' }),
      ev({ id: 'e1', sequenceNumber: 1, eventType: 'ASSIGN', turnUnits: 100, assignmentKind: 'walk_in_shared' }),
      ev({ id: 'e3', sequenceNumber: 3, eventType: 'MANUAL_ASSIGN', reasonCode: 'SKILL_MATCH', recommendedTechnicianId: 'mary' }),
      ev({ id: 'e4', sequenceNumber: 4, eventType: 'ADJUST', turnUnitsDelta: -50, reasonText: 'typo fix' }),
      ev({ id: 'e5', sequenceNumber: 5, eventType: 'READY', technicianId: 'ghost' }),
      ev({ id: 'e6', sequenceNumber: 6, eventType: 'BRAND_NEW_EVENT' }),
    ], { lisa: 'Lisa', mary: 'Mary' });
    expect(t.map((x) => x.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    expect(t[0]).toMatchObject({ text: 'Lisa assigned (1.00 turn, walk in shared)', textCoded: { code: 'TURN_EVENT.ASSIGN_KIND', vars: { name: 'Lisa', units: '1.00', kind: '@srv.TURN_KIND.walk_in_shared' } } });
    expect(t[1].textCoded).toEqual({ code: 'TURN_EVENT.SKIP', vars: { name: 'Lisa', reason: '@status.turnReason.ON_BREAK' } });
    expect(t[2].textCoded).toEqual({ code: 'TURN_EVENT.MANUAL_ASSIGN_REASON', vars: { name: 'Lisa', other: 'Mary', reason: '@status.turnReason.SKILL_MATCH' } });
    // a manager's typed reason is user content: in the English text, never in the coded vars
    expect(t[3].text).toBe('Lisa turn adjusted -0.50 — typo fix');
    expect(t[3].textCoded).toEqual({ code: 'TURN_EVENT.ADJUST', vars: { name: 'Lisa', units: '-0.50' } });
    expect(t[4].textCoded.code).toBe('TURN_EVENT.READY_ANON');
    expect(t[5].textCoded.code).toBe('TURN_EVENT.BRAND_NEW_EVENT');   // the POS falls back to the English text
  });
});
