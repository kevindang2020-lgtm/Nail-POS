// ai-queue-assignment-foundation.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { evaluateEligibility, partitionEligibility } from './ai-queue-assignment-eligibility';
import { buildRecommendation } from './ai-queue-assignment-engine';
import { InMemoryQueueAssignmentRepository } from './ai-queue-assignment.repository';
import type { EligibilityInput, AssignmentSignals, QueueAssignmentContext } from './ai-queue-assignment.dto';

const baseElig = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  technicianId: 't1', name: 'Kim', branchId: 'b1', clockedIn: true, skills: ['nails'], requiredCategories: ['nails'],
  activeAssignments: 0, maxConcurrent: 1, onBreak: false, blocked: false, reservedForAppointment: false,
  stationAvailable: true, manualLock: false, ...over,
});

describe('eligibility — hard constraints', () => {
  it('passes when every rule is satisfied', () => {
    expect(evaluateEligibility(baseElig()).eligible).toBe(true);
  });
  it('fails closed on each hard rule', () => {
    expect(evaluateEligibility(baseElig({ branchId: null })).hardFails).toContain('wrong_branch');
    expect(evaluateEligibility(baseElig({ clockedIn: false })).hardFails).toContain('not_clocked_in');
    expect(evaluateEligibility(baseElig({ skills: ['hair'] })).hardFails).toContain('missing_skill');
    expect(evaluateEligibility(baseElig({ activeAssignments: 1, maxConcurrent: 1 })).hardFails).toContain('at_capacity');
    expect(evaluateEligibility(baseElig({ onBreak: true })).hardFails).toContain('on_break');
    expect(evaluateEligibility(baseElig({ blocked: true })).hardFails).toContain('blocked');
    expect(evaluateEligibility(baseElig({ reservedForAppointment: true })).hardFails).toContain('appointment_reserved');
    expect(evaluateEligibility(baseElig({ stationAvailable: false })).hardFails).toContain('station_unavailable');
    expect(evaluateEligibility(baseElig({ manualLock: true })).hardFails).toContain('manual_lock');
  });
  it('partitions eligible vs ineligible', () => {
    const r = partitionEligibility([baseElig(), baseElig({ technicianId: 't2', onBreak: true })]);
    expect(r.eligible.map((e) => e.technicianId)).toEqual(['t1']);
    expect(r.ineligible.map((e) => e.technicianId)).toEqual(['t2']);
  });
});

const sig = (over: Partial<AssignmentSignals> = {}): AssignmentSignals => ({
  technicianId: 't1', name: 'Kim', available: true, skills: ['nails'], activeLoad: 0, ...over,
});

describe('engine — structured envelope', () => {
  it('returns a recommended + alternates, sorted by score', () => {
    const env = buildRecommendation({
      queueEntryId: 'q1', requiredCategories: ['nails'], serviceDurationMinutes: 30,
      eligible: [sig({ technicianId: 't1', name: 'Kim', isRequested: true }), sig({ technicianId: 't2', name: 'Lee' })],
    });
    expect(env.recommended?.technicianId).toBe('t1'); // requested → higher
    expect(env.alternates.map((a) => a.technicianId)).toContain('t2');
    expect(env.recommended?.reasons).toContain('Requested by guest');
    expect(env.ruleVersion).toBe('qa-rule-2');
    expect(env.recoVersion).toBe('qa-reco-2');
  });

  it('rotation + workload-minutes are additive; null signals contribute nothing', () => {
    const topRotation = buildRecommendation({ queueEntryId: 'q1', requiredCategories: ['nails'], serviceDurationMinutes: 30, eligible: [sig({ rotationIndex: 0 })] });
    expect(topRotation.recommended?.reasons).toContain('Next up in rotation');
    // null rotation/minutes → no rotation/minutes reasons
    const noSignals = buildRecommendation({ queueEntryId: 'q1', requiredCategories: ['nails'], serviceDurationMinutes: 30, eligible: [sig({ rotationIndex: null, assignedMinutes: null })] });
    expect(noSignals.recommended?.reasons.some((r) => /rotation/i.test(r))).toBe(false);
  });

  it('appointment-soon and shift-end produce warnings + staff_review', () => {
    const env = buildRecommendation({ queueEntryId: 'q1', requiredCategories: ['nails'], serviceDurationMinutes: 30, eligible: [sig({ nextAppointmentInMinutes: 20, shiftEndsInMinutes: 15 })] });
    expect(env.warnings.join(' ')).toMatch(/appointment/i);
    expect(env.warnings.join(' ')).toMatch(/Shift ends/i);
    expect(env.requiredAction).toBe('staff_review');
  });

  it('computes estimated start/completion from availableInMinutes + duration', () => {
    const env = buildRecommendation({ queueEntryId: 'q1', requiredCategories: ['nails'], serviceDurationMinutes: 45, eligible: [sig({ availableInMinutes: 10 })] });
    expect(env.recommended?.estimatedStartInMinutes).toBe(10);
    expect(env.recommended?.estimatedCompletionInMinutes).toBe(55);
  });

  it('no eligible technicians → no_eligible_technician + conflicts surfaced', () => {
    const env = buildRecommendation({ queueEntryId: 'q1', requiredCategories: ['nails'], serviceDurationMinutes: 30, eligible: [], conflicts: ['All qualified technicians are on break'] });
    expect(env.recommended).toBeNull();
    expect(env.requiredAction).toBe('no_eligible_technician');
    expect(env.conflicts).toContain('All qualified technicians are on break');
    expect(env.confidence).toBe(0);
  });
});

describe('repository — tenant/branch scoped', () => {
  const ctx = (t: string, b = 'b1'): QueueAssignmentContext => ({ tenantId: t, branchId: b, userId: 'u1', role: 'OWNER', permissions: [] });
  it('saves + reads back within tenant, isolates across tenants', async () => {
    const repo = new InMemoryQueueAssignmentRepository();
    const env = buildRecommendation({ queueEntryId: 'q1', requiredCategories: ['nails'], serviceDurationMinutes: 30, eligible: [sig()] });
    const saved = await repo.saveRecommendation(ctx('A'), env);
    expect((await repo.getRecommendation(ctx('A'), saved.id))?.id).toBe(saved.id);
    expect(await repo.getRecommendation(ctx('B'), saved.id)).toBeNull(); // isolation
    expect((await repo.latestForEntry(ctx('A'), 'q1'))?.id).toBe(saved.id);
  });
  it('records + lists decisions, tenant-scoped', async () => {
    const repo = new InMemoryQueueAssignmentRepository();
    await repo.recordDecision(ctx('A'), { recommendationId: 'r1', queueEntryId: 'q1', decision: 'accepted', chosenTechnicianId: 't1', reason: null, decidedBy: 'u1' });
    expect((await repo.listDecisions(ctx('A'), 'q1')).length).toBe(1);
    expect((await repo.listDecisions(ctx('B'), 'q1')).length).toBe(0);
  });
});
