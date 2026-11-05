// ai-money-protection-reconciliation.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import {
  reconcileMembershipPayments, reconcileGiftCards, reconcileCashDrawers, fairBatchByTenant,
  type NormalizedMembershipPayment, type NormalizedGiftCard, type NormalizedGiftCardTxn, type NormalizedCashSession,
} from './ai-money-protection-reconciliation';

const T = Date.parse('2026-07-07T10:00:00Z');

describe('reconcileMembershipPayments', () => {
  const mp = (o: Partial<NormalizedMembershipPayment>): NormalizedMembershipPayment => ({ id: 'm', branchId: 'b1', customerId: 'c1', amountCents: 4900, status: 'succeeded', processorRef: null, idempotencyKey: null, createdAtMs: T, ...o });
  it('flags duplicate membership charge sharing an idempotency key', () => {
    const out = reconcileMembershipPayments([mp({ id: 'm1', idempotencyKey: 'K1' }), mp({ id: 'm2', idempotencyKey: 'K1' })]);
    expect(out).toHaveLength(1);
    expect(out[0].alertType).toBe('duplicate_membership_charge');
    expect(out[0].evidence.summary.toLowerCase()).not.toMatch(/fraud|theft|stole/);
  });
  it('ignores non-captured membership charges', () => {
    expect(reconcileMembershipPayments([mp({ id: 'm1', status: 'failed', processorRef: 'P1' }), mp({ id: 'm2', status: 'failed', processorRef: 'P1' })])).toHaveLength(0);
  });
});

describe('reconcileGiftCards', () => {
  it('flags a negative gift-card balance and a redemption that overdraws', () => {
    const cards: NormalizedGiftCard[] = [{ id: 'g1', branchId: 'b1', balanceCents: -500, status: 'active' }, { id: 'g2', branchId: 'b1', balanceCents: 1000, status: 'active' }];
    const txns: NormalizedGiftCardTxn[] = [{ id: 'tx1', giftCardId: 'g2', branchId: 'b1', type: 'redeem', amountCents: 2000, balanceAfterCents: -1000 }];
    const out = reconcileGiftCards(cards, txns);
    expect(out.map((a) => a.alertType).sort()).toEqual(['giftcard_negative_balance', 'giftcard_redemption_exceeds_balance']);
  });
  it('does not flag healthy gift cards', () => {
    expect(reconcileGiftCards([{ id: 'g1', branchId: 'b1', balanceCents: 1000, status: 'active' }], [{ id: 'tx', giftCardId: 'g1', branchId: 'b1', type: 'redeem', amountCents: 500, balanceAfterCents: 500 }])).toHaveLength(0);
  });
});

describe('reconcileCashDrawers', () => {
  const cs = (o: Partial<NormalizedCashSession>): NormalizedCashSession => ({ id: 's1', branchId: 'b1', businessDate: '2026-07-07', varianceCents: 0, countedCents: null, expectedCents: null, status: 'reconciled', ...o });
  it('flags a drawer variance beyond tolerance (short)', () => {
    const out = reconcileCashDrawers([cs({ varianceCents: -1500 })]);
    expect(out).toHaveLength(1);
    expect(out[0].alertType).toBe('cash_drawer_variance');
    expect(out[0].amountCents).toBe(1500);
  });
  it('does not flag within tolerance, and ignores open sessions', () => {
    expect(reconcileCashDrawers([cs({ varianceCents: 100 }), cs({ varianceCents: -9999, status: 'open' })])).toHaveLength(0);
  });
  it('computes variance from counted/expected when variance is null', () => {
    expect(reconcileCashDrawers([cs({ varianceCents: null, countedCents: 10000, expectedCents: 10500 })])).toHaveLength(1);
  });
});

describe('fairBatchByTenant (spec §45 — no tenant starves others)', () => {
  it('round-robins across tenants and caps per tenant + total', () => {
    const items = [
      { t: 'A', id: 1 }, { t: 'A', id: 2 }, { t: 'A', id: 3 }, { t: 'A', id: 4 },
      { t: 'B', id: 5 }, { t: 'B', id: 6 },
    ];
    const out = fairBatchByTenant(items, (x) => x.t, { maxPerTenant: 2, maxTotal: 100 });
    expect(out.map((x) => x.id)).toEqual([1, 5, 2, 6]); // interleaved, A capped at 2 → A's 3,4 deferred
  });
  it('respects maxTotal', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ t: i % 2 === 0 ? 'A' : 'B', id: i }));
    expect(fairBatchByTenant(items, (x) => x.t, { maxPerTenant: 5, maxTotal: 4 })).toHaveLength(4);
  });
});
