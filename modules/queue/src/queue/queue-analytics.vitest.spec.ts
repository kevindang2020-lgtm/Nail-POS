import { describe, it, expect } from 'vitest';
import { buildTopWaitingServices, buildVisitSourceMix, buildCustomerTypeMix, buildQueuePotentialRevenue } from './queue.dto';

const item = (o: Partial<{ source: string; isVip: boolean; priority: string; customerId: string; svc: [string, number][] }>) =>
  ({ source: o.source, isVip: o.isVip, priority: o.priority, customerId: o.customerId, requestedServices: (o.svc || []).map(([serviceName, priceCents]) => ({ serviceName, priceCents })) });

describe('queue analytics helpers', () => {
  it('buildTopWaitingServices counts by primary requested service, share-summing', () => {
    const bars = buildTopWaitingServices([item({ svc: [['Gel X Full Set', 0]] }), item({ svc: [['Gel X Full Set', 0]] }), item({ svc: [['Pedicure', 0]] })]);
    expect(bars[0]).toMatchObject({ service: 'Gel X Full Set', count: 2, sharePercent: 67 });
  });
  it('buildVisitSourceMix maps to canonical buckets (App/Phone/Walk-In/AI Receptionist/In Person)', () => {
    const mix = buildVisitSourceMix([item({ source: 'online' }), item({ source: 'walk_in' }), item({ source: 'ai' }), item({ source: 'walk_in' })]);
    expect(mix.find((m) => m.label === 'Walk-In')).toMatchObject({ count: 2 });
    expect(mix.find((m) => m.label === 'AI Receptionist')).toMatchObject({ count: 1 });
  });
  it('buildCustomerTypeMix classifies VIP / Walk-In / Returning / New', () => {
    const mix = buildCustomerTypeMix([
      item({ isVip: true }), item({ source: 'walk_in' }),
      item({ source: 'appointment', customerId: 'c1' }), item({ source: 'appointment', customerId: 'c2' }),
    ], { c1: 3 });
    expect(mix.find((m) => m.label === 'VIP')).toMatchObject({ count: 1 });
    expect(mix.find((m) => m.label === 'Returning')).toMatchObject({ count: 1 });
    expect(mix.find((m) => m.label === 'New')).toMatchObject({ count: 1 });
  });
  it('buildQueuePotentialRevenue sums requested-service prices by service', () => {
    const r = buildQueuePotentialRevenue([item({ svc: [['Gel X Full Set', 2100_00]] }), item({ svc: [['Pedicure', 1350_00]] })]);
    expect(r.totalCents).toBe(3450_00);
    expect(r.byService[0]).toMatchObject({ service: 'Gel X Full Set', revenueCents: 2100_00 });
  });
});

import { computeQueueConversion, QUEUE_CONVERSION_GOAL_PERCENT } from './queue.dto';
describe('queue conversion (canonical)', () => {
  it('is the rounded share of eligible guests that reached serving; null when none', () => {
    expect(computeQueueConversion(0, 0)).toBeNull();
    expect(computeQueueConversion(8, 5)).toBe(63);   // 62.5 -> 63
    expect(computeQueueConversion(10, 7)).toBe(70);
  });
  it('clamps at 100 and never exceeds it', () => {
    expect(computeQueueConversion(4, 9)).toBe(100);
  });
  it('exposes the canonical goal target', () => {
    expect(QUEUE_CONVERSION_GOAL_PERCENT).toBe(70);
  });
});
