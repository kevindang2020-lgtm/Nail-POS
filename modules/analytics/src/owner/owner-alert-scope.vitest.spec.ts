import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerAlert } from './owner.dto';

// Owner alert mutation (acknowledge/resolve/dismiss) must enforce branch scope on the WRITE path, not just the read path:
// a restricted manager assigned to a branch subset cannot transition an alert outside their branches even with its id.
// The service populates __allowedBranchIds (via allowedSet) and the repo's existence check applies bScope; here the fake
// repo simulates that bScope so the service↔repo authorization contract is exercised without live Postgres.
const ctx = (perms: string[], role = 'MANAGER'): OwnerContext => ({ tenantId: 't1', userId: 'u1', role, permissions: perms } as any);

class AlertRepo extends InMemoryOwnerRepository {
  seenAllowed: string[] | null | undefined = undefined;
  constructor(private allowed: string[] | null, private alertBranch: string) { super(); }
  async allowedBranchIds() { return this.allowed; }
  async userHomeBranch() { return this.allowed ? this.allowed[0] : null; }
  async updateAlertStatus(c: OwnerContext, alertId: string, status: string): Promise<OwnerAlert | null> {
    const allowed = (c as unknown as { __allowedBranchIds?: string[] | null }).__allowedBranchIds;
    this.seenAllowed = allowed;
    if (allowed && allowed.length && !allowed.includes(this.alertBranch)) return null; // bScope existence miss → not found
    return { id: alertId, branchId: this.alertBranch, category: 'inventory', severity: 'info' as any, status: status as any, title: 'x', body: null, createdAt: '', resolvedAt: null };
  }
}

describe('Owner alert mutation — branch authorization (write path)', () => {
  it('blocks a restricted manager from transitioning a foreign-branch alert', async () => {
    const svc = new OwnerService(new AlertRepo(['b1'], 'b2'));
    await expect(svc.resolveAlert(ctx(['owner.alerts.resolve']), 'a1')).rejects.toThrow(/not found/i);
  });

  it('allows a restricted manager to transition an alert within their branch', async () => {
    const svc = new OwnerService(new AlertRepo(['b1'], 'b1'));
    const out = await svc.acknowledgeAlert(ctx(['owner.alerts.resolve']), 'a1');
    expect(out.status).toBe('acknowledged');
  });

  it('allows a full owner (no branch subset) to transition any alert', async () => {
    const svc = new OwnerService(new AlertRepo(null, 'b9'));
    const out = await svc.dismissAlert(ctx(['owner.alerts.resolve'], 'OWNER'), 'a1');
    expect(out.status).toBe('dismissed');
  });

  it('resolves the allowed set before the repo mutation runs', async () => {
    const repo = new AlertRepo(['b1'], 'b1');
    await new OwnerService(repo).acknowledgeAlert(ctx(['owner.alerts.resolve']), 'a1');
    expect(repo.seenAllowed).toEqual(['b1']);
  });

  it('still requires owner.alerts.resolve', async () => {
    const svc = new OwnerService(new AlertRepo(null, 'b1'));
    await expect(svc.resolveAlert(ctx(['owner.dashboard.view']), 'a1')).rejects.toThrow(/permission/i);
  });
});
