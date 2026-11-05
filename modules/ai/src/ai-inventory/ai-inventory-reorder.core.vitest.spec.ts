// ai-inventory-reorder.core.vitest.spec.ts — pure low-stock + reorder math.
import { describe, it, expect } from 'vitest';
import { computeReorder, lowStockSeverity, roundToBatch, type ReorderInputs } from './ai-inventory-reorder.core';

const inp = (o: Partial<ReorderInputs>): ReorderInputs => ({
  sellableAvailable: 0, confirmedInbound: 0, reorderLevel: 10, reorderQuantity: 0, ...o,
});

describe('lowStockSeverity', () => {
  it('out_of_stock at zero', () => expect(lowStockSeverity(0, 10)).toBe('out_of_stock'));
  it('critical uses explicit critical level', () => expect(lowStockSeverity(4, 10, 5)).toBe('critical'));
  it('critical falls back to half reorder', () => expect(lowStockSeverity(4, 10)).toBe('critical'));
  it('low at/below reorder', () => expect(lowStockSeverity(8, 10)).toBe('low'));
  it('none above reorder', () => expect(lowStockSeverity(20, 10)).toBe('none'));
});

describe('roundToBatch', () => {
  it('rounds up to batch multiple', () => expect(roundToBatch(13, 12)).toBe(24));
  it('passes through when no batch', () => expect(roundToBatch(13, 0)).toBe(13));
  it('zero need → zero', () => expect(roundToBatch(0, 12)).toBe(0));
});

describe('computeReorder', () => {
  it('suggests to reach the reorder point, batch-rounded', () => {
    const r = computeReorder(inp({ sellableAvailable: 3, reorderLevel: 10, reorderQuantity: 12 }));
    expect(r.belowReorderPoint).toBe(true);
    expect(r.targetStock).toBe(10);
    expect(r.suggestedQuantity).toBe(12); // need 7 → round up to 12
    expect(r.usesStaticReorderPoint).toBe(true);
    expect(r.confidence).toBe('low');
  });

  it('nets out confirmed inbound (no double order)', () => {
    const r = computeReorder(inp({ sellableAvailable: 3, confirmedInbound: 20, reorderLevel: 10 }));
    expect(r.projectedAvailable).toBe(23);
    expect(r.coveredByInbound).toBe(true);
    expect(r.suggestedQuantity).toBe(0);
  });

  it('raises confidence to medium only with usage + lead time', () => {
    const r = computeReorder(inp({ sellableAvailable: 3, reorderLevel: 10, avgDailyUsage: 2, leadTimeDays: 7 }));
    expect(r.confidence).toBe('medium');
    expect(r.usesStaticReorderPoint).toBe(false);
  });

  it('insufficient_data when no reorder point configured', () => {
    const r = computeReorder(inp({ sellableAvailable: 0, reorderLevel: 0 }));
    expect(r.confidence).toBe('insufficient_data');
    expect(r.severity).toBe('out_of_stock');
  });
});
