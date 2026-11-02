// gift-card-redeem.postgres-race.vitest.spec.ts — Smooth Refresh spec §79/§108: two (here ten) terminals redeeming the
// same gift-card balance must never overspend — and the ledger must tell the truth about each redemption.
// Deterministic race: SHARE on gift_cards lets every terminal pass its pre-read, then blocks every UPDATE until released.
// Opt-in: PG_RACE_URL=postgres://... (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'a5000000-0000-4000-8000-0000000000aa';
const B = 'b5000000-0000-4000-8000-0000000000bb';
const ctx = { tenantId: T, branchId: B, userId: 'e5000000-0000-4000-8000-0000000000ee', role: 'FRONT_DESK', permissions: [] } as any;
let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyCheckoutRepository;

describe.skipIf(!url)('real-Postgres gift-card redemption race (spec §79, §108)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyCheckoutRepository(db as any);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Gift Salon', 'Gift Salon', 'gift-salon', 'GIFTS', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from gift_card_transactions where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from gift_cards where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('ten terminals redeem $10 each from a $50 card at once — exactly five succeed, balance $0, each ledger row states its true balance-after', async () => {
    await sql`delete from gift_card_transactions where tenant_id = ${T}`.execute(db);
    await sql`delete from gift_cards where tenant_id = ${T}`.execute(db);
    await sql`insert into gift_cards (tenant_id, branch_id, code, balance_cents, status) values (${T}, ${B}, 'RACE-50', 5000, 'active')`.execute(db);
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('lock table gift_cards in share mode');
    const pending = Promise.allSettled(Array.from({ length: 10 }, () => repo.decrementGift(ctx, 'RACE-50', 1000)));
    await new Promise((r) => setTimeout(r, 400));
    await gate.query('commit'); gate.release();
    const results = await pending;
    expect(results.filter((r) => r.status === 'fulfilled' && r.value === true)).toHaveLength(5);
    const card = (await sql<{ balance_cents: string; status: string }>`select balance_cents, status from gift_cards where tenant_id = ${T} and code = 'RACE-50'`.execute(db)).rows[0];
    expect(Number(card.balance_cents)).toBe(0);                 // never negative, never over-spent
    expect(card.status).toBe('redeemed');
    const ledger = (await sql<{ balance_after_cents: string }>`select balance_after_cents from gift_card_transactions where tenant_id = ${T} and type = 'redeem'`.execute(db)).rows.map((r) => Number(r.balance_after_cents)).sort((a, b) => b - a);
    expect(ledger).toEqual([4000, 3000, 2000, 1000, 0]);       // each redemption's own balance-after — not a neighbour's
  });
});
