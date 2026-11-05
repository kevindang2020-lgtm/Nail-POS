// consent-before-link.pgtest.vitest.spec.ts — [ported from the Technician Profile package, Oct 12 2026] — TECHNICIAN_AUDIT P0 #12 ("global profile visible to hiring salon before
// consent"). When a POS create matches an EXISTING global profile, the membership is pending_tech_approval — and the
// roster row's global_tech_profile_id now stays NULL until the technician accepts. Until then the hiring salon's
// manager view says "invitation pending" and the salon's customer page does not list her portable profile; the
// moment she accepts, everything links. A NEW human (no prior profile) links immediately, as before.
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
import { GlobalTechIdentityService } from './global-tech-identity.service';
import { GlobalTechDirectory } from './global-tech-directory.kysely';
import { TechWorkplacesService } from './tech-workplaces.service';
import { TechProfileService } from './tech-profile.service';

const P = 'af';
const HOME = uuid(P, 1), HIRER = uuid(P, 2);
const BR_H = uuid(P, 'b1'), BR_R = uuid(P, 'b2');
const MGR_H = uuid(P, 'f1'), MGR_R = uuid(P, 'f2');
const mgrHome: any = { tenantId: HOME, branchId: BR_H, userId: MGR_H, role: 'MANAGER', permissions: [] };
const mgrHirer: any = { tenantId: HIRER, branchId: BR_R, userId: MGR_R, role: 'MANAGER', permissions: [] };

let h: Harness;
let identity: GlobalTechIdentityService;
let workplaces: TechWorkplacesService;
let profiles: TechProfileService;

const roster = async (tenantId: string, branchId: string, name: string) =>
  String((await h.q(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$2,$3,'X',$3,true) returning id`, [tenantId, branchId, name]))[0].id);

beforeAll(async () => {
  h = await bootPg();
  identity = new GlobalTechIdentityService(h.db as any, new GlobalTechDirectory(h.db as any));
  workplaces = new TechWorkplacesService(h.db as any, identity);
  profiles = new TechProfileService(h.db as any, null as any);
  await h.q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Home','Home Salon','af-home','AFHOME','active'),($2,'Hirer','Hiring Salon','af-hire','AFHIRE','active')`, [HOME, HIRER]);
  await h.q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'),($3,$4,'Main','active')`, [BR_H, HOME, BR_R, HIRER]);
  await h.q(`insert into tenant_app_flags (tenant_id, flag_key, enabled) values ($1,'public_listing',true)`, [HIRER]);
  await h.q(`insert into users (id, tenant_id, branch_id, role, status, full_name) values ($1,$2,$3,'MANAGER','active','Home Mgr'),($4,$5,$6,'MANAGER','active','Hirer Mgr')`, [MGR_H, HOME, BR_H, MGR_R, HIRER, BR_R]);
}, 180000);

describe('consent before link', () => {
  it('a NEW human links immediately; an EXISTING human does not link until she accepts', async () => {
    // 1. Home salon creates her — nobody has this phone → a new profile, linked at once
    const homeTech = await roster(HOME, BR_H, 'Mia Pham');
    const born = await identity.attachToTechnician(mgrHome, homeTech, { fullName: 'Mia Pham', phone: '856-555-2001', email: null });
    expect(born.linkedExistingProfile).toBe(false);
    expect(born.membershipStatus).toBe('active');
    expect((await h.q(`select global_tech_profile_id from technicians where id = $1`, [homeTech]))[0].global_tech_profile_id).toBe(born.profileId);
    await h.q(`update global_tech_profiles set is_public = true, portfolio_photo_count = 7, overall_rating = 4.9, rating_count = 120 where id = $1`, [born.profileId]);

    // 2. The hiring salon types the same phone number
    const hirerTech = await roster(HIRER, BR_R, 'Mia Pham');
    const linked = await identity.attachToTechnician(mgrHirer, hirerTech, { fullName: 'Mia Pham', phone: '856-555-2001', email: null });
    expect(linked.linkedExistingProfile).toBe(true);
    expect(linked.profileId).toBe(born.profileId);
    expect(linked.membershipStatus).toBe('pending_tech_approval');

    // ── NOT LINKED YET. The roster row has her login (the salon's own employment data) but not her identity.
    const [row]: any = await h.q(`select user_id, global_tech_profile_id from technicians where id = $1`, [hirerTech]);
    expect(row.user_id).toBe(linked.userId);
    expect(row.global_tech_profile_id).toBeNull();

    // ── the hiring salon's manager view: "invitation pending", no portfolio, no rating
    const view: any = await profiles.posViewTechProfile(mgrHirer, hirerTech);
    expect(view.hasProfile).toBe(false);
    expect(view.invitationPending).toBe(true);
    expect(view.membershipHereStatus).toBe('pending_tech_approval');
    expect(JSON.stringify(view)).not.toContain('4.9');
    expect(view.photos).toBeUndefined();

    // ── and the hiring salon's public technician page does not list her
    expect((await profiles.customerSalonTechnicians(BR_R)).technicians).toEqual([]);

    // 3. She accepts (from her HOME session — the session that resolves to her profile)
    const [homeUser]: any = await h.q(`select user_id from technicians where id = $1`, [homeTech]);
    const techCtx: any = { tenantId: HOME, branchId: BR_H, userId: homeUser.user_id, role: 'TECHNICIAN', permissions: [] };
    const acc = await workplaces.accept(techCtx, linked.membershipId);
    expect(acc.status).toBe('active');

    // ── NOW it links — on HER roster row, not a second one
    const rows: any[] = await h.q(`select id, global_tech_profile_id, is_active from technicians where tenant_id = $1 and archived_at is null`, [HIRER]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(hirerTech);
    expect(rows[0].global_tech_profile_id).toBe(born.profileId);
    const after: any = await profiles.posViewTechProfile(mgrHirer, hirerTech);
    expect(after.hasProfile).toBe(true);
    expect(after.membershipHereStatus).toBe('active');
    expect((await profiles.customerSalonTechnicians(BR_R)).technicians.map((t: any) => t.technicianId)).toEqual([hirerTech]);
  });

  it('a DECLINED invitation never links, and the roster row stays a plain salon record', async () => {
    const homeTech = await roster(HOME, BR_H, 'Lena Vo');
    const born = await identity.attachToTechnician(mgrHome, homeTech, { fullName: 'Lena Vo', phone: '856-555-2002', email: null });
    const hirerTech = await roster(HIRER, BR_R, 'Lena Vo');
    const linked = await identity.attachToTechnician(mgrHirer, hirerTech, { fullName: 'Lena Vo', phone: '856-555-2002', email: null });
    const [homeUser]: any = await h.q(`select user_id from technicians where id = $1`, [homeTech]);
    await workplaces.decline({ tenantId: HOME, branchId: BR_H, userId: homeUser.user_id, role: 'TECHNICIAN', permissions: [] } as any, linked.membershipId);
    expect((await h.q(`select global_tech_profile_id from technicians where id = $1`, [hirerTech]))[0].global_tech_profile_id).toBeNull();
    expect((await h.q(`select status from tech_salon_memberships where id = $1`, [linked.membershipId]))[0].status).toBe('cancelled');
    expect(born.profileId).toBeTruthy();
  });
});
