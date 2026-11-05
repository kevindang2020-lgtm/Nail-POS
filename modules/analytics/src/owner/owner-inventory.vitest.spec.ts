import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerInventoryOverview } from './owner.dto';

// Owner Inventory & Products is read-only aggregate analytics gated by 'owner.dashboard.view'. The service resolves the
// branch scope (allowed-set) and delegates to the repo. Stock VALUATION (cost/retail) is only surfaced to owners with
// 'owner.finance.view' — otherwise nulled, mirroring the inventory module's cost-privacy.
const ctx = (perms: string[], role = 'OWNER'): OwnerContext => ({ tenantId: 't1', userId: 'u1', role, permissions: perms } as any);

const overview = (): OwnerInventoryOverview => ({
  totalProducts: 320, stockPositions: 412,
  statusCounts: { inStock: 360, low: 28, critical: 14, outOfStock: 6, overstock: 4 },
  needsReorderCount: 48, stockValueCents: 1843200, retailValueCents: 4120000,
  brandsCount: 12, vendorsCount: 7, categoriesCount: 9,
  topCategories: [{ category: 'Gel Polish', products: 80, stockValueCents: 720000 }, { category: 'Acrylic', products: 60, stockValueCents: 540000 }],
  reorderList: [{ productId: 'p1', name: 'OPI Bubble Bath', branchId: 'b1', branchName: 'Main', onHand: 0, reorderLevel: 6, status: 'out_of_stock', suggestedQty: 12 }],
  generatedAt: '2026-06-27T15:00:00.000Z',
});

class FakeRepo extends InMemoryOwnerRepository {
  lastBranchIds: string[] | null | undefined;
  constructor(private allowed: string[] | null = null) { super(); }
  async allowedBranchIds() { return this.allowed; }
  async userHomeBranch() { return null; }
  async ownerInventoryOverview(_ctx: OwnerContext, branchIds: string[] | null) { this.lastBranchIds = branchIds; return overview(); }
}

describe('Owner Inventory & Products — read-only with cost-privacy', () => {
  it('blocks a user without owner.dashboard.view', async () => {
    const svc = new OwnerService(new FakeRepo());
    await expect(svc.inventoryOverview(ctx(['owner.settings.view']))).rejects.toThrow(/permission/i);
  });

  it('returns the full overview including valuation for a finance-permitted owner', async () => {
    const svc = new OwnerService(new FakeRepo());
    const out = await svc.inventoryOverview(ctx(['owner.dashboard.view', 'owner.finance.view']));
    expect(out.statusCounts.outOfStock).toBe(6);
    expect(out.needsReorderCount).toBe(48);
    expect(out.stockValueCents).toBe(1843200);
    expect(out.topCategories[0].stockValueCents).toBe(720000);
  });

  it('nulls cost/retail valuation for a non-finance user (dashboard.view only)', async () => {
    const svc = new OwnerService(new FakeRepo());
    const out = await svc.inventoryOverview(ctx(['owner.dashboard.view']));
    expect(out.stockValueCents).toBeNull();
    expect(out.retailValueCents).toBeNull();
    expect(out.topCategories[0].stockValueCents).toBeNull();
    expect(out.statusCounts.outOfStock).toBe(6); // operational data still visible
  });

  it('forbids a branch outside the owner’s allowed set', async () => {
    const svc = new OwnerService(new FakeRepo(['b1']));
    await expect(svc.inventoryOverview(ctx(['owner.dashboard.view', 'owner.finance.view']), 'b2')).rejects.toThrow(/assigned branch/i);
  });

  it('delegates with null branch scope for a full owner (all locations)', async () => {
    const repo = new FakeRepo(null);
    const svc = new OwnerService(repo);
    await svc.inventoryOverview(ctx(['owner.dashboard.view', 'owner.finance.view']));
    expect(repo.lastBranchIds).toBeNull();
  });
});
