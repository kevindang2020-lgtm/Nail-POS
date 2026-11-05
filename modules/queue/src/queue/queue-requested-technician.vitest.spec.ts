import { describe, it, expect } from 'vitest';
import { InMemoryQueueRepository, type QueueContext } from './queue.repository';
import { QueueService, ValidationError } from './queue.service';

const PERMS = ['pos.queue.view', 'pos.queue.create', 'pos.queue.assign_technician'];
const ctx = (): QueueContext => ({ tenantId: 'luxe001', branchId: 'br1', userId: 'u_owner', role: 'OWNER', permissions: PERMS });
const svc = () => new QueueService(new InMemoryQueueRepository());

describe('requested technician (§32)', () => {
  it('create records the requested technician and resolves its name', async () => {
    const s = svc();
    const row = await s.create(ctx(), { customerName: 'Olivia Brown', source: 'walk_in', requestedTechnicianId: 'tech_mia' } as any);
    const detail = await s.detail(ctx(), row.queueItemId);
    expect(detail?.requestedTechnicianName).toBe('Mia');
  });

  it('change to a specific technician, then clear to Any Available', async () => {
    const s = svc();
    const row = await s.create(ctx(), { customerName: 'Emma Wilson', source: 'walk_in' } as any);
    // initially Any (no requested tech)
    let d = await s.detail(ctx(), row.queueItemId);
    expect(d?.requestedTechnicianName).toBeUndefined();
    // change to Ava
    d = await s.changeRequestedTechnician(ctx(), row.queueItemId, { technicianId: 'tech_ava' });
    expect(d.requestedTechnicianName).toBe('Ava');
    // clear to Any Available (null)
    d = await s.changeRequestedTechnician(ctx(), row.queueItemId, { technicianId: null });
    expect(d.requestedTechnicianName).toBeUndefined();
  });

  it('rejects an unknown technician', async () => {
    const s = svc();
    const row = await s.create(ctx(), { customerName: 'Mia Johnson', source: 'walk_in' } as any);
    await expect(s.changeRequestedTechnician(ctx(), row.queueItemId, { technicianId: 'tech_nope' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires the assign permission', async () => {
    const s = svc();
    const row = await s.create(ctx(), { customerName: 'Ava T', source: 'walk_in' } as any);
    const noPerm = { ...ctx(), permissions: ['pos.queue.view'] };
    await expect(s.changeRequestedTechnician(noPerm, row.queueItemId, { technicianId: 'tech_mia' })).rejects.toBeTruthy();
  });
});
