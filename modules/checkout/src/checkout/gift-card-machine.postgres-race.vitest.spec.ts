// gift-card-machine.postgres-race — BUILD_PLAN Phase 12 round 2 (#27): the GIFT_CARD machine's money writes on REAL
// Postgres with concurrent connections. Before round 2 a reload read the balance, then wrote `balance + amount` with no
// condition — two reloads at once lost one of them (money vanished), and a reload revived a VOID card with a balance.
// Runs when PG_RACE_URL points at a migrated database.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'd2e00000-0000-4000-8000-000000000001', B = 'd2e00000-0000-4000-8000-0000000000b1';
const ctx = { tenantId: T, branchId: B, userId: '', role: 'MANAGER', permissions: [] } as any;

describe.skipIf(!url)('gift cards under real concurrency (Postgres)', () => {
  let pool: pg.Pool; let db: Kysely<any>; let repo: KyselyCheckoutRepository;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 12 }); db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    await sql`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES (${T}, 'GC Race LLC', 'GC Race', 'd2erace', 'D2ER') ON CONFLICT (id) DO NOTHING`.execute(db);
    await sql`INSERT INTO branches (id, tenant_id, name) VALUES (${B}, ${T}, 'Main') ON CONFLICT (id) DO NOTHING`.execute(db);
    repo = new KyselyCheckoutRepository(db as any);
  });
  afterAll(async () => {
    for (const t of ['gift_card_transactions', 'gift_cards', 'outbox_events']) await sql`DELETE FROM ${sql.table(t)} WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM branches WHERE id = ${B}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM tenants WHERE id = ${T}`.execute(db).catch(() => undefined);
    await db.destroy();
  });
  const card = async (code: string, status: string, balance: number) => sql`INSERT INTO gift_cards (tenant_id, branch_id, code, initial_balance_cents, balance_cents, status) VALUES (${T}, ${B}, ${code}, ${balance}, ${balance}, ${status})`.execute(db);
  const bal = async (code: string) => (await sql<{ b: number; s: string }>`SELECT balance_cents AS b, status AS s FROM gift_cards WHERE tenant_id = ${T} AND code = ${code}`.execute(db)).rows[0];

  it('ten $25 reloads of one card at once: every one that reports success is in the balance — none is lost', async () => {
    await card('GC-RACE-1', 'active', 0);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => repo.reloadGiftCard(ctx, 'GC-RACE-1', 2500)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    for (const r of results) if (r.status === 'rejected') expect((r.reason as any).code).toBe('INVALID_STATE_TRANSITION');
    expect(ok).toBeGreaterThanOrEqual(1);
    expect((await bal('GC-RACE-1')).b).toBe(ok * 2500);   // before: 10 "successes" and a balance of 2500 or 5000
  });
  it('a reload never revives a void card (409), and voiding twice is refused the second time', async () => {
    await card('GC-RACE-2', 'void', 0);
    await expect(repo.reloadGiftCard(ctx, 'GC-RACE-2', 2500)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION', status: 409 });
    expect(await bal('GC-RACE-2')).toEqual({ b: 0, s: 'void' });
    await card('GC-RACE-3', 'active', 4000);
    const lines = async () => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM gift_card_transactions t JOIN gift_cards g ON g.id = t.gift_card_id WHERE g.code = 'GC-RACE-3'`.execute(db)).rows[0].n;
    await repo.voidGiftCard(ctx, 'GC-RACE-3');
    const after = await lines();
    await expect(repo.voidGiftCard(ctx, 'GC-RACE-3')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect(await lines()).toBe(after);   // the refused second void writes no second adjusting line
    expect(await bal('GC-RACE-3')).toEqual({ b: 0, s: 'void' });
  });
});
