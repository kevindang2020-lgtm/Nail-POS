// booking-service-technicians-salon.pgtest — developer merge (Oct 6 2026): GET /customer/booking/service-technicians
// matched the session's DEFAULT salon's technicians even when the customer was booking at another of the tenant's
// salons. `salonId` now scopes the match — to one of THIS tenant's branches only; another tenant's branch is "not found".
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TechProfileService } from './tech-profile.service';

const T = 'bd100000-0000-4000-8000-000000000001', T2 = 'bd100000-0000-4000-8000-000000000002';
const B1 = 'bd100000-0000-4000-8000-0000000000b1', B2 = 'bd100000-0000-4000-8000-0000000000b2', BX = 'bd100000-0000-4000-8000-0000000000b3';
const CAT1 = 'bd100000-0000-4000-8000-0000000000c1', CAT2 = 'bd100000-0000-4000-8000-0000000000c2';
const S1 = 'bd100000-0000-4000-8000-0000000000e1', S2 = 'bd100000-0000-4000-8000-0000000000e2';
const T1 = 'bd100000-0000-4000-8000-0000000000d1', T2ID = 'bd100000-0000-4000-8000-0000000000d2';
const G1 = 'bd100000-0000-4000-8000-0000000000a7', G2 = 'bd100000-0000-4000-8000-0000000000a8';
const U = 'bd100000-0000-4000-8000-0000000000f1', CUST = 'bd100000-0000-4000-8000-0000000000a1';
const ctx: any = { tenantId: T, branchId: B1, userId: U, role: 'CUSTOMER', permissions: [] };
let svc: TechProfileService; let pg: any;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = await migratedPglite();
  const db = kyselyFor(pg);
  svc = new TechProfileService(db as any, null as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A LLC','A','bsa','BSA'), ($2,'B LLC','B','bsb','BSB')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$4,'Main'), ($2,$4,'Second'), ($3,$5,'Elsewhere')`, [B1, B2, BX, T, T2]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name, sort_order) values ($1,$3,$4,'Mani',1), ($2,$3,$5,'Mani',1)`, [CAT1, CAT2, T, B1, B2]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, sort_order) values ($1,$3,$4,$6,'Gel',45,4500,1), ($2,$3,$5,$7,'Gel',45,4500,1)`, [S1, S2, T, B1, B2, CAT1, CAT2]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$3,$4,'Lisa','One','Lisa One','active'), ($2,$3,$5,'Anna','Two','Anna Two','active')`, [T1, T2ID, T, B1, B2]);
  // Technician Profile merge (WF, Oct 12): customer matching lists ONLY technicians with a public, active, visible
  // profile (TECHNICIAN_AUDIT P0 #12 — the roster name never leaves the salon), so both technicians publish one here.
  await q(`insert into global_tech_profiles (id, tech_code, public_slug, display_name, is_public, status) values ($1,'BSG1','lisa-one','Lisa One',true,'active'), ($2,'BSG2','anna-two','Anna Two',true,'active')`, [G1, G2]);
  await q(`update technicians set global_tech_profile_id = case id when $1::uuid then $3::uuid else $4::uuid end where id in ($1,$2)`, [T1, T2ID, G1, G2]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,true), ($1,$5,$6,$7,true)`, [T, B1, T1, S1, B2, T2ID, S2]);
  await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, status, role) values ($1,$2,'Cus','Tomer','Cus Tomer','cus@example.com','active','CUSTOMER')`, [U, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, user_id) values ($1,$2,$3,'Cus','Tomer','Cus Tomer',$4)`, [CUST, T, B1, U]);
}, 120_000);

describe('customerBookingServiceTechnicians + salonId', () => {
  it('no salonId: the session salon (as before)', async () => {
    const r = await svc.customerBookingServiceTechnicians(ctx, S1);
    expect(r.technicians.map((t: any) => t.technicianId)).toEqual([T1]);
  });
  it("salonId = another of the tenant's salons: THAT salon's technicians", async () => {
    const r = await svc.customerBookingServiceTechnicians(ctx, S2, B2);
    expect(r.technicians.map((t: any) => t.technicianId)).toEqual([T2ID]);
  });
  it("salonId = another tenant's branch: not found, never substituted", async () => {
    await expect(svc.customerBookingServiceTechnicians(ctx, S2, BX)).rejects.toMatchObject({ code: 'not_found' });
  });
});
