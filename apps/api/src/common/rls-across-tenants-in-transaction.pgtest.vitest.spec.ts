// rls-across-tenants-in-transaction — inside an OPEN transaction, runAcrossTenants cannot help (the connection was checked
// out carrying the request's tenant). acrossTenantsIn clears app.tenant_id LOCALLY for the transaction while its callback
// runs, then restores it. Proven on the real migrated schema, under migration 458's policy on customers, as a NON-superuser.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { acrossTenantsIn, runWithTenant } from '@aipowersalon/database';

let pg: any; let db: any;
const A = 'aaaaaaaa-0000-4000-8000-00000000001a';
const B = 'bbbbbbbb-0000-4000-8000-00000000001b';
const saved = process.env.DB_TENANT_RLS;
const tenantsSeen = async (x: any) => (await sql<{ tenant_id: string }>`select tenant_id from customers where tenant_id in (${A}, ${B}) order by tenant_id`.execute(x)).rows.map((r) => r.tenant_id);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  const req = (await pg.query(`select column_name, data_type from information_schema.columns where table_name = 'customers' and is_nullable = 'NO' and column_default is null`)).rows;
  for (const [tenant, name] of [[A, 'Ann'], [B, 'Bob']]) {
    // Phase 10: customers.tenant_id → tenants is a foreign key now (migration 538) — the salon row first
    await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state, status) values ($1, 'T', 'T', $2, $2, 'ACTIVE', 'active') on conflict do nothing`, [tenant, `rls-${String(tenant).slice(0, 8)}-${String(tenant).slice(-4)}`]);
    const cols: string[] = [], vals: unknown[] = [];
    for (const c of req) { cols.push(c.column_name); vals.push(c.column_name === 'tenant_id' ? tenant : /uuid/.test(c.data_type) ? crypto.randomUUID() : /timestamp|date/.test(c.data_type) ? new Date().toISOString() : /int|numeric/.test(c.data_type) ? 0 : /bool/.test(c.data_type) ? false : name); }
    if (!cols.includes('tenant_id')) { cols.push('tenant_id'); vals.push(tenant); }
    await pg.query(`insert into customers (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`, vals);
  }
  await pg.exec(`create role rls_trx nologin; grant all on all tables in schema public to rls_trx; set role rls_trx;`);
  process.env.DB_TENANT_RLS = '1';
});
afterAll(() => { if (saved === undefined) delete process.env.DB_TENANT_RLS; else process.env.DB_TENANT_RLS = saved; });

describe('acrossTenantsIn — crossing salons inside a transaction', () => {
  it("inside salon A's transaction: only A before, both inside the helper, only A again after", async () => {
    await pg.query(`select set_config('app.tenant_id', $1, false)`, [A]);   // what the tenant-session pool does at checkout
    await runWithTenant(A, () => db.transaction().execute(async (trx: any) => {
      expect(await tenantsSeen(trx)).toEqual([A]);
      const inside = await acrossTenantsIn(trx, 'shared gift-card program: the issuing salon', () => tenantsSeen(trx));
      expect(inside).toEqual([A, B]);
      expect(await tenantsSeen(trx)).toEqual([A]);                          // restored within the transaction
    }));
    expect(await tenantsSeen(db)).toEqual([A]);                              // and the session setting is untouched
  });
  it('plain runAcrossTenants inside the transaction does NOT help — why this helper exists', async () => {
    const { runAcrossTenants } = await import('@aipowersalon/database');
    await pg.query(`select set_config('app.tenant_id', $1, false)`, [A]);
    await db.transaction().execute(async (trx: any) => {
      expect(await runAcrossTenants('demonstration', () => tenantsSeen(trx))).toEqual([A]);
    });
  });
});
