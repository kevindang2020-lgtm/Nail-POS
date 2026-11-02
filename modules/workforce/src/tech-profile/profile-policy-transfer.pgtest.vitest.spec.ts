// profile-policy-transfer.pgtest.vitest.spec.ts — Technician Profile mandate (wave 3 TECH, Oct 13 2026), on every migration:
//   §95  publicProfileChangesRequireApproval — a held edit, a manager's decision (optimistic version), her withdraw
//   §62  consented career history on the public profile (OFF by default)
//   §53  one public-profile status word
//   §60 / §170 technician-REQUESTED transfer: approval at the new salon ends the old employment in the same transaction;
//        Tenant A's private data never reaches Tenant B; the profile survives
//   §128 employment history: hired at A → transferred out of A → hired at B, each row in the salon that owns it
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { GlobalTechIdentityService } from './global-tech-identity.service';
import { GlobalTechDirectory } from './global-tech-directory.kysely';
import { TechProfileService } from './tech-profile.service';
import { readEmploymentHistory } from '../technicians/employment-history';

type Harness = { pg: any; db: any; q: (s: string, p?: unknown[]) => Promise<any[]> };
async function bootPg(): Promise<Harness> {
  const pg: any = await migratedPglite();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
  return { pg, db: kyselyFor(pg), q };
}
const uuid = (p: string, s: string | number) => `${p.padEnd(8, '0')}-0000-4000-8000-${String(s).padStart(12, '0')}`;
const P = 'c6';
const A = uuid(P, 1), B = uuid(P, 2);
const BR_A = uuid(P, 'b1'), BR_B = uuid(P, 'b2');
const MGR_A = uuid(P, 'f1'), MGR_B = uuid(P, 'f2');
const mgrA: any = { tenantId: A, branchId: BR_A, userId: MGR_A, role: 'MANAGER', permissions: [] };
const mgrB: any = { tenantId: B, branchId: BR_B, userId: MGR_B, role: 'MANAGER', permissions: [] };

let h: Harness; let identity: GlobalTechIdentityService; let profiles: TechProfileService;
const roster = async (tenantId: string, branchId: string, name: string) =>
  String((await h.q(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$2,$3,'X',$3,true) returning id`, [tenantId, branchId, name]))[0].id);
const techCtx = async (tenantId: string, branchId: string, technicianId: string) => {
  const [u]: any = await h.q(`select user_id from technicians where id = $1`, [technicianId]);
  return { tenantId, branchId, userId: u.user_id, role: 'TECHNICIAN', permissions: [] } as any;
};

beforeAll(async () => {
  h = await bootPg();
  identity = new GlobalTechIdentityService(h.db as any, new GlobalTechDirectory(h.db as any));
  profiles = new TechProfileService(h.db as any, null as any, undefined, identity);
  await h.q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Salon A','c6-a','C6A','active'),($2,'B','Salon B','c6-b','C6B','active')`, [A, B]);
  await h.q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'),($3,$4,'Main','active')`, [BR_A, A, BR_B, B]);
  await h.q(`insert into tenant_app_flags (tenant_id, flag_key, enabled) values ($1,'public_listing',true),($2,'public_listing',true)`, [A, B]);
  await h.q(`insert into users (id, tenant_id, branch_id, role, status, full_name) values ($1,$2,$3,'MANAGER','active','A Mgr'),($4,$5,$6,'MANAGER','active','B Mgr')`, [MGR_A, A, BR_A, MGR_B, B, BR_B]);
}, 180000);

describe('§95 public-profile change approval', () => {
  it('no policy → the edit applies at once; policy ON at an employing salon → the edit is HELD; approve applies it; the version guards the decision', async () => {
    const tech = await roster(A, BR_A, 'Mia Pham');
    const born = await identity.attachToTechnician(mgrA, tech, { fullName: 'Mia Pham', phone: '856-555-6001', email: null });
    const me = await techCtx(A, BR_A, tech);
    // 1. no policy: direct write
    const direct: any = await profiles.updateMyProfile(me, { bio: 'Gel specialist', isPublic: true });
    expect(direct.bio).toBe('Gel specialist'); expect(direct.pendingChanges).toBeNull(); expect(direct.publicProfileStatus).toBe('PUBLIC');
    // 2. Salon A turns approval on
    expect((await profiles.posSetProfilePolicy(mgrA, true)).publicProfileChangesRequireApproval).toBe(true);
    const held: any = await profiles.updateMyProfile(me, { bio: 'NEW BIO', title: 'Senior Artist', acceptsMessages: false });
    expect(held.bio).toBe('Gel specialist');                       // not applied
    expect(held.acceptsMessages).toBe(false);                     // her own switch applied at once
    expect(held.pendingChanges?.changes).toEqual({ bio: 'NEW BIO', title: 'Senior Artist' });
    // a second edit merges into the SAME pending request (one per profile)
    const held2: any = await profiles.updateMyProfile(me, { bio: 'NEWER BIO' });
    expect(held2.pendingChanges?.changes).toEqual({ bio: 'NEWER BIO', title: 'Senior Artist' });
    expect((await h.q(`select count(*)::int n from tech_profile_change_requests where global_tech_profile_id = $1 and status = 'pending'`, [born.profileId]))[0].n).toBe(1);
    // 3. Salon B (not employing her) sees nothing; Salon A sees the request with the current values beside the change
    expect((await profiles.posListProfileChanges(mgrB)).requests).toEqual([]);
    const list = (await profiles.posListProfileChanges(mgrA)).requests;
    expect(list).toHaveLength(1);
    expect(list[0].technicianId).toBe(tech); expect(list[0].current.bio).toBe('Gel specialist'); expect(list[0].changes.bio).toBe('NEWER BIO');
    // 4. a stale version is refused (§104); B cannot decide it at all
    await expect(profiles.posDecideProfileChange(mgrA, list[0].requestId, 'approved', list[0].version - 1)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(profiles.posDecideProfileChange(mgrB, list[0].requestId, 'approved', list[0].version)).rejects.toMatchObject({ code: 'not_found' });
    // 5. approve → applied verbatim (re-sanitised), request closed, she is notified
    const ok = await profiles.posDecideProfileChange(mgrA, list[0].requestId, 'approved', list[0].version);
    expect(ok.applied).toEqual({ bio: 'NEWER BIO', title: 'Senior Artist' });
    const [p]: any = await h.q(`select bio, title from global_tech_profiles where id = $1`, [born.profileId]);
    expect(p.bio).toBe('NEWER BIO'); expect(p.title).toBe('Senior Artist');
    expect((await h.q(`select status from tech_profile_change_requests where id = $1`, [list[0].requestId]))[0].status).toBe('approved');
    expect((await h.q(`select count(*)::int n from technician_notifications where technician_id = $1 and type = 'profile_change_approved'`, [tech]))[0].n).toBe(1);
    await expect(profiles.posDecideProfileChange(mgrA, list[0].requestId, 'approved', list[0].version + 1)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    // 6. reject with a note; then withdraw
    await profiles.updateMyProfile(me, { bio: 'rejected one' });
    const l2 = (await profiles.posListProfileChanges(mgrA)).requests;
    await profiles.posDecideProfileChange(mgrA, l2[0].requestId, 'rejected', l2[0].version, 'Keep it professional');
    expect((await h.q(`select bio from global_tech_profiles where id = $1`, [born.profileId]))[0].bio).toBe('NEWER BIO');
    expect((await h.q(`select body from technician_notifications where technician_id = $1 and type = 'profile_change_rejected'`, [tech]))[0].body).toContain('Keep it professional');
    await profiles.updateMyProfile(me, { bio: 'withdrawn one' });
    expect((await profiles.withdrawMyPendingChange(me)).withdrawn).toBe(true);
    expect((await profiles.withdrawMyPendingChange(me)).withdrawn).toBe(false);
    expect((await profiles.posListProfileChanges(mgrA)).requests).toEqual([]);
    await profiles.posSetProfilePolicy(mgrA, false);
  }, 60000);
});

describe('§62 career history + §53 status', () => {
  it('career history is EMPTY until she opts in; then salon names + years only; status words follow the platform state', async () => {
    const tech = await roster(A, BR_A, 'Lena Vo');
    const born = await identity.attachToTechnician(mgrA, tech, { fullName: 'Lena Vo', phone: '856-555-6002', email: null });
    const me = await techCtx(A, BR_A, tech);
    await profiles.updateMyProfile(me, { isPublic: true });
    const off: any = await profiles.customerPublicProfile({ tenantId: A, branchId: BR_A, userId: '', role: 'CUSTOMER', permissions: [] } as any, (await h.q(`select public_slug from global_tech_profiles where id = $1`, [born.profileId]))[0].public_slug);
    expect(off.careerHistory).toEqual([]);
    const on: any = await profiles.updateMyProfile(me, { careerHistoryPublic: true });
    expect(on.careerHistoryPublic).toBe(true);
    const pub: any = await profiles.customerPublicProfile({ tenantId: A, branchId: BR_A, userId: '', role: 'CUSTOMER', permissions: [] } as any, off.publicSlug);
    expect(pub.careerHistory).toHaveLength(1);
    expect(pub.careerHistory[0]).toMatchObject({ salonName: 'Salon A', current: true, to: null });
    expect(Object.keys(pub.careerHistory[0]).sort()).toEqual(['current', 'from', 'salonName', 'to']);   // nothing else crosses
    expect(JSON.stringify(pub)).not.toMatch(/commission|payroll|notes/i);
    // §53
    const priv: any = await profiles.updateMyProfile(me, { isPublic: false });
    expect(priv.publicProfileStatus).toBe('PRIVATE');
    await h.q(`update global_tech_profiles set status = 'suspended' where id = $1`, [born.profileId]);
    expect((await profiles.getOrCreateMyProfile(me)).publicProfileStatus).toBe('SUSPENDED');
    await h.q(`update global_tech_profiles set status = 'active', admin_profile_hidden = true where id = $1`, [born.profileId]);
    expect((await profiles.getOrCreateMyProfile(me)).publicProfileStatus).toBe('HIDDEN');
    await h.q(`update global_tech_profiles set admin_profile_hidden = false where id = $1`, [born.profileId]);
  }, 60000);
});

describe('§60 / §170 technician-requested transfer + §128 history', () => {
  it('request {transfer:true} → approve at B ends employment at A in the same commit; A keeps its private rows; B sees none of them; history on both sides', async () => {
    const techA = await roster(A, BR_A, 'Ann Le');
    const born = await identity.attachToTechnician(mgrA, techA, { fullName: 'Ann Le', phone: '856-555-6003', email: null });
    // Tenant-private data at A: a commission rate, a manager note, a customer
    await h.q(`update technicians set default_commission_split_percent = 55 where id = $1`, [techA]);
    const me = await techCtx(A, BR_A, techA);
    const req: any = await profiles.requestMembership(me, 'C6B', 'moving closer to home', { transfer: true });
    expect(req.transfer).toBe(true); expect(req.status).toBe('pending_salon_approval');
    const [m]: any = await h.q(`select id, transfer_from_tenant_id, requested_by_user_id from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [born.profileId, B]);
    expect(m.transfer_from_tenant_id).toBe(A);
    // B's manager sees "transfer" but NOT which salon she is leaving (§61)
    const pending = (await profiles.posListMembershipRequests(mgrB)).requests;
    expect(pending).toHaveLength(1); expect(pending[0].isTransfer).toBe(true);
    expect(JSON.stringify(pending[0])).not.toContain('Salon A');
    // B approves
    const ok: any = await profiles.posDecideMembershipRequest(mgrB, m.id, 'approve');
    expect(ok.status).toBe('active'); expect(ok.transferred).toBe(true);
    // A: employment ended, membership former, login revoked; the private rows remain in A
    const [a]: any = await h.q(`select is_active, status, ended_reason, global_tech_profile_id from technicians where id = $1`, [techA]);
    expect(a.is_active).toBe(false); expect(a.ended_reason).toBe('transferred'); expect(a.global_tech_profile_id).toBe(born.profileId);
    expect((await h.q(`select status from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [born.profileId, A]))[0].status).toBe('former');
    expect((await h.q(`select status from users where tenant_id = $1 and global_tech_profile_id = $2`, [A, born.profileId]))[0].status).not.toBe('active');
    // B: a NEW roster row with B's tenant default (never A's 55), same global profile, no note copied
    const [b]: any = await h.q(`select id, is_active, global_tech_profile_id, default_commission_split_percent from technicians where tenant_id = $1 and global_tech_profile_id = $2 and archived_at is null`, [B, born.profileId]);
    expect(b.is_active).toBe(true); expect(b.id).not.toBe(techA);
    expect(Number(b.default_commission_split_percent ?? 0)).not.toBe(55);
    expect((await h.q(`select count(*)::int n from global_tech_profiles where id = $1 and status = 'active'`, [born.profileId]))[0].n).toBe(1);
    // §128: A's history ends with 'transferred'; B's starts with 'hired'; neither salon reads the other's rows
    const histA = await readEmploymentHistory(h.db, A, techA);
    expect(histA.map((r) => r.type)).toEqual(['transferred', 'hired']);
    expect(histA[0].reason).toBe('transferred');
    const histB = await readEmploymentHistory(h.db, B, b.id);
    expect(histB.map((r) => r.type)).toEqual(['hired']);
    expect(await readEmploymentHistory(h.db, B, techA)).toEqual([]);
    // §64 rehire at A keeps the old rows and adds 'rehired'
    const back: any = await profiles.requestMembership(await techCtx(B, BR_B, b.id), 'C6A', 'back');
    const [mb]: any = await h.q(`select id from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [born.profileId, A]);
    expect(back.status).toBe('pending_salon_approval');
    await profiles.posDecideMembershipRequest(mgrA, mb.id, 'approve');
    const rehired = await readEmploymentHistory(h.db, A, techA);
    expect(rehired.map((r) => r.type)).toEqual(['rehired', 'transferred', 'hired']);
  }, 90000);

  it('a transfer request is refused while she is mid-service at the old salon (TRANSFER_NOT_ALLOWED, §60/§107)', async () => {
    const techA = await roster(A, BR_A, 'Kim Tran');
    const born = await identity.attachToTechnician(mgrA, techA, { fullName: 'Kim Tran', phone: '856-555-6004', email: null });
    const me = await techCtx(A, BR_A, techA);
    await profiles.requestMembership(me, 'C6B', undefined, { transfer: true });
    const [m]: any = await h.q(`select id from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [born.profileId, B]);
    await h.q(`insert into pos_queue_items (tenant_id, branch_id, assigned_technician_id, status, customer_name) values ($1,$2,$3,'in_service','Guest')`, [A, BR_A, techA]);
    await expect(profiles.posDecideMembershipRequest(mgrB, m.id, 'approve')).rejects.toMatchObject({ code: 'TRANSFER_NOT_ALLOWED' });
    expect((await h.q(`select is_active from technicians where id = $1`, [techA]))[0].is_active).toBe(true);
    expect((await h.q(`select status from tech_salon_memberships where id = $1`, [m.id]))[0].status).toBe('pending_salon_approval');
  }, 60000);
});
