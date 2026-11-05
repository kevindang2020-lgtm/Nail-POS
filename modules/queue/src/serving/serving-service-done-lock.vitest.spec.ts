import { describe, it, expect } from 'vitest';
import { ServingService, ConflictError, ValidationError } from './serving.service';
import { InMemoryServingRepository, ServingContext } from './serving.repository';

// Manager context with send + edit authority. sv_4001 is in_service with l1 5500 + l2 1500 (subtotal 7000).
const ctx = (over: Partial<ServingContext> = {}): ServingContext =>
  ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_mgr', role: 'OWNER',
    permissions: ['pos.serving.view', 'pos.serving.edit_services', 'pos.serving.send_to_service_done', 'pos.service_done.view'], ...over });

describe('Service Done formal lock + audited reopen (epic Req §5)', () => {
  it('locks on send and records who/when + the subtotal snapshot', async () => {
    const repo = new InMemoryServingRepository();
    const svc = new ServingService(repo);
    const res = await svc.sendToServiceDone(ctx(), 'sv_4001');
    expect(res.sent).toBe(true);
    const lock = await repo.serviceDoneLock(ctx(), 'sv_4001');
    expect(lock).toBeTruthy();
    expect(lock!.lockedByUserId).toBe('u_mgr');
    expect(lock!.lockedTotalCents).toBe(7000);
    expect((await svc.getRevisions(ctx(), 'sv_4001')).revisions.some((r) => r.action === 'service_done_locked')).toBe(true);
  });

  it('blocks every edit while locked, then allows edits again after an audited reopen', async () => {
    const repo = new InMemoryServingRepository();
    const svc = new ServingService(repo);
    await svc.sendToServiceDone(ctx(), 'sv_4001');
    await expect(svc.editService(ctx(), 'sv_4001', 'l1', { priceOverrideCents: 9999 })).rejects.toThrow(ConflictError);
    await expect(svc.reopenServiceDone(ctx(), 'sv_4001', { reason: '' })).rejects.toThrow(ValidationError);   // reason required
    await svc.reopenServiceDone(ctx(), 'sv_4001', { reason: 'Customer added a service after checkout started' });
    expect(await repo.serviceDoneLock(ctx(), 'sv_4001')).toBeNull();        // lock cleared
    await svc.editService(ctx(), 'sv_4001', 'l1', { priceOverrideCents: 6000 });   // now succeeds
    expect((await svc.getRevisions(ctx(), 'sv_4001')).revisions.map((r) => r.action))
      .toEqual(['service_done_locked', 'service_done_reopened', 'service_updated']);
  });

  it('rejects reopening a ticket that is not locked', async () => {
    const svc = new ServingService(new InMemoryServingRepository());
    await expect(svc.reopenServiceDone(ctx(), 'sv_4003', { reason: 'oops' })).rejects.toThrow(/not locked/i);
  });
});
