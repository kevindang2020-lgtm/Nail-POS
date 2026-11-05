// queue-round2.vitest.spec.ts — BUILD_PLAN Phase 6, round 2 (shapes the POS / tech / customer / kiosk screens coded
// against): the board row's lock, "is my requested technician busy — who else could take me", the 409 when the
// technician the guest picked was taken meanwhile, and unassign held to the same expected-technician / version rules
// as assign (the ops repair path).
import { describe, it, expect } from 'vitest';
import { InMemoryQueueRepository, type QueueContext } from './queue.repository';
import { QueueService, QueueAssignmentConflict, ValidationError } from './queue.service';

// Merge Oct 12 2026 (R1): `managerOverride` is honoured only with pos.booking.override_conflict — the fixture holds it explicitly.
const STAFF = ['pos.booking.override_conflict', 'pos.queue.view', 'pos.queue.create', 'pos.queue.edit', 'pos.queue.assign_technician', 'pos.queue.cancel'];
const desk = (): QueueContext => ({ tenantId: 'luxe001', branchId: 'br1', userId: 'u_desk', role: 'FRONT_DESK', permissions: STAFF });
const manager = (): QueueContext => ({ ...desk(), userId: 'u_mgr', role: 'MANAGER', permissions: [...STAFF, 'ai_queue_assignment.override'] });
const customer = (id: string): QueueContext => ({ tenantId: 'luxe001', branchId: '', userId: 'user_c_' + id, role: 'CUSTOMER', permissions: [] });
const setup = () => { const repo = new InMemoryQueueRepository(); return { repo, svc: new QueueService(repo) }; };

describe('board rows carry the lock and the assignment fields', () => {
  it('lock { technicianId, reason } next to locked; version / groupId / requested / assigned always present', async () => {
    const { svc } = setup();
    await svc.lock(manager(), 'q_5001', { technicianId: 'tech_ava', reason: 'regular of Ava' });
    const rows = (await svc.getState(desk(), {})).queue.items;
    const r = rows.find((x) => x.queueItemId === 'q_5001')!;
    expect(r).toMatchObject({ locked: true, lock: { technicianId: 'tech_ava', reason: 'regular of Ava' }, version: 2, groupId: null, requestedTechnicianId: null, assignedTechnicianId: null });
    const free = rows.find((x) => x.queueItemId === 'q_5003')!;
    expect(free).toMatchObject({ locked: false, lock: null, assignedTechnicianId: 'tech_ava' });
    for (const k of ['version', 'groupId', 'requestedTechnicianId', 'assignedTechnicianId', 'lock']) expect(Object.keys(free)).toContain(k);
  });
});

describe('requested technician busy → alternates (customer app, kiosk)', () => {
  it('the requested technician is busy: busy true, skill-matched alternates soonest first', async () => {
    const { svc } = setup();
    await svc.changeRequestedTechnician(desk(), 'q_5002', { technicianId: 'tech_leo' });   // Leo is serving q_5006 (≈5 min left)
    const v = await svc.customerQueueExtras(customer('q_5002'), 'q_5002');
    expect(v.requestedTechnician).toMatchObject({ technicianId: 'tech_leo', name: 'Leo', busy: true });
    expect(v.alternates.map((a) => a.name)).toEqual(['Ava']);                               // Spa Pedicure: only Ava has Pedicure
    expect(v.alternates[0].availableInMinutes).toBe(45);                                    // Liv Chen (45 min) is ahead of her
  });
  it('the requested technician is free: busy false and no alternates offered', async () => {
    const { svc } = setup();
    await svc.cancel(desk(), 'q_5003', { reason: 'left' });                                 // Ava's only guest left
    await svc.changeRequestedTechnician(desk(), 'q_5002', { technicianId: 'tech_ava' });
    const v = await svc.customerQueueExtras(customer('q_5002'), 'q_5002');
    expect(v.requestedTechnician).toEqual({ technicianId: 'tech_ava', name: 'Ava', busy: false, availableInMinutes: 0 });
    expect(v.alternates).toEqual([]);
  });
  it('a free requested technician offers no alternates even when others could do the service', async () => {
    const { svc } = setup();
    await svc.cancel(desk(), 'q_5003', { reason: 'left' });   // Ava free; Mia (also Manicure) is busy with q_5005
    const row = await svc.create(desk(), { customerId: 'c_new', customerName: 'Nell', source: 'walk_in', serviceIds: ['svc_mani'], requestedTechnicianId: 'tech_ava' });
    const v = await svc.customerQueueExtras({ ...customer('x'), userId: 'user_c_new' }, row.queueItemId);
    expect(v.requestedTechnician).toMatchObject({ technicianId: 'tech_ava', busy: false });
    expect(v.alternates).toEqual([]);
    await svc.changeRequestedTechnician(desk(), row.queueItemId, { technicianId: 'tech_mia' });   // now the requested one is busy
    expect((await svc.customerQueueExtras({ ...customer('x'), userId: 'user_c_new' }, row.queueItemId)).alternates.map((a) => a.technicianId)).toContain('tech_ava');
  });
  it('no requested technician: null and no alternates', async () => {
    const { svc } = setup();
    expect(await svc.customerQueueExtras(customer('q_5002'), 'q_5002')).toEqual({ requestedTechnician: null, alternates: [] });
  });
  it("another customer's visit is never readable", async () => {
    const { svc } = setup();
    await expect(svc.customerQueueExtras(customer('q_5001'), 'q_5002')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('accept-alternate: ok + technicianName, 409 when taken', () => {
  it('accepted: ok, technicianName = requestedTechnicianName, recorded as the customer', async () => {
    const { repo, svc } = setup();
    await svc.changeRequestedTechnician(desk(), 'q_5002', { technicianId: 'tech_leo' });
    const r = await svc.acceptAlternate(customer('q_5002'), 'q_5002', { technicianId: 'tech_ava' });
    expect(r).toEqual({ ok: true, queueItemId: 'q_5002', requestedTechnicianId: 'tech_ava', requestedTechnicianName: 'Ava', technicianName: 'Ava', version: 3 });
    expect((await repo.history(desk(), 'q_5002')).at(-1)).toMatchObject({ action: 'accept_alternate', source: 'customer' });
  });
  it('a technician who can no longer take the guest (off / not skilled) → 409', async () => {
    const { svc } = setup();
    const e = await svc.acceptAlternate(customer('q_5002'), 'q_5002', { technicianId: 'tech_leo' }).catch((x) => x);   // Leo: unavailable, no Pedicure
    expect(e).toBeInstanceOf(QueueAssignmentConflict);
    expect(e.message).toMatch(/just taken|no longer/);
  });
  it('the desk assigned the guest meanwhile → 409, the assignment stands', async () => {
    const { svc } = setup();
    await svc.assignTechnician(desk(), 'q_5002', { technicianId: 'tech_mia', managerOverride: true });
    await expect(svc.acceptAlternate(customer('q_5002'), 'q_5002', { technicianId: 'tech_ava' })).rejects.toBeInstanceOf(QueueAssignmentConflict);
    expect((await svc.detail(desk(), 'q_5002')).assignedTechnicianId).toBe('tech_mia');
  });
  it('the kiosk path (no customer session) records source kiosk', async () => {
    const { repo, svc } = setup();
    const kiosk: QueueContext = { tenantId: 'luxe001', branchId: 'br1', userId: 'kiosk:dev1', role: 'KIOSK', permissions: [] };
    const r = await svc.acceptAlternateForItem(kiosk, 'q_5002', 'tech_ava', 'kiosk');
    expect(r).toMatchObject({ ok: true, technicianName: 'Ava' });
    expect((await repo.history(desk(), 'q_5002')).at(-1)).toMatchObject({ action: 'accept_alternate', source: 'kiosk' });
  });
});

describe('unassignTechnician — expected technician / version / source (the ops repair path)', () => {
  it('a stale expectedTechnicianId or expectedVersion is refused; the repair is recorded as such', async () => {
    const { repo, svc } = setup();
    await expect(svc.unassignTechnician(desk(), 'q_5003', { reason: 'stuck', expectedTechnicianId: 'tech_mia' })).rejects.toBeInstanceOf(QueueAssignmentConflict);
    await expect(svc.unassignTechnician(desk(), 'q_5003', { reason: 'stuck', expectedVersion: 7 })).rejects.toBeInstanceOf(QueueAssignmentConflict);
    const d = await svc.unassignTechnician({ tenantId: 'luxe001', branchId: 'br1', userId: '', role: '', permissions: [], system: true }, 'q_5003',
      { reason: 'stuck assignment', expectedTechnicianId: 'tech_ava', expectedVersion: 1, source: 'repair' });
    expect(d.assignedTechnicianId).toBeNull();
    expect((await repo.history(desk(), 'q_5003')).at(-1)).toMatchObject({ action: 'unassign', source: 'repair', reason: 'stuck assignment', fromTechnicianId: 'tech_ava' });
  });
});
