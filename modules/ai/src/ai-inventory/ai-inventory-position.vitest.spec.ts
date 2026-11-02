// ai-inventory-position.vitest.spec.ts — slice 1 service: §10 positions, branch context, permission + isolation + cost-blind.
import { describe, it, expect } from 'vitest';
import { AiInventoryPositionService } from './ai-inventory-position.service';
import { InMemoryInventoryRead } from './ai-inventory.port';
import { AiInventoryError, type AiInventoryContext, type ProductStockRow } from './ai-inventory.dto';

const row = (over: Partial<ProductStockRow>): ProductStockRow => ({
  productId: 'p1', name: 'Gel Top Coat', sku: 'GTC-1', categoryName: 'Gel', inventoryType: 'consumable',
  onHand: 12, reserved: 2, damaged: 1, expired: 0, quarantined: 0, confirmedInbound: 0,
  reorderLevel: 10, reorderQuantity: 24, criticalLevel: 5, maximumStock: 100,
  costCents: 800, retailPriceCents: 1500, preferredVendorId: null, vendorName: null, vendorLeadTimeDays: null, updatedAt: '2026-07-01T00:00:00.000Z', ...over,
});

const ctx = (over: Partial<AiInventoryContext> = {}): AiInventoryContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['inventory.view', 'inventory.cost.view'], ...over,
});

function svc() {
  const read = new InMemoryInventoryRead();
  read.seed('T1', 'B1', [row({}), row({ productId: 'p2', name: 'Acetone', onHand: 3, reserved: 0, damaged: 0, reorderLevel: 10, criticalLevel: 5 })]);
  read.seed('T1', 'B2', [row({ productId: 'pB2', name: 'Other branch only', onHand: 99 })]);
  read.seed('T2', 'B1', [row({ productId: 'pT2', name: 'Tenant 2 secret', onHand: 500, costCents: 111 })]);
  return new AiInventoryPositionService(read);
}

describe('permission gating', () => {
  it('requires inventory.view', async () => {
    await expect(svc().getContext(ctx({ permissions: [] }))).rejects.toBeInstanceOf(AiInventoryError);
  });
});

describe('getPositions', () => {
  it('computes §10 position with inbound wired (in-transit structurally 0)', async () => {
    const out = await svc().getPositions(ctx());
    const p1 = out.positions.find((p) => p.productId === 'p1')!;
    expect(p1.position.physicalOnHand).toBe(13);   // 12 usable + 1 damaged
    expect(p1.position.sellableOnHand).toBe(10);   // 12 - 2 reserved
    expect(p1.position.projectedAvailable).toBe(10); // no open PO on this fixture
    expect(p1.position.dataComplete).toBe(true);
    expect(out.inboundWired).toBe(true);
    expect(p1.position.daysOfSupply).toBeNull();    // no usage yet → honest null
  });

  it('folds confirmed PO inbound into projected available', async () => {
    const read = new InMemoryInventoryRead();
    read.seed('T1', 'B1', [row({ productId: 'pInb', onHand: 8, reserved: 0, damaged: 0, confirmedInbound: 24 })]);
    const s = new AiInventoryPositionService(read);
    const p = await s.getProductPosition(ctx(), 'pInb');
    expect(p.position.confirmedInbound).toBe(24);
    expect(p.position.projectedAvailable).toBe(32); // 8 sellable + 24 inbound
    expect(p.position.dataComplete).toBe(true);
  });

  it('classifies status from authoritative levels', async () => {
    const out = await svc().getPositions(ctx());
    expect(out.positions.find((p) => p.productId === 'p2')!.position.status).toBe('critical'); // onHand 3 ≤ crit 5
  });
});

describe('cost visibility', () => {
  it('strips cost/price for a technician without cost.view', async () => {
    const out = await svc().getPositions(ctx({ role: 'TECHNICIAN', permissions: ['inventory.view', 'inventory.view_limited'] })   /* Phase 9: a technician's session carries the LIMITED view */);
    expect(out.costVisible).toBe(false);
    expect(out.positions[0].costCents).toBeNull();
    expect(out.positions[0].retailPriceCents).toBeNull();
  });
  it('shows cost for owner with cost.view', async () => {
    const out = await svc().getPositions(ctx());
    expect(out.costVisible).toBe(true);
    expect(out.positions[0].costCents).toBe(800);
  });
});

describe('tenant + branch isolation', () => {
  it('never returns another tenant’s product', async () => {
    const out = await svc().getPositions(ctx({ tenantId: 'T1' }));
    expect(out.positions.some((p) => p.productId === 'pT2')).toBe(false);
  });
  it('only returns the ctx branch', async () => {
    const out = await svc().getPositions(ctx({ branchId: 'B1' }));
    expect(out.positions.some((p) => p.productId === 'pB2')).toBe(false);
  });
  it('T2 sees only its own product', async () => {
    const out = await svc().getPositions(ctx({ tenantId: 'T2' }));
    expect(out.positions.map((p) => p.productId)).toEqual(['pT2']);
  });
});

describe('getProductPosition', () => {
  it('404s when the product has no stock at this branch', async () => {
    await expect(svc().getProductPosition(ctx(), 'does-not-exist')).rejects.toBeInstanceOf(AiInventoryError);
  });
  it('returns the single product position', async () => {
    const p = await svc().getProductPosition(ctx(), 'p2');
    expect(p.name).toBe('Acetone');
  });
});

describe('getContext', () => {
  it('summarizes status counts for the branch', async () => {
    const c = await svc().getContext(ctx());
    expect(c.productCount).toBe(2);
    expect(c.critical).toBe(1);
    expect(c.inboundWired).toBe(true);
  });
});
