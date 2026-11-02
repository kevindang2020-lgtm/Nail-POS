// technician-eligibility-batch.pgtest — B-82 / 200-technician scale (Oct 23 2026) on the REAL schema: the batch reader
// (KyselyEligibilityReader.technicians) returns exactly the record the single reader returns for every technician —
// roster branch, user_branch_access, an active membership (by technician or by global profile), exact services, the
// legacy mode, certifications (by technician or by global profile) — and costs a FIXED number of queries whatever the
// count (the per-technician read was ~6 queries each: ~1,400 per assignment in a 200-technician salon).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyEligibilityReader, eligibleAmong, assertTechnicianEligible, TechnicianEligibilityError } from './technician-eligibility';

const u = (x: string) => `bb7c0000-0000-4000-8000-${x.padStart(12, '0')}`;
const T = u('a1'), B = u('b1'), B2 = u('b2'), CAT = u('c1'), MANI = u('f1'), ACR = u('f2');
const N = 60;
const tech = (i: number) => u(`e${String(i).padStart(4, '0')}`);
let pg: any; let db: any;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1,'Batch','Batch','batch-elig','BATCH1','active')`, [T]);
  await pg.query(`INSERT INTO branches (id, tenant_id, name, status) VALUES ($1,$3,'Main','active'), ($2,$3,'Second','active')`, [B, B2, T]);
  await pg.query(`INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await pg.query(`INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, required_certification) VALUES ($1,$3,$4,$5,'Manicure',45,4500,'active',NULL), ($2,$3,$4,$5,'Acrylic',90,9000,'active','Acrylic Safety')`, [MANI, ACR, T, B, CAT]);
  for (let i = 1; i <= N; i++) {
    const id = tech(i);
    const status = i % 11 === 0 ? 'suspended' : 'active';
    const roster = i % 7 === 0 ? B2 : B;
    let userId: string | null = null;
    if (i % 5 === 0) {   // some reach branch 2 through user_branch_access
      userId = u(`d${String(i).padStart(4, '0')}`);
      await pg.query(`INSERT INTO users (id, tenant_id, branch_id, full_name, email, password_hash, status, role) VALUES ($1,$2,$3,$4,$5,'x','active','TECHNICIAN')`, [userId, T, B, `Tech ${i}`, `t${i}@batch.test`]);
      await pg.query(`INSERT INTO user_branch_access (tenant_id, branch_id, user_id, access_level) VALUES ($1,$2,$3,'staff')`, [T, B2, userId]);
    }
    // some carry a portable global profile: their membership (and, for some, their certificate) is held BY THE PROFILE
    const gtp = i % 9 === 0 ? u(`9${String(i).padStart(4, '0')}`) : null;
    if (gtp) await pg.query(`INSERT INTO global_tech_profiles (id, public_slug, display_name, tech_code) VALUES ($1,$2,$3,$4)`, [gtp, `tech-${i}-batch`, `Tech ${i}`, `TB${String(i).padStart(4, '0')}`]);
    await pg.query(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, global_tech_profile_id, first_name, last_name, full_name, status, is_active, service_eligibility_mode) VALUES ($1,$2,$3,$4,$5,'Tech',$6,$7,$8,$9,$10)`,
      [id, T, roster, userId, gtp, String(i), `Tech ${i}`, status, status === 'active', i % 13 === 0 ? 'legacy_unconfigured' : 'exact']);
    if (i % 13 !== 0) await pg.query(`INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ($1,$2,$3,$4)`, [T, B, id, MANI]);
    if (i % 3 === 0) {
      await pg.query(`INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ($1,$2,$3,$4)`, [T, B, id, ACR]);
      const exp = i % 6 === 0 ? '2020-01-01' : '2099-01-01';   // half of the acrylic techs hold an EXPIRED certificate
      if (i % 18 === 0) await pg.query(`INSERT INTO technician_certifications (global_tech_profile_id, name, verification_status, expires_at) VALUES ($1,'Acrylic Safety','VERIFIED','2099-01-01')`, [u(`9${String(i).padStart(4, '0')}`)]);   // by the profile
      else await pg.query(`INSERT INTO technician_certifications (tenant_id, technician_id, name, verification_status, expires_at) VALUES ($1,$2,'Acrylic Safety','VERIFIED',$3)`, [T, id, exp]);
    }
    if (gtp) await pg.query(`INSERT INTO tech_salon_memberships (tenant_id, global_tech_profile_id, branch_id, status) VALUES ($1,$2,$3,'active')`, [T, gtp, B2]);
  }
});

const sortRec = (r: any) => r && ({ ...r, branchIds: [...r.branchIds].sort(), approvedServiceIds: [...r.approvedServiceIds].sort(), certifications: [...r.certifications].sort((a: any, b: any) => (a.name + a.expiresAt).localeCompare(b.name + b.expiresAt)) });

describe('KyselyEligibilityReader.technicians ≡ technician(), at a fixed query count', () => {
  it(`${N} technicians: every batch record equals the single read`, async () => {
    const r = new KyselyEligibilityReader(db);
    const ids = Array.from({ length: N }, (_, i) => tech(i + 1));
    const batch = await r.technicians(T, ids);
    expect(batch.size).toBe(N);
    for (const id of ids) expect(sortRec(batch.get(id)), id).toEqual(sortRec(await r.technician(T, id)));
  });
  it('the batch costs the same number of queries for 6 technicians and for 60', async () => {
    const counted = () => { let n = 0; const d = db.withPlugin({ transformQuery: (a: any) => { n++; return a.node; }, transformResult: async (a: any) => a.result }); return { r: new KyselyEligibilityReader(d), n: () => n }; };
    const small = counted(); await small.r.technicians(T, Array.from({ length: 6 }, (_, i) => tech(i + 1)));
    const big = counted(); await big.r.technicians(T, Array.from({ length: N }, (_, i) => tech(i + 1)));
    expect(big.n()).toBe(small.n());
    expect(big.n()).toBeLessThanOrEqual(6);
  });
  it('eligibleAmong on the real schema equals assert for every technician, for manicure and for acrylic, in both branches', async () => {
    const deps = { reader: new KyselyEligibilityReader(db), now: () => new Date('2026-10-23T12:00:00Z') };
    const ids = Array.from({ length: N }, (_, i) => tech(i + 1));
    const seen = new Set<string>();
    for (const branchId of [B, B2]) for (const serviceIds of [[MANI], [ACR], [MANI, ACR]]) {
      const v = await eligibleAmong(deps, { tenantId: T, branchId, technicianIds: ids, serviceIds });
      for (const id of ids) {
        const single = await assertTechnicianEligible(deps, { tenantId: T, branchId, technicianId: id, serviceIds, actor: {} }).then(() => 'OK', (e) => (e instanceof TechnicianEligibilityError ? e.code : 'THROW'));
        expect(v.get(id)!.eligible ? 'OK' : v.get(id)!.code, `${id} ${branchId === B ? 'B1' : 'B2'} ${serviceIds.length}`).toBe(single);
        seen.add(single);
      }
    }
    // the fixture really exercises every answer (a suite where everyone is OK would prove nothing)
    expect([...seen].sort()).toEqual(['OK', 'TECHNICIAN_BRANCH_ACCESS_DENIED', 'TECHNICIAN_NOT_ACTIVE', 'TECHNICIAN_NOT_SKILLED']);
  });
  it('another salon\'s technicians are never read (tenant-scoped)', async () => {
    const r = new KyselyEligibilityReader(db);
    expect((await r.technicians(u('ff'), [tech(1), tech(2)])).size).toBe(0);
  });
});
