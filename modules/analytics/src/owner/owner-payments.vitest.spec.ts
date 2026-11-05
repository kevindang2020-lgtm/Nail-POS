import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerPaymentsOverview, DateRange } from './owner.dto';

// Owner Payments & Money is read-only payment-level oversight gated by 'owner.finance.view' (it's the books). The service
// resolves the branch scope + period and delegates to the repo. These tests cover the finance gate, the overview
// passthrough, and the delegation (branch scope null for a full owner).
const ctx = (perms: string[]): OwnerContext => ({ tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: perms } as any);

const overview: OwnerPaymentsOverview = {
  range: { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
  summary: { grossCents: 4820000, tipsCents: 612000, refundsCents: 84000, netCents: 4736000, transactionCount: 612, refundCount: 7, byMethod: [{ method: 'card', amountCents: 4100000, count: 540 }, { method: 'cash', amountCents: 720000, count: 72 }] },
  transactions: [{ id: 'pay1', amountCents: 8800, tipCents: 1500, method: 'card', status: 'captured', ticketRef: '#a1b2c3d4', processorRef: '•••4242', at: '2026-06-27T14:00:00.000Z' }],
  refunds: [{ id: 'r1', amountCents: 4200, reason: 'Service redo', status: 'completed', paymentRef: '#a1b2c3d4', at: '2026-06-26T11:00:00.000Z' }],
  generatedAt: '2026-06-27T15:00:00.000Z',
};

class FakeRepo extends InMemoryOwnerRepository {
  lastBranch: string | null | undefined;
  async allowedBranchIds() { return null; }
  async tenantTimezoneCurrency() { return { timezone: 'America/New_York', currency: 'USD' }; }
  async ownerPaymentsOverview(_ctx: OwnerContext, branchId: string | null, _from: DateRange) { this.lastBranch = branchId; return overview; }
}

describe('Owner Payments & Money — read-only oversight (finance-gated)', () => {
  it('blocks a user without owner.finance.view', async () => {
    const svc = new OwnerService(new FakeRepo());
    await expect(svc.paymentsOverview(ctx(['owner.dashboard.view']))).rejects.toThrow(/permission/i);
  });

  it('returns the summary, transactions, and refunds for a finance owner', async () => {
    const svc = new OwnerService(new FakeRepo());
    const out = await svc.paymentsOverview(ctx(['owner.finance.view']), 'month');
    expect(out.summary.grossCents).toBe(4820000);
    expect(out.summary.netCents).toBe(4736000);
    expect(out.summary.byMethod[0].method).toBe('card');
    expect(out.transactions[0].processorRef).toBe('•••4242');
    expect(out.refunds[0].reason).toBe('Service redo');
  });

  it('delegates with null branch scope for a full owner', async () => {
    const repo = new FakeRepo();
    const svc = new OwnerService(repo);
    await svc.paymentsOverview(ctx(['owner.finance.view']), 'month');
    expect(repo.lastBranch).toBeNull();
  });
});
