// queue-transitions.vitest.spec.ts — BUILD_PLAN Phase 6: versioned, audited, idempotent, lock-aware transitions
// (contract "A → everyone"), on the in-memory twin of the repository. The Postgres behaviour (the trigger, the same
// transaction) is pinned by queue-phase6.pgtest.vitest.spec.ts; true concurrency by queue-phase6.postgres-race.
import { describe, it, expect } from 'vitest';
import { InMemoryQueueRepository, type QueueContext } from './queue.repository';
import { QueueService, ValidationError, ForbiddenError, QueueAssignmentConflict, QueueAssignmentLocked } from './queue.service';

// Merge Oct 12 2026 (R1): `managerOverride` is honoured only with pos.booking.override_conflict — the fixture holds it explicitly.
const STAFF = ['pos.booking.override_conflict', 'pos.queue.view', 'pos.queue.create', 'pos.queue.edit', 'pos.queue.assign_technician', 'pos.queue.update_priority', 'pos.queue.cancel', 'pos.queue.call_next'];
const desk = (): QueueContext => ({ tenantId: 'luxe001', branchId: 'br1', userId: 'u_desk', role: 'FRONT_DESK', permissions: STAFF });
const manager = (): QueueContext => ({ tenantId: 'luxe001', branchId: 'br1', userId: 'u_mgr', role: 'MANAGER', permissions: [...STAFF, 'ai_queue_assignment.override'] });
const setup = () => { const repo = new InMemoryQueueRepository(); return { repo, svc: new QueueService(repo) }; };

describe('every transition bumps the version and writes history + audit (bug 15)', () => {
  it('assign → version 2, one history row with from/to, one durable audit row', async () => {
    const { repo, svc } = setup();
    const d = await svc.assignTechnician(desk(), 'q_5001', { technicianId: 'tech_mia', reason: 'regular' });
    expect(d.version).toBe(2);
    const h = await repo.history(desk(), 'q_5001');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ version: 2, fromStatus: 'waiting', toStatus: 'assigned', fromTechnicianId: null, toTechnicianId: 'tech_mia', action: 'assign', source: 'staff', actorId: 'u_desk', reason: 'regular' });
    expect(repo.auditRows.filter((a) => a.entityId === 'q_5001').map((a) => a.actionType)).toEqual(['pos_queue_technician_assigned']);
  });
  it('call, priority, cancel each bump once', async () => {
    const { repo, svc } = setup();
    await svc.callNext(desk(), 'q_5002'); await svc.updatePriority(desk(), 'q_5002', { priority: 'high', reason: 'Running late for a flight' }); const d = await svc.cancel(desk(), 'q_5002', { reason: 'left' });
    expect(d.version).toBe(4);
    expect((await repo.history(desk(), 'q_5002')).map((x) => x.action)).toEqual(['call', 'priority', 'cancel']);
  });
  it('GET history answers with the rows in order', async () => {
    const { svc } = setup();
    await svc.assignTechnician(desk(), 'q_5001', { technicianId: 'tech_mia' });
    await svc.unassignTechnician(desk(), 'q_5001', { reason: 'wrong tech' });
    const r = await svc.history(desk(), 'q_5001');
    expect(r.history.map((x) => [x.action, x.version])).toEqual([['assign', 2], ['unassign', 3]]);
  });
});

describe('assignTechnician — the AI rules (bug 5), versions, idempotency', () => {
  it('an AI source never re-assigns a guest staff already assigned', async () => {
    const { svc } = setup();
    const e = await svc.assignTechnician(desk(), 'q_5003', { technicianId: 'tech_mia', source: 'auto_assign', expectedTechnicianId: 'tech_ava' }).catch((x) => x);
    expect(e).toBeInstanceOf(QueueAssignmentConflict);
    expect(e.message).toMatch(/already has a technician/);
  });
  it('an AI source must say which technician it expects', async () => {
    const { svc } = setup();
    await expect(svc.assignTechnician(desk(), 'q_5001', { technicianId: 'tech_mia', source: 'ai_suggestion' })).rejects.toBeInstanceOf(ValidationError);
  });
  it('a stale expectedVersion is refused with the current version', async () => {
    const { svc } = setup();
    await svc.updatePriority(desk(), 'q_5001', { priority: 'urgent', reason: 'Allergy flare — seat now' });   // version 2
    const e = await svc.assignTechnician(desk(), 'q_5001', { technicianId: 'tech_mia', expectedTechnicianId: null, expectedVersion: 1, source: 'ai_suggestion' }).catch((x) => x);
    expect(e).toBeInstanceOf(QueueAssignmentConflict);
    expect(e.currentVersion).toBe(2);
  });
  it('the same idempotency key → the same result, no second write', async () => {
    const { repo, svc } = setup();
    const a = await svc.assignTechnician(desk(), 'q_5001', { technicianId: 'tech_mia', expectedTechnicianId: null, source: 'ai_suggestion', idempotencyKey: 'dec-1' });
    const b = await svc.assignTechnician(desk(), 'q_5001', { technicianId: 'tech_mia', expectedTechnicianId: null, source: 'ai_suggestion', idempotencyKey: 'dec-1' });
    expect(b.version).toBe(a.version);
    expect((await repo.history(desk(), 'q_5001')).length).toBe(1);
    await expect(svc.assignTechnician(desk(), 'q_5002', { technicianId: 'tech_ava', idempotencyKey: 'dec-1' })).rejects.toThrow(/already used for another guest/);
  });
  it('a retried decision after the desk moved the guest replays — it never takes the guest back', async () => {
    const { repo, svc } = setup();
    await svc.assignTechnician(desk(), 'q_5001', { technicianId: 'tech_mia', expectedTechnicianId: null, source: 'ai_suggestion', idempotencyKey: 'dec-2' });
    await svc.assignTechnician(desk(), 'q_5001', { technicianId: 'tech_ava', expectedTechnicianId: 'tech_mia', managerOverride: true });   // the desk moves her
    const retry = await svc.assignTechnician(desk(), 'q_5001', { technicianId: 'tech_mia', expectedTechnicianId: null, source: 'ai_suggestion', idempotencyKey: 'dec-2' });
    expect(retry.assignedTechnicianId).toBe('tech_ava');
    expect((await repo.history(desk(), 'q_5001')).length).toBe(2);
  });
  it('a system context (the background auto-run) needs no user but is recorded as system', async () => {
    const { repo, svc } = setup();
    await svc.assignTechnician({ tenantId: 'luxe001', branchId: 'br1', userId: '', role: '', permissions: [], system: true }, 'q_5001', { technicianId: 'tech_mia', expectedTechnicianId: null, source: 'auto_assign' });
    expect((await repo.history(desk(), 'q_5001'))[0]).toMatchObject({ action: 'auto_assign', source: 'auto_assign' });
    expect(repo.auditRows.at(-1)).toMatchObject({ role: 'SYSTEM', userId: null });
  });
});

describe('assignment locks', () => {
  it('lock / unlock need ai_queue_assignment.override and a reason', async () => {
    const { svc } = setup();
    await expect(svc.lock(desk(), 'q_5001', { technicianId: 'tech_ava', reason: 'regular of Ava' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.lock(manager(), 'q_5001', { technicianId: 'tech_ava', reason: ' ' })).rejects.toBeInstanceOf(ValidationError);
  });
  it('a lock to Ava refuses Mia (409 ASSIGNMENT_LOCKED) — staff, AI and auto alike; Ava is fine', async () => {
    const { svc } = setup();
    const d = await svc.lock(manager(), 'q_5001', { technicianId: 'tech_ava', reason: 'regular of Ava' });
    expect(d.lock).toMatchObject({ technicianId: 'tech_ava', technicianName: 'Ava', reason: 'regular of Ava', lockedBy: 'u_mgr' });
    expect(d.version).toBe(2);
    for (const body of [{}, { source: 'ai_suggestion' as const, expectedTechnicianId: null }, { source: 'auto_assign' as const, expectedTechnicianId: null }]) {
      const e = await svc.assignTechnician(desk(), 'q_5001', { technicianId: 'tech_mia', ...body }).catch((x) => x);
      expect(e).toBeInstanceOf(QueueAssignmentLocked);
      expect(e.code).toBe('ASSIGNMENT_LOCKED');
    }
    expect((await svc.assignTechnician(desk(), 'q_5001', { technicianId: 'tech_ava', managerOverride: true })).assignedTechnicianId).toBe('tech_ava');
  });
  it('"nobody yet" refuses everyone; a manager override with the permission moves the guest, the auto-run never', async () => {
    const { svc } = setup();
    await svc.lock(manager(), 'q_5002', { technicianId: null, reason: 'waiting for her friend' });
    await expect(svc.assignTechnician(desk(), 'q_5002', { technicianId: 'tech_ava', managerOverride: true })).rejects.toBeInstanceOf(QueueAssignmentLocked);   // no permission
    await expect(svc.assignTechnician(manager(), 'q_5002', { technicianId: 'tech_ava', managerOverride: true, source: 'auto_assign', expectedTechnicianId: null })).rejects.toBeInstanceOf(QueueAssignmentLocked);
    const d = await svc.assignTechnician(manager(), 'q_5002', { technicianId: 'tech_ava', managerOverride: true });
    expect(d.assignedTechnicianId).toBe('tech_ava');
  });
  it('unlock releases it; scanEntries and the item show the lock while it holds', async () => {
    const { svc } = setup();
    await svc.lock(manager(), 'q_5001', { technicianId: 'tech_ava', reason: 'regular' });
    expect((await svc.scanEntries(desk())).find((e) => e.queueEntryId === 'q_5001')?.lock).toEqual({ technicianId: 'tech_ava', reason: 'regular' });
    const d = await svc.unlock(manager(), 'q_5001', { reason: 'Ava went home' });
    expect(d.lock).toBeNull();
    await expect(svc.unlock(manager(), 'q_5001', { reason: 'again' })).rejects.toThrow(/not locked/);
  });
});

describe('reorder, parties, multi-technician visits', () => {
  it('reorder sets positions 1..n and the board follows; a stale version refuses the whole order', async () => {
    const { svc } = setup();
    const r = await svc.reorder(desk(), { order: [{ queueItemId: 'q_5004', expectedVersion: 1 }, { queueItemId: 'q_5002' }, { queueItemId: 'q_5001' }] });
    expect(r.order.map((o) => [o.queueItemId, o.position, o.version])).toEqual([['q_5004', 1, 2], ['q_5002', 2, 2], ['q_5001', 3, 2]]);
    expect((await svc.items(desk(), {})).items.slice(0, 3).map((i) => i.queueItemId)).toEqual(['q_5004', 'q_5002', 'q_5001']);
    await expect(svc.reorder(desk(), { order: [{ queueItemId: 'q_5001', expectedVersion: 1 }] })).rejects.toBeInstanceOf(QueueAssignmentConflict);
    await expect(svc.reorder(desk(), { order: [{ queueItemId: 'q_5001' }, { queueItemId: 'q_5001' }] })).rejects.toBeInstanceOf(ValidationError);
  });
  it('a party of two is created, listed and stamped on each guest', async () => {
    const { svc } = setup();
    const g = await svc.createGroup(desk(), { label: 'Kim sisters', queueItemIds: ['q_5001', 'q_5002'] });
    expect(g).toMatchObject({ label: 'Kim sisters', size: 2, together: true, status: 'waiting' });
    expect((await svc.groups(desk())).map((x) => x.groupId)).toEqual([g.groupId]);
    expect((await svc.detail(desk(), 'q_5001')).groupId).toBe(g.groupId);
    await expect(svc.createGroup(desk(), { label: 'Solo', queueItemIds: ['q_5004'] })).rejects.toBeInstanceOf(ValidationError);
  });
  it('each service of a visit on its own technician', async () => {
    const { svc } = setup();
    const d = await svc.setServiceAssignments(desk(), 'q_5005', { assignments: [{ serviceId: 'svc_mani', technicianId: 'tech_mia' }, { serviceId: 'svc_pedi', technicianId: 'tech_ava' }] });
    expect(d.serviceAssignments).toMatchObject([
      { serviceId: 'svc_mani', serviceName: 'Signature Manicure', technicianId: 'tech_mia', technicianName: 'Mia', status: 'assigned', sequence: 0, timing: 'parallel' },
      { serviceId: 'svc_pedi', serviceName: 'Spa Pedicure', technicianId: 'tech_ava', technicianName: 'Ava', status: 'assigned', sequence: 1, timing: 'parallel' },
    ]);
    await expect(svc.setServiceAssignments(desk(), 'q_5005', { assignments: [{ serviceId: 'svc_wax', technicianId: 'tech_leo' }] })).rejects.toThrow(/not on this visit/);
  });
});

describe('the customer accepts another technician', () => {
  const customer = (repo: InMemoryQueueRepository): QueueContext => ({ tenantId: 'luxe001', branchId: '', userId: 'user_c_q_5002', role: 'CUSTOMER', permissions: [] });
  it('only on their own visit; recorded with source customer', async () => {
    const { repo, svc } = setup();
    await svc.changeRequestedTechnician(desk(), 'q_5002', { technicianId: 'tech_leo' });
    const r = await svc.acceptAlternate(customer(repo), 'q_5002', { technicianId: 'tech_ava' });
    expect(r).toMatchObject({ queueItemId: 'q_5002', requestedTechnicianId: 'tech_ava', requestedTechnicianName: 'Ava' });
    expect((await repo.history(desk(), 'q_5002')).at(-1)).toMatchObject({ action: 'accept_alternate', source: 'customer' });
    await expect(svc.acceptAlternate(customer(repo), 'q_5001', { technicianId: 'tech_ava' })).rejects.toThrow(/could not find this visit/);
  });
  it('alternates are skill-matched and exclude the requested technician', async () => {
    const { repo, svc } = setup();
    await svc.changeRequestedTechnician(desk(), 'q_5002', { technicianId: 'tech_leo' });
    const v = await svc.customerAlternates(customer(repo), 'q_5002');   // Spa Pedicure → only Ava has Pedicure
    expect(v.requestedTechnicianName).toBe('Leo');
    expect(v.alternates.map((a) => a.name)).toEqual(['Ava']);
  });
});
