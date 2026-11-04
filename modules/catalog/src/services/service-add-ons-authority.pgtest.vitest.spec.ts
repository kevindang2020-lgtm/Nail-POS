// service-add-ons-authority.pgtest — D1 (Oct 22 2026): the "Add-ons" CATEGORY is the one add-on model. getAddOns(main)
// answers the active add-on services at the main's branch (the kiosk / POS / serving rule), with the legacy
// service_add_ons rows served beside them — kept, never removed, never repeated when one names a category add-on.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { categoryAddOnsForService, mergeAddOnRows } from '@aipowersalon/database';
import { KyselyServicesRepository } from './services.kysely.repository';

const T = '5a000000-0000-4000-8000-000000000001', B = '5a000000-0000-4000-8000-0000000000b1', B2 = '5a000000-0000-4000-8000-0000000000b2';
const NAILS = '5a000000-0000-4000-8000-0000000000c0', ADDONS = '5a000000-0000-4000-8000-0000000000c9', ADDONS_B2 = '5a000000-0000-4000-8000-0000000000c8';
const GEL = '5a000000-0000-4000-8000-0000000000d1', PEDI = '5a000000-0000-4000-8000-0000000000d2';
const PARAFFIN = '5a000000-0000-4000-8000-0000000000e1', ART = '5a000000-0000-4000-8000-0000000000e2', GONE = '5a000000-0000-4000-8000-0000000000e3', OTHER_BRANCH = '5a000000-0000-4000-8000-0000000000e4';
const ctx: any = { tenantId: T, branchId: B, userId: '5a000000-0000-4000-8000-0000000000f1', role: 'OWNER', permissions: ['pos.services.view'] };
let db: any; let repo: KyselyServicesRepository; let pg: any;

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','A','Addons','addons','ADD01','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Downtown'), ('${B2}','${T}','Uptown');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${NAILS}','${T}','${B}','Nails'), ('${ADDONS}','${T}','${B}','Add-Ons'), ('${ADDONS_B2}','${T}','${B2}','Add-ons');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES
      ('${GEL}','${T}','${B}','${NAILS}','Gel Manicure',45,4500,'active'), ('${PEDI}','${T}','${B}','${NAILS}','Pedicure',50,5500,'active'),
      ('${PARAFFIN}','${T}','${B}','${ADDONS}','Paraffin Dip',10,1000,'active'), ('${ART}','${T}','${B}','${ADDONS}','Nail Art',15,1500,'active'),
      ('${GONE}','${T}','${B}','${ADDONS}','Old Add-on',5,500,'archived'), ('${OTHER_BRANCH}','${T}','${B2}','${ADDONS_B2}','Uptown Dip',10,1000,'active');
    INSERT INTO service_add_ons (tenant_id, branch_id, service_id, add_on_key, name, price_cents, duration_delta_minutes, is_taxable, is_active, sort_order) VALUES
      ('${T}','${B}','${GEL}','${ART}','Nail Art (legacy row)',1200,15,true,true,0),
      ('${T}','${B}','${GEL}','ao_legacy_french','French Tips',800,10,true,true,1);
  `);
  db = kyselyFor(pg); repo = new KyselyServicesRepository(db);
}, 60_000);

describe('D1: the "Add-ons" category is the add-on authority; the table is served beside it', () => {
  it('categoryAddOnsForService: every ACTIVE add-on service at the main\'s branch, by the category-name rule (case / hyphen agnostic), never another branch, never an archived one, never the main itself', async () => {
    const rows = await categoryAddOnsForService(db, T, GEL);
    expect(rows.map((r) => [r.addOnId, r.name, r.priceCents, r.durationDeltaMinutes, r.source])).toEqual([[ART, 'Nail Art', 1500, 15, 'category'], [PARAFFIN, 'Paraffin Dip', 1000, 10, 'category']]);
    expect(await categoryAddOnsForService(db, T, '5a000000-0000-4000-8000-00000000ffff')).toEqual([]);
    expect((await categoryAddOnsForService(db, T, PARAFFIN)).map((r) => r.addOnId)).toEqual([]);   // an add-on's own siblings are not its add-ons
  });
  it('getAddOns(main) = category rows first, then the legacy table rows that do not name one of them (the legacy duplicate of Nail Art is not repeated)', async () => {
    const a = await repo.getAddOns(ctx, GEL);
    expect(a!.map((x) => [x.addOnId, x.name, x.priceCents])).toEqual([[ART, 'Nail Art', 1500], [PARAFFIN, 'Paraffin Dip', 1000], ['ao_legacy_french', 'French Tips', 800]]);
    expect(a!.every((x) => !('source' in x))).toBe(true);                       // the public shape is unchanged
    expect((await repo.getAddOns(ctx, PEDI))!.map((x) => x.addOnId)).toEqual([ART, PARAFFIN]);   // no legacy rows for the pedicure: the category still answers
  });
  it('mergeAddOnRows is pure and keeps the authority first', () => {
    const merged = mergeAddOnRows([{ addOnId: 'x', name: 'X', priceCents: 1, durationDeltaMinutes: 1, isTaxable: true, isActive: true, source: 'category' }], [{ addOnId: 'x', name: 'old X', priceCents: 9, durationDeltaMinutes: 9, isTaxable: true, isActive: true }, { addOnId: 'y', name: 'Y', priceCents: 2, durationDeltaMinutes: 2, isTaxable: false, isActive: true }]);
    expect(merged.map((m) => [m.addOnId, m.name, m.source])).toEqual([['x', 'X', 'category'], ['y', 'Y', 'legacy_table']]);
  });
});

describe('D2 Services (Nov 4 2026): taxable / not taxable is stored per service; a rate, exemption or category is refused', () => {
  it('stores "not taxable", reads it back, records the change; refuses what is not available; unknown service → null', async () => {
    expect(await repo.setTax(ctx, GEL, { isTaxable: true, exemptAllowed: false })).toEqual({ isTaxable: true, exemptAllowed: false });
    await expect(repo.setTax(ctx, GEL, { isTaxable: false, exemptAllowed: true })).rejects.toMatchObject({ apiCode: 'SERVICE_TAX_NOT_CONFIGURABLE' });
    await expect(repo.setTax(ctx, GEL, { isTaxable: true, exemptAllowed: false, overridePercent: 5 })).rejects.toMatchObject({ apiCode: 'SERVICE_TAX_NOT_CONFIGURABLE' });
    expect(await repo.getTax(ctx, GEL)).toEqual({ isTaxable: true, exemptAllowed: false });
    expect(await repo.setTax(ctx, GEL, { isTaxable: false, exemptAllowed: false })).toEqual({ isTaxable: false, exemptAllowed: false });
    expect(await repo.getTax(ctx, GEL)).toEqual({ isTaxable: false, exemptAllowed: false });
    expect((await pg.query(`select count(*)::int n from catalog_change_log where entity_id = '${GEL}' and field = 'is_taxable'`)).rows[0].n).toBe(1);
    expect(await repo.setTax(ctx, GEL, { isTaxable: true, exemptAllowed: false })).toEqual({ isTaxable: true, exemptAllowed: false });
    expect(await repo.setTax(ctx, '5a000000-0000-4000-8000-00000000dead', { isTaxable: true, exemptAllowed: false })).toBeNull();
  });
});

describe('the older per-service add-on route never deletes (Nov 4 2026)', () => {
  it('a list from an old client updates by key, adds new keys, sets the left-out ones inactive — no row is deleted; all of it is in the history', async () => {
    const before = (await pg.query(`select count(*)::int n from service_add_ons where service_id = '${PEDI}'`)).rows[0].n;
    await pg.exec(`INSERT INTO service_add_ons (tenant_id, branch_id, service_id, add_on_key, name, price_cents, duration_delta_minutes, is_taxable, is_active, sort_order) VALUES
      ('${T}','${B}','${PEDI}','ao_callus','Callus Care',1000,10,true,true,0), ('${T}','${B}','${PEDI}','ao_mask','Mask',900,10,true,true,1)`);
    await repo.setAddOns(ctx, PEDI, [{ addOnId: 'ao_callus', name: 'Callus Care', priceCents: 1200, durationDeltaMinutes: 10, isTaxable: true, isActive: true },
      { addOnId: 'ao_scrub', name: 'Scrub', priceCents: 700, durationDeltaMinutes: 5, isTaxable: true, isActive: true }]);
    const rows = (await pg.query(`select add_on_key, price_cents::int as p, is_active from service_add_ons where service_id = '${PEDI}' order by add_on_key`)).rows;
    expect(rows).toEqual([{ add_on_key: 'ao_callus', p: 1200, is_active: true }, { add_on_key: 'ao_mask', p: 900, is_active: false }, { add_on_key: 'ao_scrub', p: 700, is_active: true }]);
    expect(rows.length).toBe(before + 3);
    const log = (await pg.query(`select entity_id, field from catalog_change_log where service_id = '${PEDI}' and entity_type = 'add_on' order by entity_id, field`)).rows;
    expect(log).toEqual(expect.arrayContaining([{ entity_id: 'ao_callus', field: 'price_cents' }, { entity_id: 'ao_mask', field: 'is_active' }]));
  });
});
