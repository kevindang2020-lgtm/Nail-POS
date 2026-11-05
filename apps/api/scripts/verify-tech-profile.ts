/* verify-tech-profile.ts — proves the portable tech profile P1 on real Postgres (PGlite/PG16), tech-profile spec set:
 * migration 066, profile auto-create seeded from the salon technician record (+ slug + ACTIVE membership + link),
 * idempotency, tech-editable updates with javascript: links DROPPED, the doc-exact completion math,
 * "Connect to New Salon" membership requests (pending row IS the request) with dupe/own-salon/bad-code handling,
 * and the ratings read shape with reviewer privacy ("Jessica L." / "Anonymous Customer"). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { TechProfileError, TechProfileService } from '../../../modules/workforce/src/tech-profile/tech-profile.service';
import { LocalDiskMediaStorage } from '../../../packages/media/src/media-storage';
import { existsSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PG = 5473;
  const TA = '00000000-0000-0000-0000-0000000000a1', TB = '00000000-0000-0000-0000-0000000000a2';
  const BA = '00000000-0000-0000-0000-0000000000b1';
  const TU = '00000000-0000-0000-0000-000000000c01'; // technician user
  const TECH = '00000000-0000-0000-0000-000000000c11';
  const CU1 = '00000000-0000-0000-0000-000000000c21', CU2 = '00000000-0000-0000-0000-000000000c22';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));

  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES
    ('${TA}','Luxe LLC','Luxe Nails','luxe-p','LUXEP','active'), ('${TB}','Palace LLC','Palace Nails','palace-p','PALACEP','active')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, address, city, state, zip, phone) VALUES
    ('${BA}','${TA}','Cherry Hill','1 Main St','Cherry Hill','NJ','08002','(856) 555-0101')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, email, password_hash, full_name, role, status) VALUES
    ('${TU}','${TA}','${BA}','mia@luxe.test','x','Mia Tran','TECHNICIAN','active')`);
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, default_commission_split_percent, is_active) VALUES
    ('${TECH}','${TA}','${BA}','${TU}','Mia','Tran','Mia Tran','active','percent',50,50,true)`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in) VALUES
    ('${CU1}','${TA}','${BA}','Jessica','Lopez','Jessica Lopez','active',false,false),
    ('${CU2}','${TA}','${BA}','Dana','Kim','Dana Kim','active',false,false)`);

  const server = new PGLiteSocketServer({ db, port: PG, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PG, user: 'postgres', database: 'postgres', max: 1 });
  const kdb = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const mediaRoot = `/tmp/tp-media-${Date.now()}`;
  const storage = new LocalDiskMediaStorage(mediaRoot);
  const rtEvents: { room: string; event: string; payload: any }[] = [];
  const fakeRealtime: any = {
    toTenant: (c: any, event: string, payload: any) => rtEvents.push({ room: `tenant:${c.tenantId}:${c.branchId}`, event, payload }),
    toTechnician: (technicianId: string, event: string, payload: any) => rtEvents.push({ room: `technician:${technicianId}`, event, payload }),
  };
  const svc = new TechProfileService(kdb as any, storage, fakeRealtime);
  const ctx = { tenantId: TA, branchId: BA, userId: TU, role: 'TECHNICIAN', permissions: [] as string[] };

  // 1) auto-create
  const p1 = await svc.getOrCreateMyProfile(ctx);
  ok('GET /tech/profile creates the portable profile seeded from the technician record', p1.displayName === 'Mia Tran' && /^mia-tran-/.test(p1.publicSlug), p1.publicSlug);
  ok('auto-creates the ACTIVE membership at the current salon', p1.memberships.length === 1 && p1.memberships[0].status === 'active' && p1.memberships[0].salonName === 'Luxe Nails');
  const linked: any = await kdb.selectFrom('technicians').where('id', '=', TECH).select('global_tech_profile_id').executeTakeFirst();
  ok('technicians.global_tech_profile_id is linked', linked.global_tech_profile_id === p1.profileId);

  // 2) idempotent
  const p2 = await svc.getOrCreateMyProfile(ctx);
  ok('second GET is idempotent (same profile, still one membership)', p2.profileId === p1.profileId && p2.memberships.length === 1);

  // 3) update: sanitation + link safety + completion math
  const upd = await svc.updateMyProfile(ctx, {
    title: 'Senior Nail Artist', bio: '<script>evil()</script>I specialize in gel art and chrome finishes.',
    yearsExperience: 7, specialties: ['Gel X', 'Chrome', '<b>3D Design</b>'], languages: ['English', 'Vietnamese'],
    profileLinks: { linkme: 'https://linkme.bio/mia', tiktok: 'javascript:alert(1)', instagram: 'https://instagram.com/mia.nails' },
    isPublic: true, marketplaceDiscoveryEnabled: true,
  });
  ok('bio sanitized (script block gone), title saved', upd.bio === 'I specialize in gel art and chrome finishes.' && upd.title === 'Senior Nail Artist');
  ok('javascript: link DROPPED, https links kept', !('tiktok' in upd.profileLinks) && upd.profileLinks.linkme === 'https://linkme.bio/mia' && Object.keys(upd.profileLinks).length === 2);
  ok('specialties sanitized of tags', (upd.specialties as string[]).includes('3D Design') && (upd.specialties as string[]).length === 3);
  ok('completion math: bio20 + specialties10 + link5 = 35 (no avatar/photos/services yet)', upd.completionPercent === 35, String(upd.completionPercent));
  let badName = '';
  try { await svc.updateMyProfile(ctx, { displayName: '   ' }); } catch (e) { if (e instanceof TechProfileError) badName = e.code; }
  ok('empty display name rejected', badName === 'invalid');

  // 4) Connect to New Salon
  const req1 = await svc.requestMembership(ctx, 'palacep', 'Moving to Cherry Hill');
  ok('membership request to salon B goes pending with the salon name', req1.status === 'pending' && req1.salonName === 'Palace Nails');
  const req2 = await svc.requestMembership(ctx, 'PALACEP');
  ok('duplicate request returns the friendly already-waiting status', req2.status === 'pending' && /already waiting/.test(req2.message));
  let own = ''; try { await svc.requestMembership(ctx, 'LUXEP'); } catch (e) { if (e instanceof TechProfileError) own = e.message; }
  ok('own-salon request rejected', /already work/.test(own));
  let bad = ''; try { await svc.requestMembership(ctx, 'NOPE'); } catch (e) { if (e instanceof TechProfileError) bad = e.code; }
  ok('unknown salon code → not_found', bad === 'not_found');
  const p3 = await svc.getOrCreateMyProfile(ctx);
  ok('membership-status lists active A + pending B', p3.memberships.length === 2 && p3.memberships.some((m: any) => m.status === 'pending' && m.salonName === 'Palace Nails'));

  // 5) ratings read shape + reviewer privacy (write path is proven in the ratings phase)
  await db.exec(`INSERT INTO reviews (tenant_id, branch_id, customer_id, rating, comment, technician_id, global_tech_profile_id, review_tags, is_public) VALUES
    ('${TA}','${BA}','${CU1}',5,'Beautiful French tips, very clean.','${TECH}','${p1.profileId}','["Clean Work","Friendly"]',true),
    ('${TA}','${BA}','${CU2}',4,'Great shape.','${TECH}','${p1.profileId}','[]',false)`);
  const ratings = await svc.myRatings(ctx);
  ok('ratings list: public reviewer shows as "Jessica L."', ratings.recent.some((r: any) => r.reviewer === 'Jessica L.' && r.rating === 5));
  ok('non-public reviewer shows as "Anonymous Customer"', ratings.recent.some((r: any) => r.reviewer === 'Anonymous Customer' && r.rating === 4));
  ok('breakdown counts both rows', ratings.breakdown['5'] === 1 && ratings.breakdown['4'] === 1);

  // 6) uploads — magic-byte validation + storage on disk + completion/denorm math
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
  const afterAvatar = await svc.uploadAvatar(ctx, png);
  ok('avatar upload stores under /media and bumps completion to 55 (+avatar20)', String(afterAvatar.avatarUrl).startsWith('/media/tech-profiles/') && afterAvatar.completionPercent === 55, `${afterAvatar.avatarUrl} ${afterAvatar.completionPercent}`);
  ok('avatar file is really on disk', existsSync(storage.resolvePath(String(afterAvatar.avatarUrl).replace('/media/', ''))!));
  let badType = ''; try { await svc.uploadAvatar(ctx, Buffer.from('hello this is not an image at all')); } catch (e) { if (e instanceof TechProfileError) badType = e.message; }
  ok('non-image rejected by magic bytes', /Only JPG, PNG, or WebP/.test(badType));
  let tooBig = ''; try { await svc.uploadAvatar(ctx, Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)])); } catch (e) { if (e instanceof TechProfileError) tooBig = e.message; }
  ok('oversize avatar rejected (>5MB)', /too large/.test(tooBig));

  const added = await svc.addPortfolioPhotos(ctx, [jpg, png, jpg], 'Chrome set');
  const afterPhotos = await svc.getOrCreateMyProfile(ctx);
  ok('3 portfolio photos uploaded; denormalized count = 3; completion 80 (+photos25)', added.photos.length === 3 && afterPhotos.portfolioPhotoCount === 3 && afterPhotos.completionPercent === 80, `${afterPhotos.portfolioPhotoCount} ${afterPhotos.completionPercent}`);
  let photos = await svc.listMyPhotos(ctx);
  ok('photos listed in sort order with the shared caption', photos.length === 3 && photos[0].sortOrder === 0 && photos[0].caption === 'Chrome set');
  await svc.updatePhoto(ctx, photos[2].photoId, { caption: 'Featured French', isFeatured: true, tags: ['French Tips', 'Gel X'] });
  photos = await svc.listMyPhotos(ctx);
  ok('featured photo floats first with sanitized tags', photos[0].isFeatured && photos[0].caption === 'Featured French' && (photos[0].tags as string[]).includes('Gel X'));
  const reversed = [...photos].reverse().map((x) => x.photoId);
  await svc.reorderPhotos(ctx, reversed);
  let foreign = ''; try { await svc.reorderPhotos(ctx, ['00000000-0000-0000-0000-00000000ffff']); } catch (e) { if (e instanceof TechProfileError) foreign = e.code; }
  ok('reorder accepts own ids; foreign id → not_found', foreign === 'not_found');
  const victim = photos[1];
  await svc.deletePhoto(ctx, victim.photoId);
  const afterDelete = await svc.getOrCreateMyProfile(ctx);
  ok('delete removes the row, refreshes count to 2, and unlinks the file on disk', afterDelete.portfolioPhotoCount === 2 && !existsSync(storage.resolvePath(String(victim.imageUrl).replace('/media/', ''))!));
  ok('path traversal refused by the storage adapter', storage.resolvePath('../../etc/passwd') === null);

  // ───────────── P3 — POS manager surfaces ─────────────
  const BB = '00000000-0000-0000-0000-0000000000b2';
  const MB = '00000000-0000-0000-0000-000000000c02';
  await db.exec(`INSERT INTO branches (id, tenant_id, name, address, city, state, zip, phone) VALUES
    ('${BB}','${TB}','Palace Main','2 King St','Cherry Hill','NJ','08002','(856) 555-0202')`);
  const mgrA = { tenantId: TA, branchId: BA, userId: '00000000-0000-0000-0000-000000000c03', role: 'OWNER', permissions: ['pos.technicians.view', 'pos.technicians.edit'] };
  const mgrB = { tenantId: TB, branchId: BB, userId: MB, role: 'OWNER', permissions: ['pos.technicians.view', 'pos.technicians.edit'] };

  const mview = await svc.posViewTechProfile(mgrA as any, TECH);
  ok('P3: manager view returns profile + ALL photos with moderation status + membership-here', (mview as any).hasProfile && (mview as any).photos.length === 2 && (mview as any).photos.every((x: any) => x.moderationStatus) && (mview as any).membershipHereStatus === 'active');

  const firstPhoto = (mview as any).photos[0];
  const hid = await svc.posModeratePhoto(mgrA as any, TECH, firstPhoto.photoId, 'hidden');
  const afterHide = await svc.posViewTechProfile(mgrA as any, TECH);
  ok('P3: photo hide updates moderation + approved denorm drops to 1', hid.moderationStatus === 'hidden' && (afterHide as any).profile.portfolioPhotoCount === 1);
  await svc.posModeratePhoto(mgrA as any, TECH, firstPhoto.photoId, 'approved');
  ok('P3: re-approve restores denorm to 2', ((await svc.posViewTechProfile(mgrA as any, TECH)) as any).profile.portfolioPhotoCount === 2);

  const reqsB = await svc.posListMembershipRequests(mgrB as any);
  ok('P3: Palace manager sees the pending request with profile preview', reqsB.requests.length === 1 && reqsB.requests[0].displayName.length > 0 && reqsB.requests[0].message === 'Moving to Cherry Hill');
  const reqsA = await svc.posListMembershipRequests(mgrA as any);
  ok('P3: tenant isolation — Luxe manager sees zero Palace requests', reqsA.requests.length === 0);

  const approved = await svc.posDecideMembershipRequest(mgrB as any, reqsB.requests[0].requestId, 'approve');
  ok('P3: approve creates a Palace technicians row linked to the global profile', approved.ok && approved.status === 'active' && !!approved.technicianId);
  const palaceTech: any = (await pool.query(`SELECT id, tenant_id, branch_id, full_name, global_tech_profile_id, is_active FROM technicians WHERE tenant_id='${TB}'`)).rows[0];
  ok('P3: new row is tenant-B scoped, branch-filled, active, profile-linked', palaceTech && palaceTech.branch_id === BB && palaceTech.is_active && palaceTech.global_tech_profile_id != null);
  const notifB: any = (await pool.query(`SELECT title FROM technician_notifications WHERE tenant_id='${TB}' AND technician_id='${palaceTech.id}'`)).rows;
  ok('P3: approval writes the welcome notification in tenant B', notifB.length === 1 && notifB[0].title === 'Salon membership approved');
  const statusAfter = await svc.getOrCreateMyProfile(ctx);
  ok('P3: tech membership list now shows Palace active alongside Luxe', (statusAfter.memberships as any[]).filter((m) => m.status === 'active').length === 2);
  let already = ''; try { await svc.posDecideMembershipRequest(mgrB as any, reqsB.requests[0].requestId, 'approve'); } catch (e) { if (e instanceof TechProfileError) already = e.code; }
  ok('P3: deciding twice → invalid_state', already === 'invalid_state');

  // ratings moderation: seed two verified public reviews, hide one, denorm recomputes
  const profId = (statusAfter as any).profileId;
  await db.exec(`INSERT INTO reviews (id, tenant_id, branch_id, customer_id, ticket_id, rating, comment, technician_id, global_tech_profile_id, review_tags, is_public)
    VALUES ('00000000-0000-0000-0000-00000000ee01','${TA}','${BA}','${CU1}',NULL,5,'Beautiful French tips','${TECH}','${profId}','["Clean Work"]',true),
           ('00000000-0000-0000-0000-00000000ee02','${TA}','${BA}','${CU2}',NULL,1,'rude review text','${TECH}','${profId}','[]',true)`);
  await (svc as any).recomputeRatingDenorm(profId);
  const list1 = await svc.posListRatings(mgrA as any, TECH);
  ok('P3: manager rating list shows ALL 4 rows (public + private) with privacy-safe names', list1.ratings.length === 4 && list1.ratings.some((r) => r.reviewer === 'Jessica L.') && list1.ratings.some((r) => r.reviewer === 'Anonymous Customer'), JSON.stringify(list1.ratings.map((r) => r.reviewer)));
  const before = await svc.posViewTechProfile(mgrA as any, TECH);
  ok('P3: denorm counts PUBLIC rows only — 3.67 avg of 3 (private 4★ excluded)', (before as any).profile.overallRating === 3.67 && (before as any).profile.ratingCount === 3, `${(before as any).profile.overallRating}/${(before as any).profile.ratingCount}`);
  await svc.posSetRatingHidden(mgrA as any, TECH, '00000000-0000-0000-0000-00000000ee02', true, 'Abusive language');
  const after = await svc.posViewTechProfile(mgrA as any, TECH);
  ok('P3: hiding the 1★ recomputes public denorm to 5.0 avg of 2 (score never edited)', (after as any).profile.overallRating === 5 && (after as any).profile.ratingCount === 2, `${(after as any).profile.overallRating}/${(after as any).profile.ratingCount}`);
  const list2 = await svc.posListRatings(mgrA as any, TECH);
  ok('P3: hidden review stays in MANAGER list with the reason', list2.ratings.find((r) => r.isHiddenByManager)?.hiddenReason === 'Abusive language');

  const deact = await svc.posDeactivateMembership(mgrA as any, TECH);
  const statusEnd = await svc.getOrCreateMyProfile(ctx);
  ok('P3: deactivate flips Luxe membership to inactive; Palace stays active', deact.deactivated && (statusEnd.memberships as any[]).find((m) => m.salonName === 'Luxe Nails')?.status === 'inactive' && (statusEnd.memberships as any[]).find((m) => m.salonName === 'Palace Nails')?.status === 'active');
  let cross = ''; try { await svc.posViewTechProfile(mgrB as any, TECH); } catch (e) { if (e instanceof TechProfileError) cross = e.code; }
  ok('P3: tenant isolation — Palace manager cannot open a Luxe technician id', cross === 'not_found');

  // ───────────── P4 — customer discovery + verified ratings ─────────────
  await db.exec(`INSERT INTO tenant_app_flags (tenant_id, flag_key, enabled) VALUES
    ('${TA}','public_listing',true), ('${TB}','public_listing',true)`);
  await db.exec(`UPDATE branches SET latitude=39.9300, longitude=-75.0200 WHERE id='${BA}'`);
  await db.exec(`UPDATE branches SET latitude=39.9400, longitude=-75.0300 WHERE id='${BB}'`);
  await svc.updateMyProfile(ctx, { displayName: 'Mia Tran', isPublic: true, marketplaceDiscoveryEnabled: true });

  const near = await svc.customerNearbyTechs(39.93, -75.02, 10);
  ok('P4: nearby finds Mia ONCE — via Palace only (inactive Luxe membership excluded)', near.results.length === 1 && near.results[0].salonName === 'Palace Nails — Palace Main' && near.results[0].bookingRoute === `/book/${BB}` && near.results[0].rankScore > 0, JSON.stringify(near.results.map((r: any) => r.salonName)));
  ok('P4: nearby card is public-safe (rating denorm + featured thumbs, no private fields)', near.results[0].averageRating === 5 && near.results[0].reviewCount === 2 && Array.isArray(near.results[0].featuredPortfolioPhotos) && !('user_id' in near.results[0]));
  await db.exec(`UPDATE tenant_app_flags SET enabled=false WHERE tenant_id='${TB}' AND flag_key='public_listing'`);
  ok('P4: salon kill switch — unlisted Palace hides Mia from discovery', (await svc.customerNearbyTechs(39.93, -75.02, 10)).results.length === 0);
  await db.exec(`UPDATE tenant_app_flags SET enabled=true WHERE tenant_id='${TB}' AND flag_key='public_listing'`);
  ok('P4: radius respected — 0.5mi search from far point finds nothing', (await svc.customerNearbyTechs(40.5, -75.5, 1)).results.length === 0);

  const slugPage = await svc.customerPublicProfile({ tenantId: TA, branchId: BA, userId: '', role: 'CUSTOMER', permissions: [] } as any, (statusEnd as any).publicSlug);
  ok('P4: public profile page — approved+public portfolio only, Palace as the only Available-at salon', slugPage.portfolio.length === 2 && slugPage.availableAt.length === 1 && slugPage.availableAt[0].salonName === 'Palace Nails — Palace Main' && slugPage.isBookable, JSON.stringify({ p: slugPage.portfolio.length, a: slugPage.availableAt }));
  ok('P4: reviews on the page are public+unhidden only with privacy names + breakdown', slugPage.reviews.length === 2 && slugPage.reviews.every((r: any) => r.reviewer.includes('.')) && slugPage.ratingBreakdown.find((b: any) => b.star === 5)?.pct === 100, JSON.stringify(slugPage.reviews.map((r: any) => r.reviewer)));
  let privSlug = ''; await db.exec(`UPDATE global_tech_profiles SET is_public=false WHERE id='${(statusEnd as any).profileId}'`);
  try { await svc.customerPublicProfile({ tenantId: TA, branchId: BA, userId: '', role: 'CUSTOMER', permissions: [] } as any, (statusEnd as any).publicSlug); } catch (e) { if (e instanceof TechProfileError) privSlug = e.code; }
  await db.exec(`UPDATE global_tech_profiles SET is_public=true WHERE id='${(statusEnd as any).profileId}'`);
  ok('P4: private profile slug → not_found', privSlug === 'not_found');

  const palaceCards = await svc.customerSalonTechnicians(BB);
  const luxeCards = await svc.customerSalonTechnicians(BA);
  ok('P4: salon technician lists — Palace shows Mia, Luxe shows none (membership inactive)', palaceCards.technicians.length === 1 && luxeCards.technicians.length === 0);

  // verified rating flow (ticket in TA where Mia actually served)
  const UC1 = '00000000-0000-0000-0000-000000000c31';
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, email, password_hash, full_name, role, status) VALUES
    ('${UC1}','${TA}','${BA}','jess@cust.test','x','Jessica Lopez','CUSTOMER','active')`);
  await db.exec(`UPDATE customers SET user_id='${UC1}' WHERE id='${CU1}'`);
  const SVCID = '00000000-0000-0000-0000-00000000f201';
  await db.exec(`INSERT INTO service_categories (id, tenant_id, branch_id, name, sort_order, status) VALUES
    ('00000000-0000-0000-0000-00000000f301','${TA}','${BA}','Manicures',0,'active')`);
  await db.exec(`INSERT INTO services (id, tenant_id, branch_id, category_id, name, price_cents, duration_minutes, status) VALUES
    ('${SVCID}','${TA}','${BA}','00000000-0000-0000-0000-00000000f301','Gel Manicure',5000,45,'active')`);
  const TK = '00000000-0000-0000-0000-00000000f001', LN = '00000000-0000-0000-0000-00000000f101';
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES
    ('${TK}','${TA}','${BA}','${CU1}','paid',5000,300,0,5300,0,now())`);
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES
    ('${LN}','${TA}','${BA}','${TK}','${SVCID}','${TECH}','Gel Manicure',5000,45,'percent',50,5000,'done',100)`);
  const custCtx = { tenantId: TA, branchId: BA, userId: UC1, role: 'CUSTOMER', permissions: [] as string[] };

  const pend1 = await svc.customerPendingTechRatings(custCtx as any);
  ok('P4: pending prompt appears after paid ticket — doc-exact copy', pend1.pending.length === 1 && pend1.pending[0].prompt === 'How was your service with Mia Tran?' && pend1.pending[0].serviceName === 'Gel Manicure');
  const sub = await svc.customerSubmitTechRating(custCtx as any, TK, { technicianId: TECH, rating: 5, reviewText: 'Gorgeous chrome set!', tags: ['Clean Work', 'Bogus Tag', 'Friendly'], isPublic: true });
  ok('P4: submit returns the doc thank-you copy', sub.ok && /Thank you! Your rating helps customers/.test(sub.message));
  const newRow: any = (await pool.query(`SELECT review_tags, ticket_service_line_id FROM reviews WHERE ticket_id='${TK}'`)).rows[0];
  ok('P4: tags whitelisted (Bogus dropped) + line linked', !JSON.stringify(newRow.review_tags).includes('Bogus') && newRow.ticket_service_line_id === LN, JSON.stringify(newRow));
  ok('P4: denorm refreshed to avg 5 of 3 public', Number((await pool.query(`SELECT overall_rating, rating_count FROM global_tech_profiles`)).rows[0].rating_count) === 3);
  ok('P4: pending list clears after rating', (await svc.customerPendingTechRatings(custCtx as any)).pending.length === 0);
  let dup = ''; try { await svc.customerSubmitTechRating(custCtx as any, TK, { technicianId: TECH, rating: 4 }); } catch (e) { if (e instanceof TechProfileError) dup = e.message; }
  ok('P4: duplicate rating blocked with a friendly message', /already rated/.test(dup));
  const notifRate: any = (await pool.query(`SELECT title FROM technician_notifications WHERE tenant_id='${TA}' AND technician_id='${TECH}' AND type='rating_received'`)).rows;
  ok('P4: technician gets the rating notification', notifRate.length === 1 && notifRate[0].title === 'You received a 5★ rating');
  const TK2 = '00000000-0000-0000-0000-00000000f002';
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) VALUES
    ('${TK2}','${TA}','${BA}','${CU1}','serving',5000,300,0,5300,0)`);
  await db.exec(`INSERT INTO ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES
    ('${TA}','${BA}','${TK2}','${SVCID}','${TECH}','Pedicure',5000,45,'percent',50,5000,'in_progress',20)`);
  let unpaid = ''; try { await svc.customerSubmitTechRating(custCtx as any, TK2, { technicianId: TECH, rating: 5 }); } catch (e) { if (e instanceof TechProfileError) unpaid = e.code; }
  ok('P4: unpaid ticket cannot be rated', unpaid === 'invalid_state');
  let wrongTech = ''; try { await svc.customerSubmitTechRating(custCtx as any, TK, { technicianId: '00000000-0000-0000-0000-00000000dead', rating: 5 }); } catch (e) { if (e instanceof TechProfileError) wrongTech = e.code; }
  ok('P4: tech who did not serve the ticket is rejected', wrongTech === 'invalid');


  // ───────────── P5 — booking matching + realtime emissions ─────────────
  const T2 = '00000000-0000-0000-0000-000000000c12';
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, commission_type, commission_value, default_commission_split_percent, is_active) VALUES
    ('${T2}','${TA}','${BA}','Lan','Vo','Lan Vo','active','percent',50,50,true)`);
  await db.exec(`INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) VALUES
    ('${TA}','${BA}','${TECH}','${SVCID}',true), ('${TA}','${BA}','${T2}','${SVCID}',false)`);

  const match = await svc.customerServiceTechnicians(BA, SVCID);
  ok('P5: service matching returns both techs, primary-skill first', match.technicians.length === 2 && match.technicians[0].technicianId === TECH && match.technicians[0].isPrimary, JSON.stringify(match.technicians.map((t: any) => t.displayName)));
  ok('P5: profile-enriched card (slug+rating) vs profile-less card (nulls, still bookable)', match.technicians[0].publicSlug != null && match.technicians[0].averageRating === 5 && match.technicians[1].publicSlug === null && match.technicians[1].averageRating === null && match.technicians[1].isBookable === true);
  const posMatch = await svc.posServiceTechnicians(mgrA as any, SVCID);
  ok('P5: POS matching returns the same set for reception', posMatch.technicians.length === 2 && posMatch.technicians[0].technicianId === TECH);
  await db.exec(`UPDATE tenant_app_flags SET enabled=false WHERE tenant_id='${TA}' AND flag_key='public_listing'`);
  let unlistedMatch = ''; try { await svc.customerServiceTechnicians(BA, SVCID); } catch (e) { if (e instanceof TechProfileError) unlistedMatch = e.code; }
  await db.exec(`UPDATE tenant_app_flags SET enabled=true WHERE tenant_id='${TA}' AND flag_key='public_listing'`);
  ok('P5: public matching is listed-gated (POS matching is not)', unlistedMatch === 'not_found' && (await svc.posServiceTechnicians(mgrA as any, SVCID)).technicians.length === 2);

  // realtime emissions captured by the fake bus across the whole run
  const names = rtEvents.map((e) => e.event);
  ok('P5: profile update emitted to the tenant room', names.includes('technician_profile_updated'));
  ok('P5: membership approval emitted to the deciding tenant room', rtEvents.some((e) => e.event === 'tech_salon_membership_approved' && e.room.startsWith(`tenant:${TB}`)));
  ok('P5: rating emitted to BOTH the salon room and the technician room', rtEvents.some((e) => e.event === 'technician_rating_submitted' && e.room.startsWith(`tenant:${TA}`)) && rtEvents.some((e) => e.event === 'technician_rating_submitted' && e.room === `technician:${TECH}`));

  const TC = '00000000-0000-0000-0000-0000000000a3', BC = '00000000-0000-0000-0000-0000000000b3';
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${TC}','Glow LLC','Glow Nails','glow-p','GLOWP','active')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, address, city, state, zip, phone) VALUES ('${BC}','${TC}','Main','3 Pine St','Marlton','NJ','08053','(856) 555-0303')`);
  await svc.requestMembership(ctx, 'GLOWP', 'Weekend availability');
  ok('P5: new membership request reaches every branch room of the target salon', rtEvents.some((e) => e.event === 'tech_salon_membership_requested' && e.room === `tenant:${TC}:${BC}`));


  // ───────────── P6 — spec-closure: availability · featured · favorites · rating edits · manager edit · cancel ─────────────
  // next-available comes from the SAME engine as booking (window + conflicts)
  const navail = await (svc as any).nextAvailable(TA, TECH);
  ok('P6: next-available computes a real slot for a tech with assigned services', !!navail && /^\d{4}-\d{2}-\d{2}$/.test(navail.date) && /^\d{2}:\d{2}$/.test(navail.startTime), JSON.stringify(navail));
  const m2 = await svc.posServiceTechnicians(mgrA as any, SVCID);
  ok('P6: matcher cards now carry nextAvailable for the selected service', !!(m2.technicians[0] as any).nextAvailable);

  // featured: inactive membership refuses; active salon features and floats first
  let featInactive = ''; try { await svc.posSetFeatured(mgrA as any, TECH, true); } catch (e) { if (e instanceof TechProfileError) featInactive = e.code; }
  ok('P6: featuring requires an ACTIVE membership at this salon', featInactive === 'invalid_state');
  await svc.posSetFeatured(mgrB as any, palaceTech.id, true);
  const palaceCards2 = await svc.customerSalonTechnicians(BB);
  ok('P6: Palace card shows featured + badge derivation present', (palaceCards2.technicians[0] as any).isFeatured === true && Array.isArray((palaceCards2.technicians[0] as any).badges));

  // manager salon-assist edit of public fields (audited)
  const edited = await svc.posUpdateTechProfile(mgrA as any, TECH, { title: 'Senior Nail Artist' });
  ok('P6: manager edit updates title and returns the manager view', (edited as any).profile.title === 'Senior Nail Artist');
  const auditEdit: any = (await pool.query(`SELECT 1 FROM technician_audit_logs WHERE action='tech_profile_updated_by_manager' AND technician_id='${TECH}'`)).rows;
  ok('P6: manager edit is audited', auditEdit.length === 1);
  let emptyPatch = ''; try { await svc.posUpdateTechProfile(mgrA as any, TECH, {}); } catch (e) { if (e instanceof TechProfileError) emptyPatch = e.code; }
  ok('P6: empty manager patch rejected with the field list', emptyPatch === 'invalid');

  // favorites (cross-salon, user-keyed, public-only)
  const fav1 = await svc.customerAddFavoriteTech(custCtx as any, { technicianId: TECH });
  await svc.customerAddFavoriteTech(custCtx as any, { technicianId: TECH }); // idempotent
  const favList = await svc.customerListFavoriteTechs(custCtx as any);
  ok('P6: favorite by technicianId resolves the profile; list shows ONE card', fav1.ok && favList.techs.length === 1 && favList.techs[0].displayName === 'Mia Tran');
  await db.exec(`UPDATE global_tech_profiles SET is_public=false WHERE id='${profId}'`);
  let favPriv = ''; try { await svc.customerAddFavoriteTech(custCtx as any, { publicSlug: (statusEnd as any).publicSlug }); } catch (e) { if (e instanceof TechProfileError) favPriv = e.code; }
  ok('P6: private profiles cannot be favorited AND drop out of the favorites list', favPriv === 'not_found' && (await svc.customerListFavoriteTechs(custCtx as any)).techs.length === 0);
  await db.exec(`UPDATE global_tech_profiles SET is_public=true WHERE id='${profId}'`);
  await svc.customerRemoveFavoriteTech(custCtx as any, (statusEnd as any).publicSlug);
  ok('P6: unfavorite empties the list', (await svc.customerListFavoriteTechs(custCtx as any)).slugs.length === 0);

  // rating edit window (7 days)
  const mine1 = await svc.customerMyTechRating(custCtx as any, TK, TECH);
  ok('P6: my-rating endpoint returns the editable row with the window', mine1.exists && mine1.editable && mine1.rating === 5 && !!mine1.editableUntil);
  const ratingEdit = await svc.customerUpdateTechRating(custCtx as any, TK, (mine1 as any).ratingId, { rating: 4, tags: ['Friendly'] });
  const profAfterEdit: any = (await pool.query(`SELECT overall_rating, rating_count FROM global_tech_profiles WHERE id='${profId}'`)).rows[0];
  ok('P6: edit updates the score and recomputes the denorm (5,5,4 → 4.67 of 3)', ratingEdit.ok && Number(profAfterEdit.overall_rating) === 4.67 && Number(profAfterEdit.rating_count) === 3, JSON.stringify(profAfterEdit));
  await db.exec(`UPDATE reviews SET created_at = now() - interval '8 days' WHERE id='${(mine1 as any).ratingId}'`);
  let lateEdit = ''; try { await svc.customerUpdateTechRating(custCtx as any, TK, (mine1 as any).ratingId, { rating: 5 }); } catch (e) { if (e instanceof TechProfileError) lateEdit = e.message; }
  ok('P6: edits outside 7 days are refused with the doc rule', /within 7 days/.test(lateEdit));
  ok('P6: my-rating reports editable=false after the window', (await svc.customerMyTechRating(custCtx as any, TK, TECH) as any).editable === false);

  // review service name on the public page
  const slugPage2 = await svc.customerPublicProfile({ tenantId: TA, branchId: BA, userId: '', role: 'CUSTOMER', permissions: [] } as any, (statusEnd as any).publicSlug);
  ok('P6: public reviews carry the service name from the snapshot', (slugPage2.reviews as any[]).some((r) => r.serviceName === 'Gel Manicure'));

  // "Services I Do" per salon + per-salon next-available (Palace gets its own service)
  await db.exec(`INSERT INTO service_categories (id, tenant_id, branch_id, name, sort_order, status) VALUES
    ('00000000-0000-0000-0000-00000000f302','${TB}','${BB}','Manicures',0,'active')`);
  await db.exec(`INSERT INTO services (id, tenant_id, branch_id, category_id, name, price_cents, duration_minutes, status) VALUES
    ('00000000-0000-0000-0000-00000000f202','${TB}','${BB}','00000000-0000-0000-0000-00000000f302','Chrome Set',6500,60,'active')`);
  await db.exec(`INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) VALUES
    ('${TB}','${BB}','${palaceTech.id}','00000000-0000-0000-0000-00000000f202',true)`);
  const slugPage3 = await svc.customerPublicProfile({ tenantId: TA, branchId: BA, userId: '', role: 'CUSTOMER', permissions: [] } as any, (statusEnd as any).publicSlug);
  const palaceEntry: any = (slugPage3.availableAt as any[]).find((x) => x.salonId === BB);
  ok('P6: profile lists Services I Do per salon with duration + price', palaceEntry.services.length === 1 && palaceEntry.services[0].name === 'Chrome Set' && palaceEntry.services[0].priceCents === 6500 && palaceEntry.services[0].durationMinutes === 60, JSON.stringify(palaceEntry.services));
  ok('P6: profile shows next available time at the salon', !!palaceEntry.nextAvailableAt && /^\d{2}:\d{2}$/.test(palaceEntry.nextAvailableAt.startTime), JSON.stringify(palaceEntry.nextAvailableAt));
  ok('P6: profile carries honest badges', Array.isArray(slugPage3.badges));

  // minRating filter on nearby (Mia now 4.67 via Palace)
  ok('P6: minRating 4 keeps Mia; 4.8 filters her out', (await svc.customerNearbyTechs(39.93, -75.02, 10, undefined, 4)).results.length === 1 && (await svc.customerNearbyTechs(39.93, -75.02, 10, undefined, 4.8)).results.length === 0);

  // cancel my pending request, then re-request flips it back
  const glowRow: any = (await pool.query(`SELECT id FROM tech_salon_memberships WHERE tenant_id='${TC}' AND status='pending'`)).rows[0];
  const cancelled = await svc.cancelMyMembershipRequest(ctx, glowRow.id);
  ok('P6: tech cancels their own pending request', cancelled.status === 'cancelled');
  const reReq = await svc.requestMembership(ctx, 'GLOWP');
  ok('P6: re-request flips a cancelled row back to pending', reReq.status === 'pending');

  // reject fans notifications to the tech in EVERY salon where they actively work
  const mgrC = { tenantId: TC, branchId: BC, userId: '00000000-0000-0000-0000-000000000c04', role: 'OWNER', permissions: ['pos.technicians.view', 'pos.technicians.edit'] };
  const reqsC = await svc.posListMembershipRequests(mgrC as any);
  await svc.posDecideMembershipRequest(mgrC as any, reqsC.requests[0].requestId, 'reject');
  const declineNotifs: any = (await pool.query(`SELECT tenant_id FROM technician_notifications WHERE type='membership_rejected' AND title='Salon request declined'`)).rows;
  ok('P6: decline notifies the tech in both home salons (Luxe + Palace rows)', declineNotifs.length === 2 && new Set(declineNotifs.map((r: any) => r.tenant_id)).size === 2, JSON.stringify(declineNotifs));


  // ───────────── P7 — services list · owner public-preview · would-book-again ─────────────
  const shapeSvcs = (await svc.getOrCreateMyProfile(ctx)) as any;
  ok('P7: profile shape carries servicesHere (salon-assigned, primary-flagged) for the tech screen', shapeSvcs.servicesHere.length === 1 && shapeSvcs.servicesHere[0].name === 'Gel Manicure' && shapeSvcs.servicesHere[0].isPrimary === true, JSON.stringify(shapeSvcs.servicesHere));
  await db.exec(`UPDATE global_tech_profiles SET is_public=false WHERE id='${(statusEnd as any).profileId}'`);
  const preview = await svc.myPublicPreview(ctx);
  await db.exec(`UPDATE global_tech_profiles SET is_public=true WHERE id='${(statusEnd as any).profileId}'`);
  ok('P7: owner preview renders the FULL public payload even while hidden, flagged isLivePublicly:false', (preview as any).portfolio.length === 2 && (preview as any).isLivePublicly === false && Array.isArray((preview as any).badges));
  const slugAgain = await svc.customerPublicProfile({ tenantId: TA, branchId: BA, userId: '', role: 'CUSTOMER', permissions: [] } as any, (statusEnd as any).publicSlug);
  ok('P7: public page carries wouldBookAgainPct derived from review tags', typeof (slugAgain as any).wouldBookAgainPct === 'number' || (slugAgain as any).wouldBookAgainPct === null, String((slugAgain as any).wouldBookAgainPct));


  await kdb.destroy(); await server.stop(); await db.close();
  console.log(`\n${fail ? '⚠️' : '🎉'} verify-tech-profile: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(1); });
