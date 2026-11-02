// hidden-tech-visibility.pgtest.vitest.spec.ts — [ported from the Technician Profile package, Oct 12 2026] — a suspended / admin-hidden / non-public technician is on NO
// customer-facing list (TECHNICIAN_AUDIT P0 #12): salon technicians, favorites, favorite-add, public profile,
// service matching. And customer service-matching never hands out the salon roster name (technicians.full_name) of a
// technician who has not published a profile — the POS matcher still sees its own roster.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
// Inline harness (merge port, Oct 12 2026): their integration-mandate-tests/harness.pgtest → our migratedPglite (every migration).
type Harness = { pg: any; db: any; q: (s: string, p?: unknown[]) => Promise<any[]>; count: (s: string, p?: unknown[]) => Promise<number> };
async function bootPg(): Promise<Harness> {
  const pg: any = await migratedPglite();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
  return { pg, db: kyselyFor(pg), q, count: async (s: string, p: unknown[] = []) => Number((await q(s, p))[0]?.n ?? 0) };
}
const uuid = (p: string, s: string | number) => `${p.padEnd(8, '0')}-0000-4000-8000-${String(s).padStart(12, '0')}`;
import { TechProfileService } from './tech-profile.service';

const P = 'ac';
const T = uuid(P, 1), B = uuid(P, 'b1');
const CAT = uuid(P, 'ca'), SVC = uuid(P, 'e1');
const G_PUB = uuid(P, 'a1'), G_SUSP = uuid(P, 'a2'), G_HIDDEN = uuid(P, 'a3'), G_PRIV = uuid(P, 'a4');
const T_PUB = uuid(P, 'd1'), T_SUSP = uuid(P, 'd2'), T_HIDDEN = uuid(P, 'd3'), T_PRIV = uuid(P, 'd4'), T_NOPROF = uuid(P, 'd5');
const CUST_USER = uuid(P, 'f1'), CUST = uuid(P, 'c1');
const custCtx: any = { tenantId: T, branchId: B, userId: CUST_USER, role: 'CUSTOMER', permissions: [] };
const posCtx: any = { tenantId: T, branchId: B, userId: uuid(P, 'f2'), role: 'MANAGER', permissions: [] };

let h: Harness;
let svc: TechProfileService;

beforeAll(async () => {
  h = await bootPg();
  svc = new TechProfileService(h.db as any, null as any);
  await h.q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','Salon A','ac-a','ACA')`, [T]);
  await h.q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [B, T]);
  await h.q(`insert into tenant_app_flags (tenant_id, flag_key, enabled) values ($1,'public_listing',true)`, [T]);
  await h.q(`insert into global_tech_profiles (id, tech_code, public_slug, display_name, is_public, status) values
    ($1,'AC1','pub-tech','Public Tech',true,'active'),($2,'AC2','susp-tech','Suspended Tech',true,'suspended'),
    ($3,'AC3','hidden-tech','Hidden Tech',true,'active'),($4,'AC4','priv-tech','Private Tech',false,'active')`, [G_PUB, G_SUSP, G_HIDDEN, G_PRIV]);
  await h.q(`update global_tech_profiles set admin_profile_hidden = true where id = $1`, [G_HIDDEN]);
  await h.q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, global_tech_profile_id) values
    ($1,$6,$7,'Public','Tech','ROSTER Public',true,$8),($2,$6,$7,'Suspended','Tech','ROSTER Suspended',true,$9),
    ($3,$6,$7,'Hidden','Tech','ROSTER Hidden',true,$10),($4,$6,$7,'Private','Tech','ROSTER Private',true,$11),
    ($5,$6,$7,'No','Profile','ROSTER NoProfile',true,null)`, [T_PUB, T_SUSP, T_HIDDEN, T_PRIV, T_NOPROF, T, B, G_PUB, G_SUSP, G_HIDDEN, G_PRIV]);
  for (const [g, t] of [[G_PUB, T_PUB], [G_SUSP, T_SUSP], [G_HIDDEN, T_HIDDEN], [G_PRIV, T_PRIV]]) {
    await h.q(`insert into tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, technician_id, status) values ($1,$2,$3,$4,'active')`, [g, T, B, t]);
  }
  await h.q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await h.q(`insert into services (id, tenant_id, branch_id, category_id, name, status, price_cents, duration_minutes) values ($1,$2,$3,$4,'Gel','active',5000,45)`, [SVC, T, B, CAT]);
  for (const t of [T_PUB, T_SUSP, T_HIDDEN, T_PRIV, T_NOPROF]) await h.q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T, B, t, SVC]);
  await h.q(`insert into users (id, tenant_id, branch_id, full_name, email, status, role, mfa_enabled, must_change_password) values ($1,$2,$3,'Cust','cust@ac.test','active','CUSTOMER',false,false)`, [CUST_USER, T, B]);
  await h.q(`insert into customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,$4,'Cu','St','Cu St','+18565550202')`, [CUST, T, B, CUST_USER]);
  // the customer hearted every one of them while they were visible
  for (const g of [G_PUB, G_SUSP, G_HIDDEN, G_PRIV]) await h.q(`insert into customer_favorite_techs (user_id, global_tech_profile_id) values ($1,$2)`, [CUST_USER, g]);
}, 240000);

describe('customer-facing lists', () => {
  it('salon technicians: only the public, active, not-hidden profile', async () => {
    const r = await svc.customerSalonTechnicians(B);
    expect(r.technicians.map((t: any) => t.publicSlug)).toEqual(['pub-tech']);
  });
  it('favorites: suspended / hidden / private hearts are not rendered', async () => {
    const r = await svc.customerListFavoriteTechs(custCtx);
    expect(r.slugs).toEqual(['pub-tech']);
  });
  it('favorite-add and the public page refuse a suspended or hidden profile as not found', async () => {
    await expect(svc.customerAddFavoriteTech(custCtx, { publicSlug: 'susp-tech' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.customerAddFavoriteTech(custCtx, { technicianId: T_HIDDEN })).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.customerPublicProfile(custCtx, 'susp-tech')).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.customerPublicProfile(custCtx, 'pub-tech')).resolves.toMatchObject({ displayName: 'Public Tech' });
  });
  it('service matching (customer): public profiles only, named by their PUBLIC display name — the roster name never leaves the salon', async () => {
    const r = await svc.customerServiceTechnicians(B, SVC);
    expect(r.technicians.map((t: any) => t.technicianId)).toEqual([T_PUB]);
    expect(r.technicians[0].displayName).toBe('Public Tech');
    expect(JSON.stringify(r)).not.toContain('ROSTER');
    const inApp = await svc.customerBookingServiceTechnicians(custCtx, SVC);
    expect(inApp.technicians.map((t: any) => t.technicianId)).toEqual([T_PUB]);
    expect(JSON.stringify(inApp)).not.toContain('ROSTER');
  });
  it('service matching (POS): the salon still sees its whole roster, by roster name', async () => {
    const r = await svc.posServiceTechnicians(posCtx, SVC);
    expect(r.technicians.map((t: any) => t.technicianId).sort()).toEqual([T_PUB, T_SUSP, T_HIDDEN, T_PRIV, T_NOPROF].sort());
    expect(r.technicians.find((t: any) => t.technicianId === T_NOPROF).displayName).toBe('ROSTER NoProfile');
  });
});
