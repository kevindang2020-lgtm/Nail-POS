// customer-language.pgtest — English + Vietnamese POS mandate WP-I (§55) on the real migrated schema (PGlite): migration
// 697 maps the free-text customers.preferred_language to 'en' / 'vi' (accents, case, region codes), keeps any other
// value in the customer's notes rather than losing it, never touches another salon's rows differently, and the CHECK
// then refuses anything but en / vi. The profile edit stores the code.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomersRepository } from './customers.kysely.repository';
import { CustomersService } from './customers.service';

const T = 'a6970000-0000-4000-8000-0000000000aa', B = 'a6970000-0000-4000-8000-0000000000b1';
const id = (n: number) => `a6970000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CASES: Array<[string | null, string | null]> = [
  ['Vietnamese', 'vi'], ['Tiếng Việt', 'vi'], ['tieng viet', 'vi'], ['vi-VN', 'vi'], ['VN', 'vi'], ['  TIẾNG VIỆT ', 'vi'],
  ['English', 'en'], ['en-US', 'en'], ['eng', 'en'], ['Tiếng Anh', 'en'],
  ['Spanish', null], ['Vietnamese / English', null], ['', null], [null, null], ['vi', 'vi'], ['en', 'en'],
];
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1, 'L', 'Lang', 'lang-697', 'LANG697', 'active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1, $2, 'Main', 'active')`, [B, T]);
  await q(`alter table customers drop constraint customers_preferred_language_chk`);   // the rows a database held before 697
  for (const [i, [v]] of CASES.entries()) await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, preferred_language, notes_json) values ($1, $2, $3, 'C', $4, $5, $6, $7)`,
    [id(i + 1), T, B, String(i), `C ${i}`, v, i === 11 ? JSON.stringify({ preferredLanguage: 'Typed in notes' }) : null]);
  await pg.exec(readFileSync(resolve(MIGRATIONS_DIR, '697_customer_language_normalize.sql'), 'utf8'));
}, 240_000);

describe('migration 697 — customers.preferred_language → en / vi', () => {
  it('maps every way staff wrote Vietnamese or English; anything else becomes no preference', async () => {
    const rows = await q(`select id, preferred_language from customers where tenant_id = $1 order by id`, [T]);
    expect(rows.map((r) => r.preferred_language)).toEqual(CASES.map(([, want]) => want));
  });
  it('nothing typed is lost: an unmappable value moves into the notes (an existing note language is kept)', async () => {
    const notes = async (n: number) => (await q(`select notes_json from customers where id = $1`, [id(n)]))[0].notes_json;
    expect(await notes(11)).toMatchObject({ preferredLanguage: 'Spanish' });
    expect(await notes(12)).toMatchObject({ preferredLanguage: 'Typed in notes' });
    expect(await notes(1)).toBeNull();                                         // mapped values do not touch the notes
  });
  it('the CHECK refuses anything but en / vi from now on', async () => {
    await expect(q(`update customers set preferred_language = 'Vietnamese' where id = $1`, [id(1)])).rejects.toThrow();
    await q(`update customers set preferred_language = 'en' where id = $1`, [id(1)]);
  });
  it('the profile edit stores the code on the real table', async () => {
    const svc = new CustomersService(new KyselyCustomersRepository(db));
    const ctx = { tenantId: T, branchId: B, userId: 'u1', role: 'FRONT_DESK', permissions: ['pos.customers.view', 'pos.customers.edit'] } as any;
    await svc.update(ctx, id(2), { preferredLanguage: 'Tiếng Việt' });
    expect((await q(`select preferred_language from customers where id = $1`, [id(2)]))[0].preferred_language).toBe('vi');
  });
});
