// ai-scheduling-optimizer.ts — the DETERMINISTIC optimization core. This is the source of truth for scheduling decisions;
// an LLM never runs here (it only explains the output later). The flow is always: hard-constraint gate (Stage 2) →
// weighted soft-objective scoring → ranked options. Weights are tenant-configurable; no single strategy is hard-coded.
// Technician-day optimization moves only UNLOCKED appointments and never worsens the objective. Given identical inputs it
// produces identical output (deterministic), and it degrades to a rule-based fallback when scoring signal is thin.
import { Range, durationOf } from './ai-scheduling-core';

// ── soft-objective weights (tenant-configurable) ──────────────────────────────
export interface ScoringWeights {
  preferredTimeProximity: number; waitReduction: number; gapFit: number; preferencePreservation: number;
  utilization: number; fragmentation: number; overtimeAvoidance: number; workloadBalance: number; idleReduction: number;
}
export const DEFAULT_WEIGHTS: ScoringWeights = {
  preferredTimeProximity: 3, waitReduction: 2, gapFit: 2, preferencePreservation: 3,
  utilization: 1, fragmentation: 1, overtimeAvoidance: 2, workloadBalance: 1, idleReduction: 1,
};

// Precomputed, deterministic signals for a candidate placement (the optimizer derives these from context).
export interface PlacementSignals {
  waitMin: number;                 // estimated customer wait
  gapLeftoverMin: number;          // minutes left unused in the gap this placement sits in
  matchesPreferredTech: boolean;   // soft preference (required prefs are a HARD constraint, handled upstream)
  minutesFromRequested: number;    // distance from the customer's requested time
  techUtilizationPct: number;      // resulting technician utilization
  techLoadPct: number;             // current load of the technician (for balancing)
  adjacentToExisting: boolean;     // sits next to an existing appointment (reduces fragmentation/idle)
  nearOvertime: boolean;           // would push toward overtime
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const near = (v: number, cap: number) => clamp01(1 - Math.min(Math.abs(v), cap) / cap);

/** Map signals → normalized objective components (each 0..1, higher = better). */
export function components(s: PlacementSignals, target = 75): Record<keyof ScoringWeights, number> {
  return {
    preferredTimeProximity: near(s.minutesFromRequested, 240),
    waitReduction: near(s.waitMin, 120),
    gapFit: near(s.gapLeftoverMin, 120),
    preferencePreservation: s.matchesPreferredTech ? 1 : 0,
    utilization: clamp01(1 - Math.abs(target - s.techUtilizationPct) / target),
    fragmentation: s.adjacentToExisting ? 1 : 0.5,
    overtimeAvoidance: s.nearOvertime ? 0 : 1,
    workloadBalance: clamp01(1 - s.techLoadPct / 100),
    idleReduction: s.adjacentToExisting ? 1 : 0.6,
  };
}

export interface ScoreResult { score: number; breakdown: Record<string, number> }
/** Weighted, normalized score (0..1). Deterministic. */
export function scoreCandidate(signals: PlacementSignals, weights: ScoringWeights = DEFAULT_WEIGHTS, target = 75): ScoreResult {
  const comp = components(signals, target);
  const keys = Object.keys(weights) as (keyof ScoringWeights)[];
  const totalW = keys.reduce((n, k) => n + Math.max(0, weights[k]), 0) || 1;
  const breakdown: Record<string, number> = {};
  let score = 0;
  for (const k of keys) { const contribution = Math.max(0, weights[k]) * comp[k]; breakdown[k] = Math.round(comp[k] * 100) / 100; score += contribution; }
  return { score: Math.round((score / totalW) * 1000) / 1000, breakdown };
}

export interface Candidate<T = unknown> { id: string; signals: PlacementSignals; meta?: T; }
export interface RankedOption<T = unknown> { id: string; score: number; breakdown: Record<string, number>; meta?: T; }

/** Rank feasible candidates (already past the hard gate) best-first. Ties broken deterministically by id. */
export function rankOptions<T>(candidates: Candidate<T>[], weights: ScoringWeights = DEFAULT_WEIGHTS, target = 75): RankedOption<T>[] {
  return candidates
    .map((c) => { const r = scoreCandidate(c.signals, weights, target); return { id: c.id, score: r.score, breakdown: r.breakdown, meta: c.meta }; })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Deterministic rule-based fallback when scoring signal is thin: earliest-starting feasible option, preferred tech first. */
export function ruleBasedFallback<T>(candidates: Candidate<T>[]): RankedOption<T> | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) =>
    (Number(b.signals.matchesPreferredTech) - Number(a.signals.matchesPreferredTech)) ||
    (a.signals.waitMin - b.signals.waitMin) ||
    a.id.localeCompare(b.id));
  const c = sorted[0];
  return { id: c.id, score: 0, breakdown: { fallback: 1 }, meta: c.meta };
}

// ── technician-day local search (locked appointments are immovable) ───────────
export interface DayAppt { id: string; range: Range; locked: boolean; }
export interface DayOptimization { improved: boolean; moves: { id: string; from: Range; to: Range }[]; beforeIdleMin: number; afterIdleMin: number; }

/** Re-pack a technician's day to reduce idle time WITHOUT moving locked/confirmed appointments. Only returns an
 *  improvement (never a worse schedule), and never overlaps or reorders across a locked anchor. */
export function optimizeTechnicianDay(shift: Range, appts: DayAppt[], opts: { minMoveGainMin?: number } = {}): DayOptimization {
  const minGain = opts.minMoveGainMin ?? 5;
  const sorted = [...appts].sort((a, b) => a.range.start - b.range.start);
  const idleOf = (list: { range: Range }[]) => {
    const ordered = [...list].sort((a, b) => a.range.start - b.range.start);
    let idle = 0, cursor = shift.start;
    for (const a of ordered) { if (a.range.start > cursor) idle += a.range.start - cursor; cursor = Math.max(cursor, a.range.end); }
    return idle;
  };
  const beforeIdle = idleOf(sorted);
  // greedily left-pack only the UNLOCKED appointments into the earliest space after the previous (locked or moved) block
  const moves: { id: string; from: Range; to: Range }[] = [];
  let cursor = shift.start;
  const result: DayAppt[] = [];
  for (const a of sorted) {
    if (a.locked) { result.push(a); cursor = Math.max(cursor, a.range.end); continue; }
    const dur = durationOf(a.range);
    const newStart = Math.max(cursor, shift.start);
    const to: Range = { start: newStart, end: newStart + dur };
    if (to.start !== a.range.start) moves.push({ id: a.id, from: a.range, to });
    result.push({ ...a, range: to });
    cursor = to.end;
  }
  const afterIdle = idleOf(result);
  const gain = beforeIdle - afterIdle;
  const improved = gain >= minGain && moves.length > 0;
  return { improved, moves: improved ? moves : [], beforeIdleMin: beforeIdle, afterIdleMin: improved ? afterIdle : beforeIdle };
}
