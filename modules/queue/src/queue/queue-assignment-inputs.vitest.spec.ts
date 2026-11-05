// queue-assignment-inputs.vitest.spec.ts — BUILD_PLAN Phase 6, audit bugs 1, 3, 4 and parallel implementation 1.
// The engine's inputs came from a 20-row board page, the requested / previous technician were read from fields
// detail() never returned (always null), every technician was given the CALLER's branch, and the board ran its own
// "Best Match" scorer. Pinned here on the in-memory repository (the Postgres reads: queue-phase6.pgtest).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { InMemoryQueueRepository, type QueueContext } from './queue.repository';
import { QueueService } from './queue.service';
import { TechQueueService } from '../tech-queue/tech-queue.service';
import type { QueueRecommenderPort } from './queue-recommender';

const PERMS = ['pos.queue.view', 'pos.queue.create', 'pos.queue.assign_technician', 'pos.tech_queue.view'];
const ctx = (branchId = 'br1'): QueueContext => ({ tenantId: 'luxe001', branchId, userId: 'u', role: 'OWNER', permissions: PERMS });

describe('assignmentInputs carries the real signals (bug 1)', () => {
  it('requested AND previous technician reach the engine', async () => {
    const repo = new InMemoryQueueRepository(); const svc = new QueueService(repo);
    repo.previousVisits.set('c_returning', 'tech_ava');
    const row = await svc.create(ctx(), { customerId: 'c_returning', customerName: 'Ruth', source: 'walk_in', serviceIds: ['svc_mani'], requestedTechnicianId: 'tech_mia' });
    const r = await svc.assignmentInputs(ctx(), row.queueItemId);
    expect(r.entry.requestedTechnicianId).toBe('tech_mia');
    expect(r.entry.previousTechnicianId).toBe('tech_ava');
    expect(r.candidates.find((c) => c.technicianId === 'tech_ava')?.isPrevious).toBe(true);
    expect(r.candidates.find((c) => c.technicianId === 'tech_mia')?.isPrevious).toBe(false);
    expect(r.entry).toMatchObject({ version: 1, requiredCategories: ['Manicure'], serviceDurationMinutes: 45, isVip: false, isAppointment: false, serviceIds: ['svc_mani'], lock: null });
  });
  it("each technician carries their OWN branch, not the caller's", async () => {
    const repo = new InMemoryQueueRepository(); const svc = new QueueService(repo);
    const r = await svc.assignmentInputs(ctx('br_other'), 'q_5001');
    expect(r.candidates.every((c) => c.branchId === 'br1')).toBe(true);
  });
  it('every contract field is present on a candidate', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const c = (await svc.assignmentInputs(ctx(), 'q_5001')).candidates.find((x) => x.technicianId === 'tech_leo')!;
    expect(Object.keys(c).sort()).toEqual(['activeAssignments', 'assignedMinutes', 'available', 'availableInMinutes', 'blocked', 'branchId', 'isPrevious', 'lastServedAt', 'maxConcurrent', 'name', 'nextAppointmentInMinutes', 'onBreak', 'rotationIndex', 'shiftEndsInMinutes', 'skills', 'technicianId'].sort());
    // Leo is serving q_5006 (Gel Add-on, 15 min, started 10 min ago) → free in about 5 minutes, not "null"
    expect(c.availableInMinutes).toBeGreaterThanOrEqual(4);
    expect(c.availableInMinutes).toBeLessThanOrEqual(6);
  });
});

describe('no 20-row cap (bug 4)', () => {
  it('workload and the scan see all 30 active guests of a busy technician', async () => {
    const repo = new InMemoryQueueRepository(); const svc = new QueueService(repo);
    for (let i = 0; i < 30; i++) { const r = await svc.create(ctx(), { customerName: 'Guest ' + i, source: 'walk_in', serviceIds: ['svc_mani'] }); await svc.assignTechnician(ctx(), r.queueItemId, { technicianId: 'tech_mia' }); }
    const inputs = await svc.assignmentInputs(ctx(), 'q_5001');
    expect(inputs.candidates.find((c) => c.technicianId === 'tech_mia')!.activeAssignments).toBe(31);   // 30 + q_5005
    expect(inputs.candidates.find((c) => c.technicianId === 'tech_mia')!.assignedMinutes).toBe(30 * 45 + 100);
    const scan = await svc.scanEntries(ctx());
    expect(scan.length).toBe(36);                                    // 6 seeded (in service included) + 30
    expect(scan.some((e) => e.status === 'in_service')).toBe(true);
  });
  it('scan entries carry the real updated_at and the full contract shape (bug 3)', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const e = (await svc.scanEntries(ctx())).find((x) => x.queueEntryId === 'q_5004')!;
    expect(Date.now() - Date.parse(e.updatedAt)).toBeGreaterThan(4 * 60000);   // seeded 5 minutes ago — not "now"
    expect(Object.keys(e).sort()).toEqual(['appointmentStartAt', 'assignedTechnicianId', 'expectedDurationMinutes', 'groupId', 'isAppointment', 'isVip', 'lateMinutes', 'lock', 'queueEntryId', 'requestedTechnicianId', 'serviceIds', 'startedAt', 'status', 'updatedAt', 'version', 'waitMinutes'].sort());
  });
});

describe('suggestions come only from QUEUE_RECOMMENDER (parallel implementation 1)', () => {
  const engine = (): QueueRecommenderPort & { asked: string[][] } => {
    const e = { asked: [] as string[][], async suggest(_c: any, ids: string[]) { e.asked.push(ids); return Object.fromEntries(ids.map((id) => [id, { technicianId: 'tech_ava', name: 'Ava', confidence: 0.8, requiredAction: 'none', reasons: ['requested'] }])); }, async balance() { return { proposals: [], unassignable: [] }; } };
    return e;
  };
  it("the board's Best Match is the engine's, for unassigned waiting guests only", async () => {
    const eng = engine(); const svc = new QueueService(new InMemoryQueueRepository(), undefined, undefined, undefined, () => eng);
    const st = await svc.getState(ctx(), {});
    expect(eng.asked[0].sort()).toEqual(['q_5001', 'q_5002', 'q_5004']);
    expect(st.queue.items.find((i) => i.queueItemId === 'q_5001')).toMatchObject({ bestMatchTechnicianName: 'Ava', bestMatchTechnicianId: 'tech_ava' });
    expect(st.queue.items.find((i) => i.queueItemId === 'q_5003')?.bestMatchTechnicianName).toBeUndefined();
  });
  it('without an engine the board shows no suggestion', async () => {
    const st = await new QueueService(new InMemoryQueueRepository()).getState(ctx(), {});
    expect(st.queue.items.every((i) => i.bestMatchTechnicianName === undefined)).toBe(true);
  });
  it('the Tech Queue best match comes from the same engine', async () => {
    const eng = engine();
    const repo: any = { query: async () => ({ waitingGuests: [{ queueItemId: 'q_1', customerName: 'A' }, { queueItemId: 'q_2', customerName: 'B' }], technicianRows: [{ technicianId: 'tech_ava', avatarUrl: 'x.png' }] }) };
    const st: any = await new TechQueueService(repo, undefined, eng).getState(ctx() as any, {});
    expect(st.waitingGuests[0]).toMatchObject({ bestMatchTechnicianId: 'tech_ava', bestMatchTechnicianName: 'Ava', bestMatchAvatarUrl: 'x.png' });
    const none: any = await new TechQueueService(repo).getState(ctx() as any, {});
    expect(none.waitingGuests[0].bestMatchTechnicianName).toBeUndefined();
  });
  it('no queue source file imports or defines a technician scorer any more', () => {
    const root = join(__dirname, '..'); const hits: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(f) && !/spec\.ts$|test\.ts$/.test(f) && /recommendTechnician|buildAutoBalanceProposals/.test(readFileSync(p, 'utf8').replace(/\/\/.*$/gm, ''))) hits.push(p); } };
    walk(root);
    expect(hits).toEqual([]);
  });
});
