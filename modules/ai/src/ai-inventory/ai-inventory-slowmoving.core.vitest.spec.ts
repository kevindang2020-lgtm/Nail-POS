// ai-inventory-slowmoving.core.vitest.spec.ts — pure classification + velocity + new-product grace.
import { describe, it, expect } from 'vitest';
import { classifySlowMoving, daysSinceLastActivity, DEFAULT_THRESHOLDS, type SlowMovingInputs } from './ai-inventory-slowmoving.core';

const inp = (o: Partial<SlowMovingInputs>): SlowMovingInputs => ({
  onHand: 20, costCents: 500, maximumStock: null, productAgeDays: 365,
  daysSinceLastSale: null, daysSinceLastUsage: null, retailUnitsInWindow: 0, consumptionUnitsInWindow: 0,
  isConsumable: false, ...o,
});

describe('daysSinceLastActivity', () => {
  it('takes the most recent', () => expect(daysSinceLastActivity(40, 10)).toBe(10));
  it('null when never moved', () => expect(daysSinceLastActivity(null, null)).toBeNull());
});

describe('classifySlowMoving', () => {
  it('never calls a new product dead stock (grace period)', () => {
    const r = classifySlowMoving(inp({ productAgeDays: 5, onHand: 20, daysSinceLastSale: null }));
    expect(r.classification).toBe('new_insufficient_data');
    expect(r.confidence).toBe('insufficient_data');
  });

  it('classifies dead stock: old, never moved, has stock', () => {
    expect(classifySlowMoving(inp({ productAgeDays: 200, onHand: 20 })).classification).toBe('dead_stock');
  });

  it('healthy when old + never moved but no stock (nothing sitting)', () => {
    expect(classifySlowMoving(inp({ productAgeDays: 200, onHand: 0 })).classification).toBe('healthy');
  });

  it('bands by days since last activity', () => {
    expect(classifySlowMoving(inp({ daysSinceLastSale: 100 })).classification).toBe('dead_stock');
    expect(classifySlowMoving(inp({ daysSinceLastSale: 70 })).classification).toBe('very_slow');
    expect(classifySlowMoving(inp({ daysSinceLastSale: 40 })).classification).toBe('slow_moving');
    expect(classifySlowMoving(inp({ daysSinceLastSale: 10 })).classification).toBe('healthy');
  });

  it('uses usage (not sale) velocity for consumables', () => {
    const r = classifySlowMoving(inp({ isConsumable: true, daysSinceLastUsage: 5, daysSinceLastSale: 200 }));
    expect(r.classification).toBe('healthy'); // recent usage, even though never "sold"
  });

  it('computes velocity per week and inventory value', () => {
    const r = classifySlowMoving(inp({ retailUnitsInWindow: 90, onHand: 20, costCents: 500 }), { ...DEFAULT_THRESHOLDS, windowDays: 90 });
    expect(r.salesVelocityPerWeek).toBe(7);      // 90/90*7
    expect(r.inventoryValueCents).toBe(10000);   // 20*500
  });

  it('flags overstock as an overlay', () => {
    const r = classifySlowMoving(inp({ onHand: 120, maximumStock: 100, daysSinceLastSale: 5 }));
    expect(r.overstock).toBe(true);
    expect(r.classification).toBe('healthy');
  });

  it('null inventory value when cost unknown', () => {
    expect(classifySlowMoving(inp({ costCents: null })).inventoryValueCents).toBeNull();
  });
});
