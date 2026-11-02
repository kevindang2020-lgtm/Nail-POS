import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerLiveOperations } from './owner.dto';

// Owner Live Operations is read-only and ALWAYS tenant-scoped (server-derived). A passed branchId must be inside the
// owner's allowed subset; an all-locations request (no branchId) is permitted. The repo applies the branch scope.
const base: OwnerContext = { tenantId: 't1', userId: 'u_owner', role: 'OWNER', permissions: ['owner.dashboard.view'] } as any;
const fresh = () => ({ ...base });

const snap: OwnerLiveOperations = {
  branchId: null,
  counts: { waiting: 5, serving: 3, completedToday: 12 },
  techQueue: [{ technicianId: 'te1', technicianName: 'Mia', serviceLabel: 'Gel-X Full Set', customerName: 'Grace', elapsedMinutes: 14, paused: false }],
  liveQueue: [{ queueItemId: 'q1', customerName: 'Ana', isVip: true, serviceLabel: 'Pedicure', requestedTechnicianName: 'Mia', waitMinutes: 8, status: 'waiting' }],
  todaySoFar: { servicesDone: 12, walkIns: 4 },
  signals: { readyForCheckout: 2, delayedAppointments: 1 },
  generatedAt: '2026-06-27T15:00:00.000Z',
};

class FakeRepo extends InMemoryOwnerRepository {
  constructor(private allowed: string[] | null) { super(); }
  async allowedBranchIds() { return this.allowed; }
  async tenantTimezoneCurrency() { return { timezone: 'America/New_York', currency: 'USD' }; }
  async ownerLiveOperations(_ctx: OwnerContext, branchId: string | null) { return { ...snap, branchId }; }
}

describe('Owner Live Operations — read-only, branch-scoped', () => {
  it('blocks a branch the restricted owner cannot access', async () => {
    const svc = new OwnerService(new FakeRepo(['b1']));
    await expect(svc.liveOperations(fresh() as any, 'b2')).rejects.toThrow(/access to that branch/i);
  });

  it('returns the live snapshot for an allowed branch', async () => {
    const svc = new OwnerService(new FakeRepo(['b1']));
    const out = await svc.liveOperations(fresh() as any, 'b1');
    expect(out.branchId).toBe('b1');
    expect(out.counts).toEqual({ waiting: 5, serving: 3, completedToday: 12 });
    expect(out.techQueue[0].technicianName).toBe('Mia');
    expect(out.signals.delayedAppointments).toBe(1);
  });

  it('permits an all-locations request (no branchId) for an unrestricted owner', async () => {
    const svc = new OwnerService(new FakeRepo(null));
    const out = await svc.liveOperations(fresh() as any);
    expect(out.branchId).toBeNull();
    expect(out.liveQueue[0].isVip).toBe(true);
    expect(out.todaySoFar.walkIns).toBe(4);
  });
});
