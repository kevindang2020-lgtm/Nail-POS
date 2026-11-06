// vendor-normalize.pgtest — F7 §44 / §154 (Nov 6 2026, migration 821): the database's vendor_normalized_name() gives the
// SAME answer as normalizeVendorName() for every spelling the receipt pipeline meets, and the trigger keeps
// inventory_vendors.normalized_name current on insert and rename (every writer, no code change).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { normalizeVendorName } from './vendor-normalize';

let db: Kysely<any>;
const T = 'f7a00000-0000-4000-8000-0000000000a1';
const SAMPLES = ['HOME DEPOT #4102', 'THE HOME DEPOT', 'Home Depot', 'Sally Beauty Supply LLC', 'Sally Beauty Supply, Inc.', "Lowe's Store 1234",
  'Café Nguyễn & Sons Co.', 'OPI Products Inc', 'CVS/pharmacy #07421', 'Amazon.com Services LLC', 'PSE&G', 'Walmart Supercenter 5512',
  'The Nail Supply Co Ltd', '  ', '', 'Trần Beauty Corp', 'A1 Nails Store 22B', 'Location 7 Salon Depot', 'Costco Wholesale #0198'];

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()) as unknown as Kysely<any>;
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'F7V', 'F7V', 'f7v', 'F7V', 'active')`.execute(db);
}, 120_000);

describe('vendor_normalized_name (SQL) = normalizeVendorName (TS)', () => {
  it.each(SAMPLES)('%j', async (raw) => {
    const r = (await sql<{ n: string }>`select vendor_normalized_name(${raw}) as n`.execute(db)).rows[0];
    expect(r.n).toBe(normalizeVendorName(raw));
  });
  it('the trigger fills it on insert and follows a rename; spellings of one vendor share it', async () => {
    await sql`insert into inventory_vendors (tenant_id, name) values (${T}, 'HOME DEPOT #4102'), (${T}, 'The Home Depot')`.execute(db);
    const rows = (await sql<any>`select name, normalized_name from inventory_vendors where tenant_id = ${T} order by name`.execute(db)).rows;
    expect(new Set(rows.map((x: any) => x.normalized_name))).toEqual(new Set(['home depot']));
    await sql`update inventory_vendors set name = 'Sally Beauty Supply LLC' where tenant_id = ${T} and name = 'The Home Depot'`.execute(db);
    expect((await sql<any>`select normalized_name from inventory_vendors where tenant_id = ${T} and name = 'Sally Beauty Supply LLC'`.execute(db)).rows[0].normalized_name).toBe('sally beauty supply');
  });
  it('vendor_type accepts the listed types only', async () => {
    await sql`insert into inventory_vendors (tenant_id, name, vendor_type) values (${T}, 'PSE&G', 'utility')`.execute(db);
    await expect(sql`insert into inventory_vendors (tenant_id, name, vendor_type) values (${T}, 'X', 'not_a_type')`.execute(db)).rejects.toThrow();
  });
});
