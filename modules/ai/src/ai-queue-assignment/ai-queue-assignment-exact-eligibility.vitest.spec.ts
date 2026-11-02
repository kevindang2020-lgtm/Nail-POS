// deep-scan (Oct 22 2026): Fair Turn's hard rule — the exact-service eligibility answer decides missing_skill when the
// queue supplies it; the category match is the fallback only. (Extended pilot day: Mary, whose services are all in the
// salon's one "Nails" category but who is not approved for acrylic, was recommended for an acrylic set.)
import { describe, it, expect } from 'vitest';
import { evaluateEligibility } from './ai-queue-assignment-eligibility';
import { mapAssignmentInputs } from './ai-queue-assignment.adapters';

const base = { technicianId: 'mary', name: 'Mary', branchId: 'b', queueBranchId: 'b', clockedIn: true, skills: ['Nails'], requiredCategories: ['Nails'], activeAssignments: 0, maxConcurrent: 1, onBreak: false, blocked: false, reservedForAppointment: false, stationAvailable: true, manualLock: false };

describe('Fair Turn hard rule — exact-service eligibility', () => {
  it('categories match but the authority says no → missing_skill (never recommended)', () => {
    expect(evaluateEligibility({ ...base }).eligible).toBe(true);                                   // the old, category-only answer
    expect(evaluateEligibility({ ...base, serviceEligible: false }).hardFails).toContain('missing_skill');
  });
  it('the authority says yes → eligible even if the category list is stale; absent → the category rule', () => {
    expect(evaluateEligibility({ ...base, skills: [], serviceEligible: true }).eligible).toBe(true);
    expect(evaluateEligibility({ ...base, skills: [] }).hardFails).toContain('missing_skill');
  });
  it('the queue\'s answer reaches the engine through the inputs mapping', () => {
    const m = mapAssignmentInputs({ entry: { queueItemId: 'q1' }, candidates: [{ technicianId: 'mary', name: 'Mary', serviceEligible: false }, { technicianId: 'lisa', name: 'Lisa' }] });
    expect(m.candidates[0].serviceEligible).toBe(false);
    expect('serviceEligible' in m.candidates[1]).toBe(false);
  });
});
