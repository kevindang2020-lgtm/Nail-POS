// ai-checkout-upsell.records.vitest.spec.ts — stage-4 recommendation records (§44), state validity (§45), and
// dismissal/feedback (§52/§53). A stale or expired recommendation can never be applied; a dismissed card never resurfaces.
import { describe, it, expect } from 'vitest';
import { newRecord, isValid, acceptBlockedReason, transition } from './ai-checkout-upsell.records';
import { AiCheckoutUpsellService } from './ai-checkout-upsell.service';

const NOW = '2026-07-07T12:00:00.000Z';
const card: any = { type: 'service_addon', targetId: 'ao1', title: 'Nail Art', description: '', priceCents: 1500, confidence: 'high', reason: '', eligible: true };
const rec = () => newRecord({ recommendationId: 'R1', tenantId: 'A', branchId: 'b1', checkoutId: 'c1', customerId: 'cust1', card, contextFingerprint: 'CX1', nowIso: NOW });

describe('recommendation records + validity (§44/§45)', () => {
  it('is valid only while fresh + context-matched, and blocks stale/expired/applied accepts', () => {
    const r = rec();
    expect(r.status).toBe('GENERATED');
    expect(isValid(r, 'CX1', NOW)).toBe(true);
    expect(isValid(r, 'CX_CHANGED', NOW)).toBe(false);
    expect(isValid(r, 'CX1', '2026-07-07T12:10:00.000Z')).toBe(false);
    expect(acceptBlockedReason(r, 'CX1', NOW)).toBeNull();
    expect(acceptBlockedReason(r, 'CX2', NOW)).toBe('RECOMMENDATION_NO_LONGER_ELIGIBLE');
    expect(acceptBlockedReason(r, 'CX1', '2026-07-07T12:10:00.000Z')).toBe('RECOMMENDATION_EXPIRED');
    const applied = transition(transition(r, 'ACCEPTED'), 'APPLIED');
    expect(applied.status).toBe('APPLIED');
    expect(acceptBlockedReason(applied, 'CX1', NOW)).toBe('DUPLICATE_CART_ACTION');
    expect(() => transition(applied, 'DISPLAYED')).toThrow('INVALID_RECOMMENDATION_TRANSITION');
  });
});

describe('dismissal + feedback (§52/§53)', () => {
  // $100 booking: Decision 27's cap is min($30, 30%) = $30, so both add-ons ($15 + $10) fit; this test is about dismissal, not the cap.
  const TICKET = { checkoutId: 'c1', branchId: 'b1', customerId: 'cust1', status: 'open', serviceLines: [{ serviceId: 'svc1', serviceName: 'Gel' }], cartAddOnIds: [], subtotalCents: 10000 };
  const checkout: any = { getTicket: async () => TICKET };
  const addOns: any = { getAddOns: async () => [{ addOnId: 'ao1', name: 'Nail Art', priceCents: 1500, durationDeltaMinutes: 20, isTaxable: false, isActive: true }, { addOnId: 'ao2', name: 'Cuticle', priceCents: 1000, durationDeltaMinutes: 10, isTaxable: false, isActive: true }] };
  const stub: any = { candidates: async () => [], state: async () => ({ enroll: { programActive: false, branchParticipates: false, alreadyEnrolled: true, eligible: false, programName: '' }, redeem: { enrolled: false, balancePoints: 0, rewards: [], cartEligible: false } }), options: async () => ({ enabled: false, allowedAmountsCents: [] }), context: async () => null };
  const ctx: any = { tenantId: 'A', branchId: 'b1', userId: 'u', role: 'RECEPTION', permissions: ['pos.checkout.view'] };

  it('suppresses a dismissed card on the next generation and validates feedback', async () => {
    const store: Record<string, string[]> = {};
    const dismissals: any = { dismissed: async (_c: any, id: string) => store[id] || [], record: async (_c: any, id: string, t: string) => { (store[id] = store[id] || []).push(t); }, recordFeedback: async () => {} };
    const svc = new AiCheckoutUpsellService(checkout, addOns, stub, stub, stub, stub, stub, undefined, dismissals, null, undefined);
    const before: any = await svc.recommendations(ctx, 'c1');
    expect(before.cards.some((c: any) => c.targetId === 'ao1')).toBe(true);
    await svc.dismiss(ctx, 'c1', 'ao1', 'not_relevant');
    const after: any = await svc.recommendations(ctx, 'c1');
    expect(after.cards.some((c: any) => c.targetId === 'ao1')).toBe(false);
    expect(after.cards.some((c: any) => c.targetId === 'ao2')).toBe(true);
    expect((await svc.recordFeedback(ctx, 'c1', 'R1', 'wrong_service') as any).recorded).toBe(true);
    await expect(svc.recordFeedback(ctx, 'c1', 'R1', 'make_it_free' as any)).rejects.toThrow('INVALID_FEEDBACK');
  });
});
