// ai-inventory-slowmoving.vitest.spec.ts — slow-moving service: surfacing, cost-blind, grace, isolation.
import { describe, it, expect } from 'vitest';
import { AiInventorySlowMovingService } from './ai-inventory-slowmoving.service';
import { InMemoryInventoryRead } from './ai-inventory.port';
import { type AiInventoryContext, type SlowMovingInputRow } from './ai-inventory.dto';

const row = (over: Partial<SlowMovingInputRow>): SlowMovingInputRow => ({
  productId: 'p1', name: 'Polish', sku: 'PL-1', categoryName: 'Retail', inventoryType: 'retail',
  onHand: 20, costCents: 500, maximumStock: null, productAgeDays: 365,
  daysSinceLastSale: 10, daysSinceLastUsage: null, retailUnitsInWindow: 30, consumptionUnitsInWindow: 0, ...over,
});
const ctx = (o: Partial<AiInventoryContext> = {}): AiInventoryContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['inventory.view', 'inventory.cost.view'], ...o,
});

function svc(rows: SlowMovingInputRow[]) {
  const read = new InMemoryInventoryRead();
  read.seedSlowMoving('T1', 'B1', rows);
  read.seedSlowMoving('T2', 'B1', [row({ productId: 'pT2', daysSinceLastSale: 200 })]);
  return new AiInventorySlowMovingService(read);
}

describe('surfacing', () => {
  it('returns non-healthy items worst-first, excludes healthy', async () => {
    const out = await svc([
      row({ productId: 'healthy', daysSinceLastSale: 5 }),
      row({ productId: 'slow', daysSinceLastSale: 40 }),
      row({ productId: 'dead', daysSinceLastSale: 200, costCents: 1000, onHand: 10 }),
    ]).getSlowMoving(ctx());
    expect(out.items.map((i) => i.productId)).toEqual(['dead', 'slow']);
    expect(out.items[0].classification).toBe('dead_stock');
  });
});

describe('cost visibility', () => {
  it('hides inventory value from cost-blind roles', async () => {
    const out = await svc([row({ daysSinceLastSale: 200 })]).getSlowMoving(ctx({ role: 'TECHNICIAN', permissions: ['inventory.view', 'inventory.view_limited'] })   /* Phase 9: a technician's session carries the LIMITED view */);
    expect(out.costVisible).toBe(false);
    expect(out.items[0].inventoryValueCents).toBeNull();
  });
});

describe('new-product grace', () => {
  it('does not surface a fresh product as dead by default', async () => {
    const out = await svc([row({ productAgeDays: 5, daysSinceLastSale: null })]).getSlowMoving(ctx());
    expect(out.items).toHaveLength(0);
  });
  it('can include new items when asked', async () => {
    const out = await svc([row({ productAgeDays: 5, daysSinceLastSale: null })]).getSlowMoving(ctx(), { includeNew: true });
    expect(out.items[0].classification).toBe('new_insufficient_data');
  });
});

describe('isolation', () => {
  it('never surfaces another tenant’s product', async () => {
    const out = await svc([row({ daysSinceLastSale: 200 })]).getSlowMoving(ctx({ tenantId: 'T1' }));
    expect(out.items.some((i) => i.productId === 'pT2')).toBe(false);
  });
  it('requires inventory.view', async () => {
    await expect(svc([row({})]).getSlowMoving(ctx({ permissions: [] }))).rejects.toThrow();
  });
});
