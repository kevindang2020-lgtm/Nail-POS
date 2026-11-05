import { describe, it, expect } from 'vitest';
import { ServiceDoneService } from './service-done.service';
import { InMemoryServiceDoneRepository } from './service-done.repository';

// Reconciliation (epic Req §5): reopening from the Service Done board must clear the P5 formal lock so the ticket is
// editable again on the serving floor — otherwise assertNotLocked would keep blocking edits after a reopen.
const ctx = { tenantId: 'luxe001', branchId: 'b1', userId: 'u_mgr', role: 'MANAGER', permissions: ['pos.service_done.view', 'pos.service_done.reopen'] };

describe('Service Done reopen — reconciles the P5 formal Service Done lock', () => {
  it('clears the formal lock on reopen, threading the reason + actor through', async () => {
    const repo = new InMemoryServiceDoneRepository();
    const svc = new ServiceDoneService(repo as any);
    await svc.reopen(ctx as any, 'sd_3001', { reason: 'Guest wants an add-on after review' } as any);
    expect(repo.reopenLockClears).toHaveLength(1);
    expect(repo.reopenLockClears[0]).toMatchObject({ id: 'sd_3001', reason: 'Guest wants an add-on after review', byUserId: 'u_mgr' });
  });

  it('still requires a reason — no lock-clear is attempted without one', async () => {
    const repo = new InMemoryServiceDoneRepository();
    const svc = new ServiceDoneService(repo as any);
    await expect(svc.reopen(ctx as any, 'sd_3001', { reason: '   ' } as any)).rejects.toThrow(/reason/i);
    expect(repo.reopenLockClears).toHaveLength(0);
  });
});
