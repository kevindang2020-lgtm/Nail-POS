// kpi-snapshots-local-day.pgtest — the daily KPI snapshot behind every "vs yesterday" arrow is filed under the BRANCH's
// business day (Oct 6 2026), not UTC's. At 9:30 pm Monday in New York (01:30 UTC Tuesday) the old code filed tonight's
// figures under Tuesday — and Tuesday morning's overwrote them — so "yesterday" was a 7:59 pm snapshot.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR, clearBranchTimeZoneCache } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { PosKpiSnapshots } from './kpi-snapshots';

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

const T = 'e4000000-0000-4000-8000-0000000000a1', B = 'e4000000-0000-4000-8000-0000000000b1';
let pg: PGlite; let snaps: PosKpiSnapshots;
const days = async () => (await pg.query(`select to_char(business_day, 'YYYY-MM-DD') as d, metrics from pos_kpi_daily_snapshots where tenant_id = $1 order by business_day`, [T])).rows as any[];

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  clearBranchTimeZoneCache();
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Snap Day LLC','Snap Day','snap-day','SNDAY1','active')`, [T]);
  await pg.query(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  snaps = new PosKpiSnapshots(db as never);
});

describe('the snapshot\'s business day', () => {
  it('Monday 9:30 pm in New York files under Monday; Tuesday 9 am compares against Monday\'s closing figures', async () => {
    snaps.now = () => Date.parse('2026-10-05T14:00:00Z');                 // Monday 10 am
    await snaps.snapshotAndTrends(T, B, 'checkout', { revenue: 100 });
    snaps.now = () => Date.parse('2026-10-06T01:30:00Z');                 // Monday 9:30 pm (Tuesday in UTC)
    await snaps.snapshotAndTrends(T, B, 'checkout', { revenue: 900 });
    expect((await days()).map((r) => [r.d, r.metrics.revenue])).toEqual([['2026-10-05', 900]]);
    snaps.now = () => Date.parse('2026-10-06T13:00:00Z');                 // Tuesday 9 am
    const t = await snaps.snapshotAndTrends(T, B, 'checkout', { revenue: 450 });
    expect(t.revenue).toEqual({ deltaPercent: 50, direction: 'down' });  // vs Monday's 900, not a 7:59 pm figure
    expect((await days()).map((r) => [r.d, r.metrics.revenue])).toEqual([['2026-10-05', 900], ['2026-10-06', 450]]);
  });
});
