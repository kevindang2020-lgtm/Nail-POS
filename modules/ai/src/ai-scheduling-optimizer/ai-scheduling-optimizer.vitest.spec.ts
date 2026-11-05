// ai-scheduling-optimizer.vitest.spec.ts — the deterministic engine: weighted soft-objective scoring, stable ranking,
// a rule-based fallback, and technician-day local search that never moves a locked appointment and never worsens idle.
import { describe, it, expect } from 'vitest';
import { scoreCandidate, rankOptions, ruleBasedFallback, optimizeTechnicianDay, DEFAULT_WEIGHTS, type PlacementSignals, type Candidate } from './ai-scheduling-optimizer';

const sig = (o: Partial<PlacementSignals> = {}): PlacementSignals => ({ waitMin: 0, gapLeftoverMin: 0, matchesPreferredTech: false, minutesFromRequested: 0, techUtilizationPct: 75, techLoadPct: 50, adjacentToExisting: true, nearOvertime: false, ...o });

describe('scoring', () => {
  it('is normalized, deterministic, and weight-driven', () => {
    const ideal = scoreCandidate(sig({ matchesPreferredTech: true }));
    const poor = scoreCandidate(sig({ matchesPreferredTech: false, minutesFromRequested: 240, waitMin: 120, gapLeftoverMin: 120, nearOvertime: true, adjacentToExisting: false, techLoadPct: 100 }));
    expect(ideal.score).toBeGreaterThan(poor.score);
    expect(ideal.score).toBeLessThanOrEqual(1);
    expect(scoreCandidate(sig({ matchesPreferredTech: true })).score).toBe(ideal.score);
    const w0 = { ...DEFAULT_WEIGHTS, preferencePreservation: 0 };
    expect(scoreCandidate(sig({ matchesPreferredTech: true }), w0).score).toBe(scoreCandidate(sig({ matchesPreferredTech: false }), w0).score);
  });
});

describe('ranking + fallback', () => {
  const cands: Candidate[] = [{ id: 'a', signals: sig({ matchesPreferredTech: true, minutesFromRequested: 0 }) }, { id: 'b', signals: sig({ matchesPreferredTech: false, minutesFromRequested: 120 }) }, { id: 'c', signals: sig({ matchesPreferredTech: false, minutesFromRequested: 200, waitMin: 90 }) }];
  it('ranks best-first deterministically and falls back sensibly', () => {
    expect(rankOptions(cands).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(ruleBasedFallback([{ id: 'x', signals: sig({ matchesPreferredTech: false, waitMin: 10 }) }, { id: 'y', signals: sig({ matchesPreferredTech: true, waitMin: 30 }) }])?.id).toBe('y');
    expect(ruleBasedFallback([])).toBeNull();
  });
});

describe('technician-day local search', () => {
  it('reduces idle without moving locked appointments and never worsens', () => {
    const day = optimizeTechnicianDay({ start: 540, end: 1020 }, [{ id: 'A', range: { start: 600, end: 660 }, locked: true }, { id: 'B', range: { start: 800, end: 860 }, locked: false }]);
    expect(day.improved).toBe(true);
    expect(day.afterIdleMin).toBeLessThan(day.beforeIdleMin);
    expect(day.moves.some((m) => m.id === 'A')).toBe(false);
    expect(day.moves.some((m) => m.id === 'B' && m.to.start < 800)).toBe(true);
    const opt = optimizeTechnicianDay({ start: 540, end: 1020 }, [{ id: 'A', range: { start: 540, end: 600 }, locked: false }, { id: 'B', range: { start: 600, end: 660 }, locked: false }]);
    expect(opt.improved).toBe(false);
    expect(opt.afterIdleMin).toBeLessThanOrEqual(opt.beforeIdleMin);
  });
});
