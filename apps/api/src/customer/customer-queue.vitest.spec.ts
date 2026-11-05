import { describe, it, expect } from 'vitest';
import { computeQueueState, type CustomerQueueRaw } from './customer-queue';
import { CustomerService } from './customer.service';
import type { CustomerDataPort } from './customer.repository';

const NOW = 1_700_000_000_000;
const minAgo = (m: number) => NOW - m * 60000;

describe('computeQueueState (pure)', () => {
  it('returns not-in-queue for null/empty', () => {
    expect(computeQueueState(null, NOW)).toEqual({ inQueue: false });
    expect(computeQueueState({ myItemId: 'x', status: 'waiting', items: [], availableTechnicians: 2, avgServiceMinutes: 30 }, NOW)).toEqual({ inQueue: false });
  });
  it('ranks by wait (longest first) and estimates wait from people ahead ÷ techs × avg', () => {
    const raw: CustomerQueueRaw = {
      myItemId: 'C', status: 'waiting', availableTechnicians: 2, avgServiceMinutes: 30,
      items: [
        { queueItemId: 'A', priority: 'normal', checkedInAtMs: minAgo(30) },
        { queueItemId: 'B', priority: 'normal', checkedInAtMs: minAgo(20) },
        { queueItemId: 'C', priority: 'normal', checkedInAtMs: minAgo(10) },
      ],
    };
    const s = computeQueueState(raw, NOW);
    expect(s.inQueue).toBe(true);
    expect(s.position).toBe(3);           // youngest wait → last
    expect(s.totalWaiting).toBe(3);
    // ahead=2, (2/2)*30 = 30 → range 24–36
    expect(s.estimatedWaitMinMinutes).toBe(24);
    expect(s.estimatedWaitMaxMinutes).toBe(36);
  });
  it('VIP priority jumps the line (position 1, short wait floor)', () => {
    const raw: CustomerQueueRaw = {
      myItemId: 'C', status: 'waiting', availableTechnicians: 2, avgServiceMinutes: 30,
      items: [
        { queueItemId: 'A', priority: 'normal', checkedInAtMs: minAgo(30) },
        { queueItemId: 'B', priority: 'normal', checkedInAtMs: minAgo(20) },
        { queueItemId: 'C', priority: 'vip', checkedInAtMs: minAgo(10) },
      ],
    };
    const s = computeQueueState(raw, NOW);
    expect(s.position).toBe(1);
    expect(s.estimatedWaitMinMinutes).toBe(0);
    expect(s.estimatedWaitMaxMinutes).toBe(5); // floor so "you're next" still shows a small wait
  });
});

function stub(over: Partial<CustomerDataPort> = {}): CustomerDataPort {
  return {
    resolveCustomerId: async () => 'c1',
    getLoyaltyConfig: async () => [], homeRaw: async () => ({ customerName: '', points: 0, recentVisitsCount: 0 }),
    appointments: async () => [], receipts: async () => [], loyaltyPoints: async () => 0, activeService: async () => null, updateProfile: async () => {},
    customerQueue: async () => ({ myItemId: 'C', status: 'waiting', availableTechnicians: 1, avgServiceMinutes: 30, items: [
      { queueItemId: 'A', priority: 'normal', checkedInAtMs: minAgo(20) }, { queueItemId: 'C', priority: 'normal', checkedInAtMs: minAgo(10) },
    ] }),
    ...over,
  };
}

describe('CustomerService.getQueue', () => {
  const ctx = { tenantId: 'T', branchId: 'B', userId: 'U', role: 'CUSTOMER', permissions: [] };
  it('returns the customer position + ETA', async () => {
    const s = await new CustomerService(stub()).getQueue(ctx, NOW);
    expect(s).toMatchObject({ inQueue: true, position: 2, totalWaiting: 2 });
  });
  it('returns not-in-queue when the session is not a linked customer', async () => {
    const s = await new CustomerService(stub({ resolveCustomerId: async () => null })).getQueue(ctx, NOW);
    expect(s).toEqual({ inQueue: false });
  });
});
