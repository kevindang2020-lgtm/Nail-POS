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
let db: any; let repo: KyselyServicesRepository;

beforeAll(async () => {
  const pg = await migratedPglite();
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
