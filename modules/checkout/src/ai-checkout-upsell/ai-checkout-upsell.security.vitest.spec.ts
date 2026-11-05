// ai-checkout-upsell.security.vitest.spec.ts — stage-2 isolation + gating + settings + tool safety. Re-run on every
// change to the service. A single cross-tenant leak, a missing gate, or a mutation tool sneaking in fails the suite.
import { describe, it, expect } from 'vitest';
import { AiCheckoutUpsellService, AiCheckoutUpsellForbiddenError } from './ai-checkout-upsell.service';
import { resolveSettings, PLATFORM_DEFAULTS } from './ai-checkout-upsell-settings';
import { AI_CHECKOUT_UPSELL_TOOLS, allToolsReadOnly } from './ai-checkout-upsell.tools';

const TICKET = (tenant: string, status = 'open') => ({ checkoutId: 'c1', branchId: 'b1', customerId: 'cust' + tenant, status, serviceLines: [{ serviceId: 'svc' + tenant, serviceName: 'Gel ' + tenant }], cartAddOnIds: [], subtotalCents: 5000 });
const checkout: any = { getTicket: async (ctx: any, id: string) => id === 'missing' ? null : (id === 'otherbranch' ? { ...TICKET(ctx.tenantId), branchId: 'bZ' } : TICKET(ctx.tenantId, id === 'paying' ? 'payment_in_progress' : 'open')) };
const addOns: any = { getAddOns: async (ctx: any) => [{ addOnId: 'ao_' + ctx.tenantId, name: 'AddOn-' + ctx.tenantId, priceCents: 1200, durationDeltaMinutes: 10, isTaxable: false, isActive: true }] };
const products: any = { candidates: async (ctx: any) => [{ productId: 'p_' + ctx.tenantId, name: 'Prod-' + ctx.tenantId, priceCents: 900, isActive: true, sellable: true, stockStatus: 'in_stock', aftercareForServiceName: 'Gel' }] };
const memberships: any = { candidates: async () => [] };
const loyalty: any = { state: async () => ({ enroll: { programActive: false, branchParticipates: false, alreadyEnrolled: true, eligible: false, programName: 'x' }, redeem: { enrolled: false, balancePoints: 0, rewards: [], cartEligible: false } }) };
const giftCards: any = { options: async () => ({ enabled: false, allowedAmountsCents: [] }) };
const booking: any = { context: async () => null };
const ctx = (tenant: string, perms = ['pos.checkout.view'], branch = 'b1'): any => ({ tenantId: tenant, branchId: branch, userId: 'u', role: 'RECEPTION', permissions: perms });
const mk = (settingsPort?: any) => new AiCheckoutUpsellService(checkout, addOns, products, memberships, loyalty, giftCards, booking, settingsPort, undefined, null);

describe('ai_checkout_upsell isolation + gating (§5/§10/§70)', () => {
  it('never leaks another tenant\u2019s catalog', async () => {
    const svc = mk();
    const a: any = await svc.recommendations(ctx('A'), 'c1');
    const b: any = await svc.recommendations(ctx('B'), 'c1');
    expect(a.cards.some((c: any) => c.title === 'AddOn-A')).toBe(true);
    expect(a.cards.some((c: any) => /AddOn-B|Prod-B/.test(c.title))).toBe(false);
    expect(b.cards.some((c: any) => /AddOn-A|Prod-A/.test(c.title))).toBe(false);
  });
  it('enforces permission, enabled, payment-stage, and branch gates', async () => {
    const svc = mk();
    await expect(svc.recommendations(ctx('A', []), 'c1')).rejects.toBeInstanceOf(AiCheckoutUpsellForbiddenError);
    const d: any = await mk({ layers: async () => ({ tenant: { enabled: false } }) }).recommendations(ctx('A'), 'c1');
    expect(d.enabled).toBe(false); expect(d.cards.length).toBe(0);
    const frozen: any = await svc.recommendations(ctx('A'), 'paying');
    expect(frozen.frozen).toBe(true); expect(frozen.cards.length).toBe(0);
    await expect(svc.recommendations(ctx('A'), 'otherbranch')).rejects.toThrow('BRANCH_NOT_AUTHORIZED');
    await expect(svc.recommendations(ctx('A'), 'missing')).rejects.toThrow('CHECKOUT_NOT_FOUND');
  });
  it('enforces the added-value safety ceiling', async () => {
    const svc = new AiCheckoutUpsellService(checkout,
      { getAddOns: async () => Array.from({ length: 5 }, (_, i) => ({ addOnId: 'x' + i, name: 'X' + i, priceCents: 20000, durationDeltaMinutes: i, isTaxable: false, isActive: true })) } as any,
      { candidates: async () => [] } as any, memberships, loyalty, giftCards, booking,
      { layers: async () => ({ tenant: { tunables: { maxTotal: 8, maxAddOn: 8, maxAddedValueCents: 45000 } } }) } as any, undefined, null);
    const r: any = await svc.recommendations(ctx('A'), 'c1');
    expect(r.cards.reduce((s: number, c: any) => s + (c.priceCents || 0), 0)).toBeLessThanOrEqual(45000);
  });
});

describe('settings + tools', () => {
  it('disabled-wins and clamps tunables', () => {
    const eff = resolveSettings({ platform: PLATFORM_DEFAULTS, branch: { enabled: false }, tenant: { tunables: { maxAddOn: 99 } } });
    expect(eff.disabledAtLevel).toBe('branch');
    expect(eff.tunables.maxAddOn).toBe(5);
  });
  it('every tool is read-only and rejects malformed checkout ids', async () => {
    expect(allToolsReadOnly()).toBe(true);
    const tool = AI_CHECKOUT_UPSELL_TOOLS.find(t => t.name === 'get_checkout_recommendations')!;
    await expect(tool.run(mk() as any, ctx('A'), { checkoutId: 'bad id; DROP TABLE' } as any)).rejects.toThrow('CHECKOUT_NOT_FOUND');
  });
});
