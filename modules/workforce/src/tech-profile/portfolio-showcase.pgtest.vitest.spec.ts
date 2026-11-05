// portfolio-showcase.pgtest.vitest.spec.ts — Technician Profile mandate §46/§47 (wave 3 TECH): a technician shares an
// approved public portfolio photo into the Nail Showcase; the salon's showcase policy decides live-at-once vs review;
// the customer feed carries technician / salon attribution (Book This Look); she can take it back; a private or
// consent-blocked photo is refused; one live post per photo.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { GlobalTechIdentityService } from './global-tech-identity.service';
import { GlobalTechDirectory } from './global-tech-directory.kysely';
import { TechProfileService } from './tech-profile.service';
import { NailShowcaseService } from '../nail-showcase/nail-showcase.service';
import { KyselyNailShowcaseRepository } from '../nail-showcase/nail-showcase.kysely.repository';

const uuid = (p: string, s: string | number) => `${p.padEnd(8, '0')}-0000-4000-8000-${String(s).padStart(12, '0')}`;
const P = 'c7';
const A = uuid(P, 1), BR_A = uuid(P, 'b1'), MGR_A = uuid(P, 'f1'), CUST_USER = uuid(P, 'c1'), CUST = uuid(P, 'c2');
const mgrA: any = { tenantId: A, branchId: BR_A, userId: MGR_A, role: 'MANAGER', permissions: [] };
const custCtx: any = { tenantId: A, branchId: BR_A, userId: CUST_USER, role: 'CUSTOMER', permissions: [] };

let pg: any; let db: any; let profiles: TechProfileService; let showcase: NailShowcaseService;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  const identity = new GlobalTechIdentityService(db, new GlobalTechDirectory(db));
  profiles = new TechProfileService(db, null as any, undefined, identity);
  showcase = new NailShowcaseService(new KyselyNailShowcaseRepository(db));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Salon A','c7-a','C7A','active')`, [A]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [BR_A, A]);
  await q(`insert into users (id, tenant_id, branch_id, role, status, full_name) values ($1,$2,$3,'MANAGER','active','A Mgr'),($4,$2,$3,'CUSTOMER','active','Ann Customer')`, [MGR_A, A, BR_A, CUST_USER]);
  await q(`insert into customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,$4,'Ann','C','Ann C','+18565557001')`, [CUST, A, BR_A, CUST_USER]);
}, 180000);

describe('§46 portfolio → Nail Showcase', () => {
  it('share waits for the salon\'s review by default, is approved through the showcase\'s own moderation, shows attribution in the feed, and can be taken back', async () => {
    const tech = String((await q(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$2,'Mia','X','Mia Pham',true) returning id`, [A, BR_A]))[0].id);
    const born = await (profiles as any).identity.attachToTechnician(mgrA, tech, { fullName: 'Mia Pham', phone: '856-555-7001', email: null });
    const [u]: any = await q(`select user_id from technicians where id = $1`, [tech]);
    const me: any = { tenantId: A, branchId: BR_A, userId: u.user_id, role: 'TECHNICIAN', permissions: [] };
    const pub = String((await q(`insert into tech_portfolio_photos (global_tech_profile_id, image_url, thumbnail_url, caption, tags, is_public, moderation_status) values ($1,'global/tech-profiles/${born.profileId}/portfolio/a.jpg','global/tech-profiles/${born.profileId}/portfolio/a_t.jpg','Chrome French','["chrome"]',true,'approved') returning id`, [born.profileId]))[0].id);
    const priv = String((await q(`insert into tech_portfolio_photos (global_tech_profile_id, image_url, caption, is_public, moderation_status) values ($1,'global/tech-profiles/${born.profileId}/portfolio/b.jpg','Private one',false,'approved') returning id`, [born.profileId]))[0].id);

    // a private photo is refused
    await expect(profiles.sharePhotoToShowcase(me, priv)).rejects.toMatchObject({ code: 'invalid' });
    // share → pending review (the salon has no auto-publish policy)
    const r1 = await profiles.sharePhotoToShowcase(me, pub);
    expect(r1.status).toBe('pending_review'); expect(r1.already).toBe(false);
    expect((await profiles.sharePhotoToShowcase(me, pub)).already).toBe(true);     // one live post per photo
    const [post]: any = await q(`select id, post_type, technician_id, tenant_id, customer_id, display_name, visibility, portfolio_photo_id from nail_showcase_posts where portfolio_photo_id = $1 and deleted_at is null`, [pub]);
    expect(post.post_type).toBe('technician_portfolio'); expect(post.technician_id).toBe(tech); expect(post.tenant_id).toBe(A);
    expect(post.customer_id).toBe(u.user_id); expect(post.display_name).toBe('Mia Pham'); expect(post.visibility).toBe('public_platform');
    expect((await q(`select image_url from nail_showcase_photos where post_id = $1`, [post.id]))[0].image_url).toContain('/portfolio/a.jpg');
    // her own photo list says so
    const mine = await profiles.listMyPhotos(me);
    expect(mine.find((p: any) => p.photoId === pub)?.showcase).toEqual({ postId: String(post.id), status: 'pending_review' });
    // not in the customer feed yet
    const before = await showcase.feed(custCtx, { scope: 'salon', salonId: A, limit: 50 } as any);
    expect(before.posts.map((p: any) => p.id)).not.toContain(String(post.id));
    // the salon approves through the showcase's existing moderation
    expect((await showcase.approvePost({ ...mgrA } as any, String(post.id))).status).toBe('published');
    expect((await q(`select count(*)::int n from technician_notifications where technician_id = $1 and type = 'nail_showcase'`, [tech]))[0].n).toBe(1);
    const after = await showcase.feed(custCtx, { scope: 'salon', salonId: A, limit: 50 } as any);
    const item: any = after.posts.find((p: any) => p.id === String(post.id));
    expect(item).toBeTruthy();
    expect(item.technicianId).toBe(tech); expect(item.technicianName).toBe('Mia Pham'); expect(item.salonName).toBe('Salon A');   // §46: Technician · Salon → Book This Look
    expect(item.postType).toBe('technician_portfolio');
    // she takes it back
    expect((await profiles.unsharePhotoFromShowcase(me, pub)).removed).toBe(true);
    expect((await q(`select status, deleted_at from nail_showcase_posts where id = $1`, [post.id]))[0]).toMatchObject({ status: 'removed' });
    expect((await profiles.listMyPhotos(me)).find((p: any) => p.photoId === pub)?.showcase).toBeNull();
    expect((await profiles.unsharePhotoFromShowcase(me, pub)).removed).toBe(false);
    // and may share again (the unique index is partial on live posts)
    expect((await profiles.sharePhotoToShowcase(me, pub)).already).toBe(false);
  }, 90000);

  it('a salon with auto-publish goes live at once; a consent-blocked photo is refused', async () => {
    const tech = String((await q(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$2,'Lena','X','Lena Vo',true) returning id`, [A, BR_A]))[0].id);
    const born = await (profiles as any).identity.attachToTechnician(mgrA, tech, { fullName: 'Lena Vo', phone: '856-555-7002', email: null });
    const [u]: any = await q(`select user_id from technicians where id = $1`, [tech]);
    const me: any = { tenantId: A, branchId: BR_A, userId: u.user_id, role: 'TECHNICIAN', permissions: [] };
    await q(`insert into nail_showcase_tenant_policy (tenant_id, auto_publish_manual) values ($1, true) on conflict (tenant_id) do update set auto_publish_manual = true`, [A]);
    const ok = String((await q(`insert into tech_portfolio_photos (global_tech_profile_id, image_url, is_public, moderation_status) values ($1,'global/tech-profiles/${born.profileId}/portfolio/c.jpg',true,'approved') returning id`, [born.profileId]))[0].id);
    expect((await profiles.sharePhotoToShowcase(me, ok)).status).toBe('published');
    const blocked = String((await q(`insert into tech_portfolio_photos (global_tech_profile_id, image_url, is_public, moderation_status) values ($1,'global/tech-profiles/${born.profileId}/portfolio/d.jpg',true,'approved') returning id`, [born.profileId]))[0].id);
    await q(`insert into nail_photo_consent (photo_id, global_tech_profile_id, approved_uses, revoked, revoked_at, public_blocked) values ($1,$2,'["portfolio"]',true,now(),true)`, [blocked, born.profileId]);
    await expect(profiles.sharePhotoToShowcase(me, blocked)).rejects.toMatchObject({ code: 'invalid' });
  }, 60000);
});
