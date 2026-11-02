// ai-checkout-upsell.mutations.vitest.spec.ts — stage-3 safety: confirmation-gated, revalidated, idempotent mutations
// that delegate to the authoritative domain services and never let a model price/price-bypass through.
import { describe, it, expect } from 'vitest';
import { AiCheckoutUpsellService, AiCheckoutUpsellForbiddenError, type MutationDeps } from './ai-checkout-upsell.service';
import { InMemoryIdempotencyStore, runOnce } from './ai-checkout-upsell.idempotency';

const TICKET = (status = 'open') => ({ checkoutId: 'c1', branchId: 'b1', customerId: 'cust1', status, serviceLines: [{ serviceId: 'svc1', serviceName: 'Gel' }], cartAddOnIds: ['already'], subtotalCents: 5000 });
const checkout: any = { getTicket: async (_c: any, id: string) => TICKET(id === 'paying' ? 'payment_in_progress' : 'open') };
const addOns: any = { getAddOns: async () => [{ addOnId: 'ao1', name: 'Nail Art', priceCents: 1500, durationDeltaMinutes: 20, isTaxable: true, isActive: true }] };
const memberships: any = { candidates: async () => [{ planId: 'gold', name: 'Gold', recurringPriceCents: 3900, billingFrequency: 'month', includedBenefit: 'x', eligibleToday: true, customerAlreadyHasActive: false }, { planId: 'have', name: 'Have', recurringPriceCents: 2900, billingFrequency: 'month', includedBenefit: 'x', eligibleToday: true, customerAlreadyHasActive: true }] };
const loyalty: any = { state: async () => ({ enroll: { programActive: true, branchParticipates: true, alreadyEnrolled: true, eligible: false, programName: 'R' }, redeem: { enrolled: true, balancePoints: 500, cartEligible: true, rewards: [{ rewardId: 'r5', label: '$5', pointsCost: 500, valueCents: 500 }, { rewardId: 'r50', label: '$50', pointsCost: 5000, valueCents: 5000 }] } }) };
const giftCards: any = { options: async () => ({ enabled: false, allowedAmountsCents: [] }) };
const booking: any = { context: async () => null };

function harness() {
  const calls = { addLine: 0, enroll: 0, redeem: 0, recalc: 0 }; let addLineInput: any = null;
  const mut: MutationDeps = {
    idem: new InMemoryIdempotencyStore(),
    addOn: { addServiceLine: async (_c, _id, input) => { calls.addLine++; addLineInput = input; return { lineId: 'L' + calls.addLine }; } },
    membership: { enroll: async () => { calls.enroll++; return { membershipId: 'M1' }; } },
    loyalty: { enroll: async () => ({ enrolled: true as const }), redeem: async () => { calls.redeem++; return { redemptionId: 'RD1' }; } },
    promotion: { apply: async () => ({ applied: true as const }) },
    booking: { openBooking: async () => ({ bookingDraftId: 'BD1' }) },
    recalc: { recalculate: async () => { calls.recalc++; return { totalCents: 6500, subtotalCents: 6000, taxCents: 500 }; } },
  };
  const svc = new AiCheckoutUpsellService(checkout, addOns, memberships as any, memberships, loyalty, giftCards, booking, undefined, undefined, null, undefined, mut);
  return { svc, calls, get addLineInput() { return addLineInput; } };
}
const ctx = (perms = ['pos.checkout.reopen_service', 'pos.memberships.enroll', 'pos.loyalty.redeem', 'pos.deals.apply', 'pos.booking.create']): any => ({ tenantId: 'A', branchId: 'b1', userId: 'u', role: 'MANAGER', permissions: perms });

describe('mutation safety (§8/§27/§47)', () => {
  it('requires explicit confirmation and never mutates on view', async () => {
    const h = harness();
    await expect(h.svc.addServiceAddon(ctx(), 'c1', 'ao1', {})).rejects.toThrow('HUMAN_CONFIRMATION_REQUIRED');
    expect(h.calls.addLine).toBe(0);
  });
  it('adds via the domain add-line service, recalculates, and passes NO model price', async () => {
    const h = harness();
    const r: any = await h.svc.addServiceAddon(ctx(), 'c1', 'ao1', { confirm: true, idempotencyKey: 'k1' });
    expect(r.added).toBe(true); expect(h.calls.addLine).toBe(1); expect(h.calls.recalc).toBe(1);
    expect('priceCents' in h.addLineInput).toBe(false);
  });
  it('blocks duplicate lines, incompatible add-ons, payment-stage, and missing permission', async () => {
    const h = harness();
    await expect(h.svc.addServiceAddon(ctx(), 'c1', 'already', { confirm: true, idempotencyKey: 'k2' })).rejects.toThrow('DUPLICATE_CART_ACTION');
    await expect(h.svc.addServiceAddon(ctx(), 'c1', 'from_model', { confirm: true, idempotencyKey: 'k3' })).rejects.toThrow('SERVICE_ADDON_INCOMPATIBLE');
    await expect(h.svc.addServiceAddon(ctx(), 'paying', 'ao1', { confirm: true, idempotencyKey: 'k4' })).rejects.toThrow('CHECKOUT_NOT_EDITABLE');
    await expect(h.svc.addServiceAddon(ctx([]), 'c1', 'ao1', { confirm: true })).rejects.toBeInstanceOf(AiCheckoutUpsellForbiddenError);
  });
  it('is idempotent under duplicate keys (double-click safe)', async () => {
    const h = harness();
    const a: any = await h.svc.addServiceAddon(ctx(), 'c1', 'ao1', { confirm: true, idempotencyKey: 'same' });
    const b: any = await h.svc.addServiceAddon(ctx(), 'c1', 'ao1', { confirm: true, idempotencyKey: 'same' });
    expect(h.calls.addLine).toBe(1); expect(b.lineId).toBe(a.lineId);
  });
  it('enforces membership + loyalty eligibility against authoritative state', async () => {
    const h = harness();
    await expect(h.svc.enrollMembership(ctx(), 'c1', 'have', { confirm: true, idempotencyKey: 'm1' })).rejects.toThrow('MEMBERSHIP_ALREADY_ACTIVE');
    expect((await h.svc.enrollMembership(ctx(), 'c1', 'gold', { confirm: true, idempotencyKey: 'm2' }) as any).enrolled).toBe(true);
    await expect(h.svc.redeemLoyalty(ctx(), 'c1', 'r50', { confirm: true, idempotencyKey: 'l1' })).rejects.toThrow('LOYALTY_BALANCE_INSUFFICIENT');
    expect((await h.svc.redeemLoyalty(ctx(), 'c1', 'r5', { confirm: true, idempotencyKey: 'l2' }) as any).redeemed).toBe(true);
  });
  it('opens next appointment separately from the cart (no recalc, allowed at payment stage)', async () => {
    const h = harness();
    const r: any = await h.svc.openNextAppointment(ctx(), 'paying', 'svc1', { confirm: true, idempotencyKey: 'b1' });
    expect(r.opened).toBe(true); expect(h.calls.recalc).toBe(0);
  });
});

describe('idempotency primitive (§46)', () => {
  it('executes once, conflicts on payload mismatch, retries after pre-commit failure', async () => {
    const store = new InMemoryIdempotencyStore(); let runs = 0;
    const r1: any = await runOnce(store, 'K', { a: 1 }, async () => { runs++; return { v: 1 }; });
    const r2: any = await runOnce(store, 'K', { a: 1 }, async () => { runs++; return { v: 2 }; });
    expect(runs).toBe(1); expect(r2.v).toBe(1);
    await expect(runOnce(store, 'K', { a: 2 }, async () => ({ v: 3 }))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    const s2 = new InMemoryIdempotencyStore(); let attempts = 0;
    await expect(runOnce(s2, 'K2', { a: 1 }, async () => { attempts++; throw new Error('boom'); })).rejects.toThrow();
    const ok2: any = await runOnce(s2, 'K2', { a: 1 }, async () => { attempts++; return { v: 'ok' }; });
    expect(attempts).toBe(2); expect(ok2.v).toBe('ok');
  });
});
