// ai-inventory-reorder.vitest.spec.ts — low-stock findings + reorder recommendation cards.
import { describe, it, expect } from 'vitest';
import { AiInventoryReorderService } from './ai-inventory-reorder.service';
import { InMemoryInventoryRead } from './ai-inventory.port';
import { type AiInventoryContext, type ProductStockRow } from './ai-inventory.dto';

const row = (over: Partial<ProductStockRow>): ProductStockRow => ({
  productId: 'p1', name: 'Gel Top Coat', sku: 'GTC-1', categoryName: 'Gel', inventoryType: 'consumable',
  onHand: 3, reserved: 0, damaged: 0, expired: 0, quarantined: 0, confirmedInbound: 0,
  reorderLevel: 10, reorderQuantity: 12, criticalLevel: 5, maximumStock: 100,
  costCents: 800, retailPriceCents: 1500, preferredVendorId: 'v1', vendorName: 'BeautyCo', vendorLeadTimeDays: 7,
  updatedAt: '2026-07-01T00:00:00.000Z', ...over,
});

const ctx = (o: Partial<AiInventoryContext> = {}): AiInventoryContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['inventory.view', 'inventory.cost.view'], ...o,
});

function svc(rows: ProductStockRow[], tenant = 'T1', branch = 'B1') {
  const read = new InMemoryInventoryRead();
  read.seed(tenant, branch, rows);
  read.seed('T2', 'B1', [row({ productId: 'pT2', name: 'Tenant 2', costCents: 999 })]);
  return new AiInventoryReorderService(read);
}

describe('getLowStock', () => {
  it('returns items at/below reorder point, worst first', async () => {
    const s = svc([
      row({ productId: 'ok', onHand: 50, reorderLevel: 10 }),           // healthy → excluded
      row({ productId: 'low', onHand: 8, reorderLevel: 10, criticalLevel: 3 }),
      row({ productId: 'out', onHand: 0, reorderLevel: 10 }),
    ]);
    const out = await s.getLowStock(ctx());
    expect(out.items.map((i) => i.productId)).toEqual(['out', 'low']);
    expect(out.items[0].severity).toBe('out_of_stock');
    expect(out.items[0].daysOfSupply).toBeNull();        // honest until forecast
    expect(out.items[0].predictedStockoutDate).toBeNull();
  });
});

describe('getReorderRecommendations', () => {
  it('suggests batch-rounded quantity with evidence and estimated cost', async () => {
    const out = await svc([row({ onHand: 3, reorderLevel: 10, reorderQuantity: 12, costCents: 800 })]).getReorderRecommendations(ctx());
    const rec = out.recommendations[0];
    expect(rec.suggestedQuantity).toBe(12);              // need 7 → batch 12
    expect(rec.estimatedCostCents).toBe(9600);           // 12 * 800
    expect(rec.confidence).toBe('low');                  // static reorder point
    expect(rec.reason).toContain('reorder point 10');
    expect(rec.dataQualityNotes.some((n) => /Safety stock/.test(n))).toBe(true);
  });

  it('excludes items whose confirmed inbound already covers the need', async () => {
    const out = await svc([row({ onHand: 3, confirmedInbound: 20, reorderLevel: 10 })]).getReorderRecommendations(ctx());
    expect(out.recommendations).toHaveLength(0);
  });

  it('hides estimated cost from cost-blind roles', async () => {
    const out = await svc([row({ onHand: 3, reorderLevel: 10, reorderQuantity: 12 })])
      .getReorderRecommendations(ctx({ role: 'TECHNICIAN', permissions: ['inventory.view', 'inventory.view_limited'] })   /* Phase 9: a technician's session carries the LIMITED view */);
    expect(out.costVisible).toBe(false);
    expect(out.recommendations[0].estimatedCostCents).toBeNull();
  });

  it('never leaks another tenant’s products', async () => {
    const out = await svc([row({ onHand: 3, reorderLevel: 10 })]).getReorderRecommendations(ctx({ tenantId: 'T1' }));
    expect(out.recommendations.some((r) => r.productId === 'pT2')).toBe(false);
  });

  it('requires inventory.view', async () => {
    await expect(svc([row({})]).getReorderRecommendations(ctx({ permissions: [] }))).rejects.toThrow();
  });
});
