// queue-assign-conflict.vitest.spec.ts — Smooth Refresh spec §77: assignment is a compare-and-set, and a board that
// showed a different assignee is refused with VERSION_CONFLICT instead of silently reassigning the guest.
import { describe, it, expect } from 'vitest';
import { QueueService } from './queue.service';
import { InMemoryQueueRepository } from './queue.repository';
import { QueueAssignmentConflict } from './queue.dto';

// Merge Oct 12 2026 (R1): `managerOverride` is honoured only with pos.booking.override_conflict — the fixture holds it explicitly.
const ctx = { tenantId: 'luxe001', branchId: 'br1', userId: 'u1', role: 'OWNER', permissions: ['pos.booking.override_conflict', 'pos.queue.view', 'pos.queue.create', 'pos.queue.assign_technician'] } as any;

async function setup() {
  const repo = new InMemoryQueueRepository();
  const svc = new QueueService(repo as any);
  const techs = await repo.technicians(ctx);
  const st = await svc.getState(ctx, {} as any);
  const item = st.queue.items.find((i: any) => ['waiting', 'called'].includes(i.status) && !i.assignedTechnicianId);
  return { repo, svc, techs, item };
}

describe('queue assignment optimistic concurrency (spec §77)', () => {
  it('a stale board (it showed "unassigned", the guest now has a technician) is refused with VERSION_CONFLICT naming the current one', async () => {
    const { svc, techs, item } = await setup();
    if (!item || techs.length < 2) return expect.fail('fixture has no unassigned waiting guest / two technicians');
    await svc.assignTechnician(ctx, item.queueItemId, { technicianId: techs[0].technicianId, managerOverride: true, expectedTechnicianId: null });
    const err = await svc.assignTechnician(ctx, item.queueItemId, { technicianId: techs[1].technicianId, managerOverride: true, expectedTechnicianId: null }).catch((e) => e);
    expect(err).toBeInstanceOf(QueueAssignmentConflict);
    expect(err.code).toBe('VERSION_CONFLICT');
    expect(err.currentTechnicianId).toBe(techs[0].technicianId);
  });
  it('a board that saw the current assignee may reassign; an older client (no expectedTechnicianId) still works', async () => {
    const { svc, techs, item } = await setup();
    if (!item || techs.length < 2) return expect.fail('fixture has no unassigned waiting guest / two technicians');
    await svc.assignTechnician(ctx, item.queueItemId, { technicianId: techs[0].technicianId, managerOverride: true });
    const moved = await svc.assignTechnician(ctx, item.queueItemId, { technicianId: techs[1].technicianId, managerOverride: true, expectedTechnicianId: techs[0].technicianId });
    expect((moved as any).assignedTechnicianId ?? (moved as any).item?.assignedTechnicianId).toBe(techs[1].technicianId);
  });
});
