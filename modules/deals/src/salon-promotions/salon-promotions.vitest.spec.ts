import { describe, it, expect } from 'vitest';
import {
  computeSalonDiscountCents, salonPromotionRedeemable, validateCreateSalonPromotion, buildSalonPromotionsSummary,
  type SalonPromotion, type SalonPromotionsContext,
} from './salon-promotions.dto';
import { InMemorySalonPromotionsRepository } from './salon-promotions.repository';
import { SalonPromotionsService, SalonPromotionForbiddenError, SalonPromotionValidationError } from './salon-promotions.service';

const promo = (o: Partial<SalonPromotion> = {}): SalonPromotion => ({
  id: 'p1', code: 'SPRING20', name: 'Spring 20% Off', discountType: 'percent', discountPercent: 20, discountCents: null,
  minPurchaseCents: 0, status: 'active', startsAt: null, endsAt: null, maxRedemptions: null, redemptionCount: 0, createdAt: '2026-07-01T00:00:00.000Z', ...o,
});
const ctx = (o: Partial<SalonPromotionsContext> = {}): SalonPromotionsContext => ({ tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.marketing.manage'], ...o });

describe('salon promotions — discount math (pure, integer cents)', () => {
  it('percent discount, clamped to subtotal', () => {
    expect(computeSalonDiscountCents({ discountType: 'percent', discountPercent: 20, discountCents: null }, 15600)).toBe(3120);
    expect(computeSalonDiscountCents({ discountType: 'percent', discountPercent: 200, discountCents: null }, 1000)).toBe(1000); // clamped
  });
  it('fixed discount, clamped to subtotal', () => {
    expect(computeSalonDiscountCents({ discountType: 'fixed', discountPercent: null, discountCents: 2500 }, 10000)).toBe(2500);
    expect(computeSalonDiscountCents({ discountType: 'fixed', discountPercent: null, discountCents: 5000 }, 3000)).toBe(3000); // clamped
  });
});

describe('salon promotions — redeemability (pure)', () => {
  const now = '2026-07-15T12:00:00.000Z';
  it('active + within window + limit + min purchase → ok', () => {
    expect(salonPromotionRedeemable(promo({ minPurchaseCents: 5000 }), 10000, now).ok).toBe(true);
  });
  it('rejects inactive, expired, over-limit, and below-minimum', () => {
    expect(salonPromotionRedeemable(promo({ status: 'paused' }), 10000, now).reason).toMatch(/not active/);
    expect(salonPromotionRedeemable(promo({ endsAt: '2026-07-01T00:00:00Z' }), 10000, now).reason).toMatch(/expired/);
    expect(salonPromotionRedeemable(promo({ maxRedemptions: 5, redemptionCount: 5 }), 10000, now).reason).toMatch(/limit/);
    expect(salonPromotionRedeemable(promo({ minPurchaseCents: 20000 }), 10000, now).reason).toMatch(/Minimum/);
  });
});

describe('salon promotions — create validation (pure)', () => {
  it('requires code, name, and a valid discount', () => {
    expect(validateCreateSalonPromotion({ code: '', name: 'x', discountType: 'percent', discountPercent: 10 }).error).toMatch(/Code/);
    expect(validateCreateSalonPromotion({ code: 'A', name: '', discountType: 'percent', discountPercent: 10 }).error).toMatch(/Name/);
    expect(validateCreateSalonPromotion({ code: 'A', name: 'x', discountType: 'percent', discountPercent: 0 }).error).toMatch(/1 and 100/);
    expect(validateCreateSalonPromotion({ code: 'A', name: 'x', discountType: 'fixed', discountCents: 0 }).error).toMatch(/greater than 0/);
    expect(validateCreateSalonPromotion({ code: 'A', name: 'x', discountType: 'percent', discountPercent: 25 }).ok).toBe(true);
  });
});

describe('salon promotions — summary (pure)', () => {
  it('counts statuses, redemptions, and expiring-soon', () => {
    const now = '2026-07-15T00:00:00.000Z';
    const s = buildSalonPromotionsSummary([
      promo({ status: 'active', redemptionCount: 3, endsAt: '2026-07-18T00:00:00Z' }), // expiring soon
      promo({ id: 'p2', status: 'active', redemptionCount: 1, endsAt: '2026-09-01T00:00:00Z' }),
      promo({ id: 'p3', status: 'paused', redemptionCount: 2 }),
    ], now);
    expect(s).toEqual({ total: 3, active: 2, paused: 1, totalRedemptions: 6, expiringSoon: 1 });
  });
});

describe('salon promotions — service', () => {
  it('creates, lists via state, rejects duplicate codes, and redeems with server-computed discount', async () => {
    const svc = new SalonPromotionsService(new InMemorySalonPromotionsRepository());
    await svc.create(ctx(), { code: 'SPRING20', name: 'Spring', discountType: 'percent', discountPercent: 20 });
    const state = await svc.getState(ctx());
    expect(state.promotions).toHaveLength(1);
    expect(state.kpis.active).toBe(1);
    await expect(svc.create(ctx(), { code: 'spring20', name: 'dup', discountType: 'percent', discountPercent: 10 }))
      .rejects.toBeInstanceOf(SalonPromotionValidationError);
    const r = await svc.redeem(ctx(), 'SPRING20', 10000);
    expect(r.ok).toBe(true);
    expect(r.discountCents).toBe(2000);
    // BUILD_PLAN Phase 5: a check is not a use — the count moves only when a PAID ticket carried the coupon
    expect(r.promotion?.redemptionCount).toBe(0);
    expect((await svc.redeem(ctx(), 'SPRING20', 10000)).ok).toBe(true);
  });
  it('redeem reports a reason for an unknown code and rejects unauthenticated', async () => {
    const svc = new SalonPromotionsService(new InMemorySalonPromotionsRepository());
    expect((await svc.redeem(ctx(), 'NOPE', 10000)).ok).toBe(false);
    await expect(svc.getState({ tenantId: '', userId: '', role: '', permissions: [] } as any)).rejects.toBeInstanceOf(SalonPromotionForbiddenError);
  });
});
