// rls-core-tables.pgtest — migration 544: row-level security extended from customers to the core money / POS / identity
// tables, with STRICT mode and the explicit cross-tenant marker '*', proven on the REAL migrated schema as a NON-superuser
// (PGlite runs as a superuser, and superusers bypass RLS even when FORCED). The settings are written exactly as
// packages/database/src/tenant-session.ts writes them.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite } from '@aipowersalon/testing';

let pg: any;
const A = 'aaaaaaaa-0000-4000-8000-0000000005a4';
const B = 'bbbbbbbb-0000-4000-8000-0000000005b4';
const TABLES = ['customers', 'tickets', 'ticket_service_lines', 'payments', 'payment_refunds', 'pos_tech_appointments', 'pos_queue_items',
  'customer_loyalty_profiles', 'loyalty_ledger', 'users'];   // (544 also names `appointments` "if present" — dropped by 041)
const rows = async (sql: string, p: unknown[] = []) => (await pg.query(sql, p)).rows;
const session = (tenant: string, strict = false) => rows(`select set_config('app.tenant_id', $1, false), set_config('app.tenant_strict', $2, false)`, [tenant, strict ? 'on' : '']);
const seen = async (table: string) => (await rows(`select tenant_id from ${table} where tenant_id in ($1, $2) order by tenant_id`, [A, B])).map((r: any) => (r.tenant_id === A ? 'A' : 'B'));

beforeAll(async () => {
  pg = await migratedPglite();
  for (const t of [A, B]) {
    // the tenant itself first, so the core foreign keys (Phase 10, migration 538) are satisfied whatever is enforced
    await rows(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values ($1, 'T', 'T', $2, $2, 'active') on conflict do nothing`, [t, `rls544-${t.slice(0, 4)}`]);
    await rows(`insert into pos_queue_items (tenant_id, customer_name) values ($1, 'Q')`, [t]);
    await rows(`insert into payment_refunds (tenant_id) values ($1)`, [t]);
    await rows(`insert into users (tenant_id, role, email) values ($1, 'MANAGER', $2)`, [t, `${t.slice(0, 4)}@example.test`]);
  }
  await pg.exec(`create role rls_core nologin; grant all on all tables in schema public to rls_core; grant execute on all functions in schema public to rls_core; set role rls_core;`);
});

describe('migration 544 — the catalog', () => {
  it('RLS is ENABLED and FORCED on every core table, with ONE tenant_isolation policy that uses the uuid helpers', async () => {
    await pg.exec('reset role');
    const cat = await rows(`select c.relname, c.relrowsecurity r, c.relforcerowsecurity f, p.qual, p.with_check
      from pg_class c left join pg_policies p on p.tablename = c.relname and p.policyname = 'tenant_isolation'
      where c.relname = any($1::text[]) and c.relkind = 'r' order by c.relname`, [TABLES]);
    await pg.exec('set role rls_core');
    expect(cat.map((r: any) => r.relname).sort()).toEqual([...TABLES].sort());
    for (const r of cat) {
      expect([r.relname, r.r, r.f], r.relname).toEqual([r.relname, true, true]);
      expect(r.qual, r.relname).toMatch(/app_session_unrestricted\(\).*tenant_id = app_session_tenant\(\)/s);
      expect(r.with_check, r.relname).toMatch(/app_session_unrestricted\(\).*tenant_id = app_session_tenant\(\)/s);
      expect(r.qual, `${r.relname}: tenant_id must be compared as uuid (index-usable), not ::text`).not.toMatch(/tenant_id\)?::text/);
    }
  });
});

describe('migration 544 — behaviour (as a non-superuser role)', () => {
  it("permissive default: NO tenant on the session (flag off — nothing is ever set) sees every row, as before", async () => {
    await session('');
    for (const t of ['pos_queue_items', 'payment_refunds', 'users']) expect(await seen(t), t).toEqual(['A', 'B']);
  });
  it("a salon's session sees ONLY its rows — without any WHERE on tenant", async () => {
    await session(A);
    for (const t of ['pos_queue_items', 'payment_refunds', 'users']) expect(await seen(t), t).toEqual(['A']);
    expect((await rows(`select count(*)::int c from users where email like '%@example.test'`))[0].c).toBe(1);
  });
  it("a salon cannot update/delete another salon's rows (0 rows) and cannot write a row for another salon or with NO tenant", async () => {
    await session(A);
    expect((await rows(`update pos_queue_items set customer_name = 'x' where tenant_id = $1 returning id`, [B])).length).toBe(0);
    expect((await rows(`delete from payment_refunds where tenant_id = $1 returning id`, [B])).length).toBe(0);
    await expect(rows(`insert into pos_queue_items (tenant_id, customer_name) values ($1, 'evil')`, [B])).rejects.toThrow(/row-level security/);
    await expect(rows(`insert into users (tenant_id, role) values (null, 'MANAGER')`)).rejects.toThrow(/row-level security/);
    await expect(rows(`update pos_queue_items set tenant_id = $1 where tenant_id = $2`, [B, A])).rejects.toThrow(/row-level security/);
  });
  it("STRICT: a session with no tenant sees NOTHING and can write nothing", async () => {
    await session('', true);
    for (const t of ['pos_queue_items', 'payment_refunds', 'users']) expect(await seen(t), t).toEqual([]);
    await expect(rows(`insert into pos_queue_items (tenant_id, customer_name) values ($1, 'x')`, [A])).rejects.toThrow(/row-level security/);
  });
  it("STRICT: the explicit cross-tenant marker '*' (Super Admin, runAcrossTenants, workers) still sees every salon", async () => {
    await session('*', true);
    for (const t of ['pos_queue_items', 'payment_refunds', 'users']) expect(await seen(t), t).toEqual(['A', 'B']);
  });
  it('STRICT: a salon session is unchanged (its own rows only)', async () => {
    await session(B, true);
    expect(await seen('pos_queue_items')).toEqual(['B']);
  });
  it('a malformed tenant value (not a uuid, not *) matches nothing — fail closed, never a cast error', async () => {
    await session('not-a-uuid');
    expect(await seen('pos_queue_items')).toEqual([]);
    await session("'; drop table users; --");
    expect(await seen('users')).toEqual([]);
  });
  it('customers (458/517) now follows the same policy shape', async () => {
    await pg.exec('reset role');
    const [p] = await rows(`select qual from pg_policies where tablename = 'customers' and policyname = 'tenant_isolation'`);
    await pg.exec('set role rls_core');
    expect(p.qual).toMatch(/app_session_unrestricted\(\)/);
  });
});
