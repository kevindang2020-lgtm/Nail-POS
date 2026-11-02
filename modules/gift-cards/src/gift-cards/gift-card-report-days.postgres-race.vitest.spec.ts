// gift-card-report-days.postgres-race.vitest.spec.ts — the Decision 31 report's days are the BRANCH's days (Oct 2 2026).
// A card sold at 9 pm on Oct 1 in New Jersey is 01:00 UTC on Oct 2: on UTC days it landed on Oct 2's report.
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyGiftCardsRepository } from './gift-cards.kysely.repository';
import { GiftCardsService } from './gift-cards.service';

const url = process.env.PG_RACE_URL;
const T = 'a7300000-0000-4000-8000-0000000000a1', B = 'b7300000-0000-4000-8000-0000000000b1', G = 'c7300000-0000-4000-8000-0000000000c1';
const ctx = { tenantId: T, branchId: B, userId: 'u', role: 'OWNER', permissions: ['reports.view'] } as any;
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('gift-card report on the branch day', () => {
  beforeAll(async () => {
    clearBranchTimeZoneCache();
    pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`delete from gift_card_transactions where tenant_id = ${T}`.execute(db);
    await sql`delete from gift_cards where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'GC', 'GC', 'gc-day-salon', 'GCDS', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Cherry Hill', 'America/New_York') on conflict (id) do update set timezone = excluded.timezone`.execute(db);
    await sql`insert into gift_cards (id, tenant_id, branch_id, code, initial_balance_cents, balance_cents, status) values (${G}, ${T}, ${B}, 'GC-DAY-1', 5000, 5000, 'active')`.execute(db);
    await sql`insert into gift_card_transactions (tenant_id, gift_card_id, branch_id, type, amount_cents, balance_after_cents, created_at)
      values (${T}, ${G}, ${B}, 'issue', 5000, 5000, '2026-10-02T01:00:00Z')`.execute(db);   // 9 pm Oct 1 in New Jersey
  });
  afterAll(async () => { clearBranchTimeZoneCache(); await sql`delete from gift_card_transactions where tenant_id = ${T}`.execute(db).catch(() => undefined); await sql`delete from gift_cards where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it("a 9 pm sale is on Oct 1's report (the branch's day), not Oct 2's", async () => {
    const svc = new GiftCardsService(new KyselyGiftCardsRepository(db as any));
    const oct1 = await svc.getLiability(ctx, { from: '2026-10-01', to: '2026-10-01' });
    const oct2 = await svc.getLiability(ctx, { from: '2026-10-02', to: '2026-10-02' });
    const sold = (r: any) => r.branches.reduce((n: number, b: any) => n + (b.soldCents || 0), 0);
    expect(sold(oct1)).toBe(5000);
    expect(sold(oct2)).toBe(0);
  });
});
