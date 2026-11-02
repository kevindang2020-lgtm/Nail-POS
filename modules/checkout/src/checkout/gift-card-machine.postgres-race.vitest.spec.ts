// gift-card-machine.postgres-race — BUILD_PLAN Phase 12 round 2 (#27) + mandate P0 §142 (Oct 20 2026): the GIFT_CARD
// machine's money writes on REAL Postgres with concurrent connections. The direct, payment-less reload was REMOVED in
// Oct 2026 (it credited value with no payment and could double-credit on a retry); the ONLY reload path is now the
// payment-first hold on a ticket, credited by `activatePendingGiftCardReloads` exactly once — proven here under ten
// concurrent activations. A void writes its balance and ledger line in one transaction.
// Runs when PG_RACE_URL points at a migrated database.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'd2e00000-0000-4000-8000-000000000001', B = 'd2e00000-0000-4000-8000-0000000000b1';
const ctx = { tenantId: T, branchId: B, userId: 'd2e00000-0000-4000-8000-0000000000e1', role: 'MANAGER', permissions: [] } as any;

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

  const TICKET = 'd2e00000-0000-4000-8000-0000000000a1';
  const lines = async (code: string, type?: string) => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM gift_card_transactions t JOIN gift_cards g ON g.id = t.gift_card_id WHERE g.code = ${code} ${type ? sql`AND t.type = ${type}` : sql``}`.execute(db)).rows[0].n;

  it('one PAID $25 reload activated by ten workers at once credits the card exactly once (retry-safe, ledger = balance)', async () => {
    await card('GC-RACE-1', 'active', 0);
    await repo.createPendingGiftCardReload(ctx, { code: 'GC-RACE-1', amountCents: 2500, ticketId: TICKET, reference: 'GC-****-CE-1' });
    expect((await bal('GC-RACE-1')).b).toBe(0);   // a pending reload credits NOTHING before payment
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => repo.activatePendingGiftCardReloads(ctx, TICKET)));
    const activated = results.reduce((n, r) => n + (r.status === 'fulfilled' ? r.value.activated : 0), 0);
    expect(activated).toBe(1);
    expect((await bal('GC-RACE-1')).b).toBe(2500);               // never 5000, never 25000
    expect(await lines('GC-RACE-1', 'adjust')).toBe(1);          // exactly one credit line
    // a later retry of afterPaid is a no-op
    expect((await repo.activatePendingGiftCardReloads(ctx, TICKET)).activated).toBe(0);
    expect((await bal('GC-RACE-1')).b).toBe(2500);
  });
  it('there is no payment-less reload any more; a paid reload hold never revives a void card; voiding twice is refused', async () => {
    expect(typeof (repo as any).reloadGiftCard).toBe('undefined');
    await card('GC-RACE-2', 'void', 0);
    await repo.createPendingGiftCardReload(ctx, { code: 'GC-RACE-2', amountCents: 2500, ticketId: 'd2e00000-0000-4000-8000-0000000000a2', reference: 'GC-****-CE-2' });
    expect((await repo.activatePendingGiftCardReloads(ctx, 'd2e00000-0000-4000-8000-0000000000a2')).activated).toBe(0);
    expect(await bal('GC-RACE-2')).toEqual({ b: 0, s: 'void' });
    await card('GC-RACE-3', 'active', 4000);
    await repo.voidGiftCard(ctx, 'GC-RACE-3');
    const after = await lines('GC-RACE-3');
    expect(after).toBe(1);   // the void's −$40 adjusting line is written IN the same transaction as the balance
    await expect(repo.voidGiftCard(ctx, 'GC-RACE-3')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect(await lines('GC-RACE-3')).toBe(after);   // the refused second void writes no second adjusting line
    expect(await bal('GC-RACE-3')).toEqual({ b: 0, s: 'void' });
  });
  it('a void whose ledger line cannot be written leaves the balance untouched (one transaction)', async () => {
    await card('GC-RACE-4', 'active', 1500);
    // make the ledger insert fail: a trigger that refuses this card's adjusting line
    await sql`CREATE OR REPLACE FUNCTION d2e_refuse_gc4() RETURNS trigger AS $$ BEGIN IF (SELECT code FROM gift_cards WHERE id = NEW.gift_card_id) = 'GC-RACE-4' THEN RAISE EXCEPTION 'ledger refused'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`.execute(db);
    await sql`CREATE TRIGGER d2e_refuse_gc4 BEFORE INSERT ON gift_card_transactions FOR EACH ROW EXECUTE FUNCTION d2e_refuse_gc4()`.execute(db);
    try {
      await expect(repo.voidGiftCard(ctx, 'GC-RACE-4')).rejects.toThrow(/ledger refused/);
      expect(await bal('GC-RACE-4')).toEqual({ b: 1500, s: 'active' });   // before: balance 0 / void with NO ledger line
      expect(await lines('GC-RACE-4')).toBe(0);
    } finally {
      await sql`DROP TRIGGER IF EXISTS d2e_refuse_gc4 ON gift_card_transactions`.execute(db);
      await sql`DROP FUNCTION IF EXISTS d2e_refuse_gc4()`.execute(db);
    }
  });
});
