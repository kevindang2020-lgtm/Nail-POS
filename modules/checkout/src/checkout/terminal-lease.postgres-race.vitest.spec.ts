// terminal-lease.postgres-race.vitest.spec.ts — Functional Decision 34 on real Postgres: ten POS stations reach for one
// shared terminal at the same instant — exactly ONE gets it. Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyTerminalLeases } from './terminal-lease';

const url = process.env.PG_RACE_URL;
const T = 'c0ffee00-1ea5-4000-8000-000000000001';   // Phase 10: payment_terminal_leases.tenant_id is uuid (539)
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('real-Postgres terminal lease (Decision 34)', () => {
  beforeAll(() => { pool = new pg.Pool({ connectionString: url, max: 24 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) }); });
  afterAll(async () => { await sql`delete from payment_terminal_leases where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('ten stations reach for one terminal at once — exactly one transaction gets it', async () => {
    await sql`delete from payment_terminal_leases where tenant_id = ${T}`.execute(db);
    const leases = new KyselyTerminalLeases(db);
    const wins = await Promise.all(Array.from({ length: 10 }, (_, i) => leases.acquire(T, 'term-A', 'ticket:' + i)));
    expect(wins.filter(Boolean)).toHaveLength(1);
    const rows = (await sql<{ n: number }>`select count(*)::int as n from payment_terminal_leases where tenant_id = ${T}`.execute(db)).rows[0].n;
    expect(rows).toBe(1);
  });

  it('the holder may re-acquire; another transaction may not until the holder releases', async () => {
    await sql`delete from payment_terminal_leases where tenant_id = ${T}`.execute(db);
    const leases = new KyselyTerminalLeases(db);
    expect(await leases.acquire(T, 'term-B', 'ticket:1')).toBe(true);
    expect(await leases.acquire(T, 'term-B', 'ticket:1')).toBe(true);      // same holder: idempotent
    expect(await leases.acquire(T, 'term-B', 'ticket:2')).toBe(false);     // TERMINAL_BUSY
    await leases.release(T, 'term-B', 'ticket:2');                          // a non-holder cannot free it
    expect(await leases.acquire(T, 'term-B', 'ticket:2')).toBe(false);
    await leases.release(T, 'term-B', 'ticket:1');
    expect(await leases.acquire(T, 'term-B', 'ticket:2')).toBe(true);
  });

  it('a lease left behind by a crashed server expires on its own — the terminal is never stuck', async () => {
    await sql`delete from payment_terminal_leases where tenant_id = ${T}`.execute(db);
    const leases = new KyselyTerminalLeases(db);
    expect(await leases.acquire(T, 'term-C', 'ticket:dead', 1)).toBe(true);
    expect(await leases.acquire(T, 'term-C', 'ticket:next')).toBe(false);
    await new Promise((r) => setTimeout(r, 1200));
    expect(await leases.acquire(T, 'term-C', 'ticket:next')).toBe(true);
    await leases.release(T, 'term-C', 'ticket:dead');                       // the dead holder's late release frees nothing
    expect(await leases.acquire(T, 'term-C', 'ticket:other')).toBe(false);
  });
});
