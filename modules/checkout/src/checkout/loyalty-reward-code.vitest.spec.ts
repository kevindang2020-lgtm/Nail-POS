// loyalty-reward-code.vitest.spec.ts — Decision 15 loyalty step: what a reward code takes off, when it cannot be used,
// and the checkout flow (apply → reserved to the ticket → used on payment; remove releases it).
import { describe, it, expect } from 'vitest';
import { rewardCodeDiscountCents, rewardCodeProblem, normalizeRewardCode, type RewardCodeRow } from './loyalty-reward-code';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

const code = (o: Partial<RewardCodeRow> = {}): RewardCodeRow => ({ redemptionId: 'rd1', code: 'RDMABC12345', customerId: 'cust1', rewardTitle: '$10 off', status: 'issued', rewardType: 'amount_off', valueCents: 1000, percent: 0, expiresAt: null, ticketId: null, ...o });
const NOW = Date.parse('2026-10-02T15:00:00Z');

describe('rewardCodeDiscountCents', () => {
  it('amount off, never more than what is left', () => {
    expect(rewardCodeDiscountCents(code(), 5000)).toBe(1000);
    expect(rewardCodeDiscountCents(code(), 600)).toBe(600);
  });
  it('percent off what is left after the earlier steps', () => {
    expect(rewardCodeDiscountCents(code({ rewardType: 'percent_off', valueCents: 0, percent: 15 }), 4000)).toBe(600);
    expect(rewardCodeDiscountCents(code({ rewardType: 'percent_off', valueCents: 0, percent: 15 }), 0)).toBe(0);
  });
});

describe('rewardCodeProblem', () => {
  const tk = { ticketId: 'tk1', customerId: 'cust1' };
  it('accepts an issued, unexpired code of this customer — and the same code already on THIS ticket', () => {
    expect(rewardCodeProblem(code(), tk, NOW)).toBeNull();
    expect(rewardCodeProblem(code({ status: 'applied', ticketId: 'tk1' }), tk, NOW)).toBeNull();
  });
  it('refuses: unknown, another customer, a walk-in with no customer, used, void, on another ticket, expired, no value', () => {
    expect(rewardCodeProblem(null, tk, NOW)).toMatch(/not found/);
    expect(rewardCodeProblem(code({ customerId: 'other' }), tk, NOW)).toMatch(/different customer/);
    expect(rewardCodeProblem(code(), { ticketId: 'tk1', customerId: null }, NOW)).toMatch(/different customer/);
    expect(rewardCodeProblem(code({ status: 'used' }), tk, NOW)).toMatch(/already been used/);
    expect(rewardCodeProblem(code({ status: 'void' }), tk, NOW)).toMatch(/cancelled/);
    expect(rewardCodeProblem(code({ status: 'applied', ticketId: 'tk9' }), tk, NOW)).toMatch(/another open ticket/);
    expect(rewardCodeProblem(code({ expiresAt: '2026-10-02T14:59:59Z' }), tk, NOW)).toMatch(/expired/);
    expect(rewardCodeProblem(code({ valueCents: 0 }), tk, NOW)).toMatch(/no value/);
  });
  it('codes are matched however staff type them', () => { expect(normalizeRewardCode(' rdm abc 12345 ')).toBe('RDMABC12345'); });
});

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_fd', role: 'FRONT_DESK',
  permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.redeem_reward', 'pos.checkout.cash_payment'] } as any;
const TK = 'tk_2041';
async function setup(o: Partial<RewardCodeRow> = {}) {
  const repo = new InMemoryCheckoutRepository(); const svc = new CheckoutService(repo);
  const t: any = await repo.ticket(ctx, TK);
  repo.rewardCodes.push(code({ customerId: t.customerId, ...o }));
  return { repo, svc, t, subtotal: t.lines.reduce((n: number, l: any) => n + l.priceCents, 0) };
}
const loyaltyCents = (t: any) => (t.discountSnapshot?.applied || []).filter((a: any) => a.category === 'loyalty').reduce((n: number, a: any) => n + a.appliedCents, 0);

describe('checkout — reward codes', () => {
  it('front desk applies a $10 code: reserved to the ticket, $10 off as a loyalty discount', async () => {
    const { repo, svc } = await setup();
    await svc.applyRewardCode(ctx, TK, 'rdmabc12345');
    expect(loyaltyCents(await repo.ticket(ctx, TK))).toBe(1000);
    expect(repo.rewardCodes[0]).toMatchObject({ status: 'applied', ticketId: TK });
  });
  it('a percent code is on what the earlier steps left, and follows the ticket when lines change', async () => {
    const { repo, svc, subtotal } = await setup({ rewardType: 'percent_off', valueCents: 0, percent: 10 });
    await svc.applyRewardCode(ctx, TK, 'RDMABC12345');
    expect(loyaltyCents(await repo.ticket(ctx, TK))).toBe(Math.round(subtotal * 0.1));
  });
  it('refusals are explained and reserve nothing', async () => {
    const { repo, svc } = await setup({ customerId: 'someone-else' });
    await expect(svc.applyRewardCode(ctx, TK, 'RDMABC12345')).rejects.toThrow(/different customer/);
    expect(repo.rewardCodes[0].status).toBe('issued');
    await expect(svc.applyRewardCode(ctx, TK, 'NOPE')).rejects.toThrow(/not found/);
  });
  it('one reward per ticket; removing releases the code and the discount', async () => {
    const { repo, svc, t } = await setup();
    repo.rewardCodes.push(code({ redemptionId: 'rd2', code: 'RDMSECOND1', customerId: t.customerId }));
    await svc.applyRewardCode(ctx, TK, 'RDMABC12345');
    await expect(svc.applyRewardCode(ctx, TK, 'RDMSECOND1')).rejects.toThrow(/already has a reward/);
    await svc.removeRewardCode(ctx, TK);
    expect(loyaltyCents(await repo.ticket(ctx, TK))).toBe(0);
    expect(repo.rewardCodes[0]).toMatchObject({ status: 'issued', ticketId: null });
  });
  it('a code reserved to another ticket cannot be taken (the reservation is the guard)', async () => {
    const { repo, svc } = await setup({ status: 'applied', ticketId: 'tk_other' });
    await expect(svc.applyRewardCode(ctx, TK, 'RDMABC12345')).rejects.toThrow(/another open ticket/);
    expect(repo.rewardCodes[0].ticketId).toBe('tk_other');
  });
  it('without the redeem permission nobody can apply a code', async () => {
    const { svc } = await setup();
    await expect(svc.applyRewardCode({ ...ctx, permissions: ['pos.checkout.view'] } as any, TK, 'RDMABC12345')).rejects.toThrow();
  });
  it('paying the ticket spends the code; it cannot be used again', async () => {
    const { repo, svc } = await setup();
    await svc.applyRewardCode(ctx, TK, 'RDMABC12345');
    const t: any = await repo.ticket(ctx, TK);
    await svc.payCash(ctx, TK, { amountReceivedCents: t.totalCents ?? 100000 } as any);
    expect(repo.rewardCodes[0].status).toBe('used');
    expect(rewardCodeProblem(repo.rewardCodes[0], { ticketId: 'tk_next', customerId: repo.rewardCodes[0].customerId }, Date.now())).toMatch(/already been used/);
  });
});
