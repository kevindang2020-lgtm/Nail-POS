// scheduler-lease.postgres-race.vitest.spec.ts — Phase 2 (BUILD_PLAN_2026-10-06), migration 518: one owner per
// scheduled tick across processes, proved on a real Postgres with real concurrent connections (PG_RACE_URL).
//
// Before: 31 schedulers ran each tick once PER PROCESS (two replicas → reminders, billing cycles, exports twice).
import { describe, it, expect, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { leaseTickCoordinator, claimTick } from '@aipowersalon/database';

const url = process.env.PG_RACE_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NAME = `lease-proof-${process.pid}`;

describe.skipIf(!url)('scheduler leases on real Postgres', () => {
  // Each "process" has its own pool: separate connections, like separate replicas.
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 3 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk(), mk(), mk()] : [];
  afterAll(async () => { if (dbs[0]) await sql`delete from scheduler_runs where name like ${'lease-proof-' + process.pid + '%'}`.execute(dbs[0]); await Promise.all(dbs.map((d) => d.destroy())); });

  it('six processes firing the same tick at the same moment: exactly ONE runs it', async () => {
    const name = NAME + ':race';
    let runs = 0;
    const outs = await Promise.all(dbs.map((db, i) => leaseTickCoordinator(db, `p${i}`)(name, 60_000, async () => { runs++; await sleep(150); })));
    expect(runs).toBe(1);
    expect(outs.filter((o) => o.ran)).toHaveLength(1);
    const row: any = (await sql`select runs, skipped, lease_owner, last_outcome from scheduler_runs where name = ${name}`.execute(dbs[0])).rows[0];
    expect(row).toMatchObject({ lease_owner: null, last_outcome: 'ok' });
    expect(Number(row.runs)).toBe(1);
    expect(Number(row.skipped)).toBe(5);
  });

  it('a second process whose timer fires a moment later in the SAME interval skips; after the interval it runs', async () => {
    const name = NAME + ':gap';
    let runs = 0;
    const a = leaseTickCoordinator(dbs[0], 'A'), b = leaseTickCoordinator(dbs[1], 'B');
    expect((await a(name, 600, async () => { runs++; })).ran).toBe(true);
    await sleep(100);
    expect((await b(name, 600, async () => { runs++; })).ran).toBe(false);   // A already ran this interval
    await sleep(500);                                                          // > 80% of 600 ms since A started
    expect((await b(name, 600, async () => { runs++; })).ran).toBe(true);
    expect(runs).toBe(2);
  });

  it('a holder that dies mid-tick blocks nobody for longer than its lease', async () => {
    const name = NAME + ':dead';
    expect(await claimTick(dbs[0], name, 'dead-process', 50, { leaseMs: 300 })).toBe(true);   // claims, then "dies"
    let ran = false;
    expect((await leaseTickCoordinator(dbs[1], 'B')(name, 50, async () => { ran = true; })).ran).toBe(false);
    await sleep(400);
    expect((await leaseTickCoordinator(dbs[1], 'B')(name, 50, async () => { ran = true; })).ran).toBe(true);
    expect(ran).toBe(true);
  });

  it('a long tick renews its lease, so nobody else starts the same work while it is still running', async () => {
    const name = NAME + ':long';
    const a = leaseTickCoordinator(dbs[0], 'A', { leaseMs: 300 }), b = leaseTickCoordinator(dbs[1], 'B', { leaseMs: 300 });
    let other = false;
    const long = a(name, 50, async () => { await sleep(1_000); });            // 3× its lease
    await sleep(600);
    expect((await b(name, 50, async () => { other = true; })).ran).toBe(false); // the lease was renewed, not lapsed
    await long;
    expect(other).toBe(false);
  });

  it('a failing tick releases the lease and records the failure', async () => {
    const name = NAME + ':fail';
    await expect(leaseTickCoordinator(dbs[0], 'A')(name, 50, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const row: any = (await sql`select lease_owner, last_outcome, last_error, failures from scheduler_runs where name = ${name}`.execute(dbs[0])).rows[0];
    expect(row).toMatchObject({ lease_owner: null, last_outcome: 'failed', last_error: 'boom' });
    expect(Number(row.failures)).toBe(1);
  });
});
