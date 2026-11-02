// ai-queue-assignment-auto.vitest.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { autoAssignDecision, DEFAULT_AUTO_CONFIG } from './ai-queue-assignment-auto';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { InMemoryQueueAssignmentRepository } from './ai-queue-assignment.repository';
import { InMemoryQueueDataAdapter, InMemoryQueueScanAdapter, InMemoryAssignExecution, type ScanEntryData, type QueueEntryInput, type QueueCandidateInput } from './ai-queue-assignment.ports';
import { InMemoryQueueAssignmentSettings, type SettingsPatch } from './ai-queue-assignment-settings';
import { QueueAssignmentForbiddenError, QueueAssignmentValidationError } from './ai-queue-assignment.dto';
import { InMemoryQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import type { RecommendationEnvelope, QueueAssignmentContext } from './ai-queue-assignment.dto';

const env = (o: Partial<RecommendationEnvelope>): RecommendationEnvelope => ({
  queueEntryId: 'q1', recommended: { technicianId: 't1', name: 'Kim', eligible: true, matchScore: 90, reasons: [], warnings: [], estimatedStartInMinutes: 0, estimatedCompletionInMinutes: 30 },
  alternates: [], confidence: 0.9, conflicts: [], warnings: [], requiredAction: 'assignable', ruleVersion: 'qa-rule-1', recoVersion: 'qa-reco-1', generatedAt: '', ...o,
});

describe('autoAssignDecision — safeguards', () => {
  const cfg = { enabled: true, confidenceFloor: 0.75, maxPerRun: 5 };
  it('assigns only when every guard passes', () => {
    expect(autoAssignDecision(env({}), cfg).assign).toBe(true);
  });
  it('never assigns when disabled (default OFF)', () => {
    expect(autoAssignDecision(env({}), DEFAULT_AUTO_CONFIG).assign).toBe(false);
    expect(autoAssignDecision(env({}), DEFAULT_AUTO_CONFIG).reason).toBe('auto_assignment_disabled');
  });
  it('blocks on staff_review, warnings, conflicts, low confidence, no recommendation', () => {
    expect(autoAssignDecision(env({ requiredAction: 'staff_review' }), cfg).assign).toBe(false);
    expect(autoAssignDecision(env({ warnings: ['shift ends soon'] }), cfg).assign).toBe(false);
    expect(autoAssignDecision(env({ conflicts: ['x'] }), cfg).assign).toBe(false);
    expect(autoAssignDecision(env({ confidence: 0.6 }), cfg).assign).toBe(false);
    expect(autoAssignDecision(env({ recommended: null, requiredAction: 'no_eligible_technician' }), cfg).assign).toBe(false);
  });
});

// BUILD_PLAN Phase 6: the auto-run through the ONE settings source — every switch (platform ai.auto_actions, salon kill
// switch, branch — bug 6), the delay, exclusions, locks, a requested technician (bug 6), never an overwrite (bug 5), its
// own decision type (bug 13) and event; `system` for the background job.
describe('service — runAutoAssignment', () => {
  const PERMS = ['ai_queue_assignment.view', 'ai_queue_assignment.recommend', 'ai_queue_assignment.manage_auto'];
  const ctx = (role = 'OWNER', perms = PERMS): QueueAssignmentContext => ({ tenantId: 'A', branchId: 'b1', userId: 'u1', role, permissions: perms });
  const scanEntry = (id: string, o: Partial<ScanEntryData> = {}): ScanEntryData => ({ queueEntryId: id, waitMinutes: 5, status: 'waiting', assignedTechnicianId: null, isAppointment: false, updatedAt: new Date().toISOString(), version: 1, ...o });
  const kim = (o: Partial<QueueCandidateInput> = {}): QueueCandidateInput => ({ technicianId: 't1', name: 'Kim', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false, maxConcurrent: 5, ...o });
  async function make(patch: SettingsPatch, entries: ScanEntryData[], o: { entry?: Partial<QueueEntryInput>; candidates?: QueueCandidateInput[]; entries?: Record<string, Partial<QueueEntryInput>> } = {}) {
    const repo = new InMemoryQueueAssignmentRepository();
    const inputs: Record<string, any> = {};
    for (const e of entries) inputs[e.queueEntryId] = {
      entry: { queueEntryId: e.queueEntryId, branchId: 'b1', version: e.version ?? 1, requiredCategories: ['nails'], serviceDurationMinutes: 30, requestedTechnicianId: null, ...o.entry, ...(o.entries?.[e.queueEntryId] ?? {}) },
      candidates: o.candidates ?? [kim()],
    };
    const exec = new InMemoryAssignExecution();
    for (const e of entries) exec.seed(e.queueEntryId, { version: e.version ?? 1 });
    const settings = new InMemoryQueueAssignmentSettings();
    await settings.update({ tenantId: 'A', branchId: 'b1' }, { autoConfidenceFloor: 0.5, autoDelaySeconds: 60, ...patch }, { userId: 'u1' });
    const emitter = { emit: vi.fn() };
    const svc = new QueueAssignmentService(repo, new InMemoryQueueDataAdapter(inputs), new InMemoryQueueAssignmentEntitlement(() => true), emitter,
      { scan: new InMemoryQueueScanAdapter(entries), settings, assign: exec });
    return { svc, exec, repo, settings, emitter };
  }

  it('does nothing when auto is OFF (default posture)', async () => {
    const { svc, exec } = await make({}, [scanEntry('q1')]);
    const r = await svc.runAutoAssignment(ctx());
    expect(r).toMatchObject({ enabled: false, allowed: false, blockedBy: 'disabled', assigned: 0 });
    expect(exec.calls.length).toBe(0);
  });

  it('assigns through the queue as "nobody yet" + the version it saw, logs auto_assigned (not accepted), event + realtime', async () => {
    const { svc, exec, repo, emitter } = await make({ autoEnabled: true }, [scanEntry('q1', { version: 4 }), scanEntry('q2')], { entries: { q1: { version: 4 } } });
    const r = await svc.runAutoAssignment(ctx());
    expect(r).toMatchObject({ enabled: true, allowed: true, assigned: 2, considered: 2 });
    expect(exec.calls.map((c) => c.queueEntryId).sort()).toEqual(['q1', 'q2']);
    const q1 = exec.calls.find((c) => c.queueEntryId === 'q1')!.opts;
    expect(q1).toMatchObject({ technicianId: 't1', expectedTechnicianId: null, expectedVersion: 4, source: 'auto_assign' });
    const ds = await repo.queryDecisions(ctx(), {});
    expect(ds.map((d) => d.decision)).toEqual(['auto_assigned', 'auto_assigned']);   // bug 13
    expect(ds.every((d) => d.applied && d.reason === 'auto_assignment')).toBe(true);
    expect(repo.events.filter((e) => e.type === 'auto_assigned')).toHaveLength(2);
    expect(emitter.emit).toHaveBeenCalledWith(expect.anything(), 'queue.auto_assigned', expect.objectContaining({ queueEntryId: 'q1', technicianId: 't1' }));
    expect((await svc.decisionAnalytics({ ...ctx(), permissions: [...PERMS] }, {})).accepted).toBe(0);
  });

  it('bug 5: a guest staff assigned meanwhile is never overwritten', async () => {
    const { svc, exec, repo } = await make({ autoEnabled: true }, [scanEntry('q1')]);
    exec.touch('q1', 't7');                                          // staff assigned after the scan was read
    const r = await svc.runAutoAssignment(ctx());
    expect(r.assigned).toBe(0);
    expect(r.skipped).toEqual([{ queueEntryId: 'q1', reason: 'changed_meanwhile' }]);
    expect((await exec.current(ctx(), 'q1'))?.assignedTechnicianId).toBe('t7');
    expect(await repo.queryDecisions(ctx(), {})).toEqual([]);
  });

  it('only unassigned WAITING guests: called / assigned / in-service guests are not touched', async () => {
    const { svc, exec } = await make({ autoEnabled: true }, [scanEntry('q1', { status: 'called' }), scanEntry('q2', { status: 'assigned', assignedTechnicianId: 't9' }), scanEntry('q3', { status: 'in_service' })]);
    const r = await svc.runAutoAssignment(ctx());
    expect(r.considered).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  it('the inputs are the authority: a guest the queue reports as assigned is skipped', async () => {
    const { svc, exec } = await make({ autoEnabled: true }, [scanEntry('q1')], { entry: { assignedTechnicianId: 't9' } });
    expect((await svc.runAutoAssignment(ctx())).skipped).toEqual([{ queueEntryId: 'q1', reason: 'already_assigned' }]);
    expect(exec.calls).toHaveLength(0);
  });

  it('respects the per-run cap', async () => {
    const { svc, exec } = await make({ autoEnabled: true, autoMaxPerRun: 1 }, [scanEntry('q1'), scanEntry('q2'), scanEntry('q3')]);
    const r = await svc.runAutoAssignment(ctx());
    expect(r.assigned).toBe(1);
    expect(exec.calls.length).toBe(1);
    expect(r.skipped.filter((s) => s.reason === 'max_per_run_reached')).toHaveLength(2);
  });

  it('waits for the delay: a guest who just arrived is left to staff', async () => {
    const { svc, exec } = await make({ autoEnabled: true, autoDelaySeconds: 600 }, [scanEntry('q1', { waitMinutes: 5 }), scanEntry('q2', { waitMinutes: 12 })]);
    const r = await svc.runAutoAssignment(ctx());
    expect(exec.calls.map((c) => c.queueEntryId)).toEqual(['q2']);
    expect(r.skipped).toEqual([{ queueEntryId: 'q1', reason: 'within_delay' }]);
  });

  describe('every switch (bug 6)', () => {
    it('the platform switch (Super Admin ai.auto_actions) stops it', async () => {
      const { svc, exec, settings } = await make({ autoEnabled: true }, [scanEntry('q1')]);
      settings.platformDisabled = true;
      expect(await svc.runAutoAssignment(ctx())).toMatchObject({ allowed: false, blockedBy: 'platform', assigned: 0 });
      expect(exec.calls).toHaveLength(0);
      expect(await svc.getAutoConfig(ctx())).toMatchObject({ enabled: true, autoAllowed: false, autoBlockedBy: 'platform', platformAutoActionsDisabled: true });
    });
    it('the salon kill switch stops every branch; only the owner turns it back on', async () => {
      const { svc, exec } = await make({ autoEnabled: true }, [scanEntry('q1')]);
      await expect(svc.killAutoAssignment(ctx(), { scope: 'salon' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);   // reason required
      const killed = await svc.killAutoAssignment(ctx('MANAGER'), { scope: 'salon', reason: 'wrong suggestions today' });
      expect(killed).toMatchObject({ autoAllowed: false, autoBlockedBy: 'salon_kill_switch', salonAutoKilled: true, salonAutoKilledReason: 'wrong suggestions today' });
      expect((await svc.runAutoAssignment(ctx())).blockedBy).toBe('salon_kill_switch');
      expect(exec.calls).toHaveLength(0);
      await expect(svc.unkillAutoAssignment(ctx('MANAGER'), { scope: 'salon', reason: 'fixed' })).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
      expect(await svc.unkillAutoAssignment(ctx('OWNER'), { scope: 'salon', reason: 'fixed' })).toMatchObject({ autoAllowed: true, salonAutoKilled: false });
      expect((await svc.runAutoAssignment(ctx())).assigned).toBe(1);
    });
    it('the branch kill switch turns this branch off; unkill turns it back on', async () => {
      const { svc, exec, emitter } = await make({ autoEnabled: true }, [scanEntry('q1')]);
      expect(await svc.killAutoAssignment(ctx(), { scope: 'branch', reason: 'short staffed' })).toMatchObject({ enabled: false, autoAllowed: false, autoBlockedBy: 'disabled' });
      expect(emitter.emit).toHaveBeenCalledWith(expect.anything(), 'queue.auto_assignment_killed', { scope: 'branch', reason: 'short staffed' });
      expect((await svc.runAutoAssignment(ctx())).assigned).toBe(0);
      await svc.unkillAutoAssignment(ctx(), { scope: 'branch', reason: 'back to normal' });
      expect((await svc.runAutoAssignment(ctx())).assigned).toBe(1);
      expect(exec.calls).toHaveLength(1);
      await expect(svc.killAutoAssignment(ctx(), { scope: 'planet', reason: 'xyz' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    });
  });

  describe('exclusions, locks and requests', () => {
    const run = async (patch: SettingsPatch, e: Partial<ScanEntryData>, entry: Partial<QueueEntryInput> = {}, candidates?: QueueCandidateInput[]) => {
      const m = await make({ autoEnabled: true, ...patch }, [scanEntry('q1', e)], { entry, candidates });
      const r = await m.svc.runAutoAssignment(ctx());
      return { r, calls: m.exec.calls };
    };
    it('a locked guest is never auto-assigned (even to the locked technician)', async () => {
      expect((await run({}, { lock: { technicianId: 't1', reason: 'regular' } })).r.skipped[0].reason).toBe('locked');
      expect((await run({}, {}, { lock: { technicianId: null, reason: 'wait' } })).r.skipped[0].reason).toBe('locked');   // only the inputs know
    });
    it('vip / appointment / requested / party / service exclusions', async () => {
      expect((await run({ autoExclusions: { vip: true } }, { isVip: true })).r.skipped[0].reason).toBe('excluded_vip');
      expect((await run({ autoExclusions: { vip: true } }, {}, { isVip: true })).r.skipped[0].reason).toBe('excluded_vip');
      expect((await run({ autoExclusions: { appointments: true } }, { isAppointment: true })).r.skipped[0].reason).toBe('excluded_appointment');
      expect((await run({ autoExclusions: { requested: true } }, { requestedTechnicianId: 't1' })).r.skipped[0].reason).toBe('excluded_requested');
      expect((await run({ autoExclusions: { groups: true } }, { groupId: 'g1' })).r.skipped[0].reason).toBe('excluded_group');
      expect((await run({ autoExclusions: { serviceIds: ['s-gel'] } }, { serviceIds: ['s-basic', 's-gel'] })).r.skipped[0].reason).toBe('excluded_service');
      expect((await run({ autoExclusions: { vip: false } }, { isVip: true })).r.assigned).toBe(1);
    });
    it('an excluded technician is never the auto pick', async () => {
      const { r, calls } = await run({ autoExclusions: { technicianIds: ['t1'] } }, {}, {}, [kim(), kim({ technicianId: 't2', name: 'Lee' })]);
      expect(r.assigned).toBe(1);
      expect(calls[0].technicianId).toBe('t2');
    });
    it('bug 6: a guest who asked for a technician is not given someone else', async () => {
      // the requested technician is on break → the engine suggests Kim for staff review only
      const a = await run({}, { requestedTechnicianId: 't9' }, { requestedTechnicianId: 't9' }, [kim(), kim({ technicianId: 't9', name: 'Ana', onBreak: true })]);
      expect(a.calls).toHaveLength(0);
      expect(a.r.skipped[0].reason).toBe('requires_staff_review');
      // the scan row still says the guest asked for t9 even if the inputs lag behind → refused by the explicit check
      const b = await run({}, { requestedTechnicianId: 't9' }, { requestedTechnicianId: null }, [kim()]);
      expect(b.calls).toHaveLength(0);
      expect(b.r.skipped[0].reason).toBe('requested_technician_conflict');
      // asked for Kim and Kim is free → assigned
      expect((await run({}, { requestedTechnicianId: 't1' }, { requestedTechnicianId: 't1' })).r.assigned).toBe(1);
    });
  });

  it('system run (the background job): no user permission needed; a user run needs manage_auto', async () => {
    const { svc } = await make({ autoEnabled: true }, [scanEntry('q1')]);
    await expect(svc.runAutoAssignment(ctx('FRONT_DESK', ['ai_queue_assignment.view']))).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
    const r = await svc.runAutoAssignment({ tenantId: 'A', branchId: 'b1', userId: '00000000-0000-0000-0000-000000000000', role: 'SYSTEM', permissions: [] }, { system: true });
    expect(r.assigned).toBe(1);
  });

  it('auto-config goes through the settings port and validates', async () => {
    const { svc, settings } = await make({}, []);
    await expect(svc.setAutoConfig(ctx('FRONT_DESK', ['ai_queue_assignment.view']), { enabled: true })).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
    await expect(svc.setAutoConfig(ctx(), { confidenceFloor: 2 })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    await expect(svc.setAutoConfig(ctx(), { maxPerRun: 101 })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    await expect(svc.setAutoConfig(ctx(), { exclusions: { vip: 'yes' } })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    await expect(svc.setAutoConfig(ctx(), {})).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    const v = await svc.setAutoConfig(ctx(), { enabled: true, confidenceFloor: 0.8, maxPerRun: 3, delaySeconds: 90, exclusions: { vip: true, technicianIds: ['t1'] } });
    expect(v).toMatchObject({ enabled: true, confidenceFloor: 0.8, maxPerRun: 3, delaySeconds: 90, exclusions: { vip: true, technicianIds: ['t1'] }, autoAllowed: true, autoBlockedBy: null });
    expect((await settings.effective({ tenantId: 'A', branchId: 'b1' })).autoEnabled).toBe(true);
    // a stale save is a 409, not a silent overwrite
    await expect(svc.setAutoConfig(ctx(), { enabled: false, expectedVersion: 1 })).rejects.toMatchObject({ name: 'QueueAssignmentStaleError' });
  });
});
