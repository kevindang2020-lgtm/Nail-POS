import { InMemoryTechQueueRepository, type TechQueueContext } from '../tech-queue/tech-queue.repository';
import { TechQueueService } from '../tech-queue/tech-queue.service';
import { describe, it, expect } from 'vitest';
import { InMemoryQueueRepository, type QueueContext } from './queue.repository';
import { QueueService } from './queue.service';

// The gap this spec closes: tech-web's push.ts registers device tokens explicitly so technicians "get
// New-Assignment pushes when the app is backgrounded" (its own words, spec §10/§32) — but nothing server-side
// ever dispatched one. Assignment (queue) and reassignment (tech queue) now push to the technician's user.
// The push port is structural, so a plain recording object stands in for PushService.

type Sent = { tenantId: string | null; userId: string; title: string; reference?: string; data?: Record<string, string> };
const recorder = () => {
  const sent: Sent[] = [];
  return { sent, push: { async dispatchToUser(tenantId: string | null, userId: string, msg: any) { sent.push({ tenantId, userId, title: msg.title, reference: msg.reference, data: msg.data }); return { ok: true }; } } };
};

// Merge Oct 12 2026 (R1): `managerOverride` is honoured only with pos.booking.override_conflict — the fixture holds it explicitly.
const qctx = (): QueueContext => ({ tenantId: 'luxe001', branchId: 'br1', userId: 'u', role: 'OWNER', permissions: ['pos.booking.override_conflict', 'pos.queue.view', 'pos.queue.assign_technician', 'pos.queue.call_next'] });

describe('queue assignTechnician → New-Assignment push', () => {
  it('dispatches to the assigned technician\'s user with the queue item reference', async () => {
    const { sent, push } = recorder();
    const svc = new QueueService(new InMemoryQueueRepository(), undefined, push);
    await svc.assignTechnician(qctx(), 'q_5001', { technicianId: 'tech_ava', managerOverride: true } as any);
    expect(sent.length).toBe(1);
    expect(sent[0].tenantId).toBe('luxe001');
    expect(sent[0].userId).toBe('user_tech_ava'); // in-memory repo maps tech → its linked user id
    expect(sent[0].title).toBe('New assignment');
    expect(sent[0].reference).toBe('queue_assignment');
    expect(sent[0].data?.queueItemId).toBe('q_5001');
  });

  it('a technician with no linked user account gets no push — and the assignment still succeeds', async () => {
    const { sent, push } = recorder();
    const repo = new InMemoryQueueRepository();
    (repo as any).technicianUserId = async () => null; // unlinked tech
    const svc = new QueueService(repo, undefined, push);
    const d = await svc.assignTechnician(qctx(), 'q_5001', { technicianId: 'tech_ava', managerOverride: true } as any);
    expect((d as any).assignedTechnicianName).toBeTruthy();
    expect(sent.length).toBe(0);
  });

  it('a push layer that throws never fails the assignment (best-effort)', async () => {
    const boom = { async dispatchToUser() { throw new Error('push down'); } };
    const svc = new QueueService(new InMemoryQueueRepository(), undefined, boom as any);
    const d = await svc.assignTechnician(qctx(), 'q_5002', { technicianId: 'tech_ava', managerOverride: true } as any);
    expect((d as any).assignedTechnicianName).toBe('Ava');
  });

  it('without a push layer wired (Nest-free construction), behavior is unchanged', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const d = await svc.assignTechnician(qctx(), 'q_5001', { technicianId: 'tech_ava', managerOverride: true } as any);
    expect((d as any).assignedTechnicianName).toBeTruthy();
  });
});

describe('tech-queue reassign → push to the receiving technician', () => {
  const tctx = (): TechQueueContext => ({ tenantId: 'luxe001', branchId: 'br1', userId: 'u', role: 'OWNER', permissions: ['pos.booking.override_conflict', 'pos.tech_queue.view', 'pos.tech_queue.reassign'] } as any);   // R1 (merge Oct 12 2026)

  it('dispatches to the NEW technician with the ticket reference', async () => {
    const { sent, push } = recorder();
    const svc = new TechQueueService(new InMemoryTechQueueRepository(), push);
    // Seeded fixtures (re-pinned, merge Oct 12 2026 R2 — skills are never overridable): tq_6002 is a PEDICURE Mia does not
    // hold, so it is refused even with the override; tq_6003 is Mia's Manicure ticket and tech_ava is Manicure-skilled (busy →
    // the override covers availability ONLY) → the valid reassign target.
    await expect(svc.reassign(tctx(), 'tq_6002', { technicianId: 'tech_mia', reason: 'coverage', managerOverride: true } as any)).rejects.toThrow(/not skilled/);
    await svc.reassign(tctx(), 'tq_6003', { technicianId: 'tech_ava', reason: 'coverage', managerOverride: true } as any);
    expect(sent.length).toBe(1);
    expect(sent[0].userId).toBe('user_tech_ava');
    expect(sent[0].reference).toBe('tech_queue_reassigned');
    expect(sent[0].data?.techQueueTicketId).toBe('tq_6003');
  });
});

describe('queue callNext → check-in-ready push to the customer', () => {
  it('dispatches to the queue item\'s customer account with the item reference', async () => {
    const { sent, push } = recorder();
    const svc = new QueueService(new InMemoryQueueRepository(), undefined, push);
    await svc.callNext(qctx(), 'q_5001', false);
    expect(sent.length).toBe(1);
    expect(sent[0].userId).toBe('user_c_q_5001'); // seeded item's customerId is 'c_' + id; in-memory maps → user
    expect(sent[0].title).toBe("You're up!");
    expect(sent[0].reference).toBe('checkin_ready');
    expect(sent[0].data?.queueItemId).toBe('q_5001');
  });

  it('a walk-in with no customer account gets no push — and the call still succeeds', async () => {
    const { sent, push } = recorder();
    const repo = new InMemoryQueueRepository();
    (repo as any).customerUserId = async () => null;
    const svc = new QueueService(repo, undefined, push);
    const d = await svc.callNext(qctx(), 'q_5002', false);
    expect((d as any).status).toBe('called');
    expect(sent.length).toBe(0);
  });
});

// BUILD_PLAN Phase 13 D (Constitution 6 §61, audit bug 9): a push lands on a lock screen — the customer's name never
// travels in it. Each producer here is run against its seeded fixture and the WHOLE message is searched for the name.
describe('§61 no customer name in a queue push (bug 9)', () => {
  const full = () => { const msgs: any[] = []; return { msgs, push: { async dispatchToUser(_t: string | null, _u: string, msg: any) { msgs.push(msg); return { ok: true }; } } }; };
  const tctx = (): TechQueueContext => ({ tenantId: 'luxe001', branchId: 'br1', userId: 'u', role: 'OWNER', permissions: ['pos.booking.override_conflict', 'pos.tech_queue.view', 'pos.tech_queue.reassign'] } as any);   // R1 (merge Oct 12 2026)

  it('assignTechnician (the DB-less fallback path) — typed QUEUE_ASSIGNMENT, no name', async () => {
    const { msgs, push } = full();
    const svc = new QueueService(new InMemoryQueueRepository(), undefined, push);
    const d: any = await svc.assignTechnician(qctx(), 'q_5001', { technicianId: 'tech_ava', managerOverride: true } as any);
    const name = String(d.customerName ?? d.customer?.name ?? '');
    expect(name.length).toBeGreaterThan(1);
    expect(msgs).toHaveLength(1);
    expect(JSON.stringify(msgs[0])).not.toContain(name);
    for (const part of name.split(/\s+/).filter((p) => p.length > 2)) expect(JSON.stringify(msgs[0])).not.toContain(part);
    expect(msgs[0].category).toBe('QUEUE_ASSIGNMENT');
  });
  it('tech-queue reassign — typed QUEUE_ASSIGNMENT, no name', async () => {
    const { msgs, push } = full();
    const svc = new TechQueueService(new InMemoryTechQueueRepository(), push);
    const d: any = await svc.reassign(tctx(), 'tq_6003', { technicianId: 'tech_ava', reason: 'coverage', managerOverride: true } as any);   // R2 re-pin: Ava holds Manicure
    const name = String(d.customerName ?? '');
    expect(name.length).toBeGreaterThan(1);
    expect(msgs).toHaveLength(1);
    for (const part of name.split(/\s+/).filter((p) => p.length > 2)) expect(JSON.stringify(msgs[0])).not.toContain(part);
    expect(msgs[0].category).toBe('QUEUE_ASSIGNMENT');
  });
  it('callNext — typed CHECK_IN_READY to the customer, no name', async () => {
    const { msgs, push } = full();
    const repo = new InMemoryQueueRepository();
    const svc = new QueueService(repo, undefined, push);
    const d: any = await svc.callNext(qctx(), 'q_5001', false);
    const name = String(d.customerName ?? '');
    for (const part of name.split(/\s+/).filter((p) => p.length > 2)) expect(JSON.stringify(msgs[0])).not.toContain(part);
    expect(msgs[0].category).toBe('CHECK_IN_READY');
  });
});
