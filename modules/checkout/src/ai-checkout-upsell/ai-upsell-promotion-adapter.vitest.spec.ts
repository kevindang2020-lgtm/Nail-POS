// BUILD_PLAN Phase 5, bug 9: the AI checkout assistant's "apply promotion" handed CheckoutService.applyPromotion an
// OBJECT where a redeemer function belonged — every AI-applied promotion was a TypeError. The adapter now applies the
// offer through the deals engine (eligibility, stacking, capacity), by the deal's id.
import { describe, it, expect } from 'vitest';
import { CheckoutPromotionMutationAdapter } from './ai-checkout-upsell.adapters';

describe('AI upsell — apply promotion', () => {
  it('applies the deal by id through checkout’s offer path (no TypeError)', async () => {
    const calls: any[] = [];
    const checkout: any = {
      async applyPromotion(_c: any, _id: string, _code: string, redeem: any) { return redeem(5000); },   // the old contract
      async applyOffer(c: any, id: string, req: any) { calls.push({ c, id, req }); return { applied: true }; },
    };
    const r = await new CheckoutPromotionMutationAdapter(checkout).apply({ tenantId: 't', branchId: 'b', userId: 'u', role: 'MANAGER', permissions: [] } as any, 'tk1', 'deal-9');
    expect(r).toEqual({ applied: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'tk1', req: { dealId: 'deal-9', source: 'ai_checkout_upsell' } });
  });
  it('a refusal from the engine surfaces as an error (never a silent success)', async () => {
    const checkout: any = { async applyOffer() { const e = new Error('This deal is for members only.'); e.name = 'ValidationError'; throw e; } };
    await expect(new CheckoutPromotionMutationAdapter(checkout).apply({ tenantId: 't', userId: 'u' } as any, 'tk1', 'deal-9')).rejects.toThrow(/members only/);
  });
});
