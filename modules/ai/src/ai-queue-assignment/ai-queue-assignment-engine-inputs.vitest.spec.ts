// ai-queue-assignment-engine-inputs.vitest.spec.ts — BUILD_PLAN Phase 6: the engine on the enriched queue inputs.
// Requested / previous technician reach the engine (audit bug 1), the hard rules the audit found unsupplied (real branch,
// lock, blocked, break, station, max concurrent), the ranking signals (rotation fixed order + last served, availability,
// shift end) and the versions recorded on every envelope. Also the board recommender (suggest / balance).
import { describe, it, expect } from 'vitest';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { InMemoryQueueAssignmentRepository } from './ai-queue-assignment.repository';
import { InMemoryQueueDataAdapter, InMemoryQueueScanAdapter, type QueueCandidateInput, type QueueEntryInput, type ScanEntryData } from './ai-queue-assignment.ports';
import { InMemoryQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import { InMemoryQueueAssignmentSettings } from './ai-queue-assignment-settings';
import { mapAssignmentInputs } from './ai-queue-assignment.adapters';
import { computeRotation, fixedOrderPositions } from './ai-queue-assignment-rotation';
import { EngineQueueRecommender } from './ai-queue-assignment-recommender';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';

const PERMS = ['ai_queue_assignment.view', 'ai_queue_assignment.recommend', 'ai_queue_assignment.assign', 'ai_queue_assignment.override', 'ai_queue_assignment.manage_rules'];
const ctx = (perms = PERMS): QueueAssignmentContext => ({ tenantId: 'A', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });
const tech = (id: string, o: Partial<QueueCandidateInput> = {}): QueueCandidateInput => ({ technicianId: id, name: id.toUpperCase(), branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false, ...o });
const entry = (o: Partial<QueueEntryInput> = {}): QueueEntryInput => ({ queueEntryId: 'q1', branchId: 'b1', version: 3, requiredCategories: ['nails'], serviceDurationMinutes: 30, requestedTechnicianId: null, ...o });

function svcWith(candidates: QueueCandidateInput[], e: Partial<QueueEntryInput> = {}, settings = new InMemoryQueueAssignmentSettings(), repo = new InMemoryQueueAssignmentRepository()) {
  const data = new InMemoryQueueDataAdapter({ q1: { entry: entry(e), candidates } });
  return { svc: new QueueAssignmentService(repo, data, new InMemoryQueueAssignmentEntitlement(() => true), undefined, { settings }), repo, settings };
}

describe('bug 1 — the requested / previous technician reach the engine', () => {
  it('the adapter keeps the contract fields of QueueService.assignmentInputs', () => {
    const m = mapAssignmentInputs({
      entry: { queueItemId: 'q1', branchId: 'b1', version: 4, requiredCategories: ['nails'], serviceDurationMinutes: 45, requestedTechnicianId: 't2', previousTechnicianId: 't3',
        isVip: true, isAppointment: true, appointmentStartAt: '2026-10-07T18:30:00.000Z', lateMinutes: 5, groupId: 'g1', groupSize: 2, lock: { technicianId: 't2', reason: 'regular' }, serviceIds: ['s1'] },
      candidates: [{ technicianId: 't2', name: 'Lee', branchId: 'b9', available: true, skills: ['nails'], activeAssignments: 1, isPrevious: false, rotationIndex: 2, assignedMinutes: 60,
        availableInMinutes: 15, shiftEndsInMinutes: 200, onBreak: false, blocked: true, maxConcurrent: 2, nextAppointmentInMinutes: 90 }],
    });
    expect(m.entry).toMatchObject({ queueEntryId: 'q1', version: 4, requestedTechnicianId: 't2', previousTechnicianId: 't3', isVip: true, isAppointment: true,
      appointmentStartAt: '2026-10-07T18:30:00.000Z', groupId: 'g1', lock: { technicianId: 't2', reason: 'regular' }, serviceIds: ['s1'] });
    expect(m.candidates[0]).toMatchObject({ branchId: 'b9', blocked: true, maxConcurrent: 2, availableInMinutes: 15, shiftEndsInMinutes: 200, rotationIndex: 2, nextAppointmentInMinutes: 90 });
  });
  // merge Oct 12 2026: the REAL clock reaches the engine when the queue knows it (true/false); unknown stays absent → legacy `available`
  it('clockedIn is carried only when the queue knows it, and a clocked-out technician is not eligible even if flagged available', async () => {
    const m = mapAssignmentInputs({ entry: { queueItemId: 'q1' }, candidates: [
      { technicianId: 'a', name: 'A', available: true, skills: [], clockedIn: false },
      { technicianId: 'b', name: 'B', available: true, skills: [], clockedIn: true },
      { technicianId: 'c', name: 'C', available: true, skills: [] },
    ] });
    expect(m.candidates.map((c) => c.clockedIn)).toEqual([false, true, undefined]);
    const both = await svcWith([tech('t1'), tech('t2', { activeAssignments: 1 })]).svc.recommend(ctx(), 'q1');
    expect(both.recommended?.technicianId).toBe('t1');   // control: the idle t1 wins when she is on the clock
    const env = await svcWith([tech('t1', { clockedIn: false }), tech('t2', { activeAssignments: 0 })]).svc.recommend(ctx(), 'q1');
    expect(env.recommended?.technicianId).toBe('t2');
  });
  it('the requested technician wins when eligible', async () => {
    const { svc } = svcWith([tech('t1'), tech('t2', { activeAssignments: 0 })], { requestedTechnicianId: 't2' });
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.recommended?.technicianId).toBe('t2');
    expect(env.recommended?.reasons).toContain('Requested by guest');
    expect(env.requestedTechnicianId).toBe('t2');
  });
  it('the requested technician busy → someone else is suggested only for staff review, naming the request', async () => {
    const { svc } = svcWith([tech('t1'), tech('t2', { onBreak: true })], { requestedTechnicianId: 't2' });
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.recommended?.technicianId).toBe('t1');
    expect(env.requiredAction).toBe('staff_review');
    expect(env.warnings.join(' ')).toMatch(/asked for T2 \(on break\)/);
  });
  it('the previous technician (from the entry) gets the "served before" preference', async () => {
    const { svc } = svcWith([tech('t1'), tech('t2')], { previousTechnicianId: 't2' });
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.recommended?.technicianId).toBe('t2');
    expect(env.recommended?.reasons).toContain('Served this guest before');
  });
});

describe('hard rules on the real inputs', () => {
  const failsOf = async (c: QueueCandidateInput, e: Partial<QueueEntryInput> = {}) => {
    const { svc } = svcWith([c, tech('ok')], e);
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.recommended?.technicianId).toBe('ok');
    return env.ineligible?.find((i) => i.technicianId === c.technicianId)?.reasons ?? [];
  };
  it('a technician of ANOTHER branch fails wrong_branch (the check used to be vacuous)', async () => {
    expect(await failsOf(tech('x', { branchId: 'b2' }))).toContain('wrong branch');
  });
  it('blocked, on break, station unavailable', async () => {
    expect(await failsOf(tech('x', { blocked: true }))).toContain('blocked');
    expect(await failsOf(tech('x', { onBreak: true }))).toContain('on break');
    expect(await failsOf(tech('x', { stationAvailable: false }))).toContain('station unavailable');
  });
  it('max concurrent: below the limit is eligible, at the limit is at capacity', async () => {
    expect(await failsOf(tech('x', { activeAssignments: 2, maxConcurrent: 2 }))).toContain('at capacity');
    const { svc } = svcWith([tech('x', { activeAssignments: 1, maxConcurrent: 2 })]);
    expect((await svc.recommend(ctx(), 'q1')).recommended?.technicianId).toBe('x');
  });
  it('a lock pins the guest to its technician; everyone else is locked out', async () => {
    const { svc } = svcWith([tech('t1'), tech('t2'), tech('t3')], { lock: { technicianId: 't3', reason: 'regular client' } });
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.recommended?.technicianId).toBe('t3');
    expect(env.alternates).toEqual([]);
    expect(env.ineligible?.map((i) => i.technicianId).sort()).toEqual(['t1', 't2']);
  });
  it('a lock to nobody → no suggestion, and the reason says so', async () => {
    const { svc } = svcWith([tech('t1')], { lock: { technicianId: null, reason: 'waiting for her friend' } });
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.recommended).toBeNull();
    expect(env.conflicts[0]).toMatch(/Locked — do not assign anyone yet \(waiting for her friend\)/);
  });
});

describe('ranking signals', () => {
  it('fixed order is read from the settings and moves on from the technician served last', () => {
    expect(fixedOrderPositions(['a', 'b', 'c'], 'b')).toEqual({ c: 0, a: 1, b: 2 });
    expect(fixedOrderPositions(['a', 'b', 'c'], null)).toEqual({ a: 0, b: 1, c: 2 });
    const cand = (id: string, idx: number | null = null) => ({ technicianId: id, assignedMinutes: 0, activeAssignments: 0, availableInMinutes: 0, fixedRotationIndex: idx });
    // not on the list → after the list, by the queue's own turn index
    expect(computeRotation('fixed_order', [cand('z', 0), cand('a'), cand('b'), cand('c')], { fixedOrder: ['a', 'b', 'c'], lastServedTechnicianId: 'a' }))
      .toEqual({ b: 0, c: 1, a: 2, z: 3 });
  });
  it('service: fixed_order policy + last served picks the next technician in turn', async () => {
    const settings = new InMemoryQueueAssignmentSettings();
    await settings.update({ tenantId: 'A', branchId: 'b1' }, { rotationPolicy: 'fixed_order', fixedOrder: ['t1', 't2', 't3'] }, { userId: 'u1' });
    const repo = new InMemoryQueueAssignmentRepository();
    // t1 was served last (an applied decision)
    await repo.recordDecision(ctx(), { recommendationId: 'r0', queueEntryId: 'q0', decision: 'accepted', chosenTechnicianId: 't1', reason: null, decidedBy: 'u1', applied: true });
    const { svc } = svcWith([tech('t1'), tech('t2'), tech('t3')], {}, settings, repo);
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.recommended?.technicianId).toBe('t2');
    expect(env.recommended?.reasons).toContain('Next up in rotation');
  });
  it('free sooner ranks higher (availableInMinutes is a real signal now)', async () => {
    const { svc } = svcWith([tech('t1', { availableInMinutes: 25, maxConcurrent: 2, activeAssignments: 0 }), tech('t2', { availableInMinutes: 0 })]);
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.recommended?.technicianId).toBe('t2');
    expect(env.recommended?.reasons).toContain('Free now');
    expect(env.recommended?.estimatedStartInMinutes).toBe(0);
  });
  it('a shift that ends before the service would finish → a clear warning and a lower rank', async () => {
    const { svc } = svcWith([tech('t1', { shiftEndsInMinutes: 20 }), tech('t2', { shiftEndsInMinutes: 300 })]);
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.recommended?.technicianId).toBe('t2');
    expect(env.alternates.find((a) => a.technicianId === 't1')?.warnings.join(' ')).toMatch(/before this service would finish/);
  });
});

describe('versions on the envelope', () => {
  it('records the settings version and the guest version the suggestion was made on', async () => {
    const settings = new InMemoryQueueAssignmentSettings();
    await settings.update({ tenantId: 'A', branchId: null }, { waitExceededMin: 25 }, { userId: 'u1' });
    await settings.update({ tenantId: 'A', branchId: 'b1' }, { autoMaxPerRun: 3 }, { userId: 'u1' });
    await settings.update({ tenantId: 'A', branchId: 'b1' }, { autoMaxPerRun: 4 }, { userId: 'u1' });
    const { svc, repo } = svcWith([tech('t1')], { version: 7 }, settings);
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.configVersion).toBe('1.2');
    expect(env.queueVersion).toBe(7);
    expect((await repo.getRecommendation(ctx(), env.recommendationId))?.envelope.configVersion).toBe('1.2');
  });
});

describe('the board recommender (QUEUE_RECOMMENDER)', () => {
  it('suggest computes without persisting; no AI permission → no suggestion (never a second scorer)', async () => {
    const { svc, repo } = svcWith([tech('t1'), tech('t2', { activeAssignments: 1, maxConcurrent: 2 })]);
    const rec = new EngineQueueRecommender(() => svc);
    const out = await rec.suggest(ctx(), ['q1', 'missing']);
    expect(out.q1).toMatchObject({ technicianId: 't1', name: 'T1', requiredAction: expect.any(String) });
    expect(out.missing).toBeUndefined();
    expect(await repo.latestForEntry(ctx(), 'q1')).toBeNull();
    expect(await rec.suggest(ctx(['pos.queue.view']), ['q1'])).toEqual({});
    expect(await new EngineQueueRecommender(() => null).suggest(ctx(), ['q1'])).toEqual({});
  });
  it('M4: a board batch reads the branch-wide inputs ONCE (inputs, settings) and answers exactly what each guest alone gets', async () => {
    const cands = [tech('t1'), tech('t2', { activeAssignments: 1, maxConcurrent: 2 }), tech('t3', { onBreak: true })];
    const rows: Record<string, any> = {};
    for (let i = 1; i <= 12; i++) rows['q' + i] = { entry: entry({ queueEntryId: 'q' + i, requestedTechnicianId: i % 4 === 0 ? 't2' : null }), candidates: cands };
    const calls = { one: 0, many: 0, settings: 0 };
    class Counting extends InMemoryQueueDataAdapter {
      async getInputs(c: QueueAssignmentContext, id: string) { calls.one++; return super.getInputs(c, id); }
      async getInputsMany(c: QueueAssignmentContext, ids: string[]) { calls.many++; const o: Record<string, any> = {}; for (const id of ids) { const r = await super.getInputs(c, id); if (r) o[id] = r; } return o; }
    }
    const settings = new InMemoryQueueAssignmentSettings();
    const eff = settings.effective.bind(settings); (settings as any).effective = async (...a: any[]) => { calls.settings++; return (eff as any)(...a); };
    const batched = new QueueAssignmentService(new InMemoryQueueAssignmentRepository(), new Counting(rows), new InMemoryQueueAssignmentEntitlement(() => true), undefined, { settings });
    const ids = [...Object.keys(rows), 'missing'];
    const out = await batched.suggest(ctx(), ids);
    expect(calls.many).toBe(1);
    expect(calls.one).toBe(1);                       // only the guest the batch could not read is read alone (and is absent)
    expect(calls.settings).toBe(1);
    expect(out.missing).toBeUndefined();
    const single = new QueueAssignmentService(new InMemoryQueueAssignmentRepository(), new InMemoryQueueDataAdapter(rows), new InMemoryQueueAssignmentEntitlement(() => true), undefined, { settings: new InMemoryQueueAssignmentSettings() });
    for (const id of Object.keys(rows)) expect(out[id], id).toEqual((await single.suggest(ctx(), [id]))[id]);
  });
  it('balance never proposes a technician past capacity and leaves out guests who asked for someone else', async () => {
    const scan = (id: string, wait: number): ScanEntryData => ({ queueEntryId: id, waitMinutes: wait, status: 'waiting', assignedTechnicianId: null, isAppointment: false, updatedAt: new Date().toISOString() });
    const cands = [tech('t1', { maxConcurrent: 1 }), tech('t2', { maxConcurrent: 1 })];
    const data = new InMemoryQueueDataAdapter({
      q1: { entry: entry({ queueEntryId: 'q1' }), candidates: cands },
      q2: { entry: entry({ queueEntryId: 'q2' }), candidates: cands },
      q3: { entry: entry({ queueEntryId: 'q3' }), candidates: cands },
      q4: { entry: entry({ queueEntryId: 'q4', requestedTechnicianId: 't9' }), candidates: [...cands, tech('t9', { onBreak: true })] },
    });
    const svc = new QueueAssignmentService(new InMemoryQueueAssignmentRepository(), data, new InMemoryQueueAssignmentEntitlement(() => true), undefined,
      { scan: new InMemoryQueueScanAdapter([scan('q1', 30), scan('q2', 20), scan('q3', 10), scan('q4', 40)]) });
    const out = await new EngineQueueRecommender(() => svc).balance(ctx());
    expect(out.proposals.map((p) => p.queueItemId)).toEqual(['q1', 'q2']);            // longest wait first
    expect(new Set(out.proposals.map((p) => p.technicianId)).size).toBe(2);         // one guest each — capacity 1
    expect(out.unassignable.map((u) => u.queueItemId).sort()).toEqual(['q3', 'q4']);
    expect(out.unassignable.find((u) => u.queueItemId === 'q4')?.reason).toMatch(/asked for T9/);
  });
});

describe('fixed order — the queue\'s lastServedAt (manual assignments included) decides whose turn it is', () => {
  it('the most recently served technician goes to the back of the fixed order', async () => {
    const settings = new InMemoryQueueAssignmentSettings();
    await settings.update({ tenantId: 'A', branchId: 'b1' }, { rotationPolicy: 'fixed_order', fixedOrder: ['t1', 't2', 't3'] }, { userId: 'u1' });
    const { svc } = svcWith([tech('t1', { lastServedAt: '2026-10-07T15:00:00Z' }), tech('t2', { lastServedAt: '2026-10-07T16:00:00Z' }), tech('t3', { lastServedAt: null })], {}, settings);
    expect((await svc.recommend(ctx(), 'q1')).recommended?.technicianId).toBe('t3');   // t2 served last → t3 is next
  });
});
