// ai-inventory-core.vitest.spec.ts — pure position math (§10), status, days-of-supply, confidence.
import { describe, it, expect } from 'vitest';
import { computePosition, positionStatus, daysOfSupply, positionConfidence, type PositionInputs } from './ai-inventory-core';
import { stockStatus } from '@aipowersalon/inventory';

const base = (over: Partial<PositionInputs>): PositionInputs => ({
  onHand: 0, reserved: 0, damaged: 0, expired: 0, quarantined: 0,
  confirmedInbound: 0, inTransitInbound: 0, inTransitOutbound: 0, inboundKnown: false,
  reorderLevel: 0, reorderQuantity: 0, ...over,
});

describe('positionStatus stays in lockstep with authoritative inventory-core.stockStatus', () => {
  const cases = [
    [0, 5, null, null], [3, 10, null, null], [6, 10, 100, null], [120, 10, 100, null], [8, 10, null, 4],
  ] as const;
  it('matches for representative inputs', () => {
    for (const [oh, rl, max, crit] of cases) {
      expect(positionStatus(oh, rl, max, crit)).toBe(stockStatus(oh, rl, max, crit));
    }
  });
});

describe('daysOfSupply', () => {
  it('divides sellable by usage, one decimal', () => { expect(daysOfSupply(30, 4)).toBe(7.5); });
  it('is null when usage unknown or non-positive', () => {
    expect(daysOfSupply(30, null)).toBeNull();
    expect(daysOfSupply(30, 0)).toBeNull();
  });
});

describe('positionConfidence never overclaims', () => {
  it('insufficient when usage unknown', () => { expect(positionConfidence(true, null, 999)).toBe('insufficient_data'); });
  it('low when inbound not wired even with long history', () => { expect(positionConfidence(false, 5, 90)).toBe('low'); });
  it('scales with history when inbound known', () => {
    expect(positionConfidence(true, 5, 90)).toBe('high');
    expect(positionConfidence(true, 5, 30)).toBe('medium');
    expect(positionConfidence(true, 5, 10)).toBe('low');
    expect(positionConfidence(true, 5, 3)).toBe('insufficient_data');
  });
});

describe('computePosition (§10)', () => {
  it('derives physical/sellable/unavailable and excludes unwired inbound', () => {
    const p = computePosition(base({ onHand: 20, reserved: 4, damaged: 3, expired: 1, quarantined: 2, confirmedInbound: 50, inboundKnown: false, reorderLevel: 10, avgDailyUsage: 2, usageHistoryDays: 60 }));
    expect(p.physicalOnHand).toBe(23);       // usable 20 + damaged 3
    expect(p.sellableOnHand).toBe(16);       // 20 - reserved 4
    expect(p.unavailable).toBe(6);           // 3 + 1 + 2
    expect(p.confirmedInbound).toBe(0);      // not wired → not fabricated
    expect(p.projectedAvailable).toBe(16);   // sellable only
    expect(p.dataComplete).toBe(false);
    expect(p.daysOfSupply).toBe(8);          // 16 / 2
    expect(p.confidence).toBe('low');        // inbound unknown caps confidence
  });

  it('includes inbound and in-transit when wired', () => {
    const p = computePosition(base({ onHand: 10, confirmedInbound: 12, inTransitInbound: 6, inTransitOutbound: 4, inboundKnown: true, reorderLevel: 8, avgDailyUsage: 2, usageHistoryDays: 60 }));
    expect(p.projectedAvailable).toBe(24);   // 10 + 12 + 6 - 4
    expect(p.dataComplete).toBe(true);
    expect(p.confidence).toBe('high');
  });

  it('never returns negative buckets', () => {
    const p = computePosition(base({ onHand: 0, reserved: 5, damaged: 0 }));
    expect(p.sellableOnHand).toBe(0);
    expect(p.status).toBe('out_of_stock');
  });
});
