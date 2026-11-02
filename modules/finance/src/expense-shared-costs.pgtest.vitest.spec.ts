// expense-shared-costs.pgtest — P2-3 / Remaining-work mandate §8 (Oct 23 2026) on the real schema (migration 681): how a
// SALON-WIDE expense (rent) shows on ONE branch's report. NONE (default) → not split; MANUAL_PERCENTAGE → the owner's
// shares, which must total exactly 100%; an expense split by hand keeps its own split. The share is computed — no
// expense row is copied per branch — and the branches' shares plus the unallocated rest sum to the salon-wide total.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { ExpenseService, type FinanceCtx, type BranchScopePort } from './expense.service';

const T = 'f6810000-0000-4000-8000-000000000001', B1 = 'f6810000-0000-4000-8000-0000000000b1', B2 = 'f6810000-0000-4000-8000-0000000000b2', OWNER = 'f6810000-0000-4000-8000-0000000000e1';
const owner: FinanceCtx = { tenantId: T, userId: OWNER, role: 'OWNER', permissions: ['owner.expenses.view', 'owner.expenses.manage', 'owner.expenses.approve', 'owner.expenses.export', 'owner.expenses.categories.manage'] };
const scopes: BranchScopePort = { async resolve(_ctx, requested) { return { branchId: requested ?? null, allowed: null, restricted: null }; } };
let pg: any; let svc: ExpenseService;
const today = new Date().toISOString().slice(0, 10);
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

beforeAll(async () => {
  pg = await migratedPglite();
  svc = new ExpenseService(kyselyFor(pg) as never, scopes, new OutboxWriter());
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Share Co','Share Salon','share-681','SHR681')`, [T]);
  await pg.query(`insert into tenant_settings (id, tenant_id, branch_id, category, settings_json) values (gen_random_uuid(), $1, NULL, 'business-branch', '{"timezone":"UTC"}'::jsonb)`, [T]);
  await pg.query(`insert into branches (id, tenant_id, name) values ($1,$3,'Downtown'), ($2,$3,'Uptown')`, [B1, B2, T]);
  await pg.query(`insert into users (id, tenant_id, first_name, last_name, full_name, email, status, role) values ($1,$2,'O','O','O O','o@share.test','active','OWNER')`, [OWNER, T]);
  const { expense: rent } = await svc.create(owner, { amountCents: 100001, incurredOn: today, vendor: 'Landlord LLC', category: 'rent', intent: 'submit', idempotencyKey: 'rent-681' });
  await svc.approve(owner, rent.id, rent.version);
  const { expense: own } = await svc.create(owner, { amountCents: 9000, incurredOn: today, vendor: 'SoftCo', category: 'software', intent: 'submit', idempotencyKey: 'soft-681',
    allocations: [{ branchId: B1, amountCents: 1000 }, { branchId: B2, amountCents: 8000 }] } as never);
  await svc.approve(owner, own.id, own.version);
  const { expense: direct } = await svc.create(owner, { amountCents: 2500, incurredOn: today, vendor: 'Polish Co', category: 'supplies', branchId: B1, intent: 'submit', idempotencyKey: 'direct-681' } as never);
  await svc.approve(owner, direct.id, direct.version);
}, 180000);

describe('salon-wide cost shares (P2-3)', () => {
  it('default NONE: a branch report shows only its own expenses + its hand-split share; the rest stays unallocated (whole salon)', async () => {
    expect((await svc.settings(owner)).sharedCostPolicy).toBe('NONE');
    const b1 = await svc.report(owner, { period: 'month', branchId: B1 });
    expect(b1.totalCents).toBe(2500);                                                  // its own direct expense, unchanged
    expect(b1.sharedCosts).toMatchObject({ policy: 'NONE', salonWideCents: 109001, branch: { branchId: B1, allocatedCents: 1000, byOwnSplitCents: 1000, byPolicyCents: 0 } });
    const all = await svc.report(owner, { period: 'month' });
    expect(all.sharedCosts.unallocatedCents).toBe(100001);                              // the rent: no branch carries it under NONE
  });
  it('MANUAL_PERCENTAGE 50 / 40 is refused (must total 100%); a branch of another salon is refused', async () => {
    const v = (await svc.settings(owner)).version;
    expect(await code(svc.saveSettings(owner, { sharedCostPolicy: 'MANUAL_PERCENTAGE', sharedCostShares: [{ branchId: B1, basisPoints: 5000 }, { branchId: B2, basisPoints: 4000 }], version: v }))).toBe('EXPENSE_INVALID');
    expect(await code(svc.saveSettings(owner, { sharedCostPolicy: 'MANUAL_PERCENTAGE', sharedCostShares: [{ branchId: B1, basisPoints: 5000 }, { branchId: 'f6810000-0000-4000-8000-0000000000ff', basisPoints: 5000 }], version: v }))).not.toBe('ok');
    expect((await svc.settings(owner)).sharedCostPolicy).toBe('NONE');
  });
  it('MANUAL_PERCENTAGE 50 / 50: the $1,000.01 rent splits 500.01 / 500.00 — to the cent; the hand-split software keeps its 10.00 / 80.00', async () => {
    const v = (await svc.settings(owner)).version;
    const s = await svc.saveSettings(owner, { sharedCostPolicy: 'MANUAL_PERCENTAGE', sharedCostShares: [{ branchId: B1, basisPoints: 5000 }, { branchId: B2, basisPoints: 5000 }], version: v });
    expect(s).toMatchObject({ sharedCostPolicy: 'MANUAL_PERCENTAGE', sharedCostShares: [{ branchId: B1, basisPoints: 5000 }, { branchId: B2, basisPoints: 5000 }] });
    const b1 = await svc.report(owner, { period: 'month', branchId: B1 });
    const b2 = await svc.report(owner, { period: 'month', branchId: B2 });
    expect(b1.sharedCosts.branch).toMatchObject({ byPolicyCents: 50001, byOwnSplitCents: 1000, allocatedCents: 51001 });
    expect(b2.sharedCosts.branch).toMatchObject({ byPolicyCents: 50000, byOwnSplitCents: 8000, allocatedCents: 58000 });
    expect(b1.totalCents).toBe(2500);                                                   // direct totals never change
    const all = await svc.report(owner, { period: 'month' });
    const per = all.sharedCosts.perBranch.reduce((t: number, b: { allocatedCents: number }) => t + b.allocatedCents, 0);
    expect(per + all.sharedCosts.unallocatedCents).toBe(all.sharedCosts.salonWideCents);  // every cent once
    expect(all.sharedCosts.unallocatedCents).toBe(0);
    // no expense row was copied: the salon still has exactly three expenses
    expect(Number((await pg.query(`select count(*)::int n from expenses where tenant_id = $1`, [T])).rows[0].n)).toBe(3);
  });
});

// §65 (Oct 27 2026) — the rest of the allocation matrix: 110 %, a negative share, a branch removed while it holds a share,
// an expense edited after it was split, and a past period's report after the policy changes.
describe('allocation matrix (§65)', () => {
  const lastMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
  const sharesAt = async (bp1: number, bp2: number) => svc.saveSettings(owner, { sharedCostPolicy: 'MANUAL_PERCENTAGE', sharedCostShares: [{ branchId: B1, basisPoints: bp1 }, { branchId: B2, basisPoints: bp2 }], version: (await svc.settings(owner)).version });

  it('110 % is refused — as the salon policy (60 + 50) and as one expense\'s own split; nothing is stored', async () => {
    const before = await svc.settings(owner);
    expect(await code(sharesAt(6000, 5000))).toBe('EXPENSE_INVALID');
    expect((await svc.settings(owner)).sharedCostShares).toEqual(before.sharedCostShares);
    expect(await code(svc.create(owner, { amountCents: 1000, incurredOn: today, vendor: 'Over Co', category: 'software', intent: 'submit', idempotencyKey: 'over-110',
      allocations: [{ branchId: B1, basisPoints: 6000 }, { branchId: B2, basisPoints: 5000 }] } as never))).toBe('EXPENSE_ALLOCATION_INVALID');
    expect(Number((await pg.query(`select count(*)::int n from expenses where tenant_id = $1 and idempotency_key = 'over-110'`, [T])).rows[0].n)).toBe(0);
  });

  it('a negative share is refused even when the shares still total 100 % (120 + −20), as policy and as an own split (amount or percentage)', async () => {
    expect(await code(sharesAt(12000, -2000))).toBe('EXPENSE_INVALID');
    expect(await code(svc.create(owner, { amountCents: 1000, incurredOn: today, vendor: 'Neg Co', category: 'software', intent: 'submit', idempotencyKey: 'neg-bp',
      allocations: [{ branchId: B1, basisPoints: 12000 }, { branchId: B2, basisPoints: -2000 }] } as never))).toBe('EXPENSE_ALLOCATION_INVALID');
    expect(await code(svc.create(owner, { amountCents: 1000, incurredOn: today, vendor: 'Neg Co', category: 'software', intent: 'submit', idempotencyKey: 'neg-amt',
      allocations: [{ branchId: B1, amountCents: 1200 }, { branchId: B2, amountCents: -200 }] } as never))).toBe('EXPENSE_ALLOCATION_INVALID');
    // Oct 28 2026 (audit F6): a split on an expense FILED TO ONE BRANCH is refused (it was accepted, then ignored by the reports)
    expect(await code(svc.create(owner, { amountCents: 1000, incurredOn: today, vendor: 'Branch Co', category: 'software', intent: 'submit', idempotencyKey: 'branch-split', branchId: B1,
      allocations: [{ branchId: B1, amountCents: 500 }, { branchId: B2, amountCents: 500 }] } as never))).toBe('EXPENSE_ALLOCATION_INVALID');
  });

  it('an expense split by hand whose total is edited keeps its proportions at the new total (still sums exactly); a new split given with the edit wins', async () => {
    const { expense: e } = await svc.create(owner, { amountCents: 9000, incurredOn: today, vendor: 'EditCo', category: 'software', intent: 'submit', idempotencyKey: 'edit-alloc',
      allocations: [{ branchId: B1, amountCents: 3000 }, { branchId: B2, amountCents: 6000 }] } as never);
    const u1 = await svc.update(owner, e.id, { amountCents: 10001, version: e.version } as never);
    const a1 = (await svc.detail(owner, e.id) as any).allocations;
    expect(a1.map((a: any) => [a.branchId, a.amountCents]).sort()).toEqual([[B1, 3334], [B2, 6667]].sort());
    expect(a1.reduce((t: number, a: any) => t + a.amountCents, 0)).toBe(10001);
    await svc.update(owner, e.id, { amountCents: 5000, allocations: [{ branchId: B1, amountCents: 5000 }], version: (u1 as any).expense?.version ?? (u1 as any).version } as never);
    const a2 = (await svc.detail(owner, e.id) as any).allocations;
    expect(a2.map((a: any) => [a.branchId, a.amountCents])).toEqual([[B1, 5000]]);
  });

  it('a branch REMOVED while it holds a share: its share keeps splitting (every cent still on some branch), the settings name it for review, and a new split may not give it a share', async () => {
    await sharesAt(5000, 5000);
    await pg.query(`update branches set status = 'inactive' where id = $1`, [B2]);
    try {
      expect((await svc.settings(owner)).sharedCostSharesNeedReview).toEqual([B2]);
      const all = await svc.report(owner, { period: 'month' });
      const per = all.sharedCosts.perBranch.reduce((t: number, b: { allocatedCents: number }) => t + b.allocatedCents, 0);
      expect(per + all.sharedCosts.unallocatedCents).toBe(all.sharedCosts.salonWideCents);
      expect(all.sharedCosts.perBranch.find((b: { branchId: string }) => b.branchId === B2)?.byPolicyCents).toBeGreaterThan(0);
      expect(await code(sharesAt(5000, 5000))).toBe('EXPENSE_INVALID');                  // re-saving the closed branch's share is refused
      expect(await code(sharesAt(10000, 0))).toBe('EXPENSE_INVALID');                     // a zero share still names the closed branch
      const moved = await svc.saveSettings(owner, { sharedCostPolicy: 'MANUAL_PERCENTAGE', sharedCostShares: [{ branchId: B1, basisPoints: 10000 }], version: (await svc.settings(owner)).version });
      expect(moved.sharedCostSharesNeedReview).toEqual([]);
      const b1 = await svc.report(owner, { period: 'month', branchId: B1 });
      expect(b1.sharedCosts.branch.byPolicyCents).toBe(100001);                           // the whole rent now on the open branch
    } finally { await pg.query(`update branches set status = 'active' where id = $1`, [B2]); }
  });

  it('historical reporting (decision): a policy split is computed when the report is READ, so last month re-splits by today\'s shares; an expense split by hand keeps its own split forever; both reconcile to the cent', async () => {
    const { expense: old } = await svc.create(owner, { amountCents: 20000, incurredOn: lastMonth, vendor: 'Landlord LLC', category: 'rent', intent: 'submit', idempotencyKey: 'rent-last-month' });
    await svc.approve(owner, old.id, old.version);
    const { expense: oldOwn } = await svc.create(owner, { amountCents: 3000, incurredOn: lastMonth, vendor: 'SoftCo', category: 'software', intent: 'submit', idempotencyKey: 'soft-last-month',
      allocations: [{ branchId: B1, amountCents: 1000 }, { branchId: B2, amountCents: 2000 }] } as never);
    await svc.approve(owner, oldOwn.id, oldOwn.version);
    await sharesAt(5000, 5000);
    const before = await svc.report(owner, { period: 'last_month', branchId: B1 });
    expect(before.sharedCosts.branch).toMatchObject({ byPolicyCents: 10000, byOwnSplitCents: 1000 });
    await sharesAt(7000, 3000);
    const after = await svc.report(owner, { period: 'last_month', branchId: B1 });
    expect(after.sharedCosts.branch).toMatchObject({ byPolicyCents: 14000, byOwnSplitCents: 1000 });   // re-split by the current policy; the own split did not move
    const all = await svc.report(owner, { period: 'last_month' });
    const per = all.sharedCosts.perBranch.reduce((t: number, b: { allocatedCents: number }) => t + b.allocatedCents, 0);
    expect(per + all.sharedCosts.unallocatedCents).toBe(all.sharedCosts.salonWideCents);
    expect(all.sharedCosts.salonWideCents).toBe(23000);
    expect(after.totalCents).toBe(before.totalCents);                                     // the branch's own filed expenses never change
  });
});
