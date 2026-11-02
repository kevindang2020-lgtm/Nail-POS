// loyalty-ledger.pgtest — BUILD_PLAN Phase 10 (audit bugs 3 and 4) on the real schema: the loyalty ledger is the truth.
//   * every balance change is ONE ledger row carrying the balance after it; the chain holds and sum(delta) = balance;
//   * an earn keyed by a payment applies once, however often it is delivered;
//   * a reversal takes back at most what is left; a void reverses once;
//   * an adjustment needs a reason (service AND database);
//   * PATCH /customers/:id/loyalty no longer overwrites the balance — it becomes an `adjust` entry (bug 3);
//   * the reconcile job repairs a profile written around the ledger, from the ledger, with one owner alert a day.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { applyLoyaltyEntry, reconcileLoyaltyBalances, LoyaltyLedgerError } from './loyalty-ledger.service';
import { KyselyCustomersRepository } from '../customers/customers.kysely.repository';

const T = 'c0c0c0c0-0000-4000-8000-0000000000c1', B = 'c0c0c0c0-0000-4000-8000-0000000000b1';
const C = 'c0c0c0c0-0000-4000-8000-00000000c001', C2 = 'c0c0c0c0-0000-4000-8000-00000000c002';
const P = (n: number) => `c0c0c0c0-0000-4000-9000-${String(n).padStart(12, '0')}`;   // payment / redemption ids
const U = 'c0c0c0c0-0000-4000-8000-0000000000e1';
let pg: any; let db: any;
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: [] } as any;
const tx = <R>(fn: (t: any) => Promise<R>) => db.transaction().execute(fn) as Promise<R>;
const ledger = async (c = C) => (await sql<any>`select entry_type, delta::int, balance_after::int, reason, source_table, source_id, type, amount::int, running_balance::int
  from loyalty_ledger where tenant_id = ${T} and customer_id = ${c} order by created_at, balance_after`.execute(db)).rows;
const profile = async (c = C) => (await sql<any>`select points_balance, total_earned_points, total_redeemed_points from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${c}`.execute(db)).rows;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','L','Ledger Salon','ledger-salon','LEDG01','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) VALUES
      ('${C}','${T}','${B}','Ava','Kim','Ava Kim','+16095550111','active'), ('${C2}','${T}','${B}','Bo','Li','Bo Li','+16095550112','active');`);
}, 120_000);
beforeEach(async () => {
  await pg.exec(`DELETE FROM loyalty_ledger WHERE tenant_id = '${T}'; DELETE FROM customer_loyalty_profiles WHERE tenant_id = '${T}'; DELETE FROM owner_alerts WHERE tenant_id = '${T}';`);
});

describe('the ledger is the source of truth', () => {
  it('earn → redeem → adjust: one row each, balance_after chains, the profile equals sum(delta), legacy columns stay filled', async () => {
    await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'earn', delta: 45, sourceTable: 'payments', sourceId: P(1), reason: 'purchase' }));
    await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'redeem', delta: -20, sourceTable: 'loyalty_redemptions', sourceId: P(2) }));
    await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'adjust', delta: 5, reason: 'goodwill', actorUserId: U }));
    const rows = await ledger();
    expect(rows.map((r: any) => [r.entry_type, r.delta, r.balance_after])).toEqual([['earn', 45, 45], ['redeem', -20, 25], ['adjust', 5, 30]]);
    for (let i = 1; i < rows.length; i++) expect(rows[i].balance_after).toBe(rows[i - 1].balance_after + rows[i].delta);
    expect(rows.every((r: any) => r.amount === r.delta && r.running_balance === r.balance_after && r.type)).toBe(true);   // 540's fill trigger
    expect(await profile()).toEqual([{ points_balance: 30, total_earned_points: 50, total_redeemed_points: 20 }]);
  });

  it('a payment earns once — the second delivery returns the first result and writes nothing', async () => {
    const a = await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'earn', delta: 10, sourceTable: 'payments', sourceId: P(3) }));
    const b = await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'earn', delta: 10, sourceTable: 'payments', sourceId: P(3) }));
    expect(a).toMatchObject({ applied: true, duplicate: false, balanceAfter: 10 });
    expect(b).toMatchObject({ applied: false, duplicate: true, balanceAfter: 10 });
    expect((await ledger()).length).toBe(1);
    expect((await profile())[0].points_balance).toBe(10);
    // and the database refuses a second row for the same source even from a writer that skips the service
    await expect(sql`insert into loyalty_ledger (tenant_id, branch_id, customer_id, entry_type, delta, balance_after, source_table, source_id)
      values (${T}, ${B}, ${C}, 'earn', 10, 20, 'payments', ${P(3)})`.execute(db)).rejects.toThrow();
  });

  it('a reversal takes back at most what is left; a void keyed by its payment reverses once', async () => {
    await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'earn', delta: 30, sourceTable: 'payments', sourceId: P(4) }));
    await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'redeem', delta: -25, sourceTable: 'loyalty_redemptions', sourceId: P(5) }));
    const r = await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'reverse', delta: -30, clampToBalance: true, sourceTable: 'payments', sourceId: P(4), reason: 'void' }));
    expect(r).toMatchObject({ applied: true, delta: -5, balanceAfter: 0 });
    const again = await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'reverse', delta: -30, clampToBalance: true, sourceTable: 'payments', sourceId: P(4), reason: 'void' }));
    expect(again.duplicate).toBe(true);
    expect((await profile())[0]).toMatchObject({ points_balance: 0, total_earned_points: 25 });
  });

  it('nothing goes below zero; an adjustment needs a reason — in the service and in the database', async () => {
    await expect(tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'redeem', delta: -1 }))).rejects.toThrow(/below 0/);
    await expect(tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'adjust', delta: 3, reason: '  ' }))).rejects.toBeInstanceOf(LoyaltyLedgerError);
    await expect(sql`insert into loyalty_ledger (tenant_id, branch_id, customer_id, entry_type, delta, balance_after) values (${T}, ${B}, ${C}, 'adjust', 3, 3)`.execute(db)).rejects.toThrow(/adjust_reason/);
    expect(await ledger()).toEqual([]);
  });

  it('bug 3 — PATCH /customers/:id/loyalty becomes ONE adjust entry with its reason (it used to overwrite the balance with no ledger row)', async () => {
    const repo = new KyselyCustomersRepository(db);
    await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'earn', delta: 40, sourceTable: 'payments', sourceId: P(6) }));
    const out = await repo.setLoyalty(ctx, C, { points: 100, earned: 999, redeemed: 0, tier: 'Gold', reason: 'migrated from paper card' } as any);
    expect(out).toMatchObject({ points: 100, earned: 100, tier: 'Gold' });       // earned comes from the ledger, not the client's 999
    const rows = await ledger();
    expect(rows.map((r: any) => [r.entry_type, r.delta, r.balance_after, r.reason])).toEqual([['earn', 40, 40, null], ['adjust', 60, 100, 'migrated from paper card']]);
    const sum = rows.reduce((n: number, r: any) => n + r.delta, 0);
    expect(sum).toBe((await profile())[0].points_balance);
    await expect(repo.setLoyalty(ctx, C, { points: 5, earned: 0, redeemed: 0, tier: 'Gold' } as any)).rejects.toThrow(/reason/);
    expect((await profile())[0].points_balance).toBe(100);
  });

  it('the register\'s adjust button and a first-ever entry create ONE profile on the customer\'s branch', async () => {
    const repo = new KyselyCustomersRepository(db);
    await repo.adjustLoyaltyPoints({ ...ctx, branchId: '' }, C2, { amount: 7, reason: 'welcome' });
    expect(await profile(C2)).toEqual([{ points_balance: 7, total_earned_points: 7, total_redeemed_points: 0 }]);
    expect((await sql<any>`select branch_id from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${C2}`.execute(db)).rows[0].branch_id).toBe(B);
  });
});

describe('loyalty.reconcile — the profile is repaired FROM the ledger', () => {
  it('a balance written around the ledger is corrected, the salon gets one alert per profile per day, agreeing books are untouched', async () => {
    await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C, entryType: 'earn', delta: 12, sourceTable: 'payments', sourceId: P(7) }));
    await tx((t) => applyLoyaltyEntry(t, { tenantId: T, customerId: C2, entryType: 'earn', delta: 8, sourceTable: 'payments', sourceId: P(8) }));
    await sql`update customer_loyalty_profiles set points_balance = 500 where tenant_id = ${T} and customer_id = ${C}`.execute(db);   // the old PATCH did this
    expect(await reconcileLoyaltyBalances(db, { tenantId: T })).toEqual({ checked: 1, repaired: 1, alerts: 1 });
    expect((await profile())[0].points_balance).toBe(12);
    expect((await profile(C2))[0].points_balance).toBe(8);
    await sql`update customer_loyalty_profiles set points_balance = 501 where tenant_id = ${T} and customer_id = ${C}`.execute(db);
    expect(await reconcileLoyaltyBalances(db, { tenantId: T })).toEqual({ checked: 1, repaired: 1, alerts: 0 });   // same profile, same day → no second alert
    const alerts = (await sql<any>`select category, severity, metadata from owner_alerts where tenant_id = ${T}`.execute(db)).rows;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ category: 'loyalty_reconcile', severity: 'warning' });
    expect(alerts[0].metadata).toMatchObject({ customerId: C, before: 500, after: 12 });
    expect(await reconcileLoyaltyBalances(db, { tenantId: T })).toEqual({ checked: 0, repaired: 0, alerts: 0 });
  });
});
