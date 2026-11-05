// gift-card-liability.vitest.spec.ts — Functional Decision 31: gift-card value is the tenant's liability; each branch
// recognizes what it sells and redeems; sold − redeemed is that branch's inter-branch clearing position.
import { describe, it, expect } from 'vitest';
import { classifyGiftCardLedger, buildBranchLiability } from './gift-cards.dto';
import { GiftCardsService } from './gift-cards.service';
import { InMemoryGiftCardsRepository } from './gift-cards.repository';

const A = 'branch-a', B = 'branch-b';
const names = new Map([[A, 'Cherry Hill'], [B, 'Moorestown']]);

describe('classifyGiftCardLedger', () => {
  it('sales: issue, activate, reload, and the reload credit (adjust keyed reload:…)', () => {
    for (const t of ['issue', 'activate', 'reload']) expect(classifyGiftCardLedger(t, null)).toBe('sold');
    expect(classifyGiftCardLedger('adjust', 'reload:h1')).toBe('sold');
  });
  it('redemptions, manual adjustments, and rows that move no value', () => {
    expect(classifyGiftCardLedger('redeem', null)).toBe('redeemed');
    expect(classifyGiftCardLedger('adjust', null)).toBe('adjusted');
    for (const t of ['transfer', 'hold', 'freeze', 'void']) expect(classifyGiftCardLedger(t, null)).toBe('none');
  });
});

describe('buildBranchLiability — the decision\'s own example', () => {
  it('$100 sold at A, $60 redeemed at B → A owes B $60; the other $40 is liability, not a clearing amount', () => {
    const r = buildBranchLiability([
      { branchId: A, type: 'issue', amountCents: 10000, idempotencyKey: null, soldBranchId: A },
      { branchId: B, type: 'redeem', amountCents: 6000, idempotencyKey: null, soldBranchId: A },
    ], names);
    expect(r.branches).toEqual([
      { branchId: A, branchName: 'Cherry Hill', soldCents: 10000, redeemedCents: 0, adjustedCents: 0, owesCents: 6000, owedCents: 0, netClearingCents: -6000 },
      { branchId: B, branchName: 'Moorestown', soldCents: 0, redeemedCents: 6000, adjustedCents: 0, owesCents: 0, owedCents: 6000, netClearingCents: 6000 },
    ]);
    expect(r.transfers).toEqual([{ fromBranchId: A, fromBranchName: 'Cherry Hill', toBranchId: B, toBranchName: 'Moorestown', amountCents: 6000 }]);
    expect(r.totals).toEqual({ soldCents: 10000, redeemedCents: 6000, adjustedCents: 0 });
    expect(r.unclearableRedeemedCents).toBe(0);
  });
  it('a card redeemed where it was sold clears nothing; a card sold in an earlier period still clears to its seller', () => {
    const r = buildBranchLiability([
      { branchId: A, type: 'redeem', amountCents: 2000, idempotencyKey: null, soldBranchId: A },
      { branchId: A, type: 'redeem', amountCents: 1500, idempotencyKey: null, soldBranchId: B },   // sold at B long ago
    ], names);
    expect(r.branches.find((b) => b.branchId === A)).toMatchObject({ redeemedCents: 3500, owedCents: 1500, owesCents: 0, netClearingCents: 1500 });
    expect(r.branches.find((b) => b.branchId === B)).toMatchObject({ soldCents: 0, owesCents: 1500, netClearingCents: -1500 });
    expect(r.transfers).toEqual([expect.objectContaining({ fromBranchId: B, toBranchId: A, amountCents: 1500 })]);
  });
  it('reload credits count as sales; manual adjustments stay separate; transfers cancel; unknown branches cannot be cleared', () => {
    const r = buildBranchLiability([
      { branchId: A, type: 'adjust', amountCents: 2500, idempotencyKey: 'reload:h9' },
      { branchId: A, type: 'adjust', amountCents: -500, idempotencyKey: null },
      { branchId: A, type: 'transfer', amountCents: 4000, idempotencyKey: null },
      { branchId: A, type: 'transfer', amountCents: -4000, idempotencyKey: null },
      { branchId: null, type: 'redeem', amountCents: 1200, idempotencyKey: null, soldBranchId: A },
      { branchId: B, type: 'redeem', amountCents: 300, idempotencyKey: null, soldBranchId: null },
    ], names);
    expect(r.branches[0]).toMatchObject({ branchId: A, soldCents: 2500, adjustedCents: -500, owesCents: 0 });
    expect(r.branches[r.branches.length - 1]).toMatchObject({ branchId: null, branchName: 'Not attributed', redeemedCents: 1200 });
    expect(r.unclearableRedeemedCents).toBe(1500);
    expect(r.transfers).toEqual([]);
  });
});

describe('GiftCardsService.getLiability', () => {
  const ctx = { tenantId: 't1', branchId: A, userId: 'u1', role: 'MANAGER', permissions: ['reports.view'] };
  const repo = new InMemoryGiftCardsRepository(
    [{ id: 'g1', code: 'G1', initialBalanceCents: 10000, balanceCents: 4000, status: 'active', customerId: null, createdAt: '' },
     { id: 'g2', code: 'G2', initialBalanceCents: 5000, balanceCents: 5000, status: 'void', customerId: null, createdAt: '' }],
    [{ branchId: A, type: 'issue', amountCents: 10000, idempotencyKey: null, soldBranchId: A, date: '2026-09-03' },
     { branchId: B, type: 'redeem', amountCents: 6000, idempotencyKey: null, soldBranchId: A, date: '2026-09-20' },
     { branchId: B, type: 'redeem', amountCents: 999, idempotencyKey: null, soldBranchId: A, date: '2026-08-31' }],
    { [A]: 'Cherry Hill', [B]: 'Moorestown' });
  it('reports the range per branch and the outstanding liability (active balances only)', async () => {
    const r = await new GiftCardsService(repo).getLiability(ctx, { from: '2026-09-01', to: '2026-09-30' });
    expect(r.outstandingLiabilityCents).toBe(4000);
    expect(r.branches.map((b) => [b.branchName, b.netClearingCents])).toEqual([['Cherry Hill', -6000], ['Moorestown', 6000]]);
    expect(r.transfers).toEqual([expect.objectContaining({ fromBranchName: 'Cherry Hill', toBranchName: 'Moorestown', amountCents: 6000 })]);
  });
  it('needs the reports permission; refuses bad or reversed ranges', async () => {
    const svc = new GiftCardsService(repo);
    await expect(svc.getLiability({ ...ctx, permissions: ['checkout.view'] }, {})).rejects.toThrow(/reports/);
    await expect(svc.getLiability(ctx, { from: '2026-9-1', to: '2026-09-30' })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(svc.getLiability(ctx, { from: '2026-10-01', to: '2026-09-30' })).rejects.toThrow(/after/);
    await expect(svc.getLiability(ctx, { from: '2024-01-01', to: '2026-09-30' })).rejects.toThrow(/year/);
  });
});
