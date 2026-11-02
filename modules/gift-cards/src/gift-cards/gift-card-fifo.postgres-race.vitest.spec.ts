// gift-card-fifo.postgres-race.vitest.spec.ts — the first-in-first-out split through the real repository: a $50 card sold
// at Cherry Hill, reloaded $40 at Haddonfield, $60 redeemed at Moorestown → Cherry Hill pays $50 and Haddonfield pays $10.
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyGiftCardsRepository } from './gift-cards.kysely.repository';
import { GiftCardsService } from './gift-cards.service';

const url = process.env.PG_RACE_URL;
const T = 'a7500000-0000-4000-8000-0000000000a1', A = 'b7500000-0000-4000-8000-0000000000a1', B = 'b7500000-0000-4000-8000-0000000000b2', C = 'b7500000-0000-4000-8000-0000000000c3';
const G = 'c7500000-0000-4000-8000-0000000000c1';
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('gift-card clearing, first in first out, on real Postgres', () => {
  beforeAll(async () => {
    clearBranchTimeZoneCache();
    pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`delete from gift_card_transactions where tenant_id = ${T}`.execute(db);
    await sql`delete from gift_cards where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'FF', 'FF', 'ff-salon', 'FFSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${A}, ${T}, 'Cherry Hill', 'America/New_York'), (${B}, ${T}, 'Moorestown', 'America/New_York'), (${C}, ${T}, 'Haddonfield', 'America/New_York') on conflict (id) do nothing`.execute(db);
    await sql`insert into gift_cards (id, tenant_id, branch_id, code, initial_balance_cents, balance_cents, status) values (${G}, ${T}, ${A}, 'GC-FIFO-1', 5000, 3000, 'active')`.execute(db);
    await sql`insert into gift_card_transactions (tenant_id, gift_card_id, branch_id, type, amount_cents, balance_after_cents, idempotency_key, created_at) values
      (${T}, ${G}, ${A}, 'issue', 5000, 5000, null, '2026-09-01T15:00:00Z'),
      (${T}, ${G}, ${C}, 'adjust', 4000, 9000, 'reload:h1', '2026-09-20T15:00:00Z'),
      (${T}, ${G}, ${B}, 'redeem', 6000, 3000, null, '2026-10-01T15:00:00Z')`.execute(db);
  });
  afterAll(async () => { clearBranchTimeZoneCache(); await sql`delete from gift_card_transactions where tenant_id = ${T}`.execute(db).catch(() => undefined); await sql`delete from gift_cards where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it("October's report: Cherry Hill pays Moorestown $50, Haddonfield pays Moorestown $10 (the sales were in September)", async () => {
    const svc = new GiftCardsService(new KyselyGiftCardsRepository(db as any));
    const r = await svc.getLiability({ tenantId: T, branchId: B, userId: 'u', role: 'OWNER', permissions: ['reports.view'] } as any, { from: '2026-10-01', to: '2026-10-31' });
    expect(r.transfers.map((t: any) => [t.fromBranchName, t.toBranchName, t.amountCents])).toEqual([['Cherry Hill', 'Moorestown', 5000], ['Haddonfield', 'Moorestown', 1000]]);
    expect(r.unclearableRedeemedCents).toBe(0);
  });
});
