// coupon-redeemed-producer.postgres-race.vitest.spec.ts — coupon.redeemed was declared since Constitution 8 and produced
// by nothing. A NEW promotion redemption emits it in the same transaction; a replay on the same idempotency key returns
// the existing row and emits nothing. Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyPromotionsRepository } from './promotions.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'a7900000-0000-4000-8000-0000000000a1', B = 'b7900000-0000-4000-8000-0000000000b1';
let db: Kysely<any>; let pool: pg.Pool; let promoId = '';

describe.skipIf(!url)('coupon.redeemed producer', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'CP', 'CP', 'cp-coupon', 'CPCO', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    await sql`delete from outbox_events where tenant_id = ${T}`.execute(db);
    await sql`delete from deal_redemptions where tenant_id = ${T}`.execute(db);
    await sql`delete from deals where tenant_id = ${T}`.execute(db);
    // BUILD_PLAN Phase 5: a tenant promotion is a deals row of kind 'automatic'
    promoId = String(((await sql`insert into deals (tenant_id, owner_type, kind, title, discount_type, discount_cents, status) values (${T}, 'salon', 'automatic', 'Fall 10 off', 'fixed', 1000, 'active') returning id`.execute(db)).rows[0] as any).id);
  });
  afterAll(async () => { await sql`delete from outbox_events where tenant_id = ${T}`.execute(db).catch(() => undefined); await sql`delete from deal_redemptions where tenant_id = ${T}`.execute(db).catch(() => undefined); await sql`delete from deals where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('a new redemption emits coupon.redeemed once; the replay emits nothing', async () => {
    const repo = new KyselyPromotionsRepository(db as any, new OutboxWriter());
    const input = { promotionId: promoId, tenantId: T, branchId: B, customerId: null, ticketId: 'd7900000-0000-4000-8000-0000000000d1', checkoutId: null, eligibleSubtotalCents: 5000, discountCents: 1000, finalSubtotalCents: 4000, currency: 'USD', idempotencyKey: 'k-' + Date.now() };
    const first = await repo.insertRedemption(input);
    const again = await repo.insertRedemption(input);
    expect(again.id).toBe(first.id);
    const events: any[] = (await sql`select event_type, payload_json as payload, correlation_id from outbox_events where tenant_id = ${T} and event_type = 'coupon.redeemed'`.execute(db)).rows;
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ redemptionId: first.id, promotionId: promoId, discountCents: 1000 });
    expect(events[0].correlation_id).toBe('ticket:d7900000-0000-4000-8000-0000000000d1');
  });
});
