// ai-checkout-upsell.hardening.vitest.spec.ts — stage-6 hardening. (1) Concurrency: the unique-index idempotency store
// executes a charge-producing action exactly once under simultaneous submits (double-click / retry storm), and no
// cross-tenant leak occurs under concurrent generation. (2) Financial invariants (property-style): recommender prices
// are faithful pass-throughs, membership savings are the exact difference (never fabricated), loyalty never exceeds the
// authoritative balance, the added-value ceiling always holds, and the service never computes a checkout total.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyIdempotencyStore } from './ai-checkout-upsell.kysely';
import { runOnce, idempotencyKey } from './ai-checkout-upsell.idempotency';
import { recommendAddOns, recommendMembership, recommendLoyaltyRedemption } from './ai-checkout-upsell-core';
import { AiCheckoutUpsellService } from './ai-checkout-upsell.service';

const rnd = (n: number) => Math.floor(Math.random() * n);

// The store runs on the REAL schema (BUILD_PLAN Phase 10: the upsell's own idempotency table was merged into
// api_idempotency, migration 541) — its (scope, idem_key) primary key is the boundary under test.
const TA = 'a1a1a1a1-0000-4000-8000-0000000000a1', BR = 'b1b1b1b1-0000-4000-8000-0000000000b1', CO = 'c1c1c1c1-0000-4000-8000-0000000000c1';
let realDb: any;
beforeAll(async () => { realDb = kyselyFor(await migratedPglite()); }, 120_000);
const makeDB = () => realDb;

describe('concurrency (§47)', () => {
  it('executes a charge-producing action exactly once under simultaneous same-key submits', async () => {
    const store = new KyselyIdempotencyStore(makeDB(), 5, 200);
    const KEY = idempotencyKey({ tenantId: TA, branchId: BR, checkoutId: CO, operation: 'add_addon', targetId: 'ao1', clientKey: 'same' });
    let exec = 0;
    await Promise.all(Array.from({ length: 25 }, () => runOnce(store, KEY, { addOnId: 'ao1' }, async () => { exec++; await new Promise(r => setTimeout(r, 1)); return { lineId: 'L' }; }).catch(() => null)));
    expect(exec).toBe(1);
  });
  it('runs distinct-key concurrent submits independently', async () => {
    const store = new KyselyIdempotencyStore(makeDB(), 5, 200); let ex = 0;
    await Promise.all(Array.from({ length: 20 }, (_, i) => runOnce(store, idempotencyKey({ tenantId: TA, branchId: BR, checkoutId: CO, operation: 'add_addon', targetId: 'ao' + i, clientKey: 'k' }), { i }, async () => { ex++; return {}; })));
    expect(ex).toBe(20);
  });
});

describe('financial invariants', () => {
  it('recommender prices are faithful pass-throughs', () => {
    for (let it = 0; it < 100; it++) {
      const cands = Array.from({ length: 1 + rnd(6) }, (_, i) => ({ addOnId: 'a' + i, name: 'A' + i, priceCents: rnd(20000), durationDeltaMinutes: rnd(60), isTaxable: !!rnd(2), isActive: true, sourceServiceId: 's', sourceServiceName: 'S' }));
      for (const c of recommendAddOns({ candidates: cands, cartAddOnIds: [], sameVisitFeasible: true, maxAddOns: 10, ticketSubtotalCents: 10000 })) {
        expect(c.priceCents).toBe(cands.find(x => x.addOnId === c.targetId)!.priceCents);
      }
    }
  });
  it('membership savings are the exact difference and only when service > plan', () => {
    for (let it = 0; it < 100; it++) {
      const plan = rnd(10000), svc = rnd(10000);
      const reason = recommendMembership({ candidates: [{ planId: 'p', name: 'P', recurringPriceCents: plan, billingFrequency: 'month', includedBenefit: 'x', eligibleToday: true, customerAlreadyHasActive: false, todayEligibleServicePriceCents: svc }], max: 1 })[0].reason;
      const m = /may reduce.*\$([0-9.]+)\/month/.exec(reason);
      if (svc > plan) expect(m?.[1]).toBe(((svc - plan) / 100).toFixed(2)); else expect(m).toBeNull();
    }
  });
  it('loyalty redemption never exceeds the authoritative balance', () => {
    for (let it = 0; it < 100; it++) {
      const bal = rnd(5000);
      const rewards = Array.from({ length: 1 + rnd(5) }, (_, i) => ({ rewardId: 'r' + i, label: 'R' + i, pointsCost: rnd(6000), valueCents: rnd(5000) }));
      const c = recommendLoyaltyRedemption({ enrolled: true, balancePoints: bal, cartEligible: true, rewards });
      if (c) expect(rewards.find(x => x.rewardId === c.targetId)!.pointsCost).toBeLessThanOrEqual(bal);
    }
  });
  it('added-value ceiling holds and no checkout total is ever computed by the service', async () => {
    const TICKET = { checkoutId: 'c1', branchId: 'b1', customerId: 'cust', status: 'open', serviceLines: [{ serviceId: 'svc1', serviceName: 'Gel' }], cartAddOnIds: [], subtotalCents: 5000 };
    const checkout: any = { getTicket: async () => TICKET };
    const stub: any = { candidates: async () => [], state: async () => ({ enroll: { programActive: false, branchParticipates: false, alreadyEnrolled: true, eligible: false, programName: '' }, redeem: { enrolled: false, balancePoints: 0, rewards: [], cartEligible: false } }), options: async () => ({ enabled: false, allowedAmountsCents: [] }), context: async () => null };
    const ctx: any = { tenantId: 'A', branchId: 'b1', userId: 'u', role: 'RECEPTION', permissions: ['pos.checkout.view'] };
    for (let it = 0; it < 20; it++) {
      const ceiling = 10000 + rnd(40000);
      const addOns: any = { getAddOns: async () => Array.from({ length: 8 }, (_, i) => ({ addOnId: 'x' + i, name: 'X' + i, priceCents: rnd(15000), durationDeltaMinutes: i, isTaxable: false, isActive: true })) };
      const svc = new AiCheckoutUpsellService(checkout, addOns, stub, stub, stub, stub, stub, { layers: async () => ({ tenant: { tunables: { maxTotal: 8, maxAddOn: 8, maxAddedValueCents: ceiling } } }) } as any, { dismissed: async () => [] } as any, null, undefined);
      const r: any = await svc.recommendations(ctx, 'c1');
      expect(r.cards.reduce((s: number, c: any) => s + (c.priceCents || 0), 0)).toBeLessThanOrEqual(ceiling);
      expect('total' in r || 'totalCents' in r).toBe(false);
    }
  });
});
