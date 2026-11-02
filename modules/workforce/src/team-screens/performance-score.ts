// performance-score.ts — F5 (Finish the Five, 30 Oct 2026): the versioned 0–100 Overall Technician Performance Score,
// PURE. It is a SEPARATE field from the verified customer rating (0–5 stars), which is never overwritten or reinterpreted.
//
//   composite = round(0.40·satisfaction + 0.30·reliability + 0.20·on-time + 0.10·correction quality, 1)
//
// Every component is 0–100 and must meet its evidence threshold. If ANY component is unsupported or below its threshold
// the composite is null — "Insufficient Data – Composite Score Not Available": no zeros, no imputation, no re-weighting,
// nothing extrapolated from tips or income. The valid components are still shown on their own.
//
// The score supports coaching and insight only. It is in COMPARISON mode (shown beside the rating, never used to rank Top
// Performers) until the owner approves switching, and it never changes pay, commission, scheduling or employment.
export interface ScoreModel {
  version: string; status: 'comparison' | 'approved'; effectiveFrom: string; approvedBy: string;
  weights: { satisfaction: number; reliability: number; onTime: number; correction: number };
  thresholds: { reviews: number; reliability: number; onTime: number; correction: number };
  gracePeriodMinutes: number; rules: Record<string, string>;
}
/** The owner-approved initial model (build guide §18). A new version is a new constant; a saved snapshot keeps its version. */
export const COMPOSITE_MODEL_V1: ScoreModel = Object.freeze({
  version: 'composite-v1', status: 'comparison', effectiveFrom: '2026-10-30', approvedBy: 'Owner decision, Finish the Five build guide (30 Oct 2026)',
  weights: { satisfaction: 0.4, reliability: 0.3, onTime: 0.2, correction: 0.1 },
  thresholds: { reviews: 5, reliability: 10, onTime: 10, correction: 20 },
  gracePeriodMinutes: 10,
  rules: {
    satisfaction: 'Verified reviews only: rating 1–5 tied to this technician, not hidden by a manager, not spam. (average ÷ 5) × 100. At least 5.',
    reliability: 'Tech Queue offers assigned to this technician: service done ÷ (service done + declined + expired). Customer no-shows and cancellations (cause outside the technician) and tickets still open are excluded. At least 10. Assumption to validate in comparison mode: a declined or expired offer is attributable to the technician.',
    onTime: 'Appointment services with a planned start, the customer\'s arrival and the actual start: started no later than the planned start + the 10-minute grace. Excluded: customer arrived after the planned start (customer late), no arrival or start time recorded (cause not inferable). At least 10.',
    correction: 'Substantiated, technician-attributable rework ÷ eligible completed services. A refund or an unreviewed complaint alone is NOT a correction. Unsupported: the system records no substantiated rework events yet.',
  },
}) as ScoreModel;

export type ComponentKey = 'satisfaction' | 'reliability' | 'onTime' | 'correction';
export interface Evidence {
  reviews: { count: number; average: number | null };
  reliability: { completed: number; failed: number; excluded: number } | null;
  onTime: { onTime: number; late: number; excluded: number } | null;
  correction: { corrections: number; eligible: number } | null;   // null = no evidence source
}
export interface Component { key: ComponentKey; weight: number; value: number | null; sample: number; threshold: number; status: 'OK' | 'INSUFFICIENT' | 'UNSUPPORTED'; excluded: number; rule: string }
export interface CompositeResult { modelVersion: string; mode: ScoreModel['status']; score: number | null; available: boolean; components: Component[]; missing: ComponentKey[] }

const r1 = (n: number) => Math.round(n * 10) / 10;
export function computeComposite(e: Evidence, m: ScoreModel = COMPOSITE_MODEL_V1): CompositeResult {
  const comp = (key: ComponentKey, sample: number, threshold: number, value: () => number, supported: boolean, excluded = 0): Component => {
    const status = !supported ? 'UNSUPPORTED' : sample < threshold ? 'INSUFFICIENT' : 'OK';
    return { key, weight: m.weights[key], sample, threshold, status, excluded, rule: m.rules[key], value: status === 'OK' ? r1(Math.max(0, Math.min(100, value()))) : null };
  };
  const rel = e.reliability, ot = e.onTime, co = e.correction;
  const components = [
    comp('satisfaction', e.reviews.count, m.thresholds.reviews, () => ((e.reviews.average ?? 0) / 5) * 100, true),
    comp('reliability', rel ? rel.completed + rel.failed : 0, m.thresholds.reliability, () => (100 * rel!.completed) / (rel!.completed + rel!.failed), !!rel, rel?.excluded ?? 0),
    comp('onTime', ot ? ot.onTime + ot.late : 0, m.thresholds.onTime, () => (100 * ot!.onTime) / (ot!.onTime + ot!.late), !!ot, ot?.excluded ?? 0),
    comp('correction', co ? co.eligible : 0, m.thresholds.correction, () => 100 * (1 - co!.corrections / co!.eligible), !!co),
  ];
  const missing = components.filter((c) => c.status !== 'OK').map((c) => c.key);
  const score = missing.length ? null : r1(components.reduce((n, c) => n + c.weight * (c.value as number), 0));
  return { modelVersion: m.version, mode: m.status, score, available: score != null, components, missing };
}
