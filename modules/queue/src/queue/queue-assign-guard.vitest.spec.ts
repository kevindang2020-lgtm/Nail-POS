import { describe, it, expect } from 'vitest';
import { InMemoryQueueRepository, type QueueContext } from './queue.repository';
import { QueueService, ValidationError } from './queue.service';

// Seeded items (in-memory): q_5001 waiting, q_5002 waiting, q_5004 called, q_5006 in_service (tech_leo).
// Merge Oct 12 2026 (R1): `managerOverride` is honoured only with pos.booking.override_conflict — the fixture holds it explicitly.
const ctx = (): QueueContext => ({ tenantId: 'luxe001', branchId: 'br1', userId: 'u', role: 'OWNER', permissions: ['pos.booking.override_conflict', 'pos.queue.view', 'pos.queue.assign_technician', 'pos.queue.cancel'] });

describe('assignTechnician concurrency/stale-action guard (§40)', () => {
  it('rejects assigning a guest already in service (racing manual+AI / stale click)', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    await expect(svc.assignTechnician(ctx(), 'q_5006', { technicianId: 'tech_mia', managerOverride: true } as any))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('allows assigning a guest that is still waiting', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const d = await svc.assignTechnician(ctx(), 'q_5001', { technicianId: 'tech_ava', managerOverride: true } as any);
    expect((d as any).assignedTechnicianName).toBeTruthy();
  });

  it('double-clicking Assign to the same technician yields one assignment, no error', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const c = ctx();
    await svc.assignTechnician(c, 'q_5002', { technicianId: 'tech_ava', managerOverride: true } as any);
    const d2 = await svc.assignTechnician(c, 'q_5002', { technicianId: 'tech_ava', managerOverride: true } as any);
    expect((d2 as any).assignedTechnicianName).toBe('Ava');
  });

  it('a guest cancelled between preview and assign can no longer be assigned', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const c = ctx();
    await svc.cancel(c, 'q_5004', { reason: 'left' } as any);
    await expect(svc.assignTechnician(c, 'q_5004', { technicianId: 'tech_ava', managerOverride: true } as any))
      .rejects.toBeInstanceOf(ValidationError);
  });
});
