// ai-queue-assignment-engine.ts — PURE. Produces the structured, versioned recommendation envelope the spec
// requires (best + alternates + score + confidence + estimates + conflicts + warnings + required action). It REUSES
// the canonical scoreTechnician from tech-recommendation (so skill/requested/previous/available/load scoring never
// diverges) and adds ONLY the terms that engine deliberately left unwired — rotation, workload-by-minutes,
// upcoming-appointment caution, and shift-end/overtime caution — as additive weighted terms + soft warnings.
// Honesty boundary (mirrors the base engine): a null signal contributes NOTHING and is never fabricated.
import { scoreTechnician } from '@aipowersalon/workforce';
import type { AssignmentSignals, RecommendationCandidate, RecommendationEnvelope, RequiredAction } from './ai-queue-assignment.dto';

export const RECO_VERSION = 'qa-reco-2';
export const RULE_VERSION = 'qa-rule-2';

// Additive weights, deliberately smaller than the base skill/requested terms so hard preferences still dominate.
const AW = { rotationTop: 12, minutesBalance: 10, apptSoonPenalty: 8, shiftEndPenalty: 8, availableSoon: 10, pastShiftPenalty: 15 } as const;
const CONFIDENCE_FLOOR = 0.55; // below this the required action becomes staff_review

function additiveScore(s: AssignmentSignals, serviceDurationMinutes = 0): { delta: number; reasons: string[]; warnings: string[] } {
  const reasons: string[] = []; const warnings: string[] = []; let delta = 0;
  // Rotation: reward being near the top of the branch rotation (index 0 best). Unknown → no effect.
  if (typeof s.rotationIndex === 'number') {
    const bonus = Math.max(0, AW.rotationTop - s.rotationIndex * 3);
    if (bonus > 0) { delta += bonus; reasons.push(s.rotationIndex === 0 ? 'Next up in rotation' : `Rotation position ${s.rotationIndex + 1}`); }
  }
  // Workload balance by assigned MINUTES (not just count): fewer minutes → small bonus. Unknown → no effect.
  if (typeof s.assignedMinutes === 'number') {
    const bonus = Math.max(0, AW.minutesBalance - Math.floor(s.assignedMinutes / 60) * 2);
    if (bonus > 0) { delta += bonus; reasons.push(`${s.assignedMinutes} assigned min today`); }
  }
  // Upcoming appointment within the service window → soft caution (hard reservation is handled in eligibility).
  if (typeof s.nextAppointmentInMinutes === 'number' && s.nextAppointmentInMinutes >= 0 && s.nextAppointmentInMinutes <= 45) {
    delta -= AW.apptSoonPenalty; warnings.push(`Has an appointment in ~${s.nextAppointmentInMinutes} min`);
  }
  // Free soonest (BUILD_PLAN Phase 6: availableInMinutes is now real — the end of the current service). Unknown → no effect.
  if (typeof s.availableInMinutes === 'number') {
    const wait = Math.max(0, s.availableInMinutes);
    const bonus = Math.max(0, AW.availableSoon - Math.floor(wait / 5) * 2);
    if (bonus > 0) { delta += bonus; reasons.push(wait === 0 ? 'Free now' : `Free in ~${wait} min`); }
  }
  // Shift end: the service would run past the shift → a clear caution; ending soon → a smaller one.
  const shift = shiftEndCaution(s.shiftEndsInMinutes, Math.max(0, s.availableInMinutes ?? 0) + Math.max(0, serviceDurationMinutes), serviceDurationMinutes);
  if (shift) { delta -= shift.kind === 'past' ? AW.pastShiftPenalty : AW.shiftEndPenalty; warnings.push(shift.warning); }
  return { delta, reasons, warnings };
}

/** THE shift-end rule (one place): the work would end after the shift → 'past'; the shift ends within
 *  SHIFT_ENDS_SOON_MIN → 'soon'; unknown shift end → nothing (never fabricated). `finishesInMinutes` is the END of the
 *  window being judged — "free-at + minutes" for one service, the PLANNED end for a line of a visit plan. */
export const SHIFT_ENDS_SOON_MIN = 30;
export function shiftEndCaution(shiftEndsInMinutes: number | null | undefined, finishesInMinutes: number, durationMinutes: number): { kind: 'past' | 'soon'; warning: string } | null {
  if (typeof shiftEndsInMinutes !== 'number' || !isFinite(shiftEndsInMinutes) || shiftEndsInMinutes < 0) return null;
  if (durationMinutes > 0 && shiftEndsInMinutes < finishesInMinutes) return { kind: 'past', warning: `Shift ends in ~${shiftEndsInMinutes} min, before this service would finish` };
  if (shiftEndsInMinutes <= SHIFT_ENDS_SOON_MIN) return { kind: 'soon', warning: `Shift ends in ~${shiftEndsInMinutes} min` };
  return null;
}
/** true for a warning shiftEndCaution produced (so a planner can re-judge it over another window) */
export function isShiftEndWarning(w: string): boolean { return /^Shift ends in ~\d+ min(, before this service would finish)?$/.test(w); }

// Confidence from score separation between the top two eligible candidates, normalized. One eligible → modest
// confidence; none → 0. Never fabricated beyond the observable score gap.
function confidenceFrom(scores: number[]): number {
  if (scores.length === 0) return 0;
  if (scores.length === 1) return 0.6;
  const top = scores[0], second = scores[1];
  const gap = Math.max(0, top - second);
  return Math.max(0, Math.min(1, 0.5 + gap / 100));
}

export interface BuildRecommendationInput {
  queueEntryId: string;
  requiredCategories: string[];
  serviceDurationMinutes: number;
  // Only ELIGIBLE technicians should be passed here (eligibility runs first, deterministically).
  eligible: AssignmentSignals[];
  // Optional: hard reasons why the pool is empty/limited (from the eligibility pass), surfaced as conflicts.
  conflicts?: string[];
  now?: number;
  /** BUILD_PLAN Phase 6: what the suggestion was made under — recorded on the envelope (and its row) */
  configVersion?: string | null;
  queueVersion?: number | null;
  /** the technician the guest asked for (audit bug 1) — a different pick needs the guest's OK, so staff review */
  requestedTechnicianId?: string | null;
  requestedTechnicianName?: string | null;
  /** technicians the hard rules removed, with the plain reasons (shown to a manager choosing an override) */
  ineligible?: { technicianId: string; name: string; reasons: string[] }[];
}

export function buildRecommendation(input: BuildRecommendationInput, opts: { allRanked?: boolean } = {}): RecommendationEnvelope {
  const nowIso = new Date(input.now ?? Date.now()).toISOString();
  const scored = input.eligible.map((s) => {
    const base = scoreTechnician({ technicianId: s.technicianId, name: s.name, available: s.available, skills: s.skills, activeLoad: s.activeLoad, isRequested: s.isRequested, isPrevious: s.isPrevious }, input.requiredCategories);
    const add = additiveScore(s, input.serviceDurationMinutes);
    const startMin = typeof s.availableInMinutes === 'number' ? Math.max(0, s.availableInMinutes) : null;
    const candidate: RecommendationCandidate = {
      technicianId: s.technicianId, name: s.name, eligible: true,
      matchScore: base.score + add.delta,
      reasons: [...base.reasons, ...add.reasons],
      warnings: add.warnings,
      estimatedStartInMinutes: startMin,
      estimatedCompletionInMinutes: startMin == null ? null : startMin + Math.max(0, input.serviceDurationMinutes),
    };
    return candidate;
  }).sort((a, b) => b.matchScore - a.matchScore);

  const [recommended, ...alts] = scored;
  const confidence = confidenceFrom(scored.map((c) => c.matchScore));
  const warnings = [...(recommended?.warnings ?? [])];
  const conflicts = input.conflicts ?? [];
  // A guest who asked for someone is never quietly given someone else: the pick needs the guest's OK (the customer
  // "accept another technician" flow) — so the action is staff review and the auto-run never takes it (audit bug 6).
  if (input.requestedTechnicianId && recommended && recommended.technicianId !== input.requestedTechnicianId) {
    const who = input.requestedTechnicianName || 'another technician';
    const why = input.ineligible?.find((i) => i.technicianId === input.requestedTechnicianId)?.reasons.join(', ');
    warnings.push(`The guest asked for ${who}${why ? ` (${why})` : ''} — check with the guest before assigning someone else`);
  }

  let requiredAction: RequiredAction;
  if (!recommended) requiredAction = 'no_eligible_technician';
  else if (confidence < CONFIDENCE_FLOOR || warnings.length > 0) requiredAction = 'staff_review';
  else requiredAction = 'assignable';

  return {
    queueEntryId: input.queueEntryId,
    recommended: recommended ?? null,
    alternates: alts.slice(0, 3),
    confidence,
    conflicts,
    warnings,
    requiredAction,
    ruleVersion: RULE_VERSION,
    recoVersion: RECO_VERSION,
    generatedAt: nowIso,
    configVersion: input.configVersion ?? null,
    queueVersion: input.queueVersion ?? null,
    requestedTechnicianId: input.requestedTechnicianId ?? null,
    ineligible: input.ineligible ?? [],
    // every eligible technician's score (the panel's list) — internal; the service strips it before storing
    ...(opts.allRanked ? { ranked: scored.map((c) => ({ technicianId: c.technicianId, matchScore: c.matchScore })) } : {}),
  } as RecommendationEnvelope;
}
