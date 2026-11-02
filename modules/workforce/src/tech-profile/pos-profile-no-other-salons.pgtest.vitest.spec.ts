// pos-profile-no-other-salons.pgtest.vitest.spec.ts — [ported from the Technician Profile package, Oct 12 2026] — PINNED: a manager's projection of a technician's portable
// profile carries THIS salon's membership and a COUNT of the others, never their names or tenant ids
// (TECHNICIAN_AUDIT P0 #12). The old `shape()` spread put every membership — salon name included — back into the
// payload the top-level `otherActiveSalonCount` was built to withhold.
//
// Also pins per-tenant moderation (migration 456): a manager's "hide" hides the photo on THIS salon's surfaces only;
// the global moderation_status is untouched, the other salon's page and the technician's public profile still show
// it, and the two portfolio counters agree (approved + public).
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

const P = 'ad';
const TA = uuid(P, 1), TB = uuid(P, 2), TC = uuid(P, 3);
const BA = uuid(P, 'b1'), BB = uuid(P, 'b2'), BC = uuid(P, 'b3');
const G = uuid(P, 'a1');
const T_A = uuid(P, 'd1'), T_B = uuid(P, 'd2'), T_C = uuid(P, 'd3');
const MGR_A = uuid(P, 'f1');
const PH1 = uuid(P, 'c1'), PH2 = uuid(P, 'c2'), PH3 = uuid(P, 'c3');
const ctxA: any = { tenantId: TA, branchId: BA, userId: MGR_A, role: 'MANAGER', permissions: [] };
const ctxB: any = { tenantId: TB, branchId: BB, userId: uuid(P, 'f2'), role: 'MANAGER', permissions: [] };

let h: Harness;
let svc: TechProfileService;

beforeAll(async () => {
  h = await bootPg();
  svc = new TechProfileService(h.db as any, null as any);
  await h.q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','Salon Alpha','ad-a','ADA'),($2,'B','SECRET Competitor Beta','ad-b','ADB'),($3,'C','SECRET Former Gamma','ad-c','ADC')`, [TA, TB, TC]);
  await h.q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'),($3,$4,'Main','active'),($5,$6,'Main','active')`, [BA, TA, BB, TB, BC, TC]);
  for (const t of [TA, TB]) await h.q(`insert into tenant_app_flags (tenant_id, flag_key, enabled) values ($1,'public_listing',true)`, [t]);
  await h.q(`insert into global_tech_profiles (id, tech_code, public_slug, display_name, is_public, status) values ($1,'AD1','ad-tech','Ad Tech',true,'active')`, [G]);
  await h.q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, global_tech_profile_id) values
    ($1,$4,$5,'Ad','Tech','Ad Tech',true,$7),($2,$6,$8,'Ad','Tech','Ad Tech',true,$7),($3,$9,$10,'Ad','Tech','Ad Tech',true,$7)`, [T_A, T_B, T_C, TA, BA, TB, G, BB, TC, BC]);
  await h.q(`insert into tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, technician_id, status) values ($1,$2,$3,$4,'active'),($1,$5,$6,$7,'active'),($1,$8,$9,$10,'former')`, [G, TA, BA, T_A, TB, BB, T_B, TC, BC, T_C]);
  await h.q(`insert into tech_portfolio_photos (id, global_tech_profile_id, image_url, thumbnail_url, moderation_status, is_public, is_featured) values
    ($2,$1,'/media/tech-profiles/g/portfolio/1.jpg','/media/tech-profiles/g/portfolio/1.jpg','approved',true,true),
    ($3,$1,'/media/tech-profiles/g/portfolio/2.jpg','/media/tech-profiles/g/portfolio/2.jpg','approved',true,false),
    ($4,$1,'/media/tech-profiles/g/portfolio/3.jpg','/media/tech-profiles/g/portfolio/3.jpg','approved',false,false)`, [G, PH1, PH2, PH3]);
}, 240000);

describe('posViewTechProfile — no other salons', () => {
  it('shows THIS salon\'s membership plus a count; the other salons\' names and ids are absent from the whole payload', async () => {
    const v: any = await svc.posViewTechProfile(ctxA, T_A);
    expect(v.hasProfile).toBe(true);
    expect(v.membershipHereStatus).toBe('active');
    expect(v.otherActiveSalonCount).toBe(1);                     // Beta is active; Gamma is former
    expect(v.profile.memberships).toHaveLength(1);
    expect(v.profile.memberships[0]).toMatchObject({ tenantId: TA, salonName: 'Salon Alpha', status: 'active' });
    const json = JSON.stringify(v);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain(TB);
    expect(json).not.toContain(TC);
  });
  it('the manager\'s photo list uses SIGNED urls (private media is not served openly) and flags per-salon hides', async () => {
    process.env.AUTH_SESSION_SECRET = 'ad-secret';
    const v: any = await svc.posViewTechProfile(ctxA, T_A);
    expect(v.photos).toHaveLength(3);
    for (const ph of v.photos) { expect(ph.imageUrl).toMatch(/^\/media\/tech-profiles\/g\/portfolio\/\d\.jpg\?exp=\d+&sig=/); expect(ph.hiddenHere).toBe(false); }
  });
});

describe('per-tenant portfolio moderation', () => {
  it('a hide at Salon A hides on A only; B and the public profile still show it; moderation_status is untouched', async () => {
    const r = await svc.posModeratePhoto(ctxA, T_A, PH1, 'hidden', 'not our style');
    expect(r).toMatchObject({ ok: true, photoId: PH1, hiddenHere: true });
    const [row]: any = await h.q(`select moderation_status, is_public from tech_portfolio_photos where id = $1`, [PH1]);
    expect(row.moderation_status).toBe('approved');            // GLOBAL state unchanged
    expect(row.is_public).toBe(true);

    const atA = await svc.customerSalonTechnicians(BA);
    const atB = await svc.customerSalonTechnicians(BB);
    expect(atA.technicians[0].featuredPortfolioPhotos).toEqual(['/media/tech-profiles/g/portfolio/2.jpg']);
    expect(atB.technicians[0].featuredPortfolioPhotos).toEqual(['/media/tech-profiles/g/portfolio/1.jpg', '/media/tech-profiles/g/portfolio/2.jpg']);
    const pub: any = await svc.customerPublicProfile({ userId: null } as any, 'ad-tech');
    expect(pub.portfolio.map((p: any) => p.photoId)).toEqual([PH1, PH2]);

    const vA: any = await svc.posViewTechProfile(ctxA, T_A);
    expect(vA.photos.find((p: any) => p.photoId === PH1)).toMatchObject({ hiddenHere: true, hiddenHereReason: 'not our style', moderationStatus: 'approved' });
    const vB: any = await svc.posViewTechProfile(ctxB, T_B);
    expect(vB.photos.find((p: any) => p.photoId === PH1).hiddenHere).toBe(false);
  });
  it('approve at Salon A lifts A\'s hide; "rejected" is also only a per-salon hide', async () => {
    await svc.posModeratePhoto(ctxA, T_A, PH1, 'approved');
    expect((await svc.customerSalonTechnicians(BA)).technicians[0].featuredPortfolioPhotos).toHaveLength(2);
    await svc.posModeratePhoto(ctxA, T_A, PH2, 'rejected');
    expect((await h.q(`select moderation_status from tech_portfolio_photos where id = $1`, [PH2]))[0].moderation_status).toBe('approved');
    expect((await svc.customerSalonTechnicians(BB)).technicians[0].featuredPortfolioPhotos).toHaveLength(2);
    await svc.posModeratePhoto(ctxA, T_A, PH2, 'approved');
  });
  it('a manager at another salon cannot moderate through a technician id that is not in their tenant', async () => {
    await expect(svc.posModeratePhoto(ctxB, T_A, PH1, 'hidden')).rejects.toMatchObject({ code: 'not_found' });
  });
  it('the portfolio counter is approved + PUBLIC, and every writer agrees', async () => {
    const count = async () => Number((await h.q(`select portfolio_photo_count from global_tech_profiles where id = $1`, [G]))[0].portfolio_photo_count);
    await svc.posModeratePhoto(ctxA, T_A, PH1, 'approved');      // triggers the refresh
    expect(await count()).toBe(2);                                // PH3 is approved but private → not counted
    await h.q(`update tech_portfolio_photos set is_public = true where id = $1`, [PH3]);
    await svc.posModeratePhoto(ctxA, T_A, PH1, 'approved');
    expect(await count()).toBe(3);
    await h.q(`update tech_portfolio_photos set is_public = false where id = $1`, [PH3]);
  });
});
