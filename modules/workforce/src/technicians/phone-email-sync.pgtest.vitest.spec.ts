// phone-email-sync.pgtest.vitest.spec.ts — ONE normalizer, three rows kept in step; serviceIds are this salon's.
// Ported from the Technician Profile package (Oct 12 2026 merge; workforce audit P1 #14 / mandate §6).
//
// POS roster create used toStoredCustomerPhone, update a bare regex, the identity service identityKeys — three shapes
// for one phone. A roster edit propagated to nothing, so the login and the global keys drifted from the number the
// salon actually had. And serviceIds were never checked against the tenant.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyTechniciansRepository } from './technicians.kysely.repository';
import { GlobalTechIdentityService } from '../tech-profile/global-tech-identity.service';
import { GlobalTechDirectory } from '../tech-profile/global-tech-directory.kysely';
import { identityKeys } from '../tech-profile/global-tech-identity-core';

const TA = '6c6c0000-0000-4000-8000-0000000000a1', TB = '6c6c0000-0000-4000-8000-0000000000b1';
const BA = '6c6c0000-0000-4000-8000-0000000000a2', BB = '6c6c0000-0000-4000-8000-0000000000b2';
const UA = '6c6c0000-0000-4000-8000-0000000000a3';
const BAD = '6c6c0000-0000-4000-8000-0000000000ff';
let pg: any; let repo: KyselyTechniciansRepository; let identity: GlobalTechIdentityService; let db: any;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows);
const ctxA = () => ({ tenantId: TA, branchId: BA, userId: UA, role: 'OWNER', permissions: ['*'] });
let svcA1: string, svcA2: string, svcB1: string;

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A LLC','A','pes-a','PESA01','active'), ($2,'B LLC','B','pes-b','PESB01','active')`, [TA, TB]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$3,'Main A','active'), ($2,$4,'Main B','active')`, [BA, BB, TA, TB]);
  await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, status, role) values ($1,$2,'O','Wner','O Wner','owner@pes.test','active','OWNER')`, [UA, TA]);
  repo = new KyselyTechniciansRepository(db);
  identity = new GlobalTechIdentityService(db, new GlobalTechDirectory(db));
  const cat = async (t: string, b: string) => (await q(`insert into service_categories (tenant_id, branch_id, name) values ($1,$2,'Nails') returning id`, [t, b]))[0].id;
  const svc = async (t: string, b: string, c: string, n: string) => (await q(`insert into services (tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,30,3000) returning id`, [t, b, c, n]))[0].id;
  const cA = await cat(TA, BA), cB = await cat(TB, BB);
  svcA1 = await svc(TA, BA, cA, 'Gel'); svcA2 = await svc(TA, BA, cA, 'Pedi'); svcB1 = await svc(TB, BB, cB, 'Other salon');
}, 240000);

describe('create + attach: one normalization everywhere', () => {
  it('the roster row, the login and the global profile all carry identityKeys() of what the manager typed', async () => {
    const row = await repo.create(ctxA() as any, { firstName: 'Hana', lastName: 'Le', phone: '(856) 555-6001', email: 'Hana.Le@Example.TEST', serviceIds: [svcA1] } as any);
    const r: any = await identity.attachToTechnician(ctxA() as any, row.technicianId, { fullName: 'Hana Le', phone: '(856) 555-6001', email: 'Hana.Le@Example.TEST' } as any);
    const k = identityKeys({ phone: '(856) 555-6001', email: 'Hana.Le@Example.TEST' });
    expect(k.normalizedPhone).toBe('+18565556001');
    const [t] = await q(`select normalized_phone, email from technicians where id = $1`, [row.technicianId]);
    const [u] = await q(`select normalized_phone, email from users where id = $1`, [r.userId]);
    const [p] = await q(`select normalized_phone, phone_hash, email_normalized from global_tech_profiles where id = $1`, [r.profileId]);
    expect([t.normalized_phone, u.normalized_phone, p.normalized_phone]).toEqual([k.normalizedPhone, k.normalizedPhone, k.normalizedPhone]);
    expect([t.email, u.email, p.email_normalized]).toEqual([k.emailNormalized, k.emailNormalized, k.emailNormalized]);
    expect(p.phone_hash).toBe(k.phoneHash);
  });
});

describe('update: a roster edit propagates to users and the global keys', () => {
  it('phone + email edited on the POS roster → users row and global profile follow, through the same function', async () => {
    const [t0] = await q(`select id, user_id, global_tech_profile_id from technicians where tenant_id = $1 and email = 'hana.le@example.test'`, [TA]);
    await repo.update(ctxA() as any, t0.id, { phone: '856.555.6002', email: 'HANA2@example.test' } as any);
    const k = identityKeys({ phone: '856.555.6002', email: 'HANA2@example.test' });
    const [t] = await q(`select normalized_phone, phone_display, email from technicians where id = $1`, [t0.id]);
    const [u] = await q(`select normalized_phone, email from users where id = $1`, [t0.user_id]);
    const [p] = await q(`select normalized_phone, phone_hash, email_normalized from global_tech_profiles where id = $1`, [t0.global_tech_profile_id]);
    expect(t.normalized_phone).toBe('+18565556002'); expect(t.phone_display).toBe('856.555.6002'); expect(t.email).toBe('hana2@example.test');
    expect(u.normalized_phone).toBe('+18565556002'); expect(u.email).toBe('hana2@example.test');
    expect(p.normalized_phone).toBe('+18565556002'); expect(p.phone_hash).toBe(k.phoneHash); expect(p.email_normalized).toBe('hana2@example.test');
    const found = await new GlobalTechDirectory(db).findByKeys(k);
    expect(found?.profileId).toBe(t0.global_tech_profile_id);
  });

  it('does NOT overwrite a key the technician set herself on her global profile (the salon only syncs its own value)', async () => {
    const [t0] = await q(`select id, global_tech_profile_id from technicians where tenant_id = $1 and email = 'hana2@example.test'`, [TA]);
    await q(`update global_tech_profiles set normalized_phone = '+18565556999', phone_hash = $2 where id = $1`, [t0.global_tech_profile_id, identityKeys({ phone: '+18565556999' }).phoneHash]);
    await repo.update(ctxA() as any, t0.id, { phone: '856-555-6003' } as any);
    expect((await q(`select normalized_phone from technicians where id = $1`, [t0.id]))[0].normalized_phone).toBe('+18565556003');
    expect((await q(`select normalized_phone from global_tech_profiles where id = $1`, [t0.global_tech_profile_id]))[0].normalized_phone).toBe('+18565556999');
  });

  it('a phone another LIVE account already holds is refused as a validation error and nothing changes', async () => {
    const k = identityKeys({ phone: '856-555-6100' });
    await q(`insert into global_tech_profiles (tech_code, public_slug, display_name, normalized_phone, phone_hash) values ('TECH-610001','other-1','Other',$1,$2)`, [k.normalizedPhone, k.phoneHash]);
    const row = await repo.create(ctxA() as any, { firstName: 'Vy', lastName: 'Do', phone: '856-555-6101' } as any);
    const r: any = await identity.attachToTechnician(ctxA() as any, row.technicianId, { fullName: 'Vy Do', phone: '856-555-6101' } as any);
    await expect(repo.update(ctxA() as any, row.technicianId, { phone: '856-555-6100' } as any)).rejects.toMatchObject({ name: 'ValidationError' });
    expect((await q(`select normalized_phone from technicians where id = $1`, [row.technicianId]))[0].normalized_phone).toBe('+18565556101');
    expect((await q(`select normalized_phone from users where id = $1`, [r.userId]))[0].normalized_phone).toBe('+18565556101');
  });
});

describe('serviceIds must belong to THIS salon', () => {
  it("create / update / setServices refuse another tenant's service id, and accept this tenant's", async () => {
    await expect(repo.create(ctxA() as any, { firstName: 'Bad', lastName: 'Svc', serviceIds: [svcA1, svcB1] } as any)).rejects.toMatchObject({ name: 'ValidationError' });
    expect((await q(`select count(*)::int n from technicians where tenant_id = $1 and first_name = 'Bad'`, [TA]))[0].n).toBe(0);
    const ok = await repo.create(ctxA() as any, { firstName: 'Good', lastName: 'Svc', serviceIds: [svcA1, svcA2] } as any);
    expect((await repo.getServices(ctxA() as any, ok.technicianId))!.serviceIds.sort()).toEqual([svcA1, svcA2].sort());
    await expect(repo.update(ctxA() as any, ok.technicianId, { serviceIds: [svcB1] } as any)).rejects.toMatchObject({ name: 'ValidationError' });
    await expect(repo.setServices(ctxA() as any, ok.technicianId, { serviceIds: [svcA1, BAD] } as any)).rejects.toMatchObject({ name: 'ValidationError' });
    expect((await repo.getServices(ctxA() as any, ok.technicianId))!.serviceIds.sort()).toEqual([svcA1, svcA2].sort());
    expect((await repo.setServices(ctxA() as any, ok.technicianId, { serviceIds: [svcA2] } as any))!.serviceIds).toEqual([svcA2]);
  });
});
