// ai-evaluation.vitest.spec — Constitution 10 §119–§128.
import { describe, it, expect } from 'vitest';
import { GOLDEN_CASES, scoreCase, scoreCaseWithSchema, compareRuns, assignVariant, assignmentBucket, experimentMetrics, type CaseResult, type EvalRun } from './ai-evaluation';
import { AI_TASKS } from './ai-task-registry';
import { rolloutBucket } from './ai-prompt-registry';

const res = (caseId: string, kind: CaseResult['kind'], passed: boolean, meta: Partial<CaseResult> = {}): CaseResult => ({ caseId, taskKey: 't', kind, passed, failures: passed ? [] : ['x'], ...meta });

describe('§121 golden datasets', () => {
  it('every case names a REAL task and a real schema', () => {
    for (const c of GOLDEN_CASES) { expect(AI_TASKS[c.taskKey], c.id).toBeDefined(); expect(c.note.length, c.id).toBeGreaterThan(20); }
  });
  it('cases are synthetic — no real-looking contact details, card numbers or ids in the fixtures', () => {
    const blob = JSON.stringify(GOLDEN_CASES);
    expect(blob).not.toMatch(/@(gmail|yahoo|hotmail|outlook)\./i);
    expect(blob).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
    expect(blob).not.toMatch(/\b(?:\d[ -]?){12,18}\d\b/);
    expect(blob).not.toMatch(/\(\d{3}\)\s?\d{3}-\d{4}/);
  });
  it('covers the §120 kinds that matter most — safety, hallucination and tenant isolation are all present', () => {
    const kinds = new Set(GOLDEN_CASES.map((c) => c.kind));
    for (const k of ['accuracy', 'safety', 'hallucination', 'tenant_isolation', 'structured_output']) expect(kinds).toContain(k);
  });
});

describe('§120 scoring', () => {
  const sarcasm = GOLDEN_CASES.find((c) => c.id === 'rev-sarcasm')!;
  it('passes a correct classification and fails a wrong one', () => {
    expect(scoreCase(sarcasm, { sentiment: 'negative', theme: 'wait', confidence: 0.8 }).passed).toBe(true);
    const bad = scoreCase(sarcasm, { sentiment: 'positive', theme: 'wait', confidence: 0.8 });
    expect(bad.passed).toBe(false); expect(bad.failures[0]).toMatch(/sentiment: expected "negative", got "positive"/);
  });
  it('a forbidden substring anywhere in the output fails, whichever field it hides in', () => {
    const refund = GOLDEN_CASES.find((c) => c.id === 'resp-no-refund')!;
    expect(scoreCase(refund, { reply: 'We are so sorry. Please come back and see us.', tone: 'warm' }).passed).toBe(true);
    expect(scoreCase(refund, { reply: 'We are sorry.', tone: 'offering a refund' }).passed).toBe(false);   // hidden in `tone`
    expect(scoreCase(refund, { reply: 'Happy to give you your MONEY BACK.', tone: 'warm' }).passed).toBe(false);  // case-insensitive
  });
  it('an injection case fails when the injected text steered the answer', () => {
    const inj = GOLDEN_CASES.find((c) => c.id === 'rev-injection')!;
    expect(scoreCase(inj, { sentiment: 'neutral', theme: 'brief', confidence: 0.4 }).passed).toBe(true);
    expect(scoreCase(inj, { sentiment: 'positive', theme: 'perfect', confidence: 1 }).passed).toBe(false);
  });
  it('§73 structural validity is not optional: a schema-invalid output fails BEFORE its content is judged', () => {
    const c = GOLDEN_CASES.find((x) => x.id === 'rev-pos-plain')!;
    const r = scoreCaseWithSchema(c, { sentiment: 'positive' });   // missing theme + confidence
    expect(r.passed).toBe(false); expect(r.failures[0]).toMatch(/^schema:/);
  });
  it('a range expectation catches an out-of-range confidence', () => {
    const c = GOLDEN_CASES.find((x) => x.id === 'ocr-cents')!;
    expect(scoreCase(c, { confidence: 0.7 }).passed).toBe(true);
    expect(scoreCase(c, { confidence: 1.4 }).passed).toBe(false);
  });
});

describe('§122/§123 regression comparison decides rollouts', () => {
  const run = (label: string, rs: CaseResult[]): EvalRun => ({ label, results: rs });
  it('a SAFETY regression is rejected outright, even when overall quality improves', () => {
    const inc = run('v1', [res('a', 'accuracy', false), res('b', 'accuracy', false), res('s1', 'safety', true)]);
    const cand = run('v2', [res('a', 'accuracy', true), res('b', 'accuracy', true), res('s1', 'safety', false)]);
    const c = compareRuns(inc, cand);
    expect(c.candidate.passRate).toBeGreaterThan(c.incumbent.passRate);   // quality went UP
    expect(c.verdict).toBe('reject');
    expect(c.reasons[0]).toMatch(/safety regressions: s1/);
  });
  it('a lower pass rate is rejected', () => {
    expect(compareRuns(run('v1', [res('a', 'accuracy', true), res('b', 'accuracy', true)]), run('v2', [res('a', 'accuracy', true), res('b', 'accuracy', false)])).verdict).toBe('reject');
  });
  it('a non-safety regression with a net gain is HELD for a human, not auto-promoted', () => {
    const inc = run('v1', [res('a', 'accuracy', true), res('b', 'accuracy', false), res('c', 'accuracy', false)]);
    const cand = run('v2', [res('a', 'accuracy', false), res('b', 'accuracy', true), res('c', 'accuracy', true)]);
    const c = compareRuns(inc, cand);
    expect(c.verdict).toBe('hold'); expect(c.regressions).toEqual(['a']); expect(c.improvements).toEqual(['b', 'c']);
  });
  it('§123 a materially costlier candidate with no quality gain is held', () => {
    const inc = run('v1', [res('a', 'accuracy', true, { costMicroUsd: 40, latencyMs: 100 })]);
    const cand = run('v2', [res('a', 'accuracy', true, { costMicroUsd: 400, latencyMs: 100 })]);
    const c = compareRuns(inc, cand);
    expect(c.verdict).toBe('hold'); expect(c.reasons[0]).toMatch(/cost rose/);
  });
  it('§123 a slower candidate with no quality gain is held', () => {
    const c = compareRuns(run('v1', [res('a', 'accuracy', true, { latencyMs: 100 })]), run('v2', [res('a', 'accuracy', true, { latencyMs: 900 })]));
    expect(c.verdict).toBe('hold'); expect(c.reasons[0]).toMatch(/latency rose/);
  });
  it('a clean win is promoted, and a costlier candidate that FIXES cases is not held on cost alone', () => {
    expect(compareRuns(run('v1', [res('a', 'accuracy', true), res('b', 'accuracy', false)]), run('v2', [res('a', 'accuracy', true), res('b', 'accuracy', true)])).verdict).toBe('promote');
    const better = compareRuns(run('v1', [res('a', 'accuracy', false, { costMicroUsd: 40 })]), run('v2', [res('a', 'accuracy', true, { costMicroUsd: 400 })]));
    expect(better.verdict).toBe('promote');
  });
  it('§123 the comparison reports all four dimensions, never quality alone', () => {
    const c = compareRuns(run('v1', [res('a', 'accuracy', true, { costMicroUsd: 10, latencyMs: 50 })]), run('v2', [res('a', 'accuracy', true, { costMicroUsd: 12, latencyMs: 60 })]));
    for (const side of [c.incumbent, c.candidate]) for (const k of ['passRate', 'safetyPassRate', 'avgLatencyMs', 'avgCostMicroUsd']) expect(side).toHaveProperty(k);
  });
});

describe('§124/§127 deterministic assignment', () => {
  it('the same subject always lands in the same bucket and variant', () => {
    expect(assignmentBucket('exp1', 't1')).toBe(assignmentBucket('exp1', 't1'));
    expect(assignmentBucket('exp1', 't1')).not.toBe(assignmentBucket('exp2', 't1'));
    // Checking ONE subject twice against two variants is a coin flip: a random implementation passes it half
    // the time. A mutation proved exactly that. Check many subjects, each twice — random assignment then has a
    // vanishing chance of agreeing on all of them.
    const subjects = Array.from({ length: 40 }, (_, i) => `tenant-${i}`);
    const first = subjects.map((s) => assignVariant('exp1', s, ['control', 'candidate']).variant);
    const second = subjects.map((s) => assignVariant('exp1', s, ['control', 'candidate']).variant);
    expect(second).toEqual(first);
  });
  it('uses the SAME bucketing as prompt rollout, so a tenant\'s membership cannot flicker between the two', () => {
    expect(assignmentBucket('k', 't')).toBe(rolloutBucket('t', 'k'));
  });
  it('spreads across variants', () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => assignVariant('exp', `t${i}`, ['a', 'b']).variant));
    expect(seen).toEqual(new Set(['a', 'b']));
  });
  it('§126 refuses to experiment on a HIGH-risk task unless a policy decision says so explicitly', () => {
    expect(() => assignVariant('exp', 't1', ['a', 'b'], { taskKey: 'money.explain_alert' })).toThrow(/HIGH risk.*explicit policy/);
    expect(() => assignVariant('exp', 't1', ['a', 'b'], { taskKey: 'money.explain_alert', explicitHighRiskPolicy: true })).not.toThrow();
    expect(() => assignVariant('exp', 't1', ['a', 'b'], { taskKey: 'review.sentiment_analyze' })).not.toThrow();
  });
  it('an experiment with no variants is an error, not a silent no-op', () => {
    expect(() => assignVariant('exp', 't1', [])).toThrow(/at least one variant/);
  });
});

describe('§128 experiment metrics', () => {
  it('measures quality, acceptance and correction — not engagement alone', () => {
    const m = experimentMetrics('candidate', [
      { passed: true, accepted: true, corrected: false, latencyMs: 100, costMicroUsd: 40 },
      { passed: true, accepted: false, corrected: true, latencyMs: 200, costMicroUsd: 60 },
      { passed: false, accepted: false, corrected: true, latencyMs: 300, costMicroUsd: 50 },
    ]);
    expect(m.quality).toBeCloseTo(2 / 3); expect(m.acceptanceRate).toBeCloseTo(1 / 3); expect(m.correctionRate).toBeCloseTo(2 / 3);
    expect(m.avgLatencyMs).toBe(200); expect(m.avgCostMicroUsd).toBe(50);
  });
  it('an unmeasured dimension is NULL, not zero — an unknown acceptance rate is not a bad one', () => {
    const m = experimentMetrics('v', [{ passed: true, latencyMs: 100 }]);
    expect(m.acceptanceRate).toBeNull(); expect(m.correctionRate).toBeNull(); expect(m.quality).toBe(1);
  });
  it('no events at all → every rate null', () => {
    const m = experimentMetrics('v', []);
    expect([m.quality, m.acceptanceRate, m.correctionRate, m.avgLatencyMs, m.avgCostMicroUsd]).toEqual([null, null, null, null, null]);
  });
});
