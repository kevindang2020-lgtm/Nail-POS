// transfer.pgtest.vitest.spec.ts — [ported from the Technician Profile package, Oct 12 2026] — A → B: profile retained; A membership former + A roster/login inactive + sessions
// dead; B employment created; A's private data untouched. Both departure paths (executor, accept) go through ONE
// function — GlobalTechIdentityService.endEmployment — and both are proven here against the real schema.
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
import { GlobalTechIdentityService, GlobalTechDirectory, TechWorkplacesService, identityKeys } from '@aipowersalon/workforce';
import { KyselyCrossTenantTransferExecutor } from './cross-tenant-transfer.executor';
import { SuperAdminStaffKyselyRepository } from './super-admin-staff.kysely.repository';

let h: Harness;
let S: Awaited<ReturnType<typeof seedTwoTenants>>;
let identity: GlobalTechIdentityService;
let executor: KyselyCrossTenantTransferExecutor;
let workplaces: TechWorkplacesService;
const ADMIN = uuid('5a5a', 'ad');

async function hireAtA(code: string, name: string, phone: string) {
  const k = identityKeys({ phone });
  const [p] = await h.q(`insert into global_tech_profiles (tech_code, public_slug, display_name, normalized_phone, phone_hash) values ($1,$2,$3,$4,$5) returning id`, [code, `${code.toLowerCase()}-s`, name, k.normalizedPhone, k.phoneHash]);
  const [u] = await h.q(`insert into users (tenant_id, branch_id, role, status, full_name, normalized_phone, global_tech_profile_id) values ($1,$2,'TECHNICIAN','active',$3,$4,$5) returning id`, [S.TA, S.BA, name, k.normalizedPhone, p.id]);
  const [t] = await h.q(`insert into technicians (tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active, default_commission_split_percent, commission_value, global_tech_profile_id)
                          values ($1,$2,$3,$4,'X',$4,true,55,55,$5) returning id`, [S.TA, S.BA, u.id, name, p.id]);
  const [m] = await h.q(`insert into tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, technician_id, user_id, status, start_date) values ($1,$2,$3,$4,$5,'active',now()) returning id`, [p.id, S.TA, S.BA, t.id, u.id]);
  await h.q(`insert into user_branch_access (tenant_id, branch_id, user_id, role, access_level) values ($1,$2,$3,'TECHNICIAN','staff')`, [S.TA, S.BA, u.id]);
  // A's PRIVATE data: a schedule row, a service mapping, two live sessions
  await h.q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,1,'09:00','17:00',true)`, [S.TA, S.BA, t.id]);
  await h.q(`insert into sessions (user_id, tenant_id, branch_id, status, expires_at) values ($1,$2,$3,'active',now() + interval '1 day'), ($1,$2,$3,'active',now() + interval '1 day')`, [u.id, S.TA, S.BA]);
  return { profileId: p.id as string, userId: u.id as string, technicianId: t.id as string, membershipId: m.id as string };
}

async function stateAtA(x: { profileId: string; userId: string; technicianId: string }) {
  const [m] = await h.q(`select status, ended_reason from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [x.profileId, S.TA]);
  const [t] = await h.q(`select is_active, status, ended_reason, default_commission_split_percent, global_tech_profile_id from technicians where id = $1`, [x.technicianId]);
  const [u] = await h.q(`select status from users where id = $1`, [x.userId]);
  const live = await h.count(`select count(*)::int n from sessions where user_id = $1 and status <> 'revoked'`, [x.userId]);
  const grants = await h.count(`select count(*)::int n from user_branch_access where tenant_id = $1 and user_id = $2`, [S.TA, x.userId]);
  const schedule = await h.count(`select count(*)::int n from technician_schedules where technician_id = $1`, [x.technicianId]);
  return { m, t, u, live, grants, schedule };
}

beforeAll(async () => {
  h = await bootPg();
  S = await seedTwoTenants(h, '5a5a', 0);
  await h.q(`update tenants set status = 'active' where id in ($1, $2)`, [S.TA, S.TB]);
  identity = new GlobalTechIdentityService(h.db as any, new GlobalTechDirectory(h.db as any));
  executor = new KyselyCrossTenantTransferExecutor(h.db as any, identity);
  workplaces = new TechWorkplacesService(h.db as any, identity);
}, 240000);

describe('self-requested transfer (executor, immediate)', () => {
  it('A → B: profile retained; A former + inactive roster + inactive login + dead sessions + no grants; B created; A private data kept', async () => {
    const x = await hireAtA('TECH-500001', 'Ivy K', '856-555-5001');
    const r = await executor.execute({ requestId: uuid('5a5a', 'c1'), userId: x.userId, fromTenantId: S.TA, toTenantId: S.TB, toBranchId: S.BB, requestedBy: x.userId, decidedByUserId: ADMIN });
    expect(r).toMatchObject({ executed: true, membershipStatus: 'active', profileId: x.profileId });

    const [p] = await h.q(`select status, tech_code, phone_hash from global_tech_profiles where id = $1`, [x.profileId]);
    expect(p.status).toBe('active'); expect(p.tech_code).toBe('TECH-500001'); expect(p.phone_hash).toBeTruthy();   // retained

    const a = await stateAtA(x);
    expect(a.m.status).toBe('former'); expect(a.m.ended_reason).toBe('transferred');
    expect(a.t.is_active).toBe(false); expect(a.t.status).toBe('inactive'); expect(a.t.ended_reason).toBe('transferred');
    expect(a.u.status).toBe('inactive');
    expect(a.live).toBe(0);
    expect(a.grants).toBe(0);
    // A's private data is A's record — untouched
    expect(a.schedule).toBe(1);
    expect(Number(a.t.default_commission_split_percent)).toBe(55);
    expect(a.t.global_tech_profile_id).toBe(x.profileId);   // the books still know whose they were

    // B: ONE login, ONE roster row (default 40 — never A's 55), an active membership, a branch grant
    const uB = await h.q(`select id, status from users where global_tech_profile_id = $1 and tenant_id = $2`, [x.profileId, S.TB]);
    expect(uB.length).toBe(1);
    const tB = await h.q(`select branch_id, is_active, default_commission_split_percent from technicians where global_tech_profile_id = $1 and tenant_id = $2 and archived_at is null`, [x.profileId, S.TB]);
    expect(tB.length).toBe(1); expect(tB[0].branch_id).toBe(S.BB); expect(tB[0].is_active).toBe(true); // Re-pinned (workforce phase 2): the new employment takes salon B's OWN default commission
    // (tenants.default_commission_percent via compensation defaultCommissionForTenant), not the old hardcoded 40.
    const bDefault = Number((await h.q(`select default_commission_percent from tenants where id = $1`, [S.TB]))[0].default_commission_percent);
    expect(Number(tB[0].default_commission_split_percent)).toBe(bDefault);
    expect((await h.q(`select status from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [x.profileId, S.TB]))[0].status).toBe('active');
    expect(await h.count(`select count(*)::int n from user_branch_access where tenant_id = $1 and user_id = $2 and branch_id = $3 and role = 'TECHNICIAN'`, [S.TB, uB[0].id, S.BB])).toBe(1);
    // the shared chain's audit row
    expect(await h.count(`select count(*)::int n from audit_events where action = 'technician_access_revoked' and tenant_id = $1`, [S.TA])).toBeGreaterThanOrEqual(1);
  });

  it('is transactional: a failure inside the move leaves her exactly where she was', async () => {
    const x = await hireAtA('TECH-500002', 'Rollback R', '856-555-5002');
    // Make the materialization at B fail AFTER the membership write: B already has a live STAFF login on her phone
    // that belongs to ANOTHER profile. ensureTenantUser cannot adopt it (it is taken) and its own insert collides
    // with uq_users_tenant_phone_staff_live. The executor's transaction must roll everything back.
    await h.q(`insert into users (tenant_id, branch_id, role, status, full_name, normalized_phone) values ($1,$2,'MANAGER','active','Phone Squatter','+18565555002')`, [S.TB, S.BB]);
    const [{ id: other }] = await h.q(`insert into global_tech_profiles (tech_code, public_slug, display_name) values ('TECH-500099','sq','Squat') returning id`);
    await h.q(`update users set global_tech_profile_id = $1 where normalized_phone = '+18565555002' and tenant_id = $2`, [other, S.TB]);

    const before = await stateAtA(x);
    await expect(executor.execute({ requestId: uuid('5a5a', 'c2'), userId: x.userId, fromTenantId: S.TA, toTenantId: S.TB, toBranchId: S.BB, requestedBy: x.userId, decidedByUserId: ADMIN })).rejects.toThrow();
    const after = await stateAtA(x);
    expect(after).toEqual(before);
    expect(after.m.status).toBe('active'); expect(after.live).toBe(2);
    expect(await h.count(`select count(*)::int n from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [x.profileId, S.TB])).toBe(0);
  });
});

describe('transfer accepted by the technician (TechWorkplacesService.accept — the second departure path)', () => {
  it('approval creates a PENDING membership and ends nothing; her acceptance ends A and creates B in ONE transaction', async () => {
    const x = await hireAtA('TECH-500003', 'Lena M', '856-555-5003');
    const r = await executor.execute({ requestId: uuid('5a5a', 'c3'), userId: x.userId, fromTenantId: S.TA, toTenantId: S.TB, toBranchId: S.BB, requestedBy: ADMIN, decidedByUserId: ADMIN });
    expect(r.membershipStatus).toBe('pending_tech_approval');
    expect((await stateAtA(x)).m.status).toBe('active');            // still employed at A

    const acc = await workplaces.accept({ tenantId: S.TA, branchId: S.BA, userId: x.userId, role: 'TECHNICIAN', permissions: [] }, r.membershipId!);
    expect(acc.status).toBe('active');
    const a = await stateAtA(x);
    expect(a.m.status).toBe('former'); expect(a.m.ended_reason).toBe('transferred');
    expect(a.t.is_active).toBe(false); expect(a.u.status).toBe('inactive'); expect(a.live).toBe(0); expect(a.grants).toBe(0);
    expect(a.schedule).toBe(1);
    expect(await h.count(`select count(*)::int n from technicians where global_tech_profile_id = $1 and tenant_id = $2 and is_active`, [x.profileId, S.TB])).toBe(1);
  });

  it('accept REFUSES when the platform account is not active', async () => {
    const x = await hireAtA('TECH-500004', 'Paused P', '856-555-5004');
    const r = await executor.execute({ requestId: uuid('5a5a', 'c4'), userId: x.userId, fromTenantId: S.TA, toTenantId: S.TB, toBranchId: S.BB, requestedBy: ADMIN, decidedByUserId: ADMIN });
    await h.q(`update global_tech_profiles set status = 'paused' where id = $1`, [x.profileId]);
    await expect(workplaces.accept({ tenantId: S.TA, branchId: S.BA, userId: x.userId, role: 'TECHNICIAN', permissions: [] }, r.membershipId!)).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await h.q(`select status from tech_salon_memberships where id = $1`, [r.membershipId]))[0].status).toBe('pending_tech_approval');
    expect((await stateAtA(x)).m.status).toBe('active');
  });
});

describe('worker BRANCH transfer (Super Admin §30) moves the whole employment, not just users.branch_id', () => {
  it('technicians.branch_id, the membership branch and the user_branch_access grant all follow the move', async () => {
    const BR2 = uuid('5a5a', 'bb2');
    await h.q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'A-Second','active')`, [BR2, S.TA]);
    const x = await hireAtA('TECH-500005', 'Move M', '856-555-5005');
    const repo = new SuperAdminStaffKyselyRepository(h.db as any);
    const { id } = await repo.createWorkerTransferRequest({ tenantId: S.TA, userId: x.userId, fromBranchId: S.BA, toBranchId: BR2, reason: 'moving', requestedBy: ADMIN });
    const out = await repo.decideWorkerTransfer(id, 'approve', null, ADMIN);
    expect(out.status).toBe('approved');

    expect((await h.q(`select branch_id from users where id = $1`, [x.userId]))[0].branch_id).toBe(BR2);
    expect((await h.q(`select branch_id from technicians where id = $1`, [x.technicianId]))[0].branch_id).toBe(BR2);
    expect((await h.q(`select branch_id, status from tech_salon_memberships where id = $1`, [x.membershipId]))[0]).toMatchObject({ branch_id: BR2, status: 'active' });
    const grants = await h.q(`select branch_id, role from user_branch_access where tenant_id = $1 and user_id = $2`, [S.TA, x.userId]);
    expect(grants).toEqual([{ branch_id: BR2, role: 'TECHNICIAN' }]);
  });
});
