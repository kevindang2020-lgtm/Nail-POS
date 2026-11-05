// promotions-redemption.pgtest — promotion redemption limits and idempotency against the real schema AND
// against a failing database, because both findings here are about which way it fails.
//
// FIXED: countRedemptions used to swallow errors to `undefined`, and n(undefined) is 0, so a failed count read
// as "never redeemed" and checkLimits let the redemption through. A one-per-customer promotion became unlimited
// whenever that query broke. It now propagates, so the redemption fails instead — the safe direction.
//
// NOT A BUG, and pinned so nobody "fixes" it into one: findRedemptionByIdem also swallows, but idempotency is
// guaranteed at INSERT time. insertRedemption uses `ON CONFLICT (promotion_id, idempotency_key) DO UPDATE …
// RETURNING *`, so a retry RETURNS THE EXISTING ROW rather than creating a second one. I first wrote this test
// expecting the database to REFUSE the duplicate; it resolved instead, because the conflict is handled — which
// is the better design, and the test now asserts what the code actually guarantees.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyPromotionsRepository } from './promotions.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'e6e6e6e6-0000-4000-8000-000000000001';
const PROMO = 'e6e6e6e6-0000-4000-8000-00000000000a';
const CUST_A = 'e6e6e6e6-0000-4000-8000-0000000000a1';
const CUST_B = 'e6e6e6e6-0000-4000-8000-0000000000b1';
let repo: KyselyPromotionsRepository;

const redemption = (customerId: string, key: string) => ({
  promotionId: PROMO, tenantId: T, branchId: null, customerId, ticketId: null, checkoutId: null,
  eligibleSubtotalCents: 5000, discountCents: 500, finalSubtotalCents: 4500, currency: 'USD', idempotencyKey: key,
}) as never;

/** A database whose every query rejects. */
const brokenDb = () => ({}) as never;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Promo Salon LLC', 'Promo Salon', 'promo-salon', 'PROMO1', 'active') ON CONFLICT DO NOTHING;
  `);
  // BUILD_PLAN Phase 5: a tenant promotion is a `deals` row of kind 'automatic' (tenant_promotions is frozen)
  await pg.exec(`
    INSERT INTO deals (id, tenant_id, owner_type, kind, title, discount_type, discount_percent, status)
    VALUES ('${PROMO}', '${T}', 'salon', 'automatic', 'First visit 10% off', 'percent', 10, 'active');
  `);
  repo = new KyselyPromotionsRepository(kyselyFor(pg) as never);
  // Customer A has redeemed TWICE, customer B ONCE — different counts, so a filter that merged them could not hide.
  await repo.insertRedemption(redemption(CUST_A, 'k-a1'));
  await repo.insertRedemption(redemption(CUST_A, 'k-a2'));
  await repo.insertRedemption(redemption(CUST_B, 'k-b1'));
});

describe('redemption counts are real — the limit check depends on every one of them', () => {
  it("customer A's count is 2, not the 0 a swallowed error used to produce", async () => {
    const c = await repo.countRedemptions(PROMO, { customerId: CUST_A, branchId: null, tenantId: T });
    expect(c.customerCount).toBe(2);
  });

  it("customer B's count is separate — the per-customer filter is applied", async () => {
    const c = await repo.countRedemptions(PROMO, { customerId: CUST_B, branchId: null, tenantId: T });
    expect(c.customerCount).toBe(1);
  });

  it('the tenant and global counts include everyone', async () => {
    const c = await repo.countRedemptions(PROMO, { customerId: CUST_A, branchId: null, tenantId: T });
    expect(c.tenantCount).toBe(3);
    expect(c.globalCount).toBe(3);
  });

  it('a REVERSED redemption no longer counts against the limit', async () => {
    const r = await repo.insertRedemption(redemption(CUST_B, 'k-b2'));
    await repo.reverseRedemption((r as never as { id: string }).id, 'refunded', T);
    const c = await repo.countRedemptions(PROMO, { customerId: CUST_B, branchId: null, tenantId: T });
    expect(c.customerCount).toBe(1);
  });
});

describe('FIXED: a failed count now FAILS the redemption instead of reading as "never redeemed"', () => {
  it('countRedemptions REJECTS on a database error — it no longer returns zeros', async () => {
    await expect(new KyselyPromotionsRepository(brokenDb()).countRedemptions(PROMO, { customerId: CUST_A, branchId: null, tenantId: T }))
      .rejects.toThrow();
  });
});

describe('NOT A BUG: idempotency is guaranteed by the schema, not the lookup', () => {
  it('a retry with the same key finds the prior redemption', async () => {
    expect(await repo.findRedemptionByIdem(PROMO, 'k-a1', T)).not.toBeNull();
  });

  it('THE REAL GUARANTEE: a retry with the same key returns the SAME redemption, not a new one', async () => {
    const original = await repo.findRedemptionByIdem(PROMO, 'k-a1', T);
    const retried = await repo.insertRedemption(redemption(CUST_A, 'k-a1'));
    expect((retried as never as { id: string }).id).toBe((original as never as { id: string }).id);
  });

  it('…so even though findRedemptionByIdem swallows its own errors, a retry still cannot redeem twice', async () => {
    const c = await repo.countRedemptions(PROMO, { customerId: CUST_A, branchId: null, tenantId: T });
    expect(c.customerCount).toBe(2);   // unchanged by the retried insert
  });
});
