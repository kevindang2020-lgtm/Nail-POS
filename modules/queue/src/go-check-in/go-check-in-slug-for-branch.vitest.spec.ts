import { describe, it, expect } from 'vitest';
import { InMemoryGoCheckInRepository } from './go-check-in.repository';
import { GoCheckInService } from './go-check-in.service';

// slugForBranch is the link that lets a paired customer-display device render Go Check-In while idle. It must be
// tenant/branch safe: only ever surface a slug for a device that belongs to the SAME tenant, preferring the device
// bound to the display's branch. slugForBranch only reads listDevices, so the CheckInService dep is unused here.
const A = 'tenant-A', B = 'tenant-B', BA1 = 'branch-A1', BA2 = 'branch-A2';
const setup = () => { const repo = new InMemoryGoCheckInRepository(); return { repo, svc: new GoCheckInService(repo as any, {} as any) }; };

describe('GoCheckInService.slugForBranch (customer-display idle link — tenant/branch safe)', () => {
  it('returns the active kiosk slug for the device bound to the branch', async () => {
    const { repo, svc } = setup();
    await repo.createDevice({ tenantId: A, branchId: BA1, deviceName: 'A1 Kiosk', checkinSlug: 'a1' });
    expect(await svc.slugForBranch(A, BA1)).toBe('a1');
  });

  it('never returns another tenant’s slug (isolation)', async () => {
    const { repo, svc } = setup();
    await repo.createDevice({ tenantId: B, branchId: BA1, deviceName: 'B Kiosk', checkinSlug: 'b1' });
    expect(await svc.slugForBranch(A, BA1)).toBeNull(); // tenant A owns no kiosk device
  });

  it('prefers a branch-bound device over a tenant-wide one', async () => {
    const { repo, svc } = setup();
    await repo.createDevice({ tenantId: A, branchId: null, deviceName: 'Tenant-wide', checkinSlug: 'wide' });
    await repo.createDevice({ tenantId: A, branchId: BA1, deviceName: 'Branch', checkinSlug: 'branch' });
    expect(await svc.slugForBranch(A, BA1)).toBe('branch');
  });

  it('falls back to a tenant-wide device when the branch has none', async () => {
    const { repo, svc } = setup();
    await repo.createDevice({ tenantId: A, branchId: null, deviceName: 'Tenant-wide', checkinSlug: 'wide' });
    expect(await svc.slugForBranch(A, BA2)).toBe('wide');
  });

  it('never hands a display ANOTHER branch\'s kiosk — its guests would land in that branch\'s queue', async () => {
    const { repo, svc } = setup();
    await repo.createDevice({ tenantId: A, branchId: BA1, deviceName: 'A1 Kiosk', checkinSlug: 'a1' });
    expect(await svc.slugForBranch(A, BA2)).toBeNull();
  });

  it('a display with no branch: the salon\'s only kiosk — and none when there are several to choose from', async () => {
    const { repo, svc } = setup();
    await repo.createDevice({ tenantId: A, branchId: BA1, deviceName: 'A1 Kiosk', checkinSlug: 'a1' });
    expect(await svc.slugForBranch(A, null)).toBe('a1');
    await repo.createDevice({ tenantId: A, branchId: BA2, deviceName: 'A2 Kiosk', checkinSlug: 'a2' });
    expect(await svc.slugForBranch(A, null)).toBeNull();
  });

  it('skips inactive devices and returns null when none are active', async () => {
    const { repo, svc } = setup();
    const d = await repo.createDevice({ tenantId: A, branchId: BA1, deviceName: 'Disabled', checkinSlug: 'off' });
    await repo.setDeviceStatus(A, d.id, 'inactive');
    expect(await svc.slugForBranch(A, BA1)).toBeNull();
  });
});
