// merge.pgtest.vitest.spec.ts — [ported from the Technician Profile package, Oct 12 2026] — the merge that used to FAIL, and the duplicates() that used to find nothing.
//
// Workforce audit P1 #14: merge copied the duplicate's keys onto the canonical row BEFORE clearing them on the
// duplicate → uq_gtp_phone_hash fired on exactly the merges that matter (the duplicate held the key the survivor
// lacked). duplicates() grouped live profiles by key — which the same unique index guarantees is always empty.
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
async function seedTwoTenants(h: Harness, p: string, _n: number) {
  const S = { TA: uuid(p, 'a1'), TB: uuid(p, 'b1'), BA: uuid(p, 'a2'), BB: uuid(p, 'b2'), UA: uuid(p, 'a3'), UB: uuid(p, 'b3') };
  await h.q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Tenant A','Salon A',$3,$4), ($2,'Tenant B','Salon B',$5,$6)`, [S.TA, S.TB, `${p}-a`, `${p}A`.toUpperCase(), `${p}-b`, `${p}B`.toUpperCase()]);
  await h.q(`insert into branches (id, tenant_id, name, status) values ($1,$3,'A-Main','active'), ($2,$4,'B-Main','active')`, [S.BA, S.BB, S.TA, S.TB]);
  await h.q(`insert into users (id, tenant_id, branch_id, full_name, email, status, role) values ($1,$3,$5,'Owner A',$7,'active','OWNER'), ($2,$4,$6,'Owner B',$8,'active','OWNER')`, [S.UA, S.UB, S.TA, S.TB, S.BA, S.BB, `owner-a@${p}.test`, `owner-b@${p}.test`]);
  return S;
}
import { GlobalTechAdminService, GlobalTechAdminError } from './global-tech-admin.service';
import { identityKeys } from '@aipowersalon/workforce';

let h: Harness;
let S: Awaited<ReturnType<typeof seedTwoTenants>>;
let admin: GlobalTechAdminService;
const ADMIN = uuid('4e4e', 'ad');
const ctx = { userId: ADMIN, ip: undefined };

async function tech(code: string, name: string, tenant: string, branch: string, i: { phone?: string | null; email?: string | null }) {
  const k = identityKeys(i);
  const [p] = await h.q(`insert into global_tech_profiles (tech_code, public_slug, display_name, normalized_phone, phone_hash, email_normalized)
                          values ($1,$2,$3,$4,$5,$6) returning id`, [code, `${code.toLowerCase()}-s`, name, k.normalizedPhone, k.phoneHash, k.emailNormalized]);
  const [u] = await h.q(`insert into users (tenant_id, branch_id, role, status, full_name, normalized_phone, email, global_tech_profile_id)
                          values ($1,$2,'TECHNICIAN','active',$3,$4,$5,$6) returning id`, [tenant, branch, name, k.normalizedPhone, k.emailNormalized, p.id]);
  const [t] = await h.q(`insert into technicians (tenant_id, branch_id, user_id, first_name, last_name, full_name, normalized_phone, email, is_active, global_tech_profile_id)
                          values ($1,$2,$3,$4,'X',$4,$5,$6,true,$7) returning id`, [tenant, branch, u.id, name, k.normalizedPhone, k.emailNormalized, p.id]);
  const [m] = await h.q(`insert into tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, technician_id, user_id, status, start_date)
                          values ($1,$2,$3,$4,$5,'active',now()) returning id`, [p.id, tenant, branch, t.id, u.id]);
  return { profileId: p.id as string, userId: u.id as string, technicianId: t.id as string, membershipId: m.id as string };
}

beforeAll(async () => {
  h = await bootPg();
  S = await seedTwoTenants(h, '4e4e', 0);
  await h.q(`insert into privileged_access_grants (grant_ref, user_id, privilege, scope, reason, status, expires_at) values ('merge-elev', $1, 'security_admin', 'platform', 'test', 'active', now() + interval '1 day')`, [ADMIN]);
  admin = new GlobalTechAdminService(h.db as any);
}, 240000);

describe('merge — key order', () => {
  it('the duplicate holds the PHONE the survivor lacks (survivor has only the email): the merge succeeds and the survivor inherits it', async () => {
    const keep = await tech('TECH-400001', 'Olivia Brown', S.TA, S.BA, { email: 'olivia@example.test' });
    const dupe = await tech('TECH-400002', 'Olivia Brown', S.TB, S.BB, { phone: '856-555-4002' });

    const r = await admin.merge(ctx, keep.profileId, dupe.profileId, 'same person');
    expect(r.ok).toBe(true);

    const [c] = await h.q(`select normalized_phone, phone_hash, email_normalized, status from global_tech_profiles where id = $1`, [keep.profileId]);
    expect(c.normalized_phone).toBe('+18565554002');
    expect(c.phone_hash).toBe(identityKeys({ phone: '+18565554002' }).phoneHash);
    expect(c.email_normalized).toBe('olivia@example.test');
    const [d] = await h.q(`select normalized_phone, phone_hash, email_normalized, status, merged_into_profile_id from global_tech_profiles where id = $1`, [dupe.profileId]);
    expect(d.status).toBe('merged');
    expect(d.phone_hash).toBeNull();
    expect(d.merged_into_profile_id).toBe(keep.profileId);
    // everything followed her, nothing left behind
    expect(await h.count(`select count(*)::int n from technicians where global_tech_profile_id = $1`, [keep.profileId])).toBe(2);
    expect(await h.count(`select count(*)::int n from users where global_tech_profile_id = $1`, [keep.profileId])).toBe(2);
    expect(await h.count(`select count(*)::int n from tech_salon_memberships where global_tech_profile_id = $1`, [keep.profileId])).toBe(2);
    expect(await h.count(`select count(*)::int n from technicians where global_tech_profile_id = $1`, [dupe.profileId])).toBe(0);
  });

  it('is transactional: a merge refused by decideMerge (shared salon, via ROSTER rows) moves nothing', async () => {
    const one = await tech('TECH-400003', 'Ana Lee', S.TA, S.BA, { phone: '856-555-4003' });
    const two = await tech('TECH-400004', 'Ana Lee', S.TB, S.BB, { phone: '856-555-4004' });
    // `two` also has a live ROSTER row at A with no membership — candidate() must count that as "known at A"
    await h.q(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, is_active, global_tech_profile_id) values ($1,$2,'Ana','Lee','Ana Lee',true,$3)`, [S.TA, S.BA, two.profileId]);
    await expect(admin.merge(ctx, one.profileId, two.profileId, 'dupe')).rejects.toThrow(GlobalTechAdminError);
    await expect(admin.merge(ctx, one.profileId, two.profileId, 'dupe')).rejects.toThrow(/same salon/i);
    expect((await h.q(`select status from global_tech_profiles where id = $1`, [two.profileId]))[0].status).toBe('active');
    expect((await h.q(`select global_tech_profile_id from technicians where id = $1`, [two.technicianId]))[0].global_tech_profile_id).toBe(two.profileId);
  });

  it('a merged signpost cannot be merged again, and the survivor keeps its own keys when it already has them', async () => {
    const [sign] = await h.q(`select id, merged_into_profile_id from global_tech_profiles where tech_code = 'TECH-400002'`);
    const other = await tech('TECH-400005', 'Someone', S.TB, S.BB, { phone: '856-555-4005' });
    await expect(admin.merge(ctx, other.profileId, sign.id, 'again')).rejects.toMatchObject({ code: 'not_mergeable' });
  });
});

describe('duplicates() — finds what the unique index makes invisible to a per-key GROUP BY', () => {
  it('two live profiles that share NO key with each other but whose roster/login rows carry the other\'s key', async () => {
    // Luxe hired her on her phone; Belle on her email. The profiles share nothing. But Belle's roster row ALSO
    // stored the phone (the manager typed both), so the comparison across tables finds the pair.
    const a = await tech('TECH-410001', 'Mia Pham', S.TA, S.BA, { phone: '856-555-4101' });
    const b = await tech('TECH-410002', 'Mia Pham', S.TB, S.BB, { email: 'mia@example.test' });
    await h.q(`update technicians set normalized_phone = '+18565554101' where id = $1`, [b.technicianId]);

    const out = await admin.duplicates();
    const g = out.groups.find((x) => x.profiles.some((p) => p.profileId === a.profileId));
    expect(g).toBeTruthy();
    expect(g!.profiles.map((p) => p.techCode).sort()).toEqual(['TECH-410001', 'TECH-410002']);
    expect(g!.weak).toBe(false);
    expect(g!.containsTombstone).toBe(false);
  });

  it('a profile whose keys were NULLED (anonymized) is still paired with the live profile reusing its number — flagged as a tombstone, not a merge candidate', async () => {
    const gone = await tech('TECH-410003', 'Gone Person', S.TA, S.BA, { phone: '856-555-4103' });
    await h.q(`update global_tech_profiles set status = 'anonymized', normalized_phone = null, phone_hash = null, email_normalized = null where id = $1`, [gone.profileId]);
    const fresh = await tech('TECH-410004', 'New Person', S.TB, S.BB, { phone: '856-555-4103' });

    const out = await admin.duplicates();
    const g = out.groups.find((x) => x.profiles.some((p) => p.profileId === fresh.profileId));
    expect(g).toBeTruthy();
    expect(g!.profiles.map((p) => p.techCode).sort()).toEqual(['TECH-410003', 'TECH-410004']);
    expect(g!.containsTombstone).toBe(true);
  });

  it('it CANNOT find two profiles with no overlapping phone/email anywhere — documented, and pinned', async () => {
    const x = await tech('TECH-410005', 'Twin One', S.TA, S.BA, { phone: '856-555-4105' });
    const y = await tech('TECH-410006', 'Twin One', S.TB, S.BB, { phone: '856-555-4106' });
    const out = await admin.duplicates();
    expect(out.groups.some((g) => g.profiles.some((p) => p.profileId === x.profileId) && g.profiles.some((p) => p.profileId === y.profileId))).toBe(false);
  });

  it('never returns a key — only who, their code, status and when', async () => {
    const out = await admin.duplicates();
    for (const g of out.groups) for (const p of g.profiles) expect(Object.keys(p).sort()).toEqual(['createdAt', 'displayName', 'profileId', 'status', 'techCode']);
  });
});
