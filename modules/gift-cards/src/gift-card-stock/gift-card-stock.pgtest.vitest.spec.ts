// gift-card-stock.pgtest.vitest.spec.ts — proves physical gift-card inventory against real SQL (spec §21): registering a
// batch stores hash+last4, re-registering an overlapping batch is deduped by the (tenant, hash) unique index, voiding
// only touches available cards, and the same printed number can exist independently at two different tenants.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyGiftCardStockRepo } from './gift-card-stock.repository';
import { hashCardNumber, lastFour } from '../gift-cards/gift-card-number-core';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'dc000000-0000-0000-0000-000000000001';
const T2 = 'dc000000-0000-0000-0000-000000000002';
const ctx = { tenantId: T, branchId: 'dc000000-0000-0000-0000-0000000000b1', userId: 'dc000000-0000-0000-0000-0000000000c1' };
const ctx2 = { ...ctx, tenantId: T2 };
const N1 = '1111222233334444', N2 = '5555666677778888', N3 = '9999000011112222', N4 = '1212343456567878';
const cards = (nums: string[]) => nums.map((n) => ({ hash: hashCardNumber(n), last4: lastFour(n) }));

let pg: PGlite;
let repo: KyselyGiftCardStockRepo;

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyGiftCardStockRepo(db as any);
});

describe('physical gift-card stock (§21)', () => {
  it('registers a batch, storing only hash + last four', async () => {
    const res = await repo.registerCards(ctx, cards([N1, N2, N3]), 'Box A');
    expect(res.added).toBe(3);
    expect(res.duplicates).toBe(0);
    const st = await repo.listStock(ctx);
    expect(st.counts.available).toBe(3);
    expect(st.items[0].last4).toHaveLength(4);
  });

  it('dedups an overlapping re-registration via the (tenant, hash) unique index', async () => {
    const res = await repo.registerCards(ctx, cards([N1, N4]), 'Box A again'); // N1 already in stock
    expect(res.added).toBe(1);
    expect(res.duplicates).toBe(1);
    expect((await repo.listStock(ctx)).counts.available).toBe(4);
  });

  it('voids only an available card and updates the counts', async () => {
    const st = await repo.listStock(ctx);
    const target = st.items.find((i) => i.status === 'available')!;
    expect(await repo.voidCard(ctx, target.id)).toBe(true);
    const after = await repo.listStock(ctx);
    expect(after.counts.void).toBe(1);
    expect(after.counts.available).toBe(3);
    // voiding it again is a no-op (it's no longer available)
    expect(await repo.voidCard(ctx, target.id)).toBe(false);
  });

  it('lets the same printed number exist independently at another tenant', async () => {
    const res = await repo.registerCards(ctx2, cards([N1]), null);
    expect(res.added).toBe(1);
    expect((await repo.listStock(ctx2)).counts.available).toBe(1);
    // tenant 1's stock is unchanged
    expect((await repo.listStock(ctx)).counts.available).toBe(3);
  });
});
