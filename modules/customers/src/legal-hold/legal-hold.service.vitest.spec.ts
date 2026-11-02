import { describe, it, expect } from 'vitest';
import { LegalHoldService } from './legal-hold.service';
import { InMemoryLegalHoldRepo } from './legal-hold.repository';

describe('LegalHoldService', () => {
  it('applies a customer hold with matter ref + reason and audits it', async () => {
    const repo = new InMemoryLegalHoldRepo();
    const svc = new LegalHoldService(repo);
    const r = await svc.applyHold({ tenantId: 't1', customerId: 'c1', matterRef: 'M-100', reason: 'litigation', scope: 'customer' }, { userId: 'admin1' });
    expect(r.ok).toBe(true);
    expect(r.hold!.status).toBe('active');
    expect(repo.getAudit()[0]).toMatchObject({ actionType: 'customer_legal_hold_applied', tenantId: 't1', customerId: 'c1' });
  });

  it('rejects an apply missing the matter reference', async () => {
    const svc = new LegalHoldService(new InMemoryLegalHoldRepo());
    const r = await svc.applyHold({ tenantId: 't1', customerId: 'c1', reason: 'x', scope: 'customer' });
    expect(r.ok).toBe(false);
    expect(r.errors!.join(' ')).toMatch(/matter/i);
  });

  it('blocks deletion while an active hold covers the customer, and allows it after release', async () => {
    const repo = new InMemoryLegalHoldRepo();
    const svc = new LegalHoldService(repo);
    const applied = await svc.applyHold({ tenantId: 't1', customerId: 'c1', matterRef: 'M', reason: 'hold', scope: 'customer' });
    expect((await svc.assertDeletable('t1', 'c1')).deletable).toBe(false);
    const rel = await svc.releaseHold(applied.hold!.id, 'matter closed', { userId: 'admin1' });
    expect(rel.ok).toBe(true);
    expect((await svc.assertDeletable('t1', 'c1')).deletable).toBe(true);
  });

  it('release requires a reason', async () => {
    const repo = new InMemoryLegalHoldRepo();
    const svc = new LegalHoldService(repo);
    const a = await svc.applyHold({ tenantId: 't1', customerId: 'c1', matterRef: 'M', reason: 'r', scope: 'customer' });
    const rel = await svc.releaseHold(a.hold!.id, '   ');
    expect(rel.ok).toBe(false);
    expect(rel.errors!.join(' ')).toMatch(/reason is required/i);
  });

  it('a tenant-scoped hold blocks deletion for any customer in that tenant but not other tenants', async () => {
    const svc = new LegalHoldService(new InMemoryLegalHoldRepo());
    await svc.applyHold({ tenantId: 't1', matterRef: 'M', reason: 'tenant audit', scope: 'tenant' });
    expect((await svc.assertDeletable('t1', 'anyone')).deletable).toBe(false);
    expect((await svc.assertDeletable('t2', 'anyone')).deletable).toBe(true);
  });

  it('counts active holds and the tenants they span', async () => {
    const svc = new LegalHoldService(new InMemoryLegalHoldRepo());
    await svc.applyHold({ tenantId: 't1', customerId: 'c1', matterRef: 'M', reason: 'r', scope: 'customer' });
    await svc.applyHold({ tenantId: 't2', customerId: 'c2', matterRef: 'M', reason: 'r', scope: 'customer' });
    const c = await svc.counts({});
    expect(c.total).toBe(2);
    expect(c.tenantCount).toBe(2);
  });
});
