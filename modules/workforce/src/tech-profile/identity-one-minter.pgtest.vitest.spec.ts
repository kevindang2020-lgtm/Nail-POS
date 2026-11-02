// identity-one-minter.pgtest.vitest.spec.ts — [ported from the Technician Profile package, Oct 12 2026] — ONE human, ONE global identity, however she arrives.
//
// Workforce audit P1 #14: `getOrCreateMyProfile` was a second minter (direct insert, no tech_code, no keys), so a
// technician who opened the Tech App before a manager ever looked her up got a second account; `decideIdentity`
// linked paused/locked accounts; `findByKeys` returned merged signposts; nothing stopped a second roster row at one
// salon. Every assertion here is about what is IN the database afterwards, against every migration.
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
import { GlobalTechIdentityService } from './global-tech-identity.service';
import { GlobalTechDirectory } from './global-tech-directory.kysely';
import { TechProfileService } from './tech-profile.service';
import { KyselyTechniciansRepository } from '../technicians/technicians.kysely.repository';
import { TechniciansService } from '../technicians/technicians.service';
import { TechWorkplacesService } from './tech-workplaces.service';
import { identityKeys } from './global-tech-identity-core';

let h: Harness;
let S: Awaited<ReturnType<typeof seedTwoTenants>>;
let identity: GlobalTechIdentityService;
let profiles: TechProfileService;
let pos: TechniciansService;
let workplaces: TechWorkplacesService;

const PERMS = ['pos.technicians.view', 'pos.technicians.create', 'pos.technicians.edit'];
const mgr = (tenantId: string, branchId: string, userId: string) => ({ tenantId, branchId, userId, role: 'OWNER', permissions: PERMS });

beforeAll(async () => {
  h = await bootPg();
  S = await seedTwoTenants(h, '1e1a', 0);
  await h.q(`update tenants set status = 'active' where id in ($1, $2)`, [S.TA, S.TB]);
  identity = new GlobalTechIdentityService(h.db as any, new GlobalTechDirectory(h.db as any));
  profiles = new TechProfileService(h.db as any, null as any, undefined, identity);
  pos = new TechniciansService(new KyselyTechniciansRepository(h.db as any), undefined, identity);
  workplaces = new TechWorkplacesService(h.db as any, identity);
}, 240000);

describe('migrations 459–461 applied to a REAL engine', () => {
  it('one live roster row per (tenant, profile); one live staff login per (tenant, email) and (tenant, phone); ended_reason exists', async () => {
    // CONFLICT (merge): their 460 staff-only login indexes are NOT ported — ours (538) are broader: ONE login per
    // (tenant, lower(email)) and per (tenant, normalized_phone) for EVERY user, staff or customer.
    const idx = await h.q(`select indexname from pg_indexes where indexname in ('uq_technicians_tenant_gtp_live', 'uq_users_tenant_email_ci', 'uq_users_tenant_phone')`);
    expect(idx.map((r) => r.indexname).sort()).toEqual(['uq_technicians_tenant_gtp_live', 'uq_users_tenant_email_ci', 'uq_users_tenant_phone']);
    const col = await h.q(`select 1 from information_schema.columns where table_name = 'technicians' and column_name = 'ended_reason'`);
    expect(col.length).toBe(1);
  });
});

describe('the Tech App path mints through the ONE minter', () => {
  it('a logged-in technician with no profile gets a tech_code, normalized keys, an active membership and a branch grant', async () => {
    // a legacy roster row + login, exactly the pre-376 state: no global_tech_profile_id anywhere
    const uid = uuid('1e1a', 'a9');
    await h.q(`insert into users (id, tenant_id, branch_id, full_name, email, normalized_phone, status, role) values ($1,$2,$3,'Mai Tran','mai@example.test','+18565550101','active','TECHNICIAN')`, [uid, S.TA, S.BA]);
    const [t] = await h.q(`insert into technicians (tenant_id, branch_id, user_id, first_name, last_name, full_name, normalized_phone, email, is_active)
                            values ($1,$2,$3,'Mai','Tran','Mai Tran','(856) 555-0101','Mai@Example.test',true) returning id`, [S.TA, S.BA, uid]);

    const out: any = await profiles.getOrCreateMyProfile({ tenantId: S.TA, branchId: S.BA, userId: uid, role: 'TECHNICIAN', permissions: [] });
    expect(out.profileId).toBeTruthy();

    const [p] = await h.q(`select tech_code, normalized_phone, phone_hash, email_normalized, status from global_tech_profiles where id = $1`, [out.profileId]);
    expect(p.tech_code).toMatch(/^TECH-\d{6}$/);           // the sequence, not a NULL that 376 forbids
    expect(p.normalized_phone).toBe('+18565550101');       // identityKeys(), not a bare regex
    expect(p.phone_hash).toBeTruthy();
    expect(p.email_normalized).toBe('mai@example.test');
    expect((await h.q(`select global_tech_profile_id from technicians where id = $1`, [t.id]))[0].global_tech_profile_id).toBe(out.profileId);
    expect((await h.q(`select global_tech_profile_id from users where id = $1`, [uid]))[0].global_tech_profile_id).toBe(out.profileId);
    expect((await h.q(`select status from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [out.profileId, S.TA]))[0].status).toBe('active');
    expect((await h.q(`select role from user_branch_access where tenant_id = $1 and user_id = $2 and branch_id = $3`, [S.TA, uid, S.BA]))[0].role).toBe('TECHNICIAN');
  });

  it('the SAME tech joining a second salon via POS create REUSES the profile: one profile, two memberships, two users, two technicians rows', async () => {
    const [{ id: profileId }] = await h.q(`select id from global_tech_profiles where normalized_phone = '+18565550101'`);
    const row: any = await pos.create(mgr(S.TB, S.BB, S.UB), { firstName: 'Mai', lastName: 'Tran', phone: '856-555-0101', email: null as any } as any);
    expect(row.globalTechProfileId).toBe(profileId);
    expect(row.linkedExistingProfile).toBe(true);
    expect(row.membershipStatus).toBe('pending_tech_approval');   // her consent, not the salon's say-so

    expect(await h.count(`select count(*)::int n from global_tech_profiles where normalized_phone = '+18565550101'`)).toBe(1);
    expect(await h.count(`select count(*)::int n from tech_salon_memberships where global_tech_profile_id = $1`, [profileId])).toBe(2);
    expect(await h.count(`select count(*)::int n from users where global_tech_profile_id = $1`, [profileId])).toBe(2);
    // "invited, not linked": Salon B's roster row exists (the salon's own employment record) but carries NO
    // global_tech_profile_id until she accepts — the membership names it by technician_id.
    const [mB] = await h.q(`select technician_id, status from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [profileId, S.TB]);
    expect(mB.technician_id).toBe(row.technicianId);
    expect((await h.q(`select global_tech_profile_id from technicians where id = $1`, [row.technicianId]))[0].global_tech_profile_id).toBeNull();
    expect(await h.count(`select count(*)::int n from technicians where global_tech_profile_id = $1`, [profileId])).toBe(1);

    // she accepts in the Tech App (signed in at Salon A) → B's roster row links, ONE row at B, branch grant at B
    const [uA] = await h.q(`select id from users where global_tech_profile_id = $1 and tenant_id = $2`, [profileId, S.TA]);
    const [{ id: membershipB }] = await h.q(`select id from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [profileId, S.TB]);
    const acc = await workplaces.accept({ tenantId: S.TA, branchId: S.BA, userId: uA.id, role: 'TECHNICIAN', permissions: [] }, membershipB);
    expect(acc.status).toBe('active');
    expect(await h.count(`select count(*)::int n from technicians where global_tech_profile_id = $1`, [profileId])).toBe(2);
    expect(await h.count(`select count(*)::int n from technicians where global_tech_profile_id = $1 and tenant_id = $2`, [profileId, S.TB])).toBe(1);
    expect((await h.q(`select global_tech_profile_id from technicians where id = $1`, [row.technicianId]))[0].global_tech_profile_id).toBe(profileId);
    const [uB] = await h.q(`select id from users where global_tech_profile_id = $1 and tenant_id = $2`, [profileId, S.TB]);
    expect(await h.count(`select count(*)::int n from user_branch_access where tenant_id = $1 and user_id = $2 and branch_id = $3 and role = 'TECHNICIAN'`, [S.TB, uB.id, S.BB])).toBe(1);
  });

  it('the duplicate guard refuses a second roster row — for an ACTIVE employment and for a merely OPEN (pending) one', async () => {
    // Salon A / B: active memberships now
    await expect(pos.create(mgr(S.TA, S.BA, S.UA), { firstName: 'Mai', lastName: 'Tran', phone: '8565550101' } as any))
      .rejects.toThrow(/already works at this salon/);
    await expect(pos.create(mgr(S.TB, S.BB, S.UB), { firstName: 'Mai', lastName: 'Tran', phone: '8565550101' } as any))
      .rejects.toThrow(/already works at this salon/);

    // a third salon invites her (pending_tech_approval — NOT active) and then tries to create her again
    const TC = uuid('1e1a', 'c3'), BC = uuid('1e1a', 'bc3'), UC = uuid('1e1a', 'ac3');
    await h.q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Tenant C','Salon C','1e1ac','1E1AC')`, [TC]);
    await h.q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'C-Main','active')`, [BC, TC]);
    await h.q(`insert into users (id, tenant_id, branch_id, full_name, email, status, role) values ($1,$2,$3,'Owner C','owner-c@1e1a.test','active','OWNER')`, [UC, TC, BC]);
    const first: any = await pos.create(mgr(TC, BC, UC), { firstName: 'Mai', lastName: 'Tran', phone: '856 555 0101' } as any);
    expect(first.membershipStatus).toBe('pending_tech_approval');
    await expect(pos.create(mgr(TC, BC, UC), { firstName: 'Mai', lastName: 'Tran', phone: '8565550101' } as any))
      .rejects.toThrow(/already has an open invitation or roster record/);
    expect(await h.count(`select count(*)::int n from technicians where tenant_id = $1 and archived_at is null`, [TC])).toBe(1);
  });

  it('and the DATABASE refuses it even if every guard were bypassed', async () => {
    const [{ id: profileId }] = await h.q(`select id from global_tech_profiles where normalized_phone = '+18565550101'`);
    await expect(h.q(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, global_tech_profile_id) values ($1,$2,'Mai','Tran','Mai Tran',$3)`, [S.TA, S.BA, profileId]))
      .rejects.toThrow(/uq_technicians_tenant_gtp_live|duplicate key/);
    // an ARCHIVED row is outside the constraint — history is kept, uniqueness is about LIVE rows
    await h.q(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, global_tech_profile_id, archived_at, is_active) values ($1,$2,'Mai','Tran','Mai Tran',$3, now(), false)`, [S.TA, S.BA, profileId]);
  });

  // Re-pinned to OUR rule (538): one login per (tenant, email) / (tenant, phone) for every role and status — the same
  // person as a client at this salon signs in with the same account; a retired login keeps its key (reactivated, not
  // duplicated). Their 460 exempted customers and retired logins.
  it('one login per (tenant, email) / (tenant, phone) — staff, customer or retired alike', async () => {
    await expect(h.q(`insert into users (tenant_id, branch_id, full_name, email, status, role) values ($1,$2,'Dup','MAI@example.test','active','MANAGER')`, [S.TA, S.BA]))
      .rejects.toThrow(/uq_users_tenant_email_ci|duplicate key/);
    await expect(h.q(`insert into users (tenant_id, branch_id, full_name, normalized_phone, status, role) values ($1,$2,'Dup','+18565550101','invited','FRONT_DESK')`, [S.TA, S.BA]))
      .rejects.toThrow(/uq_users_tenant_phone|duplicate key/);
    await expect(h.q(`insert into users (tenant_id, branch_id, full_name, email, status, role) values ($1,$2,'Same person, client side','mai@example.test','active','CUSTOMER')`, [S.TA, S.BA]))
      .rejects.toThrow(/uq_users_tenant_email_ci|duplicate key/);
  });
});

describe('decideIdentity / findByKeys against real rows', () => {
  it('refuses to link a PAUSED, LOCKED or SUSPENDED account — each with its own reason', async () => {
    for (const [status, code] of [['paused', 'platform_paused'], ['locked', 'platform_locked'], ['suspended', 'platform_suspended']] as const) {
      const phone = `+1856555${status === 'paused' ? '0201' : status === 'locked' ? '0202' : '0203'}`;
      const k = identityKeys({ phone });
      await h.q(`insert into global_tech_profiles (tech_code, public_slug, display_name, normalized_phone, phone_hash, status) values ($1,$2,'X',$3,$4,$5)`,
        [`TECH-9${status.length}${phone.slice(-4)}`, `slug-${status}`, phone, k.phoneHash, status]);
      // the lookup finds her (a manager sees WHY she cannot be hired, not a silent new account) …
      const look: any = await identity.lookupForManager(mgr(S.TA, S.BA, S.UA) as any, { phone });
      expect(look.found).toBe(true);
      expect(look.platformStatus).toBe(status);
      // … and the create refuses with that code
      const [t] = await h.q(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,'X','Y','X Y') returning id`, [S.TA, S.BA]);
      await expect(identity.attachToTechnician(mgr(S.TA, S.BA, S.UA) as any, t.id, { fullName: 'X Y', phone })).rejects.toMatchObject({ code });
      expect(await h.count(`select count(*)::int n from global_tech_profiles where phone_hash = $1`, [k.phoneHash])).toBe(1);
    }
  });

  it('a MERGED signpost that still carries a key resolves to the CANONICAL account', async () => {
    const [canon] = await h.q(`insert into global_tech_profiles (tech_code, public_slug, display_name, status) values ('TECH-930001','canon-1','Canon','active') returning id`);
    // a signpost merged before keys were released (or restored by hand): the phone hash is on the DEAD row
    await h.q(`insert into global_tech_profiles (tech_code, public_slug, display_name, normalized_phone, phone_hash, status, merged_into_profile_id)
               values ('TECH-930002','sign-1','Sign','+18565550301','h+18565550301','merged',$1)`, [canon.id]);
    const found = await new GlobalTechDirectory(h.db as any).findByKeys({ normalizedPhone: '+18565550301', phoneHash: 'h+18565550301', emailNormalized: null });
    expect(found?.profileId).toBe(canon.id);
    expect(found?.status).toBe('active');
    expect(found?.techCode).toBe('TECH-930001');
  });
});
