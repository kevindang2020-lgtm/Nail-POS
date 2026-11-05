// rls-customers.pgtest — Postgres row-level security on customers (migration 458), proven on the REAL migrated schema.
// PGlite runs as a superuser, and superusers bypass RLS even when it is FORCED — so the policy is exercised as a
// NON-superuser role (as the app's database role is), with app.tenant_id set exactly as the tenant-session pool sets it.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite } from '@aipowersalon/testing';

let pg: any;
const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const rows = async (sql: string, p: unknown[] = []) => (await pg.query(sql, p)).rows;
const asTenant = (t: string) => rows(`select set_config('app.tenant_id', $1, false)`, [t]);

beforeAll(async () => {
  pg = await migratedPglite();
  const req = await rows(`select column_name, data_type from information_schema.columns
    where table_name = 'customers' and is_nullable = 'NO' and column_default is null`);
  // one customer per tenant, filling whatever NOT NULL columns the schema demands
  for (const [tenant, name] of [[A, 'Ann A'], [B, 'Bob B']]) {
    // Phase 10: customers.tenant_id → tenants is a foreign key now (migration 538) — the salon row first
    await rows(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state, status) values ($1, 'T', 'T', $2, $2, 'ACTIVE', 'active') on conflict do nothing`, [tenant, `rls-${String(tenant).slice(0, 8)}-${String(tenant).slice(-4)}`]);
    const cols: string[] = [], vals: unknown[] = [];
    for (const c of req) {
      cols.push(c.column_name);
      vals.push(c.column_name === 'tenant_id' ? tenant : c.column_name === 'id' ? crypto.randomUUID()
        : /uuid/.test(c.data_type) ? crypto.randomUUID() : /timestamp|date/.test(c.data_type) ? new Date().toISOString()
        : /int|numeric/.test(c.data_type) ? 0 : /bool/.test(c.data_type) ? false : name);
    }
    if (!cols.includes('tenant_id')) { cols.push('tenant_id'); vals.push(tenant); }
    await rows(`insert into customers (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`, vals);
  }
  await pg.exec(`create role rls_app nologin; grant all on all tables in schema public to rls_app; set role rls_app;`);
});

describe('row-level security on customers (458)', () => {
  it('RLS is ENABLED and FORCED (the owner does not bypass it)', async () => {
    await pg.exec('reset role');
    const [r] = await rows(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'customers'`);
    await pg.exec('set role rls_app');
    expect(r).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
  it('no tenant set (flag off / worker / Super Admin): every row is visible — the migration changes nothing', async () => {
    await asTenant('');
    expect((await rows(`select tenant_id from customers`)).map((r: any) => r.tenant_id).sort()).toEqual([A, B]);
  });
  it("a tenant sees ONLY its own customers, even with no WHERE clause at all", async () => {
    await asTenant(A);
    expect((await rows(`select tenant_id from customers`)).map((r: any) => r.tenant_id)).toEqual([A]);
  });
  it("another salon's rows cannot be updated or deleted (0 rows), and cannot be inserted", async () => {
    await asTenant(A);
    expect((await rows(`update customers set updated_at = now() where tenant_id = $1 returning id`, [B])).length).toBe(0);
    expect((await rows(`delete from customers where tenant_id = $1 returning id`, [B])).length).toBe(0);
    await expect(rows(`update customers set tenant_id = $1 where tenant_id = $2`, [B, A])).rejects.toThrow(/row-level security/);
    await asTenant('');
    expect((await rows(`select tenant_id from customers`)).length).toBe(2);   // B's row survived
  });
});
