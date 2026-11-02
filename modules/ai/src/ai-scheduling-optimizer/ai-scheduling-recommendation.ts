// ai-scheduling-recommendation.ts — PURE before/after simulation + the recommendation shape. Hard rule from the spec: a
// recommendation may ONLY claim benefits that were actually simulated — deltas come from real before/after metrics, never
// invented. Every recommendation carries the versions used (forecast/rule/engine/config), a confidence that drops when
// data or forecast is thin, and an expiry (stale recommendations must never be applied). Nothing here changes a schedule.

export interface ScheduleMetrics { idleMin: number; waitMin: number; utilizationPct: number; gapCount: number; latenessRiskPct: number; }
export interface SimulationResult { before: ScheduleMetrics; after: ScheduleMetrics; deltas: { idleSavedMin: number; waitSavedMin: number; utilizationGainPct: number; gapsRemoved: number; latenessReducedPct: number }; improved: boolean; }

/** Compute the real deltas between the current and proposed schedule metrics. Positive delta = improvement. */
export function simulateChange(before: ScheduleMetrics, after: ScheduleMetrics): SimulationResult {
  const deltas = {
    idleSavedMin: before.idleMin - after.idleMin,
    waitSavedMin: before.waitMin - after.waitMin,
    utilizationGainPct: after.utilizationPct - before.utilizationPct,
    gapsRemoved: before.gapCount - after.gapCount,
    latenessReducedPct: before.latenessRiskPct - after.latenessRiskPct,
  };
  const improved = deltas.idleSavedMin > 0 || deltas.waitSavedMin > 0 || deltas.utilizationGainPct > 0 || deltas.gapsRemoved > 0 || deltas.latenessReducedPct > 0;
  return { before, after, deltas, improved };
}

export type RecommendationType =
  | 'move_appointment' | 'change_technician' | 'offer_alternate_time' | 'open_availability' | 'close_availability'
  | 'add_buffer' | 'adjust_duration' | 'add_staffing' | 'move_break' | 'fill_gap' | 'resolve_overbooking' | 'preserve_schedule';

export type DataQuality = 'good' | 'partial' | 'insufficient';
export interface RecommendationVersions { forecastVersion: string | null; ruleVersion: string; engineVersion: string; configVersion: string; }

export interface Recommendation {
  type: RecommendationType;
  tenantId: string; branchId: string | null;
  currentState: unknown; proposedState: unknown;
  affectedAppointmentIds: string[]; affectedTechnicianIds: string[];
  hardConstraintsChecked: boolean;
  softObjectivesImproved: string[];      // only objectives with a real positive delta
  expectedBenefit: string[];             // human-readable, each backed by a computed delta
  possibleDownside: string[];
  confidence: number;
  dataQuality: DataQuality;
  versions: RecommendationVersions;
  requiresHumanReview: boolean;
  requiresCustomerApproval: boolean;
  expiresAtMs: number;
  simulation: SimulationResult;
}

export interface BuildRecommendationInput {
  type: RecommendationType;
  tenantId: string; branchId: string | null;
  currentState: unknown; proposedState: unknown;
  affectedAppointmentIds?: string[]; affectedTechnicianIds?: string[];
  hardConstraintsChecked: boolean;      // MUST be true to recommend applying anything
  simulation: SimulationResult;
  dataQuality?: DataQuality;
  forecastAvailable?: boolean;
  versions: RecommendationVersions;
  touchesConfirmedAppointment?: boolean;  // → requires customer approval
  nowMs: number; ttlMs?: number;
}

const BENEFIT_LABELS: Record<string, (v: number) => string> = {
  idleSavedMin: (v) => `saves ~${v} min technician idle time`,
  waitSavedMin: (v) => `reduces customer wait by ~${v} min`,
  utilizationGainPct: (v) => `improves utilization by ~${v}%`,
  gapsRemoved: (v) => `fills ${v} schedule gap(s)`,
  latenessReducedPct: (v) => `lowers lateness risk by ~${v}%`,
};

/** Build a recommendation whose claimed benefits are derived ONLY from positive simulation deltas. */
export function buildRecommendation(input: BuildRecommendationInput): Recommendation {
  const sim = input.simulation;
  const improved: string[] = [];
  const benefit: string[] = [];
  for (const [k, v] of Object.entries(sim.deltas)) {
    if (v > 0) { improved.push(k); benefit.push(BENEFIT_LABELS[k]?.(Math.round(v)) ?? `${k}: ${v}`); }
  }
  // possible downsides = objectives that got worse
  const downside: string[] = [];
  for (const [k, v] of Object.entries(sim.deltas)) if (v < 0) downside.push(`${k} worsens by ${Math.abs(Math.round(v))}`);

  const dataQuality = input.dataQuality ?? 'good';
  let confidence = dataQuality === 'insufficient' ? 0.3 : dataQuality === 'partial' ? 0.55 : 0.85;
  if (input.forecastAvailable === false) confidence = Math.min(confidence, 0.5);   // no forecast → lowered, never invented
  if (!benefit.length) confidence = Math.min(confidence, 0.4);

  // a change that touches a confirmed appointment always needs review + customer approval
  const touchesConfirmed = !!input.touchesConfirmedAppointment;
  const type: RecommendationType = benefit.length ? input.type : 'preserve_schedule';   // no computed benefit → preserve

  return {
    type,
    tenantId: input.tenantId, branchId: input.branchId,
    currentState: input.currentState, proposedState: input.proposedState,
    affectedAppointmentIds: input.affectedAppointmentIds ?? [],
    affectedTechnicianIds: input.affectedTechnicianIds ?? [],
    hardConstraintsChecked: input.hardConstraintsChecked,
    softObjectivesImproved: improved,
    expectedBenefit: benefit,
    possibleDownside: downside,
    confidence: Math.round(confidence * 100) / 100,
    dataQuality,
    versions: input.versions,
    requiresHumanReview: true,                                   // material scheduling changes always reviewed
    requiresCustomerApproval: touchesConfirmed,
    expiresAtMs: input.nowMs + (input.ttlMs ?? 30 * 60 * 1000),
    simulation: sim,
  };
}

/** A recommendation is applicable only if hard constraints were checked, it hasn't expired, and (for confirmed-appointment
 *  changes) customer approval is present. This is the last gate before any application logic runs. */
export function isApplicable(rec: Recommendation, nowMs: number, customerApproved: boolean): { ok: boolean; reason?: string } {
  if (!rec.hardConstraintsChecked) return { ok: false, reason: 'hard_constraints_not_checked' };
  if (nowMs >= rec.expiresAtMs) return { ok: false, reason: 'expired' };
  if (rec.requiresCustomerApproval && !customerApproved) return { ok: false, reason: 'customer_approval_required' };
  return { ok: true };
}
