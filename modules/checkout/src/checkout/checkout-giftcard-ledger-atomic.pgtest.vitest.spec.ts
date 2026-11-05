// checkout-giftcard-ledger-atomic.pgtest.vitest.spec.ts — SCAN (Oct 12 2026). The redemption decremented the card and
// then wrote its ledger row with `.catch(() => undefined)`: when the ledger INSERT failed, the card had lost the money
// and no ledger row said where it went (outside a transaction), or — inside one — the swallowed error left the
// transaction aborted so every later statement failed and COMMIT silently became ROLLBACK. The redemption is now one
// unit: the ledger row and the decrement land together or not at all, and a failure surfaces.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';


class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'ed000000-0000-0000-0000-000000000001';
const ctx: any = { tenantId: T, branchId: 'ed000000-0000-0000-0000-0000000000b1', userId: 'ed000000-0000-0000-0000-0000000000f1', role: 'OWNER', permissions: [] };
let pg: PGlite;
let repo: KyselyCheckoutRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyCheckoutRepository(db as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'L','D','slug-led','CODELED')`, [T]);
  // a ledger INSERT that fails for one amount (stands in for any constraint / trigger / connection error)
  await pg.exec(`create or replace function scan_fail_ledger() returns trigger language plpgsql as $$ begin if new.type = 'redeem' and new.amount_cents = 1234 then raise exception 'ledger write failed'; end if; return new; end $$;
    create trigger scan_fail_ledger before insert on gift_card_transactions for each row execute function scan_fail_ledger();`);
});

describe('gift-card redemption is atomic with its ledger row', () => {
  it('a failed ledger write leaves the balance untouched and surfaces (no silent decrement)', async () => {
    await repo.issueGiftCard(ctx, { code: 'GC-LEDGER1', amountCents: 5000 } as any);
    let threw = false, ok: boolean | null = null;
    try { ok = await repo.decrementGift(ctx, 'GC-LEDGER1', 1234); } catch { threw = true; }
    const [card] = await q(`select balance_cents::int as b, status from gift_cards where code = 'GC-LEDGER1'`);
    expect(card.b).toBe(5000);
    expect(threw || ok === false).toBe(true);
    expect((await q(`select count(*)::int n from gift_card_transactions t join gift_cards g on g.id = t.gift_card_id where g.code = 'GC-LEDGER1' and t.type = 'redeem'`))[0].n).toBe(0);
  });
  it('a normal redemption still decrements and writes exactly one ledger row', async () => {
    await repo.issueGiftCard(ctx, { code: 'GC-LEDGER2', amountCents: 5000 } as any);
    expect(await repo.decrementGift(ctx, 'GC-LEDGER2', 1500)).toBe(true);
    const [card] = await q(`select balance_cents::int as b from gift_cards where code = 'GC-LEDGER2'`);
    expect(card.b).toBe(3500);
    const led = await q(`select amount_cents::int a, balance_after_cents::int b from gift_card_transactions t join gift_cards g on g.id = t.gift_card_id where g.code = 'GC-LEDGER2' and t.type = 'redeem'`);
    expect(led).toEqual([{ a: 1500, b: 3500 }]);
  });
});
