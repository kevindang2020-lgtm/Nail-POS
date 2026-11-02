// ai-queue-assignment-plan.vitest.spec.ts — the PURE visit / party plan composer (multi-technician routing, contract §2).
// No I/O: every line arrives already ranked by the ONE engine (compute() per line); this composes them into a plan.
import { describe, it, expect } from 'vitest';
import {
  composeVisitPlan, composePartyPlan, PLAN_VERSION, MAX_PARALLEL_TECHS, MAX_TECHS_PER_VISIT, SINGLE_TECH_GRACE_MIN,
  type ComposeVisitInput, type PlanCandidate, type PlanLineInput, type PlanServiceLine,
} from './ai-queue-assignment-plan';

const cand = (technicianId: string, matchScore: number, startInMinutes: number | null = 0, extra: Partial<PlanCandidate> = {}): PlanCandidate =>
  ({ technicianId, name: technicianId.toUpperCase(), matchScore, startInMinutes, reasons: [`${technicianId} fits`], warnings: [], ...extra });
const svc = (serviceId: string, sequence: number, durationMinutes: number, extra: Partial<PlanServiceLine> = {}): PlanServiceLine =>
  ({ serviceId, serviceName: serviceId[0].toUpperCase() + serviceId.slice(1), category: serviceId, durationMinutes, sequence, isAddon: false, parentServiceId: null, assignedTechnicianId: null, status: 'pending', ...extra });
const line = (l: PlanServiceLine, ranked: PlanCandidate[], confidence = 0.8): PlanLineInput => ({ line: l, ranked, ineligible: [], confidence, conflicts: ranked.length ? [] : ['No eligible technician (2 missing required skill)'] });
const visit = (lines: PlanLineInput[], over: Partial<ComposeVisitInput> = {}): ComposeVisitInput => ({
  queueItemId: 'q1', customerName: 'Rita', queueVersion: 3, currentTechnicianId: null, requestedTechnicianId: null, requestedTechnicianName: null,
  whole: { recommended: null, confidence: 0, warnings: [], conflicts: ['No eligible technician'] }, lines, ...over,
});

// Pedicure (P can), Manicure (M can), Nail Art add-on of Manicure (M can) — nobody covers all three
const pedi = svc('pedicure', 0, 50); const mani = svc('manicure', 1, 40); const art = svc('nailart', 2, 20, { isAddon: true, parentServiceId: 'manicure' });
const threeLines = () => [line(pedi, [cand('p', 60)]), line(mani, [cand('m', 55), cand('x', 40)]), line(art, [cand('m', 50)])];

describe('composeVisitPlan — split when no single technician covers the visit', () => {
  it('3 lines, disjoint skills → split over 2 technicians; the add-on runs after its parent; ETA = the last line end', () => {
    const p = composeVisitPlan(visit(threeLines()));
    expect(p.mode).toBe('split');
    expect(p.technicianCount).toBe(2);
    const by = Object.fromEntries(p.lines.map((l) => [l.serviceId, l]));
    expect(by.pedicure).toMatchObject({ technicianId: 'p', timing: 'parallel', afterServiceId: null, estimatedStartInMinutes: 0, estimatedEndInMinutes: 50 });
    expect(by.manicure).toMatchObject({ technicianId: 'm', timing: 'parallel', estimatedStartInMinutes: 0, estimatedEndInMinutes: 40 });
    expect(by.nailart).toMatchObject({ technicianId: 'm', timing: 'after', afterServiceId: 'manicure', estimatedStartInMinutes: 40, estimatedEndInMinutes: 60 });
    expect(p.estimatedStartInMinutes).toBe(0);
    expect(p.estimatedFinishInMinutes).toBe(60);   // max line end, not the sum (110)
    expect(p.requiredAction).toBe('assignable');
    expect(PLAN_VERSION).toBe('qa-plan-1');
  });
  it('the lead is the technician of the earliest-starting line; tie → the most minutes (m: 60 > p: 50)', () => {
    expect(composeVisitPlan(visit(threeLines())).leadTechnicianId).toBe('m');
  });
  it('each line keeps the 3 next alternates; expected technician per line = the one on it now', () => {
    const lines = threeLines(); lines[1] = line({ ...mani, assignedTechnicianId: 'x' }, [cand('m', 55), cand('x', 40), cand('y', 30), cand('z', 20), cand('w', 10)]);
    const p = composeVisitPlan(visit(lines, { currentTechnicianId: 'x' }));
    const m = p.lines.find((l) => l.serviceId === 'manicure')!;
    expect(m.alternates.map((a) => a.technicianId)).toEqual(['x', 'y', 'z']);
    expect(m.expectedTechnicianId).toBe('x');
    expect(p.expectedTechnicianId).toBe('x');
  });
});

describe('prefer one technician (D1)', () => {
  it('a single technician who finishes within 15 min of the split → single', () => {
    const lines = [line(pedi, [cand('a', 70), cand('p', 60)]), line(mani, [cand('a', 70), cand('m', 55)])];
    const p = composeVisitPlan(visit(lines, { whole: { recommended: cand('a', 70, 0), confidence: 0.7, warnings: [], conflicts: [] } }));
    // split would finish at 50 (P + M side by side); A alone finishes at 90 → 40 min later → split
    expect(p.mode).toBe('split');
    expect(p.singleTechnicianAlternative).toMatchObject({ technicianId: 'a', estimatedFinishInMinutes: 90 });
    const near = composeVisitPlan(visit([line(svc('pedicure', 0, 30), [cand('a', 70), cand('p', 60)]), line(svc('manicure', 1, 10), [cand('a', 70), cand('m', 55)])],
      { whole: { recommended: cand('a', 70, 0), confidence: 0.7, warnings: [], conflicts: [] } }));
    // A alone 40, split 30 → within the 15-minute grace → one technician
    expect(near.mode).toBe('single');
    expect(near.lines.every((l) => l.technicianId === 'a')).toBe(true);
    expect(near.lines[1]).toMatchObject({ timing: 'after', afterServiceId: 'pedicure', estimatedStartInMinutes: 30, estimatedEndInMinutes: 40 });
    expect(near.estimatedFinishInMinutes).toBe(40);
    expect(SINGLE_TECH_GRACE_MIN).toBe(15);
  });
  it('the requested technician covering every line → single on them, even when a split is faster', () => {
    const lines = [line(pedi, [cand('p', 60), cand('r', 50)]), line(mani, [cand('m', 55), cand('r', 50)])];
    const p = composeVisitPlan(visit(lines, { requestedTechnicianId: 'r', requestedTechnicianName: 'Rosa', whole: { recommended: cand('r', 50), confidence: 0.6, warnings: [], conflicts: [] } }));
    expect(p.mode).toBe('single');
    expect(p.lines.map((l) => l.technicianId)).toEqual(['r', 'r']);
    expect(p.warnings).toEqual([]);
  });
});

describe('requested technician in a split', () => {
  it('kept on the lines they cover; no warning', () => {
    const lines = [line(pedi, [cand('p', 60)]), line(mani, [cand('m', 55), cand('r', 40)])];
    const p = composeVisitPlan(visit(lines, { requestedTechnicianId: 'r', requestedTechnicianName: 'Rosa' }));
    expect(p.lines.find((l) => l.serviceId === 'manicure')!.technicianId).toBe('r');
    expect(p.warnings.some((w) => w.startsWith('The guest asked for'))).toBe(false);
  });
  it('on no line → a warning and staff review', () => {
    const p = composeVisitPlan(visit(threeLines(), { requestedTechnicianId: 'r', requestedTechnicianName: 'Rosa' }));
    expect(p.warnings.find((w) => w.startsWith('The guest asked for Rosa'))).toBeTruthy();
    expect(p.requiredAction).toBe('staff_review');
  });
});

describe('capacity, hard rules, honesty', () => {
  it('a technician on several lines of the visit is ONE technician (counted once)', () => {
    const p = composeVisitPlan(visit(threeLines()));
    expect(new Set(p.lines.map((l) => l.technicianId)).size).toBe(p.technicianCount);
    expect(p.lines.filter((l) => l.technicianId === 'm')).toHaveLength(2);
  });
  it('a line whose technicians the hard rules removed (on break / wrong branch / shift end) has no candidate → no_eligible_technician', () => {
    const lines = threeLines(); lines[0] = line(pedi, []);
    const p = composeVisitPlan(visit(lines));
    expect(p.lines.find((l) => l.serviceId === 'pedicure')!.technicianId).toBeNull();
    expect(p.requiredAction).toBe('no_eligible_technician');
    expect(p.conflicts[0]).toMatch(/^Pedicure: No eligible technician/);
  });
  it('a line warning (shift ends before it finishes) is carried, prefixed with the service; → staff review', () => {
    const lines = threeLines(); lines[0] = line(pedi, [cand('p', 60, 0, { warnings: ['Shift ends in ~20 min, before this service would finish'] })]);
    const p = composeVisitPlan(visit(lines));
    expect(p.warnings).toContain('Pedicure: Shift ends in ~20 min, before this service would finish');
    expect(p.requiredAction).toBe('staff_review');
  });
  it('confidence = the lowest line confidence; below 0.55 → staff review', () => {
    const lines = threeLines(); lines[2] = line(art, [cand('m', 50)], 0.5);
    const p = composeVisitPlan(visit(lines));
    expect(p.confidence).toBe(0.5);
    expect(p.requiredAction).toBe('staff_review');
  });
  it('an unknown availability makes the visit ETA unknown (null), never a guess', () => {
    const lines = threeLines(); lines[0] = line(pedi, [cand('p', 60, null)]);
    const p = composeVisitPlan(visit(lines));
    expect(p.lines.find((l) => l.serviceId === 'pedicure')!.estimatedStartInMinutes).toBeNull();
    expect(p.estimatedStartInMinutes).toBeNull();
    expect(p.estimatedFinishInMinutes).toBeNull();
  });
  it('a manager lock to T keeps every line on T (D6) — no T on a line → that line has no candidate', () => {
    const lines = [line(pedi, [cand('p', 60), cand('t', 10)]), line(mani, [cand('m', 55), cand('t', 10)])];
    const p = composeVisitPlan(visit(lines, { lockTechnicianId: 't' }));
    expect(p.lines.map((l) => l.technicianId)).toEqual(['t', 't']);
    const q = composeVisitPlan(visit([line(pedi, [cand('p', 60)]), line(mani, [cand('m', 55), cand('t', 10)])], { lockTechnicianId: 't' }));
    expect(q.lines.map((l) => l.technicianId)).toEqual([null, 't']);
  });
  it('at most 2 technicians at once (D2): a third parallel line waits for the first to finish; at most 3 per visit', () => {
    const a = svc('a', 0, 30), b = svc('b', 1, 60), c = svc('c', 2, 20), d = svc('d', 3, 10);
    const p = composeVisitPlan(visit([line(a, [cand('t1', 50)]), line(b, [cand('t2', 50)]), line(c, [cand('t3', 50)]), line(d, [cand('t4', 50)])]));
    const by = Object.fromEntries(p.lines.map((l) => [l.serviceId, l]));
    expect(by.c).toMatchObject({ technicianId: 't3', estimatedStartInMinutes: 30 });   // t1 and t2 are busy until 30 / 60
    expect(by.d.technicianId).toBeNull();                                              // a 4th technician is never added
    expect(MAX_PARALLEL_TECHS).toBe(2); expect(MAX_TECHS_PER_VISIT).toBe(3);
    // at every instant ≤ 2 technicians work
    const ivs = p.lines.filter((l) => l.technicianId).map((l) => [l.estimatedStartInMinutes!, l.estimatedEndInMinutes!]);
    for (let t = 0; t < 120; t++) expect(ivs.filter(([s, e]) => s <= t && t < e).length).toBeLessThanOrEqual(2);
  });
});

describe('composePartyPlan', () => {
  const member = (id: string, ranked: PlanCandidate[]) => visit([line(svc('manicure', 0, 40), ranked)], { queueItemId: id, customerName: id });
  it('together: no technician serves two members (D7); a shared start', () => {
    const p = composePartyPlan({ groupId: 'g', label: 'Smiths', together: true, members: [member('q1', [cand('a', 60, 0), cand('b', 50, 10)]), member('q2', [cand('a', 60, 0), cand('b', 50, 10)])] });
    expect(p.members.map((m) => m.lines[0].technicianId)).toEqual(['a', 'b']);
    expect(p.sharedStartInMinutes).toBe(10);
    expect(p.members.map((m) => m.estimatedStartInMinutes)).toEqual([10, 10]);
    expect(p.anyOrderFinishInMinutes).toBe(50);
    expect(p.estimatedFinishInMinutes).toBe(50);
    expect(p.together).toBe(true);
  });
  it('together with a long shared start → a warning that shows the any-order finish', () => {
    const p = composePartyPlan({ groupId: 'g', label: 'Smiths', together: true, members: [member('q1', [cand('a', 60, 0)]), member('q2', [cand('b', 60, 35)])] });
    expect(p.sharedStartInMinutes).toBe(35);
    expect(p.warnings.join(' ')).toMatch(/35 min/);
    expect(p.warnings.join(' ')).toMatch(/one by one.*75 min/);
    expect(p.requiredAction).toBe('staff_review');
  });
  it('any order: each member as soon as possible, a technician may serve two', () => {
    const p = composePartyPlan({ groupId: 'g', label: 'Smiths', together: false, members: [member('q1', [cand('a', 60, 0)]), member('q2', [cand('a', 60, 0)])] });
    expect(p.members.map((m) => m.lines[0].technicianId)).toEqual(['a', 'a']);
    expect(p.sharedStartInMinutes).toBeNull();
  });
  it('a member with no technician → the party needs no_eligible_technician', () => {
    const p = composePartyPlan({ groupId: 'g', label: 'Smiths', together: true, members: [member('q1', [cand('a', 60)]), member('q2', [cand('a', 60)])] });
    expect(p.members[1].lines[0].technicianId).toBeNull();
    expect(p.requiredAction).toBe('no_eligible_technician');
  });
});

// MT2: each line is checked against its technician's shift end over the line's PLANNED window (after its parent / after the
// technician's earlier lines), not "from now". Mo's shift ends in 45: manicure 0–40 fits, nail art 40–60 does not.
describe('shift end over the planned window (MT2)', () => {
  const PAST = (s: number) => `Shift ends in ~${s} min, before this service would finish`;
  const moShift = (s: number) => cand('m', 55, 0, { shiftEndsInMinutes: s });
  it('a later "after" line that runs past the shift is KEPT with the shift-end warning → staff review (never auto)', () => {
    const p = composeVisitPlan(visit([line(pedi, [cand('p', 60)]), line(mani, [moShift(45)]), line(art, [{ ...moShift(45), matchScore: 50 }])]));
    const by = Object.fromEntries(p.lines.map((l) => [l.serviceId, l]));
    expect(by.nailart).toMatchObject({ technicianId: 'm', timing: 'after', afterServiceId: 'manicure', estimatedStartInMinutes: 40, estimatedEndInMinutes: 60 });
    expect(by.nailart.warnings).toEqual([PAST(45)]);
    expect(by.manicure.warnings).toEqual([]);            // 0–40 ends before 45
    expect(p.warnings).toEqual([`Nailart: ${PAST(45)}`]);
    expect(p.requiredAction).toBe('staff_review');
    expect(p.estimatedFinishInMinutes).toBe(60);
  });
  it('an alternate who can finish within shift is preferred over a better-scored one who cannot', () => {
    const p = composeVisitPlan(visit([line(pedi, [cand('p', 60)]), line(mani, [moShift(45)]), line(art, [{ ...moShift(45), matchScore: 50 }, cand('x', 20, 0, { shiftEndsInMinutes: 300 })])]));
    const art2 = p.lines.find((l) => l.serviceId === 'nailart')!;
    expect(art2).toMatchObject({ technicianId: 'x', timing: 'after', afterServiceId: 'manicure', estimatedStartInMinutes: 40, estimatedEndInMinutes: 60, warnings: [] });
    expect(p.warnings).toEqual([]);
    expect(p.requiredAction).toBe('assignable');
  });
  it('the engine\'s "from now" shift caution is replaced by the planned-window one (never two shift warnings on a line)', () => {
    // the engine judged nail art from now (0–20 vs a shift ending in 25 → the soft caution); planned 40–60 → past the shift
    const p = composeVisitPlan(visit([line(pedi, [cand('p', 60)]), line(mani, [cand('m', 55, 0, { shiftEndsInMinutes: 45 })]), line(art, [cand('m', 50, 0, { shiftEndsInMinutes: 25, warnings: ['Shift ends in ~25 min'] })])]));
    expect(p.lines.find((l) => l.serviceId === 'nailart')!.warnings).toEqual([PAST(25)]);
    // and a "past" caution the engine gave from now is dropped when the planned window fits (never happens with a later start, kept honest)
    const q = composeVisitPlan(visit([line(svc('a', 0, 20), [cand('t', 50, 0, { shiftEndsInMinutes: 60, warnings: ['Shift ends in ~60 min, before this service would finish', 'Has an appointment in ~40 min'] })])]));
    expect(q.lines[0].warnings).toEqual(['Has an appointment in ~40 min']);
  });
  it('no shift data → the engine\'s warnings are carried untouched (null contributes nothing)', () => {
    const p = composeVisitPlan(visit(threeLines()));
    expect(p.warnings).toEqual([]);
  });
  it('single technician: the 3rd line on one technician is checked at its sequential window; a split that fits wins over a within-grace single that does not', () => {
    const a = cand('a', 70, 0, { shiftEndsInMinutes: 70 });
    const lines = [line(svc('pedicure', 0, 30), [a, cand('p', 60)]), line(svc('manicure', 1, 30), [a, cand('m', 55)]), line(svc('polish', 2, 30), [a])];
    // single A: 0–30, 30–60, 60–90 (past 70); split: P 0–30, M 0–30, A polish 0–30 → can't (max 2 parallel) → 30–60 → fits
    const p = composeVisitPlan(visit(lines, { whole: { recommended: a, confidence: 0.7, warnings: [], conflicts: [] } }));
    expect(p.mode).toBe('split');
    expect(p.warnings).toEqual([]);
    expect(p.singleTechnicianAlternative).toMatchObject({ technicianId: 'a', estimatedFinishInMinutes: 90 });
    // within the 15-min grace (single 50 vs split 40) one technician would normally win (D1) — not when they run past the shift
    const a45 = cand('a', 50, 0, { shiftEndsInMinutes: 45 });
    const g = composeVisitPlan(visit([line(svc('pedicure', 0, 10), [cand('p', 60), a45]), line(svc('manicure', 1, 10), [cand('m', 55), a45]), line(svc('polish', 2, 30), [a45])],
      { whole: { recommended: a45, confidence: 0.7, warnings: [], conflicts: [] } }));
    expect(g.mode).toBe('split');
    expect(g.lines.find((l) => l.serviceId === 'polish')).toMatchObject({ technicianId: 'a', estimatedStartInMinutes: 10, estimatedEndInMinutes: 40, warnings: [] });
    expect(g.singleTechnicianAlternative).toMatchObject({ technicianId: 'a', estimatedFinishInMinutes: 50 });
    // nobody else → single A, the polish line carries the warning
    const only = [line(svc('pedicure', 0, 30), [a]), line(svc('manicure', 1, 30), [a]), line(svc('polish', 2, 30), [a])];
    const s = composeVisitPlan(visit(only, { whole: { recommended: a, confidence: 0.7, warnings: [], conflicts: [] } }));
    expect(s.mode).toBe('single');
    expect(s.lines.map((l) => l.warnings)).toEqual([[], [], [PAST(70)]]);
    expect(s.requiredAction).toBe('staff_review');
  });
  it('an add-on listed BEFORE its parent still runs after it (the ETA follows the real sequence)', () => {
    const artFirst = svc('nailart', 0, 20, { isAddon: true, parentServiceId: 'manicure' });
    const p = composeVisitPlan(visit([line(artFirst, [cand('m', 50)]), line(svc('manicure', 1, 40), [cand('m', 55)]), line(svc('pedicure', 2, 50), [cand('p', 60)])]));
    const by = Object.fromEntries(p.lines.map((l) => [l.serviceId, l]));
    expect(by.nailart).toMatchObject({ technicianId: 'm', timing: 'after', afterServiceId: 'manicure', estimatedStartInMinutes: 40, estimatedEndInMinutes: 60 });
    expect(p.estimatedFinishInMinutes).toBe(60);
  });
  it('a "together" party: a member pushed to the shared start is checked at the shifted window', () => {
    const member = (id: string, ranked: PlanCandidate[]) => visit([line(svc('manicure', 0, 40), ranked)], { queueItemId: id, customerName: id });
    const p = composePartyPlan({ groupId: 'g', label: 'Smiths', together: true,
      members: [member('q1', [cand('a', 60, 0, { shiftEndsInMinutes: 50 })]), member('q2', [cand('b', 60, 15)])] });
    expect(p.sharedStartInMinutes).toBe(15);
    expect(p.members[0].lines[0]).toMatchObject({ technicianId: 'a', estimatedStartInMinutes: 15, estimatedEndInMinutes: 55, warnings: [PAST(50)] });
    expect(p.members[0].requiredAction).toBe('staff_review');
    expect(p.warnings).toContain(`q1: Manicure: ${PAST(50)}`);
    expect(p.requiredAction).toBe('staff_review');
    // any order: a is free at 0, 0–40 fits → no warning
    const q = composePartyPlan({ groupId: 'g', label: 'Smiths', together: false,
      members: [member('q1', [cand('a', 60, 0, { shiftEndsInMinutes: 50 })]), member('q2', [cand('b', 60, 15)])] });
    expect(q.warnings).toEqual([]);
  });
});
