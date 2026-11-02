// fair-turn-engine — the staged, explainable Fair Turn pipeline (mandate §5–8, §14–17, §57–62, §157–163) and the
// mode / turn-policy settings rules (§9, §166). Pure: fixed clock, no database.
import { describe, it, expect } from 'vitest';
import { RECOMMENDED_TURN_POLICY, type TurnStateLike } from '@aipowersalon/workforce';
import { rankFairTurn, turnHardFails, FAIR_TURN_ENGINE_VERSION, type FairTurnCandidate } from './fair-turn-engine';
import { validateSettingsPatch, normalizeModePatch, stripNulls } from './ai-queue-assignment-settings';

const NOW = Date.parse('2026-03-02T16:00:00Z');
const ago = (m: number) => new Date(NOW - m * 60000).toISOString();
const st = (id: string, o: Partial<TurnStateLike> = {}): TurnStateLike => ({
  technicianId: id, status: 'READY', inRotation: true, rotationPosition: 1, accumulatedUnits: 0, provisionalUnits: 0, pendingUnits: 0, baselineUnits: 0, specialUnits: 0,
  serviceMinutes: 0, baselineMinutes: 0, readySince: ago(10), eligibleSkipCount: 0, consecutiveAuto: 0, ...o,
});
const cand = (id: string, name: string, turn: TurnStateLike | null, o: Partial<FairTurnCandidate> = {}): FairTurnCandidate => ({ technicianId: id, name, hardFails: [], turn, ...o });
const base = { mode: 'traditional_weighted_rotation' as const, policy: { ...RECOMMENDED_TURN_POLICY }, assignmentMode: 'RECOMMEND_AND_CONFIRM' as const, policyVersion: '3', nowMs: NOW };

describe('rankFairTurn — traditional weighted rotation', () => {
  const lisa = cand('a', 'Lisa', st('a', { rotationPosition: 1, readySince: ago(20) }));
  const mary = cand('b', 'Mary', st('b', { rotationPosition: 2, readySince: ago(8) }));
  const anna = cand('c', 'Anna', st('c', { rotationPosition: 3, readySince: ago(2) }));

  it('picks the front of the rotation and explains why', () => {
    const r = rankFairTurn({ ...base, candidates: [mary, anna, lisa] });
    expect(r.version).toBe(FAIR_TURN_ENGINE_VERSION);
    expect(r.recommendedTechnicianId).toBe('a');
    expect(r.eligibleOrder).toEqual(['a', 'b', 'c']);
    expect(r.skips).toEqual([]);
    expect(r.why[0]).toBe('Lisa selected because Lisa is next among the technicians who can take this guest.');
    expect(r.why).toContain('Ready position: #1');
  });
  it('a technician ahead who cannot do the service keeps her place and gets a skip reason (§16, §67)', () => {
    const r = rankFairTurn({ ...base, serviceLabel: 'pedicure', candidates: [cand('a', 'Lisa', lisa.turn, { hardFails: ['missing_skill'] }), mary, anna] });
    expect(r.recommendedTechnicianId).toBe('b');
    expect(r.skips).toEqual([{ technicianId: 'a', reason: 'SKILL_INELIGIBLE' }]);
    expect(r.skippedText[0].text).toBe('Lisa remained ahead in rotation, but was not eligible for this pedicure. Her turn position was preserved.');
    expect(r.ranking.find((x) => x.technicianId === 'a')).toMatchObject({ turnRank: 1, eligible: false, skipReason: 'SKILL_INELIGIBLE' });
  });
  it('hold, break, not in rotation and a guest decline are hard rules (stage 1)', () => {
    const declined = new Set(['d']);
    expect(turnHardFails(cand('x', 'X', st('x', { status: 'HOLD' })), declined)).toEqual(['manager_hold']);
    expect(turnHardFails(cand('x', 'X', st('x', { status: 'BREAK' })), declined)).toEqual(['on_break']);
    expect(turnHardFails(cand('x', 'X', null), declined)).toEqual(['not_in_rotation']);
    expect(turnHardFails(cand('x', 'X', st('x', { status: 'CLOCKED_OUT' })), declined)).toEqual(['not_in_rotation']);
    expect(turnHardFails(cand('d', 'D', st('d')), declined)).toEqual(['customer_declined']);
    const r = rankFairTurn({ ...base, declinedTechnicianIds: ['a'], candidates: [lisa, mary] });
    expect(r.recommendedTechnicianId).toBe('b');
    expect(r.skips).toEqual([{ technicianId: 'a', reason: 'CUSTOMER_DECLINED' }]);
  });
  it('the requested technician goes first when eligible — others ahead are skipped as CUSTOMER_REQUEST (§17)', () => {
    const r = rankFairTurn({ ...base, requestedTechnicianId: 'c', candidates: [lisa, mary, anna] });
    expect(r.recommendedTechnicianId).toBe('c');
    expect(r.requested).toBe(true);
    expect(r.skips.map((s) => [s.technicianId, s.reason])).toEqual([['a', 'CUSTOMER_REQUEST'], ['b', 'CUSTOMER_REQUEST']]);
    expect(r.why[0]).toBe('Anna selected because the guest asked for Anna.');
  });
  it('a requested technician who fails a hard rule is never forced through — a warning says so', () => {
    const r = rankFairTurn({ ...base, requestedTechnicianId: 'c', candidates: [lisa, mary, cand('c', 'Anna', anna.turn, { hardFails: ['on_break'] })] });
    expect(r.recommendedTechnicianId).toBe('a');
    expect(r.requested).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/The guest asked for Anna/);
  });
  it('max consecutive automatic assignments demotes the streak holder on auto runs only (§business constraint)', () => {
    const streak = cand('a', 'Lisa', st('a', { rotationPosition: 1, consecutiveAuto: 1 }));
    expect(rankFairTurn({ ...base, automatic: true, candidates: [streak, mary] }).recommendedTechnicianId).toBe('b');
    expect(rankFairTurn({ ...base, automatic: true, candidates: [streak, mary] }).skips).toEqual([{ technicianId: 'a', reason: 'MAX_CONSECUTIVE_AUTO' }]);
    expect(rankFairTurn({ ...base, automatic: false, candidates: [streak, mary] }).recommendedTechnicianId).toBe('a');
    // never when she is the only eligible technician
    expect(rankFairTurn({ ...base, automatic: true, candidates: [streak] }).recommendedTechnicianId).toBe('a');
  });
  it('preferred technician first only under PREFERRED_TECHNICIAN_FIRST', () => {
    const pref = cand('b', 'Mary', mary.turn, { isPreferred: true });
    expect(rankFairTurn({ ...base, candidates: [lisa, pref] }).recommendedTechnicianId).toBe('a');
    expect(rankFairTurn({ ...base, policy: { ...base.policy, walkInPolicy: 'PREFERRED_TECHNICIAN_FIRST' }, candidates: [lisa, pref] }).recommendedTechnicianId).toBe('b');
  });
  it('nobody eligible → no pick, no skips, nothing invented', () => {
    const r = rankFairTurn({ ...base, candidates: [cand('a', 'Lisa', lisa.turn, { hardFails: ['missing_skill'] })] });
    expect(r.recommendedTechnicianId).toBeNull();
    expect(r.skips).toEqual([]);
    expect(r.why).toEqual([]);
  });
  it('is deterministic regardless of candidate input order (§58 — never random)', () => {
    const a = rankFairTurn({ ...base, candidates: [lisa, mary, anna] });
    const b = rankFairTurn({ ...base, candidates: [anna, lisa, mary] });
    expect(b.eligibleOrder).toEqual(a.eligibleOrder);
    expect(b.ranking.map((x) => x.technicianId)).toEqual(a.ranking.map((x) => x.technicianId));
  });
});

describe('rankFairTurn — lowest turn units', () => {
  it('fewest effective units first; equal units → longest ready wait; then position; then id', () => {
    const r = rankFairTurn({ ...base, mode: 'lowest_turn_units', candidates: [
      cand('a', 'Lisa', st('a', { accumulatedUnits: 200, rotationPosition: 1 })),
      cand('b', 'Mary', st('b', { accumulatedUnits: 150, rotationPosition: 2, readySince: ago(5) })),
      cand('c', 'Anna', st('c', { accumulatedUnits: 150, rotationPosition: 3, readySince: ago(12) })),
    ] });
    expect(r.eligibleOrder).toEqual(['c', 'b', 'a']);
    expect(r.why).toContain('Turn units today: 1.5');
  });
});

describe('settings — mode and turn policy (§9, §166)', () => {
  it('normalizes the mode and the auto switch together', () => {
    expect(normalizeModePatch({ autoEnabled: true })).toEqual({ autoEnabled: true, assignmentMode: 'AUTOMATIC' });
    expect(normalizeModePatch({ assignmentMode: 'MANUAL' })).toEqual({ assignmentMode: 'MANUAL', autoEnabled: false });
    expect(normalizeModePatch({ assignmentMode: 'AUTOMATIC' })).toEqual({ assignmentMode: 'AUTOMATIC', autoEnabled: true });
    expect(normalizeModePatch({ autoEnabled: false })).toEqual({ autoEnabled: false });
  });
  it('refuses contradictions, unknown modes and bad turn policy values', () => {
    expect(validateSettingsPatch({ autoEnabled: true, assignmentMode: 'MANUAL' } as any).join(' ')).toMatch(/TURN_POLICY_INVALID/);
    expect(validateSettingsPatch({ assignmentMode: 'AUTOMATIC', autoEnabled: false } as any).join(' ')).toMatch(/TURN_POLICY_INVALID/);
    expect(validateSettingsPatch({ assignmentMode: 'SOMETIMES' } as any)).toContain('assignmentMode must be AUTOMATIC, RECOMMEND_AND_CONFIRM or MANUAL.');
    expect(validateSettingsPatch({ rotationPolicy: 'lowest_turn_units' } as any)).toEqual([]);
    expect(validateSettingsPatch({ rotationPolicy: 'random' } as any)).toContain('Unknown rotation policy.');
    expect(validateSettingsPatch({ turnPolicy: { appointmentProtectionBufferMinutes: 10 } } as any)).toEqual([]);
    expect(validateSettingsPatch({ turnPolicy: { appointmentProtectionBufferMinutes: -5 } } as any).length).toBeGreaterThan(0);
    expect(validateSettingsPatch({ turnPolicy: { notASetting: 1 } } as any).length).toBeGreaterThan(0);
  });
  it('stripNulls drops cleared keys (null = inherit)', () => {
    expect(stripNulls({ a: 1, b: null, c: undefined, d: 'x' } as any)).toEqual({ a: 1, d: 'x' });
    expect(stripNulls(null)).toEqual({});
  });
});

// Oct 13 2026 (FLOW T1): a salon that configured a FIXED TURN ORDER under the legacy fixed_order policy keeps it — under
// manual_order the configured list IS the rotation order (anyone not on the list follows, in her queue position).
describe('applyConfiguredOrder — the legacy fixed order under manual_order (T1)', () => {
  it('ranks by the configured list first, then the rest by their own position; other modes are untouched', async () => {
    const { applyConfiguredOrder } = await import('./fair-turn-engine');
    const c = [cand('a', 'Ann', st('a', { rotationPosition: 1 })), cand('b', 'Bea', st('b', { rotationPosition: 2 })), cand('c', 'Cay', st('c', { rotationPosition: 3 })), cand('d', 'Dee', null)];
    const out = applyConfiguredOrder('manual_order', ['c', 'a'], c);
    expect(out.map((x) => [x.technicianId, x.turn?.rotationPosition ?? null])).toEqual([['a', 2], ['b', 1004], ['c', 1], ['d', null]]);
    const r = rankFairTurn({ ...base, mode: 'manual_order', candidates: out });
    expect(r.eligibleOrder.slice(0, 3)).toEqual(['c', 'a', 'b']);
    expect(applyConfiguredOrder('traditional_weighted_rotation', ['c', 'a'], c)).toBe(c);
    expect(applyConfiguredOrder('manual_order', [], c)).toBe(c);
  });
});

// Oct 13 2026 (FLOW §158 BUILT): the guest's preferred language is a SOFT preference by default (the next technician
// who speaks it is recommended; those passed keep their place with a LANGUAGE_MATCH reason), HARD only when the owner
// configures languageMatch = 'HARD' (non-speakers are ineligible), OFF ignores it. Unknown on either side = no effect.
describe('rankFairTurn — language matching (§158)', () => {
  const lisa = cand('a', 'Lisa', st('a', { rotationPosition: 1, readySince: ago(20) }), { speaksGuestLanguage: false });
  const mary = cand('b', 'Mary', st('b', { rotationPosition: 2, readySince: ago(8) }), { speaksGuestLanguage: true });
  const anna = cand('c', 'Anna', st('c', { rotationPosition: 3, readySince: ago(2) }), { speaksGuestLanguage: null });
  it('SOFT (default): the first speaker is recommended with the why line; Lisa keeps #1 with a LANGUAGE_MATCH skip', () => {
    const r = rankFairTurn({ ...base, guestLanguage: 'vi', candidates: [lisa, mary, anna] });
    expect(base.policy.languageMatch).toBe('SOFT');
    expect(r.recommendedTechnicianId).toBe('b');
    expect(r.skips).toEqual([{ technicianId: 'a', reason: 'LANGUAGE_MATCH' }]);
    expect(r.why.some((w) => /speaks the guest's language \(vi\)/.test(w))).toBe(true);
    expect(r.ranking.find((x) => x.technicianId === 'a')).toMatchObject({ turnRank: 1, eligible: true, skipReason: 'LANGUAGE_MATCH' });
    // nobody speaks it → the rotation decides, no skip
    const none = rankFairTurn({ ...base, guestLanguage: 'vi', candidates: [lisa, cand('b', 'Mary', mary.turn, { speaksGuestLanguage: false }), anna] });
    expect(none.recommendedTechnicianId).toBe('a'); expect(none.skips).toEqual([]);
    // no guest language → no effect
    expect(rankFairTurn({ ...base, candidates: [lisa, mary, anna] }).recommendedTechnicianId).toBe('a');
    // the next technician's language is UNKNOWN → she keeps the guest (unknown is never "does not speak")
    expect(rankFairTurn({ ...base, guestLanguage: 'vi', candidates: [cand('a', 'Lisa', lisa.turn, { speaksGuestLanguage: null }), mary, anna] }).recommendedTechnicianId).toBe('a');
    // a requested technician still wins over the language preference
    expect(rankFairTurn({ ...base, guestLanguage: 'vi', requestedTechnicianId: 'c', candidates: [lisa, mary, anna] }).recommendedTechnicianId).toBe('c');
  });
  it('HARD: a non-speaker is ineligible (language_mismatch); unknown stays eligible. OFF: ignored', () => {
    const hard = rankFairTurn({ ...base, policy: { ...base.policy, languageMatch: 'HARD' }, guestLanguage: 'vi', candidates: [lisa, mary, anna] });
    expect(hard.recommendedTechnicianId).toBe('b');
    expect(hard.ranking.find((x) => x.technicianId === 'a')).toMatchObject({ eligible: false, hardFails: ['language_mismatch'], skipReason: 'LANGUAGE_MATCH' });
    expect(hard.ranking.find((x) => x.technicianId === 'c')?.eligible).toBe(true);
    const off = rankFairTurn({ ...base, policy: { ...base.policy, languageMatch: 'OFF' }, guestLanguage: 'vi', candidates: [lisa, mary, anna] });
    expect(off.recommendedTechnicianId).toBe('a'); expect(off.skips).toEqual([]);
  });
});

// Vietnamese POS §21 (Oct 27 2026): "why" and "skipped" also travel as code + vars, line for line.
describe('rankFairTurn — whyCoded / skippedText.textCoded', () => {
  it('whyCoded has one code per why line; skipped carries a code with an @reason reference', () => {
    const lisa = cand('a', 'Lisa', st('a', { rotationPosition: 1, readySince: ago(20) }), { hardFails: ['on_break'] });
    const mary = cand('b', 'Mary', st('b', { rotationPosition: 2, readySince: ago(8) }));
    const r = rankFairTurn({ ...base, serviceLabel: 'pedicure', candidates: [lisa, mary] });
    expect(r.whyCoded.length).toBe(r.why.length);
    expect(r.whyCoded[0]).toEqual({ code: 'FAIR_WHY.NEXT', vars: { name: 'Mary' } });
    expect(r.whyCoded.at(-1)!.code).toBe('FAIR_WHY.RULE');
    expect(String(r.whyCoded.at(-1)!.vars!.rule)).toMatch(/^@srv\.TURN_BASIS\./);
    expect(r.whyCoded.every((c) => c.code.startsWith('FAIR_WHY.'))).toBe(true);
    const sk = r.skippedText.find((x) => x.technicianId === 'a')!;
    expect(sk.textCoded).toEqual({ code: 'FAIR_SKIP.OTHER', vars: { name: 'Lisa', reason: '@srv.SKIP_REASON.ON_BREAK' } });
  });
});
