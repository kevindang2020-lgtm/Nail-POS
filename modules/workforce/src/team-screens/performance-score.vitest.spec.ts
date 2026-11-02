// performance-score — F5 (Finish the Five, 30 Oct 2026): the versioned 40/30/20/10 composite with insufficient-data
// protection — no zeros, no imputation, no re-weighting; valid components still shown on their own.
import { describe, it, expect } from 'vitest';
import { computeComposite, COMPOSITE_MODEL_V1, type Evidence } from './performance-score';

const full: Evidence = { reviews: { count: 8, average: 4.5 }, reliability: { completed: 18, failed: 2, excluded: 3 }, onTime: { onTime: 15, late: 5, excluded: 4 }, correction: { corrections: 1, eligible: 40 } };

describe('composite score (model composite-v1)', () => {
  it('the weights are 40 / 30 / 20 / 10 and the model is versioned, in comparison mode', () => {
    expect(COMPOSITE_MODEL_V1).toMatchObject({ version: 'composite-v1', status: 'comparison', weights: { satisfaction: 0.4, reliability: 0.3, onTime: 0.2, correction: 0.1 }, thresholds: { reviews: 5 }, gracePeriodMinutes: 10 });
  });
  it('4.5 / 5 with 5+ verified reviews → satisfaction 90; all four sufficient → round(0.4·90 + 0.3·90 + 0.2·75 + 0.1·97.5, 1)', () => {
    const r = computeComposite(full);
    expect(r.components.map((c) => [c.key, c.value])).toEqual([['satisfaction', 90], ['reliability', 90], ['onTime', 75], ['correction', 97.5]]);
    expect(r.score).toBe(87.8); expect(r.available).toBe(true);
  });
  it('any component missing or under its threshold → no composite (never 0, never re-weighted); the rest still shown', () => {
    const noOnTime = computeComposite({ ...full, onTime: { onTime: 3, late: 1, excluded: 20 } });
    expect(noOnTime).toMatchObject({ score: null, available: false, missing: ['onTime'] });
    expect(noOnTime.components.find((c) => c.key === 'satisfaction')!.value).toBe(90);
    expect(computeComposite({ ...full, correction: null })).toMatchObject({ score: null, missing: ['correction'] });
    expect(computeComposite({ ...full, correction: null }).components.find((c) => c.key === 'correction')!.status).toBe('UNSUPPORTED');
    expect(computeComposite({ ...full, reviews: { count: 4, average: 5 } })).toMatchObject({ score: null, missing: ['satisfaction'] });
  });
  it('excluded events (customer no-shows / cancellations, customer late) do not enter a denominator', () => {
    const r = computeComposite({ ...full, reliability: { completed: 10, failed: 0, excluded: 50 } });
    expect(r.components.find((c) => c.key === 'reliability')).toMatchObject({ value: 100, sample: 10, excluded: 50 });
  });
});
