// memberships-local-day.pgtest — the Memberships dashboard's "this month" (revenue, new members, cancellations) and its
// daily revenue line are the SALON's month and days (Oct 6 2026), not the database's UTC ones. The clock is fixed at
// 9:30 pm Saturday Oct 31 in New York (01:30 UTC Sunday Nov 1): in UTC the month had already turned, so from 8 pm the
// dashboard showed an empty November and called October "last month".
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR, clearBranchTimeZoneCache } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyMembershipsRepository } from './memberships.kysely.repository';

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

const T = 'e8000000-0000-4000-8000-0000000000a1', B = 'e8000000-0000-4000-8000-0000000000b1';
const NOW = Date.parse('2026-11-01T01:30:00Z');
let repo: KyselyMembershipsRepository;

beforeAll(async () => {
  const pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Member Day LLC','Member Day','member-day','MBDAY1','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  let k = 0;
  const pay = (cents: number, at: string) => q(`insert into membership_payments (tenant_id, branch_id, customer_membership_id, customer_id, amount_cents, status, idempotency_key, settled_at) values ($1,$2,gen_random_uuid(),gen_random_uuid(),$3,'succeeded',$4,$5)`, [T, B, cents, 'local-day-' + (++k), at]);
  await pay(1111, '2026-09-15T16:00:00Z');   // September
  await pay(2222, '2026-10-01T03:00:00Z');   // 11 pm Wed Sep 30 here — September (October in UTC)
  await pay(4000, '2026-10-15T16:00:00Z');   // Oct 15
  await pay(6000, '2026-11-01T01:00:00Z');   // 9 pm tonight, Oct 31 here — November in UTC
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyMembershipsRepository(db as never); repo.now = () => NOW;
});

describe('the salon\'s month', () => {
  it('this month $100 (Oct 15 + tonight), last month $33.33 (Sep 15 + Sep 30 11 pm) — from the whole salon and from its branch', async () => {
    for (const f of [{}, { branchId: B }]) {
      const o: any = await repo.overview({ tenantId: T } as never, f as never);
      expect(o.kpis.membershipRevenueCents).toBe(10000);
      expect(o.kpis.revenueDeltaPct).toBe(Math.round(((10000 - 3333) / 3333) * 1000) / 10);
    }
  });
  it('the daily line has the salon\'s days: Oct 15 and Oct 31 (tonight is not "Nov 01")', async () => {
    const o: any = await repo.overview({ tenantId: T } as never, {} as never);
    expect(o.revenueSeries).toEqual([{ label: 'Oct 15', cents: 4000 }, { label: 'Oct 31', cents: 6000 }]);
  });
});
