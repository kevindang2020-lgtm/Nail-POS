// owner-portfolio-local-day.pgtest — the Owner App's All Salons figures use EACH salon's own day, month and hours (Oct 6
// 2026). The clock is fixed at 9:30 pm Saturday Oct 31 in New York (01:30 UTC Sunday Nov 1; 6:30 pm in Los Angeles).
// In UTC the month and the day have already turned: the old month total and hourly chart started over at 8 pm, and the
// chart's hours were UTC hours (a 10 am sale in New York sat in the "14" bucket).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR, clearBranchTimeZoneCache } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyOwnerPortfolioRepo } from './owner-portfolio.repository';

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

const NY = 'e9000000-0000-4000-8000-0000000000a1', LA = 'e9000000-0000-4000-8000-0000000000a2';
const NYB = 'e9000000-0000-4000-8000-0000000000b1', LAB = 'e9000000-0000-4000-8000-0000000000b2';
const NOW = Date.parse('2026-11-01T01:30:00Z');
let repo: KyselyOwnerPortfolioRepo;

beforeAll(async () => {
  const pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'NY Day LLC','NY Day','ny-day','NYDAY1','active'), ($2,'LA Day LLC','LA Day','la-day','LADAY1','active')`, [NY, LA]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Main','active','America/Los_Angeles')`, [NYB, NY, LAB, LA]);
  const pay = async (t: string, b: string, cents: number, at: string) => {
    const c: any = (await q(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,'Day','Guest','Day Guest') returning id`, [t, b])).rows[0];
    const k: any = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, paid_at) values ($1,$2,$3,'paid',$4) returning id`, [t, b, c.id, at])).rows[0];
    return q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at) values ($1,$2,$3,'cash',$4,0,'captured',$5) returning id`, [t, b, k.id, cents, at]);
  };
  await pay(NY, NYB, 9900, '2026-10-01T03:00:00Z');   // 11 pm Sep 30 in New York — last month (October in UTC)
  const ten = await pay(NY, NYB, 5000, '2026-10-31T14:00:00Z');   // 10 am today, New York
  await pay(NY, NYB, 2000, '2026-11-01T01:00:00Z');   // 9 pm tonight, New York — November in UTC
  await pay(LA, LAB, 3000, '2026-10-31T16:00:00Z');   // 9 am today, Los Angeles
  await q(`insert into payment_refunds (tenant_id, payment_id, amount_cents, status, created_at) values ($1,$2,500,'refunded','2026-10-31T14:30:00Z')`, [NY, (ten.rows[0] as any).id]);
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyOwnerPortfolioRepo(db as never); repo.now = () => NOW;
});

describe('each salon\'s own month and day', () => {
  it('New York: this month $65 (10 am $50 − $5 refund + 9 pm $20) — not $0 (UTC November), not $164 (Sep 30 too)', async () => {
    const [ny] = await repo.loadTotals([NY]);
    expect(ny.revenueMonthCents).toBe(6500);
    expect(ny.revenueTodayCents).toBe(6500);
  });
  it('Los Angeles: this month and today $30', async () => {
    const [la] = await repo.loadTotals([LA]);
    expect(la.revenueMonthCents).toBe(3000);
    expect(la.revenueTodayCents).toBe(3000);
  });
});

describe('the Revenue Overview chart', () => {
  it('24 hours of each salon\'s own day: 9 → LA\'s 9 am $30, 10 → New York\'s 10 am $45 net, 21 → New York\'s 9 pm $20', async () => {
    const pts = await repo.loadRevenueSeries([NY, LA]);
    expect(pts.map((p) => p.hour)).toEqual(Array.from({ length: 24 }, (_, h) => h));
    expect(pts.filter((p) => p.revenueCents !== 0)).toEqual([{ hour: 9, revenueCents: 3000 }, { hour: 10, revenueCents: 4500 }, { hour: 21, revenueCents: 2000 }]);
  });
  it('a salon the caller did not ask for is not in the line', async () => {
    const pts = await repo.loadRevenueSeries([LA]);
    expect(pts.filter((p) => p.revenueCents !== 0)).toEqual([{ hour: 9, revenueCents: 3000 }]);
  });
});
