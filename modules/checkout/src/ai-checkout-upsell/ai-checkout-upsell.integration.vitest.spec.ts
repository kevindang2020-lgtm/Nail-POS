// ai-checkout-upsell.integration.vitest.spec.ts — assembled end-to-end: the service wired as the module wires it (real
// code paths, faked ports), driven through the full vertical: recommend (add-on + membership) → records persisted →
// confirm add-on → domain delegate + recalc → record APPLIED → SA overview reflects the outcome → idempotent re-confirm.
import { describe, it, expect } from 'vitest';
import { AiCheckoutUpsellService, type MutationDeps, type RecommendationRecordPort } from './ai-checkout-upsell.service';
import { InMemoryIdempotencyStore } from './ai-checkout-upsell.idempotency';
import { buildPlatformOverview } from '@aipowersalon/super-admin';

describe('assembled vertical (recommend → confirm → apply → record → oversight)', () => {
  it('drives the full add-on + membership flow with real records and idempotency', async () => {
    const recRows: any[] = [];
    const records: RecommendationRecordPort = {
      async persistGenerated(_c, recs) { for (const r of recs) { const k = `${r.checkoutId}|${r.targetId}|${r.contextFingerprint}`; if (!recRows.some(x => x._k === k)) recRows.push({ _k: k, status: r.status, target: r.targetId }); } },
      async markApplied(_c, _id, target) { recRows.filter(r => r.target === target && (r.status === 'GENERATED' || r.status === 'DISPLAYED')).forEach(r => r.status = 'APPLIED'); },
      async markDismissed(_c, _id, target) { recRows.filter(r => r.target === target && (r.status === 'GENERATED' || r.status === 'DISPLAYED')).forEach(r => r.status = 'DISMISSED'); },
    };
    const TICKET = { checkoutId: 'c1', branchId: 'b1', customerId: 'cust1', status: 'open', serviceLines: [{ serviceId: 'svc_mani', serviceName: 'Signature Manicure' }], cartAddOnIds: [], subtotalCents: 5500 };
    const checkout: any = { getTicket: async () => TICKET };
    const addOns: any = { getAddOns: async () => [{ addOnId: 'svc_gel', name: 'Gel Add-on', priceCents: 1500, durationDeltaMinutes: 15, isTaxable: false, isActive: true }] };
    const membershipReco: any = { candidates: async () => [{ planId: 'gold', name: 'Gold', recurringPriceCents: 3900, billingFrequency: 'month', includedBenefit: 'x', eligibleToday: true, customerAlreadyHasActive: false, todayEligibleServicePriceCents: null }] };
    const loyaltyStub: any = { state: async () => ({ enroll: { programActive: false, branchParticipates: false, alreadyEnrolled: true, eligible: false, programName: '' }, redeem: { enrolled: false, balancePoints: 0, rewards: [], cartEligible: false } }) };
    const stub: any = { candidates: async () => [], options: async () => ({ enabled: false, allowedAmountsCents: [] }), context: async () => null };
    let addLineCalls = 0, recalcCalls = 0;
    const mut: MutationDeps = {
      idem: new InMemoryIdempotencyStore(),
      addOn: { addServiceLine: async () => { addLineCalls++; return { lineId: 'L1' }; } },
      membership: { enroll: async () => ({ membershipId: 'M1' }) },
      loyalty: { enroll: async () => ({ enrolled: true as const }), redeem: async () => ({ redemptionId: 'RD' }) },
      promotion: { apply: async () => ({ applied: true as const }) },
      booking: { openBooking: async () => ({ bookingDraftId: 'BD' }) },
      recalc: { recalculate: async () => { recalcCalls++; return { totalCents: 7000, subtotalCents: 7000, taxCents: 0 }; } },
    };
    const ctx: any = { tenantId: 'A', branchId: 'b1', userId: 'u', role: 'MANAGER', permissions: ['pos.checkout.view', 'pos.checkout.reopen_service'] };
    const svc = new AiCheckoutUpsellService(checkout, addOns, stub, membershipReco, loyaltyStub, stub, stub, undefined, { dismissed: async () => [], record: async () => {}, recordFeedback: async () => {} } as any, null, undefined, mut, records);

    const r: any = await svc.recommendations(ctx, 'c1');
    expect(r.cards.some((c: any) => c.targetId === 'svc_gel')).toBe(true);
    expect(r.cards.some((c: any) => c.targetId === 'gold')).toBe(true);
    expect(recRows.length).toBe(2);

    const add: any = await svc.addServiceAddon(ctx, 'c1', 'svc_gel', { confirm: true, idempotencyKey: 'k1' });
    expect(add.added).toBe(true); expect(addLineCalls).toBe(1); expect(recalcCalls).toBe(1);
    expect(recRows.find(x => x.target === 'svc_gel')!.status).toBe('APPLIED');

    const ov = buildPlatformOverview({ totalTenants: 1, disabledRows: [], generated: recRows.length, applied: recRows.filter(x => x.status === 'APPLIED').length, dismissed: 0 });
    expect(ov.recommendationsApplied).toBe(1);
    expect(ov.acceptanceRatePct).toBe(50);

    const add2: any = await svc.addServiceAddon(ctx, 'c1', 'svc_gel', { confirm: true, idempotencyKey: 'k1' });
    expect(addLineCalls).toBe(1); // idempotent
    expect(add2.lineId).toBe(add.lineId);
  });
});
