// customer-preferences.postgres.vitest.spec.ts — Functional Decision 1 on real Postgres: migration 490 carries what staff
// typed into the old notes form onto the profile (a branch only when the note names one of THIS salon's branches), and
// the repository writes and reads the profile columns. Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { KyselyCustomersRepository } from './customers.kysely.repository';
import { CustomersService } from './customers.service';

const url = process.env.PG_RACE_URL;
const T = 'd1000000-0000-4000-8000-0000000000aa', T2 = 'd1000000-0000-4000-8000-0000000000ab';
const B = 'd1000000-0000-4000-8000-0000000000b1', B2 = 'd1000000-0000-4000-8000-0000000000b2', BX = 'd1000000-0000-4000-8000-0000000000b9';
const C1 = 'd1000000-0000-4000-8000-0000000000c1', C2 = 'd1000000-0000-4000-8000-0000000000c2';
const ctx = { tenantId: T, branchId: B, userId: 'u_d1', role: 'FRONT_DESK', permissions: ['pos.customers.view', 'pos.customers.edit'] } as any;
let db: Kysely<any>; let pool: pg.Pool;
const migration = readFileSync(resolve(MIGRATIONS_DIR, '490_customer_preferred_name_language.sql'), 'utf8');   // Constitution 13: never a relative path to the API's migrations
const normalize = readFileSync(resolve(MIGRATIONS_DIR, '697_customer_language_normalize.sql'), 'utf8');   // WP-I: free text → en / vi
const row = async (id: string) => (await sql`select preferred_name, preferred_language, preferred_branch_id from customers where id = ${id}`.execute(db)).rows[0] as any;

describe.skipIf(!url)('customer preferred name / language / branch on real Postgres (Decision 1)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`delete from customers where tenant_id in (${T}, ${T2})`.execute(db);
    for (const [t, slug] of [[T, 'd1-salon'], [T2, 'd1-other']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase().replace('-', '')}, 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Cherry Hill', 'active'), (${B2}, ${T}, 'Moorestown', 'active'), (${BX}, ${T2}, 'Haddonfield', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, notes_json) values
      (${C1}, ${T}, ${B}, 'Nguyen', 'Thi Hoa', 'Nguyen Thi Hoa', 'active', ${JSON.stringify({ salonNotes: 'x', preferredName: ' Hoa ', preferredLanguage: 'Vietnamese', preferredBranch: 'moorestown' })}::jsonb),
      (${C2}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee', 'active', ${JSON.stringify({ preferredBranch: 'Haddonfield' })}::jsonb)`.execute(db);
  });
  afterAll(async () => { await sql`delete from customers where tenant_id in (${T}, ${T2})`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('migration 490 carries the old notes values over; a branch only when it is one of this salon\'s; 697 then maps the language to its code', async () => {
    await sql`alter table customers drop constraint if exists customers_preferred_language_chk`.execute(db);   // 490 predates 697's CHECK
    await sql.raw(migration).execute(db);       // re-runnable: it only fills empty columns
    expect(await row(C1)).toEqual({ preferred_name: 'Hoa', preferred_language: 'Vietnamese', preferred_branch_id: B2 });
    await sql.raw(normalize).execute(db);       // re-adds the CHECK
    expect(await row(C1)).toEqual({ preferred_name: 'Hoa', preferred_language: 'vi', preferred_branch_id: B2 });
    expect(await row(C2)).toEqual({ preferred_name: null, preferred_language: null, preferred_branch_id: null });   // 'Haddonfield' belongs to another salon
  });

  it('the profile edit writes the columns and the customer list reads them; another salon\'s branch is refused', async () => {
    const svc = new CustomersService(new KyselyCustomersRepository(db as any));
    const r = await svc.update(ctx, C2, { preferredName: 'Annie', preferredLanguage: 'English', preferredBranchId: B });
    expect(r).toMatchObject({ preferredName: 'Annie', preferredLanguage: 'en', preferredBranchId: B });
    expect(await row(C2)).toEqual({ preferred_name: 'Annie', preferred_language: 'en', preferred_branch_id: B });
    await expect(svc.update(ctx, C2, { preferredLanguage: 'Korean' })).rejects.toThrow(/English or Vietnamese/);   // WP-I
    await expect(svc.update(ctx, C2, { preferredBranchId: BX })).rejects.toThrow(/not one of this salon/);
    const found = await svc.getState(ctx, { search: 'annie' } as any);
    expect(found.customers.items.map((x: any) => x.customerId)).toEqual([C2]);
  });
});
