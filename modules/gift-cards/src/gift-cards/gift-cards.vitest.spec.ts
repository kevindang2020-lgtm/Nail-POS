import { describe, it, expect } from 'vitest';
import { buildGiftCardsSummary, type GiftCardRow, type GiftCardsContext } from './gift-cards.dto';
import { InMemoryGiftCardsRepository } from './gift-cards.repository';
import { GiftCardsService, ForbiddenError } from './gift-cards.service';

const card = (over: Partial<GiftCardRow> = {}): GiftCardRow => ({
  id: 'g1', code: 'GC-0001', initialBalanceCents: 10000, balanceCents: 10000, status: 'active', customerId: null, createdAt: '2026-07-01T00:00:00.000Z', ...over,
});
const ctx = (over: Partial<GiftCardsContext> = {}): GiftCardsContext => ({ tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.checkout.view'], ...over });

describe('gift cards — summary builder (pure)', () => {
  it('counts by status and sums outstanding liability from active-card balances only', () => {
    const s = buildGiftCardsSummary([
      card({ id: 'a', status: 'active', initialBalanceCents: 10000, balanceCents: 6000 }),  // 4000 redeemed, 6000 outstanding
      card({ id: 'b', status: 'active', initialBalanceCents: 5000, balanceCents: 5000 }),    // 0 redeemed, 5000 outstanding
      card({ id: 'c', status: 'redeemed', initialBalanceCents: 2000, balanceCents: 0 }),     // 2000 redeemed, not outstanding
      card({ id: 'd', status: 'void', initialBalanceCents: 3000, balanceCents: 3000 }),      // voided, not outstanding
    ]);
    expect(s.totalCards).toBe(4);
    expect(s.activeCards).toBe(2);
    expect(s.redeemedCards).toBe(1);
    expect(s.voidCards).toBe(1);
    expect(s.outstandingCents).toBe(11000);     // 6000 + 5000 (active only)
    expect(s.issuedTotalCents).toBe(20000);     // 10000 + 5000 + 2000 + 3000
    expect(s.redeemedValueCents).toBe(6000);    // 4000 + 0 + 2000 + 0 (>=0)
  });

  it('handles an empty portfolio', () => {
    const s = buildGiftCardsSummary([]);
    expect(s).toEqual({ totalCards: 0, activeCards: 0, redeemedCards: 0, voidCards: 0, outstandingCents: 0, issuedTotalCents: 0, redeemedValueCents: 0 });
  });

  it('never reports negative redeemed value when balance exceeds initial (defensive)', () => {
    const s = buildGiftCardsSummary([card({ initialBalanceCents: 1000, balanceCents: 4000, status: 'active' })]);
    expect(s.redeemedValueCents).toBe(0);
    expect(s.outstandingCents).toBe(4000);
  });
});

describe('gift cards — service', () => {
  it('returns kpis + cards for an authenticated tenant user', async () => {
    const svc = new GiftCardsService(new InMemoryGiftCardsRepository([card({ status: 'active', balanceCents: 7500 })]));
    const state = await svc.getState(ctx());
    expect(state.cards).toHaveLength(1);
    expect(state.kpis.activeCards).toBe(1);
    expect(state.kpis.outstandingCents).toBe(7500);
  });

  it('rejects an unauthenticated context', async () => {
    const svc = new GiftCardsService(new InMemoryGiftCardsRepository([]));
    await expect(svc.getState({ tenantId: '', userId: '', role: '', permissions: [] } as any)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
