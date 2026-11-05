// ai-queue-assignment-plan-service.vitest.spec.ts — multi-technician routing through the AI service (contract §2/§3/§8):
// planVisit / planParty read the ONE engine per line; decidePlan accepted / adjusted (override) / rejected /
// kept_unassigned / replay act through the queue's ONE multi-line writer (AssignExecutionPort.assignPlan); the auto-run
// assigns a split visit under every existing switch and never a party (D5); suggest() / balance() know split visits.
import { describe, it, expect, vi } from 'vitest';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { InMemoryQueueAssignmentRepository } from './ai-queue-assignment.repository';
import { InMemoryQueueDataAdapter, InMemoryQueueScanAdapter, InMemoryAssignExecution, type ScanEntryData, type QueueEntryInput, type QueueCandidateInput } from './ai-queue-assignment.ports';
import { InMemoryQueueAssignmentSettings, type SettingsPatch } from './ai-queue-assignment-settings';
import { QueueAssignmentForbiddenError, QueueAssignmentStaleError, QueueAssignmentValidationError, type QueueAssignmentContext } from './ai-queue-assignment.dto';
import { InMemoryQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import type { PlanServiceLine } from './ai-queue-assignment-plan';

const PERMS = ['ai_queue_assignment.view', 'ai_queue_assignment.recommend', 'ai_queue_assignment.assign', 'ai_queue_assignment.manage_auto'];
const ctx = (perms = PERMS, role = 'FRONT_DESK'): QueueAssignmentContext => ({ tenantId: 'A', branchId: 'b1', userId: 'u1', role, permissions: perms });
const line = (serviceId: string, sequence: number, durationMinutes: number, category: string, o: Partial<PlanServiceLine> = {}): PlanServiceLine =>
  ({ serviceId, serviceName: serviceId[0].toUpperCase() + serviceId.slice(1), category, durationMinutes, sequence, isAddon: false, parentServiceId: null, assignedTechnicianId: null, status: 'pending', ...o });
const SERVICES = [line('pedicure', 0, 50, 'pedi'), line('manicure', 1, 40, 'mani'), line('nailart', 2, 20, 'art', { isAddon: true, parentServiceId: 'manicure' })];
const tech = (technicianId: string, name: string, skills: string[], o: Partial<QueueCandidateInput> = {}): QueueCandidateInput =>
  ({ technicianId, name, branchId: 'b1', available: true, skills, activeAssignments: 0, isPrevious: false, maxConcurrent: 5, availableInMinutes: 0, ...o });
const PIA = tech('tp', 'Pia', ['pedi']); const MO = tech('tm', 'Mo', ['mani', 'art']); const ALL = tech('ta', 'Ann', ['pedi', 'mani', 'art']);
const scanEntry = (id: string, o: Partial<ScanEntryData> = {}): ScanEntryData => ({ queueEntryId: id, waitMinutes: 5, status: 'waiting', assignedTechnicianId: null, isAppointment: false, updatedAt: new Date().toISOString(), version: 1, ...o });

async function make(o: { ids?: string[]; candidates?: QueueCandidateInput[]; entry?: Partial<QueueEntryInput>; entries?: Record<string, Partial<QueueEntryInput>>; patch?: SettingsPatch; scan?: ScanEntryData[] } = {}) {
  const ids = o.ids ?? ['q1'];
  const inputs: Record<string, any> = {};
  for (const id of ids) inputs[id] = {
    entry: { queueEntryId: id, branchId: 'b1', version: 1, requiredCategories: ['pedi', 'mani', 'art'], serviceDurationMinutes: 110, requestedTechnicianId: null,
      assignedTechnicianId: null, status: 'waiting', customerName: 'Guest ' + id, serviceIds: SERVICES.map((s) => s.serviceId), services: SERVICES, ...o.entry, ...(o.entries?.[id] ?? {}) },
    candidates: o.candidates ?? [PIA, MO],
  };
  const repo = new InMemoryQueueAssignmentRepository();
  const data = new InMemoryQueueDataAdapter(inputs);
  const exec = new InMemoryAssignExecution();
  for (const id of ids) exec.seed(id, { version: 1 });
  const settings = new InMemoryQueueAssignmentSettings();
  await settings.update({ tenantId: 'A', branchId: 'b1' }, { autoConfidenceFloor: 0.5, autoDelaySeconds: 60, ...(o.patch ?? {}) }, { userId: 'u1' });
  const emitter = { emit: vi.fn() };
  const svc = new QueueAssignmentService(repo, data, new InMemoryQueueAssignmentEntitlement(() => true), emitter,
    { scan: new InMemoryQueueScanAdapter(o.scan ?? []), settings, assign: exec });
  return { svc, repo, data, exec, settings, emitter };
}

describe('planVisit — the visit plan through the one engine', () => {
  it('nobody covers the visit → split over Pia + Mo; persisted like recommend(); the event names the mode', async () => {
    const { svc, repo, emitter } = await make();
    const v = await svc.planVisit(ctx(), 'q1');
    expect(v.kind).toBe('visit');
    expect(v.planVersion).toBe('qa-plan-1');
    expect(v.visit!.mode).toBe('split');
    expect(v.visit!.lines.map((l) => [l.serviceId, l.technicianId, l.timing])).toEqual([['pedicure', 'tp', 'parallel'], ['manicure', 'tm', 'parallel'], ['nailart', 'tm', 'after']]);
    expect(v.visit!.estimatedFinishInMinutes).toBe(60);
    expect((await repo.getRecommendation(ctx(), v.recommendationId))).toBeTruthy();
    expect(emitter.emit).toHaveBeenCalledWith(expect.anything(), 'queue.assignment_recommended', expect.objectContaining({ queueEntryId: 'q1', mode: 'split' }));
  });
  it('one technician covers it all and a split would not finish 15+ min sooner → single (D1)', async () => {
    const { svc } = await make({ candidates: [ALL, tech('tp', 'Pia', ['pedi'], { availableInMinutes: 90 }), tech('tm', 'Mo', ['mani', 'art'], { availableInMinutes: 90 })] });
    const v = await svc.planVisit(ctx(), 'q1');
    expect(v.visit!.mode).toBe('single');
    expect(new Set(v.visit!.lines.map((l) => l.technicianId))).toEqual(new Set(['ta']));
  });
  it('needs ai_queue_assignment.recommend', async () => {
    const { svc } = await make();
    await expect(svc.planVisit(ctx(['ai_queue_assignment.view']), 'q1')).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
  });
});

describe('decidePlan', () => {
  it('accepted → the stored plan through assignPlan (expectations from the plan), decision row carries the lines', async () => {
    const { svc, exec, repo, emitter } = await make();
    const v = await svc.planVisit(ctx(), 'q1');
    const r = await svc.decidePlan(ctx(), v.recommendationId, { decision: 'accepted', idempotencyKey: 'click-1' });
    expect(r.applied).toBe(true);
    expect(r.result!.items[0]).toMatchObject({ queueItemId: 'q1', assignedTechnicianId: 'tm', version: 2 });
    expect(exec.planCalls).toHaveLength(1);
    expect(exec.planCalls[0]).toMatchObject({ source: 'ai_suggestion', idempotencyKey: 'aqd:click-1', items: [{ queueItemId: 'q1', expectedVersion: 1, expectedTechnicianId: null }] });
    expect(exec.planCalls[0].items[0].lines.map((l) => [l.serviceId, l.technicianId, l.timing])).toEqual([['pedicure', 'tp', 'parallel'], ['manicure', 'tm', 'parallel'], ['nailart', 'tm', 'after']]);
    expect(r.decision).toMatchObject({ decision: 'accepted', chosenTechnicianId: 'tm', applied: true });
    expect((r.decision as any).plan).toEqual([{ queueItemId: 'q1', serviceId: 'pedicure', technicianId: 'tp' }, { queueItemId: 'q1', serviceId: 'manicure', technicianId: 'tm' }, { queueItemId: 'q1', serviceId: 'nailart', technicianId: 'tm' }]);
    expect(repo.events.filter((e) => e.type === 'decided')).toHaveLength(1);
    expect(emitter.emit).toHaveBeenCalledWith(expect.anything(), 'queue.assignment_decided', expect.objectContaining({ decision: 'accepted', applied: true }));
  });
  it('the same click again replays — no second write, no second decision', async () => {
    const { svc, exec, repo } = await make();
    const v = await svc.planVisit(ctx(), 'q1');
    await svc.decidePlan(ctx(), v.recommendationId, { decision: 'accepted', idempotencyKey: 'click-2' });
    const again = await svc.decidePlan(ctx(), v.recommendationId, { decision: 'accepted', idempotencyKey: 'click-2' });
    expect(again.replayed).toBe(true);
    expect(exec.planCalls).toHaveLength(1);
    expect(await repo.queryDecisions(ctx(), {})).toHaveLength(1);
    // no client key: the default key (recommendation : decision : lines) also replays
    const v2 = await svc.planVisit(ctx(), 'q1');
    exec.seed('q1', { version: 1 }); exec.lines.delete('q1');
    await svc.decidePlan(ctx(), v2.recommendationId, { decision: 'accepted' });
    expect((await svc.decidePlan(ctx(), v2.recommendationId, { decision: 'accepted' })).replayed).toBe(true);
    expect(exec.planCalls).toHaveLength(2);
  });
  it('adjusted needs ai_queue_assignment.override (403) and the FULL line list; stored as overridden', async () => {
    const { svc, exec } = await make({ candidates: [PIA, MO, tech('tx', 'Xi', ['mani', 'art'])] });
    const v = await svc.planVisit(ctx(), 'q1');
    const lines = [{ queueItemId: 'q1', serviceId: 'pedicure', technicianId: 'tp' }, { queueItemId: 'q1', serviceId: 'manicure', technicianId: 'tx' }, { queueItemId: 'q1', serviceId: 'nailart', technicianId: 'tx' }];
    await expect(svc.decidePlan(ctx(), v.recommendationId, { decision: 'adjusted', lines })).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
    expect(exec.planCalls).toHaveLength(0);
    const mgr = ctx([...PERMS, 'ai_queue_assignment.override']);
    await expect(svc.decidePlan(mgr, v.recommendationId, { decision: 'adjusted', lines: lines.slice(0, 2) })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    const r = await svc.decidePlan(mgr, v.recommendationId, { decision: 'adjusted', lines });
    expect(r.decision.decision).toBe('overridden');
    expect(exec.planCalls[0]).toMatchObject({ managerOverride: true });
    expect(exec.planCalls[0].items[0].lines.map((l) => l.technicianId)).toEqual(['tp', 'tx', 'tx']);
  });
  it('rejected needs a reason and assigns nothing; kept_unassigned assigns nothing', async () => {
    const { svc, exec } = await make();
    const v = await svc.planVisit(ctx(), 'q1');
    await expect(svc.decidePlan(ctx(), v.recommendationId, { decision: 'rejected' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    const r = await svc.decidePlan(ctx(), v.recommendationId, { decision: 'rejected', reason: 'guest wants one person' });
    expect(r).toMatchObject({ applied: false, result: null });
    expect(r.decision.decision).toBe('rejected');
    expect((await svc.decidePlan(ctx(), v.recommendationId, { decision: 'kept_unassigned' })).applied).toBe(false);
    expect(exec.planCalls).toHaveLength(0);
  });
  it('a guest changed on another device → 409 naming the guest; nothing recorded', async () => {
    const { svc, exec, repo } = await make();
    const v = await svc.planVisit(ctx(), 'q1');
    exec.touch('q1', 'tz');
    const err: any = await svc.decidePlan(ctx(), v.recommendationId, { decision: 'accepted' }).catch((e) => e);
    expect(err).toBeInstanceOf(QueueAssignmentStaleError);
    expect(err).toMatchObject({ currentTechnicianId: 'tz', queueItemId: 'q1' });
    expect(await repo.queryDecisions(ctx(), {})).toHaveLength(0);
  });
});

describe('planParty', () => {
  it('together: one plan per member, no technician shared between members (D7); accepted assigns the party in ONE call', async () => {
    const { svc, data, exec } = await make({ ids: ['q1', 'q2'], candidates: [PIA, MO, tech('ty', 'Yu', ['pedi']), tech('tx', 'Xi', ['mani', 'art'])] });
    data.setGroup({ groupId: 'g1', label: 'Smiths', together: true, members: [{ queueItemId: 'q1', customerName: 'A', status: 'waiting' }, { queueItemId: 'q2', customerName: 'B', status: 'waiting' }] });
    const p = await svc.planParty(ctx(), 'g1');
    expect(p.kind).toBe('party');
    const [a, b] = p.party!.members;
    const techsA = new Set(a.lines.map((l) => l.technicianId)); const techsB = new Set(b.lines.map((l) => l.technicianId));
    expect([...techsA].some((t) => techsB.has(t))).toBe(false);
    const r = await svc.decidePlan(ctx(), p.recommendationId, { decision: 'accepted' });
    expect(r.applied).toBe(true);
    expect(exec.planCalls).toHaveLength(1);
    expect(exec.planCalls[0].groupId).toBe('g1');
    expect(exec.planCalls[0].items.map((i) => i.queueItemId)).toEqual(['q1', 'q2']);
  });
  it('an unknown party is a 400', async () => {
    const { svc } = await make();
    await expect(svc.planParty(ctx(), 'nope')).rejects.toBeInstanceOf(QueueAssignmentValidationError);
  });
});

describe('auto-run — split visits (D5)', () => {
  it('assigns a split visit through assignPlan as "nobody yet", logs auto_assigned with the plan; counts toward the cap', async () => {
    const { svc, exec, repo } = await make({ ids: ['q1', 'q2'], patch: { autoEnabled: true, autoMaxPerRun: 1 }, scan: [scanEntry('q1', { waitMinutes: 9 }), scanEntry('q2')] });
    const r = await svc.runAutoAssignment(ctx());
    expect(r.assigned).toBe(1);
    expect(r.skipped).toEqual([{ queueEntryId: 'q2', reason: 'max_per_run_reached' }]);
    expect(exec.calls).toHaveLength(0);   // never the single-technician path
    expect(exec.planCalls).toHaveLength(1);
    expect(exec.planCalls[0]).toMatchObject({ source: 'auto_assign', items: [{ queueItemId: 'q1', expectedTechnicianId: null, expectedVersion: 1 }] });
    expect(exec.planCalls[0].idempotencyKey).toMatch(/^auto:/);
    expect(exec.planCalls[0].items[0].lines.every((l) => l.expectedTechnicianId === null)).toBe(true);
    const ds = await repo.queryDecisions(ctx(), {});
    expect(ds.map((d) => d.decision)).toEqual(['auto_assigned']);
    expect(repo.events.find((e) => e.type === 'auto_assigned')!.payload).toMatchObject({ plan: expect.any(Array) });
  });
  it('a party is never auto-assigned, whatever exclusions.groups says', async () => {
    const { svc, exec } = await make({ patch: { autoEnabled: true }, scan: [scanEntry('q1', { groupId: 'g1' } as any)], entry: { groupId: 'g1', groupSize: 2 } });
    const r = await svc.runAutoAssignment(ctx());
    expect(r.assigned).toBe(0);
    expect(r.skipped).toEqual([{ queueEntryId: 'q1', reason: 'party_needs_staff' }]);
    expect(exec.planCalls).toHaveLength(0);
  });
  it('the requested technician off the plan → skipped (requested_technician_conflict)', async () => {
    const { svc, exec } = await make({ patch: { autoEnabled: true }, scan: [scanEntry('q1')], candidates: [PIA, MO, tech('tz', 'Zoe', ['nails'])], entry: { requestedTechnicianId: 'tz' } });
    const r = await svc.runAutoAssignment(ctx());
    expect(r.assigned).toBe(0);
    expect(exec.planCalls).toHaveLength(0);
    expect(['requested_technician_conflict', 'plan_needs_review']).toContain(r.skipped[0].reason);
  });
  it('a plan with a warning (a line tech whose shift ends right after) is left to staff (plan_needs_review)', async () => {
    const { svc, exec } = await make({ patch: { autoEnabled: true }, scan: [scanEntry('q1')], candidates: [PIA, tech('tm', 'Mo', ['mani', 'art'], { shiftEndsInMinutes: 30 })] });
    const r = await svc.runAutoAssignment(ctx());
    expect(r.assigned).toBe(0);
    expect(exec.planCalls).toHaveLength(0);
    expect(r.skipped).toEqual([{ queueEntryId: 'q1', reason: 'plan_needs_review' }]);
  });
  it('a plan below the salon\'s confidence floor is left to staff', async () => {
    const { svc, exec } = await make({ patch: { autoEnabled: true, autoConfidenceFloor: 0.99 }, scan: [scanEntry('q1')] });
    const r = await svc.runAutoAssignment(ctx());
    expect(r.skipped).toEqual([{ queueEntryId: 'q1', reason: 'below_confidence_floor' }]);
    expect(exec.planCalls).toHaveLength(0);
  });
  it('the salon kill switch and the platform switch stop split visits too', async () => {
    const a = await make({ patch: { autoEnabled: true }, scan: [scanEntry('q1')] });
    await a.svc.killAutoAssignment(ctx(PERMS, 'MANAGER'), { scope: 'salon', reason: 'pause' });
    expect(await a.svc.runAutoAssignment(ctx())).toMatchObject({ allowed: false, blockedBy: 'salon_kill_switch', assigned: 0 });
    expect(a.exec.planCalls).toHaveLength(0);
    const b = await make({ patch: { autoEnabled: true }, scan: [scanEntry('q1')] });
    b.settings.platformDisabled = true;
    expect(await b.svc.runAutoAssignment(ctx())).toMatchObject({ allowed: false, blockedBy: 'platform', assigned: 0 });
    expect(b.exec.planCalls).toHaveLength(0);
  });
});

describe('the boards: suggest() and Auto Balance', () => {
  it('suggest: split Best Match with both names only when no single technician covers the visit', async () => {
    const { svc } = await make();
    const s = (await svc.suggest(ctx(), ['q1'])).q1;
    expect(s).toMatchObject({ mode: 'split', technicianId: 'tm' });
    expect(new Set(s.technicianNames)).toEqual(new Set(['Pia', 'Mo']));
    const one = await make({ candidates: [PIA, MO, ALL] });
    expect((await one.svc.suggest(ctx(), ['q1'])).q1).toMatchObject({ mode: 'single', technicianId: 'ta', technicianNames: ['Ann'] });
  });
  it('Auto Balance skips a split visit with the plain reason', async () => {
    const { svc } = await make({ scan: [scanEntry('q1', { serviceIds: SERVICES.map((s) => s.serviceId) } as any)] });
    const r = await svc.balance(ctx());
    expect(r.unassignable).toEqual([{ queueItemId: 'q1', reason: 'Needs a multi-technician plan — open the guest' }]);
    expect(r.proposals).toEqual([]);
  });
});

// MT2: the engine judged each line from "now"; the plan judges it at its planned window. Mo's shift ends in 45 — the
// manicure (0–40) fits, the nail art after it (40–60) does not.
describe('shift end over the planned window (MT2)', () => {
  const MO45 = tech('tm', 'Mo', ['mani', 'art'], { shiftEndsInMinutes: 45 });
  const PAST = 'Shift ends in ~45 min, before this service would finish';
  it('planVisit: the nail art after the manicure keeps Mo with the shift-end warning → staff review; ETA follows the sequence', async () => {
    const { svc } = await make({ candidates: [PIA, MO45] });
    const v = (await svc.planVisit(ctx(), 'q1')).visit!;
    const art = v.lines.find((l) => l.serviceId === 'nailart')!;
    expect(art).toMatchObject({ technicianId: 'tm', timing: 'after', afterServiceId: 'manicure', estimatedStartInMinutes: 40, estimatedEndInMinutes: 60, warnings: [PAST] });
    expect(v.lines.find((l) => l.serviceId === 'manicure')!.warnings).toEqual([]);
    expect(v.warnings).toEqual([`Nailart: ${PAST}`]);
    expect(v.requiredAction).toBe('staff_review');
    expect(v.estimatedFinishInMinutes).toBe(60);
  });
  it('planVisit: an alternate who finishes the nail art within shift takes it', async () => {
    const { svc } = await make({ candidates: [PIA, MO45, tech('tx', 'Xia', ['art'], { shiftEndsInMinutes: 240 })] });
    const v = (await svc.planVisit(ctx(), 'q1')).visit!;
    expect(v.lines.find((l) => l.serviceId === 'nailart')).toMatchObject({ technicianId: 'tx', timing: 'after', afterServiceId: 'manicure', estimatedStartInMinutes: 40, estimatedEndInMinutes: 60, warnings: [] });
    expect(v.warnings).toEqual([]);   // (two close nail-art candidates keep the line's confidence low — that, not the shift, decides review)
  });
  it('the auto-run refuses such a plan (plan_needs_review) — nothing written', async () => {
    const { svc, exec, repo } = await make({ patch: { autoEnabled: true }, scan: [scanEntry('q1')], candidates: [PIA, MO45] });
    const r = await svc.runAutoAssignment(ctx());
    expect(r.assigned).toBe(0);
    expect(r.skipped).toEqual([{ queueEntryId: 'q1', reason: 'plan_needs_review' }]);
    expect(exec.planCalls).toHaveLength(0);
    expect(exec.calls).toHaveLength(0);
    expect(await repo.queryDecisions(ctx(), {})).toEqual([]);
  });
  it('suggest(): the split Best Match carries the warning and needs review', async () => {
    const { svc } = await make({ candidates: [PIA, MO45] });
    const s = (await svc.suggest(ctx(), ['q1'])).q1;
    expect(s).toMatchObject({ mode: 'split', requiredAction: 'staff_review' });
    expect(s.reasons).toContain(`Nailart: ${PAST}`);
  });
});
