import { describe, it, expect, beforeEach } from 'vitest';
import { PromotionsService, PromotionError } from './promotions.service';
import { InMemoryPromotionsRepository, type PromotionFacts } from './promotions.repository';

const basePromo = (over: Partial<PromotionFacts> = {}): PromotionFacts => ({
  id: 'p1', tenantId: 't1', branchId: null, promotionType: 'percentage', discountValue: 20, maxDiscountCents: null, minPurchaseCents: 0,
  startAt: null, endAt: null, status: 'active', approvalRequired: false, approvalStatus: 'not_required',
  customerLimit: 0, branchLimit: 0, tenantLimit: 0, globalLimit: 0, ...over,
});

let repo: InMemoryPromotionsRepository; let svc: PromotionsService;
beforeEach(() => { repo = new InMemoryPromotionsRepository(); svc = new PromotionsService(repo); });

describe('PromotionsService', () => {
  it('validate computes the discount SERVER-SIDE and never writes a redemption', async () => {
    repo.promotions.set('p1', basePromo());
    const r = await svc.validate({ tenantId: 't1' }, { promotionId: 'p1', eligibleSubtotalCents: 15600 });
    expect(r).toEqual({ eligible: true, discountCents: 3120, finalSubtotalCents: 12480 });
    expect(repo.redemptions).toHaveLength(0);
  });

  it('redeem writes exactly one redemption with the server-computed discount', async () => {
    repo.promotions.set('p1', basePromo({ promotionType: 'fixed_amount', discountValue: 2500 }));
    const r = await svc.redeem({ tenantId: 't1' }, { promotionId: 'p1', customerId: 'c1', eligibleSubtotalCents: 10000, idempotencyKey: 'k1' });
    expect(r.idempotentReplay).toBe(false);
    expect(r.redemption).toMatchObject({ discountCents: 2500, finalSubtotalCents: 7500, status: 'redeemed' });
    expect(repo.redemptions).toHaveLength(1);
  });

  it('redeem is idempotent — a retry with the same key returns the same row, no second redemption', async () => {
    repo.promotions.set('p1', basePromo());
    const a = await svc.redeem({ tenantId: 't1' }, { promotionId: 'p1', customerId: 'c1', eligibleSubtotalCents: 10000, idempotencyKey: 'dup' });
    const b = await svc.redeem({ tenantId: 't1' }, { promotionId: 'p1', customerId: 'c1', eligibleSubtotalCents: 10000, idempotencyKey: 'dup' });
    expect(b.idempotentReplay).toBe(true);
    expect(b.redemption.id).toBe(a.redemption.id);
    expect(repo.redemptions).toHaveLength(1);
  });

  it('enforces the per-customer limit (→ ineligible/409)', async () => {
    repo.promotions.set('p1', basePromo({ customerLimit: 1 }));
    await svc.redeem({ tenantId: 't1' }, { promotionId: 'p1', customerId: 'c1', eligibleSubtotalCents: 10000, idempotencyKey: 'k1' });
    await expect(svc.redeem({ tenantId: 't1' }, { promotionId: 'p1', customerId: 'c1', eligibleSubtotalCents: 10000, idempotencyKey: 'k2' }))
      .rejects.toMatchObject({ code: 'ineligible' });
    expect(repo.redemptions.filter((r) => r.status === 'redeemed')).toHaveLength(1);
  });

  it('rejects a disabled promotion and a foreign-tenant promotion', async () => {
    repo.promotions.set('p1', basePromo({ status: 'disabled' }));
    await expect(svc.validate({ tenantId: 't1' }, { promotionId: 'p1', eligibleSubtotalCents: 10000 })).rejects.toBeInstanceOf(PromotionError);
    repo.promotions.set('p2', basePromo({ id: 'p2', tenantId: 'OTHER' }));
    await expect(svc.validate({ tenantId: 't1' }, { promotionId: 'p2', eligibleSubtotalCents: 10000 })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reverse requires a reason, preserves the row, and is idempotent', async () => {
    repo.promotions.set('p1', basePromo());
    const red = await svc.redeem({ tenantId: 't1' }, { promotionId: 'p1', customerId: 'c1', eligibleSubtotalCents: 10000, idempotencyKey: 'k1' });
    await expect(svc.reverse({ tenantId: 't1' }, red.redemption.id, '')).rejects.toMatchObject({ code: 'invalid' });
    const rev = await svc.reverse({ tenantId: 't1' }, red.redemption.id, 'customer refund');
    expect(rev.redemption.status).toBe('reversed');
    expect(repo.redemptions).toHaveLength(1); // preserved, not deleted
    const again = await svc.reverse({ tenantId: 't1' }, red.redemption.id, 'customer refund');
    expect(again.alreadyReversed).toBe(true);
  });
});
