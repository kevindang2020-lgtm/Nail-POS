// checkout-membership-discount.vitest.spec.ts — Functional Decision 15: a membership benefit redeemed against a ticket's
// line reduces the bill, through the stacking engine, recorded in the discount snapshot.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER',
  permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.apply_discount', 'pos.checkout.override_total', 'pos.checkout.cash_payment'] } as any;
const TK = 'tk_2042';
async function setup() {
  const repo = new InMemoryCheckoutRepository(); const svc = new CheckoutService(repo);
  const t: any = await repo.ticket(ctx, TK);
  const line = t.lines[0];
  return { repo, svc, line, subtotal: t.lines.reduce((n: number, l: any) => n + l.priceCents, 0) };
}
const membershipCents = (t: any) => (t.discountSnapshot?.applied || []).filter((a: any) => a.category === 'membership').reduce((n: number, a: any) => n + a.appliedCents, 0);

describe('Functional Decision 15 — membership benefits reduce the bill', () => {
  it('an included-service credit redeemed on a line takes that line off the bill, as a membership discount in the snapshot', async () => {
    const { repo, svc, line } = await setup();
    repo.membershipRedemptions.push({ ticketId: TK, redemptionId: 'r1', serviceLineId: line.serviceLineId, standardValueCents: line.priceCents, upgradeChargeCents: 0 });
    await svc.detail(ctx, TK);
    const t: any = await repo.ticket(ctx, TK);
    expect(t.discountCents).toBe(line.priceCents);
    expect(membershipCents(t)).toBe(line.priceCents);
  });
  it('an upgrade the member pays for stays on the bill', async () => {
    const { repo, svc, line } = await setup();
    repo.membershipRedemptions.push({ ticketId: TK, redemptionId: 'r1', serviceLineId: line.serviceLineId, standardValueCents: line.priceCents, upgradeChargeCents: 1000 });
    await svc.detail(ctx, TK);
    expect((await repo.ticket(ctx, TK) as any).discountCents).toBe(line.priceCents - 1000);
  });
  it('a manual discount already on the ticket is kept alongside the membership discount', async () => {
    const { repo, svc, line } = await setup();
    await svc.applyDiscount(ctx, TK, { discountCents: 500 } as any);
    repo.membershipRedemptions.push({ ticketId: TK, redemptionId: 'r1', serviceLineId: line.serviceLineId, standardValueCents: line.priceCents, upgradeChargeCents: 1000 });   // $10 left for the manual discount (the engine applies membership BEFORE manual)
    await svc.detail(ctx, TK);
    const t: any = await repo.ticket(ctx, TK);
    expect((t.discountSnapshot.applied as any[]).map((a) => a.category).sort()).toEqual(['manual', 'membership']);
  });
  it('idempotent: viewing the ticket again does not rewrite the discount', async () => {
    const { repo, svc, line } = await setup();
    repo.membershipRedemptions.push({ ticketId: TK, redemptionId: 'r1', serviceLineId: line.serviceLineId, standardValueCents: line.priceCents, upgradeChargeCents: 0 });
    await svc.detail(ctx, TK);
    let writes = 0; const orig = repo.setDiscount.bind(repo); (repo as any).setDiscount = async (...a: any[]) => { writes++; return orig(...(a as [any, any, any, any])); };
    await svc.detail(ctx, TK); await svc.detail(ctx, TK);
    expect(writes).toBe(0);
  });
  it('the member pays the reduced total: cash checkout charges the bill minus the membership benefit', async () => {
    const { repo, svc, line } = await setup();
    repo.membershipRedemptions.push({ ticketId: TK, redemptionId: 'r1', serviceLineId: line.serviceLineId, standardValueCents: line.priceCents, upgradeChargeCents: 1000 });   // partly covered, so something is still due
    const before: any = await repo.totalsFor(ctx, TK, 'cash');
    const r: any = await svc.payCash(ctx, TK, { amountReceivedCents: 1_000_000 } as any);
    expect(r.payment.amountCents).toBeLessThan(before.totalDueCents);           // the benefit came off before money moved
  });
  it('no redemptions → no membership discount, nothing written', async () => {
    const { repo, svc } = await setup();
    await svc.detail(ctx, TK);
    expect(membershipCents(await repo.ticket(ctx, TK))).toBe(0);
  });

  // Oct 2 (rebuilt after the reset): the service runs the one membership rule — dollar credits at their real value and
  // the best live percent/fixed member discount on lines no redemption covers.
  it('a $25 dollar credit on a line takes $25 off, and a 10% member discount applies to the other service lines', async () => {
    const repo = new InMemoryCheckoutRepository(); const svc = new CheckoutService(repo);
    const TK2 = 'tk_2041';   // two service lines — the member discount needs a line the credit does not cover
    const t0: any = await repo.ticket(ctx, TK2); const line = t0.lines[0];
    repo.membershipRedemptions.push({ ticketId: TK2, redemptionId: 'r9', serviceLineId: line.serviceLineId, standardValueCents: line.priceCents, upgradeChargeCents: 0, benefitType: 'dollar_credit', allocatedValueCents: 2500 });
    repo.memberInputs[TK2] = { lines: t0.lines.map((l: any) => ({ serviceLineId: l.serviceLineId, serviceName: l.serviceName, serviceId: null, categoryName: null, isRetail: false, priceCents: l.priceCents })),
      benefits: [{ benefitId: 'b10', benefitType: 'percent_discount', label: '10% off', percent: 10, valueCents: 0, serviceId: null, categoryName: null }] };
    await svc.detail(ctx, TK2);
    const t: any = await repo.ticket(ctx, TK2);
    const others = t0.lines.filter((l: any) => l.serviceLineId !== line.serviceLineId).reduce((n: number, l: any) => n + l.priceCents, 0);
    expect(membershipCents(t)).toBe(Math.min(2500, line.priceCents) + Math.round(others * 0.1));
    expect(others).toBeGreaterThan(0);
    expect((t.discountSnapshot.applied as any[]).map((a) => a.id).sort()).toEqual(['membership-benefit-b10', 'membership-r9']);
  });
});
