// customer-home-salon.postgres-race.vitest.spec.ts — Profile → My salon (Kevin, Oct 3 2026) on real Postgres:
// another location of the same salon switches at once; a different salon business gets this person's account there
// (created with the same name, contact details and password hash — or the existing one reused) marked as the newest
// default, so sign-in (which prefers the newest default) lands there. Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyAuthUserRepository } from '@aipowersalon/identity';
import { KyselyCustomerRepository } from './customer.kysely.repository';

const url = process.env.PG_RACE_URL;
const T1 = 'a7800000-0000-4000-8000-0000000000a1', B1 = 'b7800000-0000-4000-8000-0000000000b1', B1b = 'b7800000-0000-4000-8000-0000000000b2';
const T2 = 'a7800000-0000-4000-8000-0000000000a2', B2 = 'b7800000-0000-4000-8000-0000000000b3', BH = 'b7800000-0000-4000-8000-0000000000b9';
const U = 'c7800000-0000-4000-8000-0000000000c1', C = 'e7800000-0000-4000-8000-0000000000e1';
const EMAIL = 'mae.switch@example.test';
let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyCustomerRepository;
const ctx = { tenantId: T1, branchId: B1, userId: U, role: 'CUSTOMER', permissions: [] } as any;

describe.skipIf(!url)('changing the default salon', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyCustomerRepository(db as any);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state, status) values (${T1}, 'Polished', 'Polished', 'polished-hs', 'POLHS', 'active', 'active'), (${T2}, 'Luxe', 'Luxe', 'luxe-hs', 'LUXHS', 'active', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, city, status, is_public) values (${B1}, ${T1}, 'Cherry Hill', 'Cherry Hill', 'active', true), (${B1b}, ${T1}, 'Moorestown', 'Moorestown', 'active', true), (${B2}, ${T2}, 'Luxe Haddonfield', 'Haddonfield', 'active', true), (${BH}, ${T2}, 'Back office', 'Haddonfield', 'active', false) on conflict (id) do nothing`.execute(db);
    await sql`delete from customers where tenant_id in (${T1}, ${T2})`.execute(db); await sql`delete from users where tenant_id in (${T1}, ${T2})`.execute(db);
    await sql`insert into users (id, tenant_id, branch_id, email, normalized_phone, password_hash, full_name, first_name, last_name, status, role, customer_default_at)
      values (${U}, ${T1}, ${B1}, ${EMAIL}, '+18565550101', 'HASH-OF-HER-PASSWORD', 'Mae Lin', 'Mae', 'Lin', 'active', 'CUSTOMER', '2026-09-01T00:00:00Z')`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, email, normalized_phone, user_id, status) values (${C}, ${T1}, ${B1}, 'Mae', 'Lin', 'Mae Lin', ${EMAIL}, '+18565550101', ${U}, 'active')`.execute(db);
  });
  afterAll(async () => { await sql`delete from customers where tenant_id in (${T1}, ${T2})`.execute(db).catch(() => undefined); await sql`delete from users where tenant_id in (${T1}, ${T2})`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('reads the current default salon', async () => {
    expect(await repo.homeSalon(ctx, C)).toEqual({ salonId: B1, salonName: 'Cherry Hill', city: 'Cherry Hill' });
  });

  it('another location of the SAME salon switches at once — no new account, no sign-in needed', async () => {
    expect(await repo.setHomeSalon(ctx, C, B1b)).toEqual({ ok: true, salonName: 'Moorestown' });
    expect(await repo.homeSalon(ctx, C)).toMatchObject({ salonId: B1b });
    expect(Number(((await sql`select count(*)::int n from users where lower(email) = ${EMAIL}`.execute(db)).rows[0] as any).n)).toBe(1);
  });

  it('a hidden location is refused', async () => {
    expect(await repo.setHomeSalon(ctx, C, BH)).toMatchObject({ ok: false });
  });

  it('a DIFFERENT salon: her account there is created (same name, contact, password hash), marked the newest default; sign-in will land there', async () => {
    const r = await repo.setHomeSalon(ctx, C, B2);
    expect(r).toEqual({ ok: true, salonName: 'Luxe Haddonfield', requiresSignIn: true });
    const t2: any = (await sql`select u.branch_id, u.password_hash, u.full_name, u.normalized_phone, c.branch_id as cbranch, c.full_name as cname from users u join customers c on c.user_id = u.id where u.tenant_id = ${T2} and lower(u.email) = ${EMAIL}`.execute(db)).rows[0];
    expect(t2).toMatchObject({ branch_id: B2, password_hash: 'HASH-OF-HER-PASSWORD', full_name: 'Mae Lin', normalized_phone: '+18565550101', cbranch: B2, cname: 'Mae Lin' });
    const cands = await new KyselyAuthUserRepository(db as any).findCustomersForLogin({ kind: 'email', value: EMAIL } as any);
    const newest = cands.reduce((a, b) => (Date.parse(b.defaultAt ?? '0') > Date.parse(a.defaultAt ?? '0') ? b : a));
    expect(newest.user.tenantId).toBe(T2);
  });

  it('switching back to the first salon reuses that account (no duplicate) and makes it the default again', async () => {
    const ctx2 = { tenantId: T2, branchId: B2, userId: String(((await sql`select id from users where tenant_id = ${T2} and lower(email) = ${EMAIL}`.execute(db)).rows[0] as any).id), role: 'CUSTOMER', permissions: [] } as any;
    const c2 = String(((await sql`select id from customers where tenant_id = ${T2} and lower(email) = ${EMAIL}`.execute(db)).rows[0] as any).id);
    expect(await repo.setHomeSalon(ctx2, c2, B1)).toMatchObject({ ok: true, requiresSignIn: true });
    expect(Number(((await sql`select count(*)::int n from users where tenant_id = ${T1} and lower(email) = ${EMAIL}`.execute(db)).rows[0] as any).n)).toBe(1);
    const cands = await new KyselyAuthUserRepository(db as any).findCustomersForLogin({ kind: 'email', value: EMAIL } as any);
    const newest = cands.reduce((a, b) => (Date.parse(b.defaultAt ?? '0') > Date.parse(a.defaultAt ?? '0') ? b : a));
    expect(newest.user.tenantId).toBe(T1);
  });
});
