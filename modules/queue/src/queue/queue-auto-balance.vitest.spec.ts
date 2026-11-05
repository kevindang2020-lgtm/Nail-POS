// queue-auto-balance.vitest.spec.ts — BUILD_PLAN Phase 6, audit bugs 5 and 11 + parallel implementation 1.
// Auto Balance used its own scorer (buildAutoBalanceProposals over recommendTechnician): it never filled the workload
// map (bug 11), forced the requested technician to null, and its apply passed no expectedTechnicianId, so a guest
// assigned in the meantime was silently overwritten (bug 5). Now: the proposals are the AI engine's, and the apply
// never overwrites.
import { describe, it, expect } from 'vitest';
import { InMemoryQueueRepository, type QueueContext } from './queue.repository';
import { QueueService, ValidationError } from './queue.service';
import type { QueueRecommenderPort } from './queue-recommender';

// Merge Oct 12 2026 (R1): `managerOverride` is honoured only with pos.booking.override_conflict — the fixture holds it explicitly.
const ctx = (): QueueContext => ({ tenantId: 'luxe001', branchId: 'br1', userId: 'u', role: 'OWNER', permissions: ['pos.booking.override_conflict', 'pos.queue.view', 'pos.queue.assign_technician'] });
const engine = (proposals: { queueItemId: string; technicianId: string; technicianName: string }[], unassignable: { queueItemId: string; reason: string }[] = []): QueueRecommenderPort & { calls: number } => {
  const r = { calls: 0, async suggest() { return {}; }, async balance() { r.calls++; return { proposals: proposals.map((p) => ({ ...p, confidence: 0.9, reasons: ['skill match', 'least busy'] })), unassignable }; } };
  return r;
};

describe('Auto Balance preview comes from the AI engine only', () => {
  it('without a bound engine there are no proposals — never a second scorer', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const p = await svc.previewAutoBalance(ctx());
    expect(p.available).toBe(false);
    expect(p.proposals).toEqual([]);
    expect(p.unavailableReason).toMatch(/not available/);
    expect(p.summary.guestsConsidered).toBe(3);   // q_5001, q_5002, q_5004 are waiting / called and unassigned
  });
  it("maps the engine's proposals and carries what the preview saw (unassigned + version) for the apply", async () => {
    const eng = engine([{ queueItemId: 'q_5001', technicianId: 'tech_mia', technicianName: 'Mia' }], [{ queueItemId: 'q_5004', reason: 'No waxing technician on shift' }]);
    const svc = new QueueService(new InMemoryQueueRepository(), undefined, undefined, undefined, eng);
    const p = await svc.previewAutoBalance(ctx());
    expect(eng.calls).toBe(1);
    expect(p.available).toBe(true);
    expect(p.proposals).toHaveLength(1);
    expect(p.proposals[0]).toMatchObject({ queueItemId: 'q_5001', customerName: 'Grace Kim', technicianId: 'tech_mia', technicianName: 'Mia', reason: 'skill match, least busy', confidence: 0.9, expectedTechnicianId: null, expectedVersion: 1 });
    expect(p.proposals[0].addressesWaitMinutes).toBeGreaterThanOrEqual(24);
    expect(p.unassignable).toEqual([{ queueItemId: 'q_5004', customerName: 'Ivy Park', reason: 'No waxing technician on shift' }]);
    expect(p.summary).toMatchObject({ proposed: 1, guestsConsidered: 2 });
  });
  it('an engine that fails reads as "no suggestions", not as a broken board', async () => {
    const svc = new QueueService(new InMemoryQueueRepository(), undefined, undefined, undefined, { async suggest() { return {}; }, async balance() { throw new Error('AI queue assignment is turned off for this salon'); } });
    const p = await svc.previewAutoBalance(ctx());
    expect(p).toMatchObject({ available: false, unavailableReason: 'AI queue assignment is turned off for this salon', proposals: [] });
  });
});

describe('applyAutoBalance never applies without explicit confirmed proposals and never overwrites (bug 5)', () => {
  it('rejects an empty proposal list', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    await expect(svc.applyAutoBalance(ctx(), { proposals: [] })).rejects.toBeInstanceOf(ValidationError);
  });
  it('returns failures (not throws) when a single assignment is invalid', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const res = await svc.applyAutoBalance(ctx(), { proposals: [{ queueItemId: 'nope', technicianId: 'tech_mia' }] });
    expect(res.applied).toBe(0);
    expect(res.failures).toHaveLength(1);
  });
  it('a guest a receptionist assigned between preview and apply keeps their technician', async () => {
    const repo = new InMemoryQueueRepository(); const svc = new QueueService(repo);
    await svc.assignTechnician(ctx(), 'q_5001', { technicianId: 'tech_ava', managerOverride: true });   // the desk, meanwhile
    const res = await svc.applyAutoBalance(ctx(), { proposals: [{ queueItemId: 'q_5001', technicianId: 'tech_mia' }] });
    expect(res.applied).toBe(0);
    expect(res.failures[0].reason).toMatch(/already has a technician/);
    expect((await svc.detail(ctx(), 'q_5001')).assignedTechnicianId).toBe('tech_ava');
  });
  it('a confirmed proposal for a still-unassigned guest is applied and recorded as an AI suggestion', async () => {
    const repo = new InMemoryQueueRepository(); const svc = new QueueService(repo);
    const res = await svc.applyAutoBalance(ctx(), { proposals: [{ queueItemId: 'q_5001', technicianId: 'tech_mia', expectedTechnicianId: null, expectedVersion: 1 }] });
    expect(res).toEqual({ applied: 1, failures: [] });
    const h = await repo.history(ctx(), 'q_5001');
    expect(h.at(-1)).toMatchObject({ action: 'assign', source: 'ai_suggestion', toTechnicianId: 'tech_mia', reason: 'Auto Balance', version: 2 });
  });
});
