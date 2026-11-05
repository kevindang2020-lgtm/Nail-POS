// membership-phone-producer.pgtest — membership.activated, membership.canceled and customer.phone_verified were declared
// since Constitution 8 and recorded by nothing. Each is now recorded in the transaction of the write that IS the fact.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyMembershipEnrollRepository } from '@aipowersalon/memberships';
import { KyselyCustomerRepository } from '../customer/customer.kysely.repository';

const T = '21212121-2121-4212-8212-212121212121', B = '22222222-2121-4212-8212-212121212122', CU = '23232323-2323-4232-8232-232323232323';
const ctx = { tenantId: T, branchId: B, userId: '24242424-2424-4242-8242-242424242424' } as any;
let db: any; let repo: KyselyMembershipEnrollRepository; let planId: string;
const facts = async (type: string) => (await sql`SELECT aggregate_id, payload_json FROM outbox_events WHERE event_type = ${type} ORDER BY occurred_at`.execute(db)).rows as any[];
const args = (status: string, n: string) => ({ customerId: CU, planId, planVersionId: planId, status, assignedTechnicianId: null, memberNumber: 'M-' + n,
  startedAt: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: null, nextBillingAt: null, termEndAt: null, autoRenew: true,
  autoRenewConsentAt: null, agreementVersion: null, enrolledChannel: 'pos' });

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','M','Member Salon','member','MEMB01','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main') ON CONFLICT (id) DO NOTHING;
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) VALUES ('${CU}','${T}','${B}','Mo','Li','Mo Li','+16095550166','active') ON CONFLICT (id) DO NOTHING;
  `);
  planId = ((await pg.query(`insert into membership_plans (tenant_id, branch_id, name, status) values ($1,$2,'Gold','active') returning id`, [T, B])).rows[0] as any).id;
  repo = new KyselyMembershipEnrollRepository(db, new OutboxWriter());
});

describe('membership facts', () => {
  it('an ACTIVE enrollment records membership.activated; a PENDING one does not', async () => {
    const { membershipId } = await repo.insertMembership(ctx, args('active', '1') as any);
    await repo.insertMembership(ctx, args('pending', '2') as any);
    const f = await facts('membership.activated');
    expect(f.map((r) => r.aggregate_id)).toEqual([membershipId]);
    expect(f[0].payload_json).toMatchObject({ membershipId, customerId: CU, planId });
  });
  it('an immediate cancel records membership.canceled; a pause, and a version conflict, record nothing', async () => {
    const [{ aggregate_id: id }] = await facts('membership.activated');
    const version = async () => Number(((await sql`SELECT version FROM customer_memberships WHERE id = ${id}`.execute(db)).rows[0] as any).version);
    const v0 = await version();
    expect((await repo.applyLifecycle(ctx, id, { status: 'paused', pausedAt: new Date().toISOString() } as any, v0)).updated).toBe(true);
    expect((await repo.applyLifecycle(ctx, id, { status: 'canceled', canceledAt: new Date().toISOString() } as any, v0)).conflict).toBe(true);   // stale version
    expect((await repo.applyLifecycle(ctx, id, { status: 'canceled', canceledAt: new Date().toISOString(), cancelReason: 'moving' } as any, await version())).updated).toBe(true);
    const f = await facts('membership.canceled');
    expect(f.map((r) => r.aggregate_id)).toEqual([id]);
    expect(f[0].payload_json).toMatchObject({ membershipId: id, customerId: CU, planId, reason: 'given' });
  });
});

// customer.phone_verified moved with "verify my phone number" into the canonical phone service (BUILD_PLAN Phase 3,
// the legacy OTP here was removed): its producer is proven in
// modules/booking/src/customer-phone/customer-phone-flow.pgtest.vitest.spec.ts ("the change is told to the rest of the platform").

describe('loyalty.points_redeemed', () => {
  it('a redemption records it with the points spent (never the bearer code); an unaffordable one records nothing', async () => {
    const cust = new KyselyCustomerRepository(db, new OutboxWriter());
    await sql`INSERT INTO customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points) VALUES (${T}, ${B}, ${CU}, 100, 100)`.execute(db);
    // Since migration 492 a reward must be worth something to be redeemable (Decision 15) — these carry a value.
    const reward: any = (await sql`INSERT INTO loyalty_rewards (tenant_id, title, points_cost, active, reward_type, value_cents) VALUES (${T}, 'Free polish', 30, true, 'amount_off', 1500) RETURNING id`.execute(db)).rows[0];
    const big: any = (await sql`INSERT INTO loyalty_rewards (tenant_id, title, points_cost, active, reward_type, value_cents) VALUES (${T}, 'Spa day', 999, true, 'amount_off', 9000) RETURNING id`.execute(db)).rows[0];
    const ok: any = await cust.redeemReward(ctx, CU, reward.id);
    expect(ok.ok).toBe(true);
    expect((await cust.redeemReward(ctx, CU, big.id)).ok).toBe(false);
    const f = await facts('loyalty.points_redeemed');
    expect(f.map((r) => r.payload_json)).toEqual([{ customerId: CU, rewardId: reward.id, pointsSpent: 30 }]);
    expect(JSON.stringify(f)).not.toContain(ok.code);
  });
});
