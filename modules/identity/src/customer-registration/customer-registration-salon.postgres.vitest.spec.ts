// customer-registration-salon.postgres.vitest.spec.ts — sign-up with a CHOSEN salon (Kevin, Oct 3 2026) on real
// Postgres: a public location of an active salon creates the account there (that location as home, marked default);
// a hidden location or an inactive salon is refused; the salon-code path still works. Opt-in: PG_RACE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCustomerRegistrationRepository } from './customer-registration.kysely.repository';
import { CustomerRegistrationService } from './customer-registration.service';

const url = process.env.PG_RACE_URL;
const T = 'a7700000-0000-4000-8000-0000000000a1', B1 = 'b7700000-0000-4000-8000-0000000000b1', B2 = 'b7700000-0000-4000-8000-0000000000b2', BH = 'b7700000-0000-4000-8000-0000000000b9';
const TX = 'a7700000-0000-4000-8000-0000000000a9', BX = 'b7700000-0000-4000-8000-0000000000b8';
let db: Kysely<any>; let pool: pg.Pool; let svc: CustomerRegistrationService;
const body = (o: any) => ({ firstName: 'Ana', lastName: 'Lee', email: `ana+${Math.random().toString(36).slice(2, 8)}@example.test`, phone: '', password: 'longenough1', ...o });

describe.skipIf(!url)('sign-up with a chosen salon', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    svc = new CustomerRegistrationService(new KyselyCustomerRegistrationRepository(db as any));
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state, status) values (${T}, 'Polished', 'Polished', 'polished-cs', 'POLCS', 'active', 'active'), (${TX}, 'Closed', 'Closed', 'closed-cs', 'CLOCS', 'active', 'suspended') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status, is_public) values (${B1}, ${T}, 'Cherry Hill', 'active', true), (${B2}, ${T}, 'Moorestown', 'active', true), (${BH}, ${T}, 'Back office', 'active', false), (${BX}, ${TX}, 'Closed salon', 'active', true) on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { for (const t of [T, TX]) { await sql`delete from customers where tenant_id = ${t}`.execute(db).catch(() => undefined); await sql`delete from users where tenant_id = ${t}`.execute(db).catch(() => undefined); } await db?.destroy(); });

  it('a picked public location: the account is at that salon, that location is home, and it is marked the default', async () => {
    const b = body({ salonId: B2 });
    expect(await svc.register(b)).toEqual({ ok: true, message: undefined });
    const u: any = (await sql`select tenant_id, branch_id, customer_default_at from users where lower(email) = ${b.email.toLowerCase()}`.execute(db)).rows[0];
    expect(u).toMatchObject({ tenant_id: T, branch_id: B2 });
    expect(u.customer_default_at).not.toBeNull();
    const c: any = (await sql`select branch_id from customers where lower(email) = ${b.email.toLowerCase()}`.execute(db)).rows[0];
    expect(c.branch_id).toBe(B2);
  });
  it('a hidden location, an inactive salon or a made-up id is refused', async () => {
    for (const salonId of [BH, BX, 'not-a-uuid', 'f7700000-0000-4000-8000-0000000000ff']) expect(await svc.register(body({ salonId }))).toMatchObject({ ok: false, message: 'That salon isn’t available for sign-up.' });
  });
  it('neither a salon nor a code → "Choose your salon."; the salon code still works', async () => {
    expect(await svc.register(body({}))).toMatchObject({ ok: false, message: 'Choose your salon.' });
    expect(await svc.register(body({ salonCode: 'POLCS' }))).toMatchObject({ ok: true });
  });
});
