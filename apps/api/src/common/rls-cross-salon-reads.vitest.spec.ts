// rls-cross-salon-reads — with row-level security (DB_TENANT_RLS) the database keys every query to the REQUEST's salon.
// The reads that cross salons BY DESIGN must run with no tenant on the session, via runAcrossTenants. This drives the real
// repositories through a real Kysely whose driver records, for every query, which tenant the async context carries —
// exactly what the tenant-session pool would put in app.tenant_id.
import { describe, it, expect } from 'vitest';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type Driver, type DatabaseConnection } from 'kysely';
import { runWithTenant, currentDbTenant } from '@aipowersalon/database';
import { KyselyOwnerPortfolioRepo } from '@aipowersalon/tenants';
import { KyselyNailShowcaseRepository, KyselyNailShowcaseSocialRepository } from '@aipowersalon/workforce';

function recordingDb() {
  const seen: string[] = [];
  const conn: DatabaseConnection = { async executeQuery() { seen.push(currentDbTenant()); return { rows: [] } as any; }, async *streamQuery() {} };
  const driver: Driver = { async init() {}, async acquireConnection() { return conn; }, async beginTransaction() {}, async commitTransaction() {}, async rollbackTransaction() {}, async releaseConnection() {}, async destroy() {} };
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => driver, createIntrospector: (d) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  return { db, seen };
}

describe('cross-salon reads run with no tenant on the database session', () => {
  it("the owner portfolio's reads cross salons even inside salon t1's request", async () => {
    const { db, seen } = recordingDb();
    const repo = new KyselyOwnerPortfolioRepo(db as any);
    await runWithTenant('t1', async () => {
      await repo.loadPortfolio('owner-1');
      await repo.loadTotals(['t1', 't2']);
      await repo.loadRevenueSeries(['t1', 't2']);
      expect(currentDbTenant()).toBe('t1');          // restored after each
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((t) => t === '')).toBe(true);   // never t1 — the portfolio would have been emptied to one salon
  });
  it("the showcase notifies an author at THEIR salon (another salon's customers row) with no tenant on the session", async () => {
    for (const Repo of [KyselyNailShowcaseRepository, KyselyNailShowcaseSocialRepository] as any[]) {
      const { db, seen } = recordingDb();
      await runWithTenant('t1', async () => { await new Repo(db).notifyUser({ tenantId: 't2', userId: 'u2', type: 'nail_showcase', title: 'x', body: null, reference: null }); });
      expect(seen.length, Repo.name).toBeGreaterThan(0);
      expect(seen.every((t: string) => t === ''), Repo.name).toBe(true);
    }
  });
  it('an ordinary tenant query in the same request DOES carry the tenant (the recorder is not vacuous)', async () => {
    const { db, seen } = recordingDb();
    await runWithTenant('t1', async () => { await db.selectFrom('customers').selectAll().execute(); });
    expect(seen).toEqual(['t1']);
  });
});
