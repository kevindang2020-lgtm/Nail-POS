// ai-queue-assignment-eligibility.ts — PURE deterministic eligibility. These are the hard constraints that run
// BEFORE any AI/weighted ranking; a technician failing any of them can never be recommended or auto-assigned
// (a documented manager override is a separate, audited path handled by the caller — not here). This mirrors and
// extends the skill gate already in tech-recommendation.ts so the two never drift: skillMatch is reused verbatim.
import { skillMatch } from '@aipowersalon/workforce';
import type { EligibilityInput, EligibilityResult, HardFailReason } from './ai-queue-assignment.dto';

// Evaluate one technician against every hard rule. Order is deterministic so the reported fails are stable.
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const fails: HardFailReason[] = [];
  // Branch: a tech may only be recommended within their active branch — a tech with no branch fails closed, and (BUILD_PLAN
  // Phase 6, audit "hard-rule gate") a tech of ANOTHER branch fails too. The queue used to stamp every technician with
  // the caller's branch, so this check could never fire; it now compares the technician's real branch.
  if (!input.branchId || (input.queueBranchId != null && input.branchId !== input.queueBranchId)) fails.push('wrong_branch');
  if (!input.clockedIn) fails.push('not_clocked_in');
  if (!(typeof input.serviceEligible === 'boolean' ? input.serviceEligible : skillMatch(input.skills, input.requiredCategories))) fails.push('missing_skill');
  if (input.activeAssignments >= Math.max(1, input.maxConcurrent)) fails.push('at_capacity');
  if (input.onBreak) fails.push('on_break');
  if (input.blocked) fails.push('blocked');
  if (input.reservedForAppointment) fails.push('appointment_reserved');
  if (!input.stationAvailable) fails.push('station_unavailable');
  if (input.manualLock) fails.push('manual_lock');
  return { technicianId: input.technicianId, eligible: fails.length === 0, hardFails: fails };
}

// Filter a set of technicians to the eligible ones, keeping the fail reasons for the rest (so the UI can explain
// why an otherwise-obvious tech is not offered, and a manager-override screen can surface them).
export function partitionEligibility(inputs: EligibilityInput[]): { eligible: EligibilityResult[]; ineligible: EligibilityResult[] } {
  const eligible: EligibilityResult[] = [];
  const ineligible: EligibilityResult[] = [];
  for (const i of inputs) {
    const r = evaluateEligibility(i);
    (r.eligible ? eligible : ineligible).push(r);
  }
  return { eligible, ineligible };
}
