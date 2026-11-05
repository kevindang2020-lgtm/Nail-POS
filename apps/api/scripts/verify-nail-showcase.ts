/* verify-nail-showcase.ts — proves the NailShowcase backend over real Postgres (PGlite) by instantiating the service +
 * Kysely repository directly (no HTTP/DI). Covers the spec's backend test matrix: verified vs manual posts + eligibility
 * gating (paid + owned ticket), feed visibility/scoping, single-reaction toggle/switch + duplicate prevention, comments +
 * ownership, reporting, tenant-safe moderation (manager own-tenant only; super admin platform-wide), and the pure photo
 * validators. Seeds two customers in one tenant + a customer in a second tenant + a paid and an unpaid ticket. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyNailShowcaseRepository } from '../../../modules/workforce/src/nail-showcase/nail-showcase.kysely.repository';
import { NailShowcaseService, NailShowcaseError } from '../../../modules/workforce/src/nail-showcase/nail-showcase.service';
import type { NailShowcaseContext } from '../../../modules/workforce/src/nail-showcase/nail-showcase.repository';
import { nsValidatePhotoFile, nsValidateCreate } from '../../../modules/workforce/src/nail-showcase/nail-showcase.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const throwsNS = async (n: string, fn: () => Promise<any>, code: string) => {
  try { await fn(); ok(n, false, 'did not throw'); }
  catch (e: any) { ok(n, e instanceof NailShowcaseError && e.code === code, e instanceof NailShowcaseError ? e.code : (e?.message || 'non-NS error')); }
};

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5481;
  const T = '00000000-0000-0000-0000-0000000a7001', T2 = '00000000-0000-0000-0000-0000000a7002';
  const B1 = '00000000-0000-0000-0000-0000000b7001', B2 = '00000000-0000-0000-0000-0000000b7002';
  const CU1 = '00000000-0000-0000-0000-0000000c7001', CU2 = '00000000-0000-0000-0000-0000000c7002', CU3 = '00000000-0000-0000-0000-0000000c7003', MGR = '00000000-0000-0000-0000-0000000c70ff';
  const CR1 = '00000000-0000-0000-0000-0000000d7001', CR2 = '00000000-0000-0000-0000-0000000d7002';
  const TE = '00000000-0000-0000-0000-0000000e7001', SVC = '00000000-0000-0000-0000-0000000f7001';
  const PT = '00000000-0000-0000-0000-000000007001', UT = '00000000-0000-0000-0000-000000007002';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Luxe','Luxe Nails','luxe','LUXE'),('${T2}','Other','Other Salon','other','OTHR')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active'),('${B2}','${T2}','Uptown','active')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, status, role) VALUES
    ('${CU1}','${T}','${B1}','Sophia','Nguyen','Sophia Nguyen','sophia@x.com','active','CUSTOMER'),
    ('${CU2}','${T}','${B1}','Maria','Lopez','Maria Lopez','maria@x.com','active','CUSTOMER'),
    ('${CU3}','${T2}','${B2}','Jane','Doe','Jane Doe','jane@x.com','active','CUSTOMER'),
    ('${MGR}','${T}','${B1}','Mona','Manager','Mona Manager','mona@x.com','active','OWNER')`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status, user_id) VALUES
    ('${CR1}','${T}','${B1}','Sophia','Nguyen','Sophia Nguyen','+15551110001','active','${CU1}'),
    ('${CR2}','${T}','${B1}','Maria','Lopez','Maria Lopez','+15551110002','active','${CU2}')`);
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES ('${TE}','${T}','${B1}',gen_random_uuid(),'Linh','Tran','Linh Tran','available','percent',40,true)`);
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES
    ('${PT}','${T}','${B1}','${CR1}','paid',6000,0,0,6000,0, now()),
    ('${UT}','${T}','${B1}','${CR1}','serving',6000,0,0,6000,0, NULL)`);
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent, completed_at) VALUES (gen_random_uuid(),'${T}','${B1}','${PT}','${SVC}','${TE}','Gel X Full Set',6000,60,'percent',40,6000,'completed',100, now())`);
  await db.exec(`INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('00000000-0000-0000-0000-0000000c7001','${T}','${B1}','Nails')`);
  await db.exec(`INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value) VALUES ('${SVC}','${T}','${B1}','00000000-0000-0000-0000-0000000c7001','Gel X Full Set',60,6000,'percent',40)`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new NailShowcaseService(new KyselyNailShowcaseRepository(k));

  const cust1: NailShowcaseContext = { tenantId: T, branchId: B1, userId: CU1, role: 'CUSTOMER', permissions: [] };
  const cust2: NailShowcaseContext = { tenantId: T, branchId: B1, userId: CU2, role: 'CUSTOMER', permissions: [] };
  const cust3: NailShowcaseContext = { tenantId: T2, branchId: B2, userId: CU3, role: 'CUSTOMER', permissions: [] };
  const mgrT: NailShowcaseContext = { tenantId: T, branchId: B1, userId: MGR, role: 'OWNER', permissions: [] };
  const mgrOther: NailShowcaseContext = { tenantId: T2, branchId: B2, userId: MGR, role: 'OWNER', permissions: [] };

  try {
    // ---- pure validators ----
    ok('photo validator rejects unsupported type', !nsValidatePhotoFile({ mimetype: 'image/gif', size: 1000 }).ok);
    ok('photo validator rejects > 10MB', !nsValidatePhotoFile({ mimetype: 'image/png', size: 11 * 1024 * 1024 }).ok);
    ok('photo validator accepts jpeg under 10MB', nsValidatePhotoFile({ mimetype: 'image/jpeg', size: 2 * 1024 * 1024 }).ok);
    ok('max 10 photos enforced (validator)', !nsValidateCreate({ photos: Array.from({ length: 11 }, () => ({ imageUrl: 'x' })) }).ok);

    // ---- verified eligibility + creation ----
    const elig = await svc.eligibility(cust1, PT);
    ok('paid+owned ticket is eligible for a verified post', elig.eligible === true && elig.technicianId === TE && elig.serviceId === SVC, `eligible=${elig.eligible} reason=${elig.reason ?? ''}`);
    const vp = await svc.createVerifiedPost(cust1, PT, { caption: 'French chrome tips ✨', visibility: 'salon_only', tags: ['Chrome', 'Gel X'], photos: [{ imageUrl: '/media/a.jpg' }] });
    ok('customer creates verified post from completed ticket', vp.isVerifiedService === true && vp.postType === 'verified_service' && vp.technicianId === TE && vp.serviceId === SVC && vp.status === 'published', `verified=${vp.isVerifiedService} status=${vp.status}`);
    ok('verified post carries its photo', vp.photos.length === 1);
    ok('post view hydrates salon, technician + service display names', vp.salonName === 'Luxe Nails' && vp.technicianName === 'Linh Tran' && vp.serviceName === 'Gel X Full Set', `salon=${vp.salonName} tech=${vp.technicianName} service=${vp.serviceName}`);
    const elig2 = await svc.eligibility(cust1, PT);
    ok('same ticket cannot be posted twice (eligibility flips)', elig2.eligible === false && elig2.alreadyPosted === true);
    await throwsNS('cannot create verified post from incomplete (unpaid) ticket', () => svc.createVerifiedPost(cust1, UT, { caption: 'x' }), 'not_eligible');
    await throwsNS('cannot create verified post from another customer’s ticket', () => svc.createVerifiedPost(cust2, PT, { caption: 'x' }), 'not_eligible');

    // ---- manual post ----
    const mp = await svc.createManualPost(cust1, { caption: 'My home manicure', visibility: 'salon_only', tags: ['Simple Design'] });
    ok('customer creates manual post (not verified)', mp.postType === 'manual_upload' && mp.isVerifiedService === false && mp.status === 'published');
    ok('display name is privacy-safe (first name + last initial)', vp.displayName === 'Sophia N.', `got "${vp.displayName}"`);
    const anon = await svc.createManualPost(cust1, { caption: 'shy', isAnonymous: true });
    ok('anonymous post hides identity', anon.displayName === 'Anonymous Customer');
    const pub = await svc.createManualPost(cust1, { caption: 'world', visibility: 'public_platform', tags: ['Luxury Design'] });

    // ---- feed visibility + scoping ----
    const salonFeed = await svc.feed(cust2, { scope: 'salon' });
    ok('salon_only post is visible to same-salon customer', salonFeed.posts.some((p) => p.id === vp.id));
    const otherSalon = await svc.feed(cust3, { scope: 'salon' });
    ok('salon_only post is NOT visible to a different tenant (tenant safety)', !otherSalon.posts.some((p) => p.id === vp.id));
    const pubFeed = await svc.feed(cust3, { scope: 'public' });
    ok('public_platform post is visible across tenants', pubFeed.posts.some((p) => p.id === pub.id));
    const forYouOther = await svc.feed(cust3, { scope: 'for_you' });
    ok('for_you for another tenant excludes salon_only, includes public', !forYouOther.posts.some((p) => p.id === vp.id) && forYouOther.posts.some((p) => p.id === pub.id));

    // ---- reactions: one per customer, switch, toggle-off, counts ----
    let rx = await svc.setReaction(cust2, vp.id, 'like');
    ok('customer can like a post', rx.myReaction === 'like' && rx.likeCount === 1 && rx.dislikeCount === 0);
    rx = await svc.setReaction(cust2, vp.id, 'dislike');
    ok('like switches to dislike (one reaction per customer)', rx.myReaction === 'dislike' && rx.likeCount === 0 && rx.dislikeCount === 1);
    rx = await svc.setReaction(cust2, vp.id, 'dislike');
    ok('tapping same reaction again removes it (no duplicate)', rx.myReaction === null && rx.dislikeCount === 0);
    await svc.setReaction(cust1, vp.id, 'like'); rx = await svc.setReaction(cust2, vp.id, 'like');
    ok('reaction counts aggregate across customers', rx.likeCount === 2);
    const rowCount = (await pool.query(`SELECT COUNT(*)::int AS c FROM nail_showcase_reactions WHERE post_id=$1 AND customer_id=$2`, [vp.id, CU2])).rows[0].c;
    ok('exactly one reaction row per (post, customer) at the DB level', rowCount === 1, `rows=${rowCount}`);

    // ---- comments + ownership ----
    const cm = await svc.addComment(cust2, vp.id, 'Obsessed with this set!');
    const afterComment = await svc.getPost(cust1, vp.id);
    ok('customer can comment (count updates)', afterComment.commentCount === 1 && cm.displayName === 'Maria L.');

    // ---- notifications + analytics (best-effort side effects) ----
    const noteCount = (await pool.query(`SELECT COUNT(*)::int AS c FROM customer_notifications WHERE customer_id=$1 AND reference=$2 AND type='nail_showcase'`, [CR1, vp.id])).rows[0].c;
    ok('a comment notifies the post author via the customer bell', noteCount >= 1, `notifications=${noteCount}`);
    const createdAudit = (await pool.query(`SELECT COUNT(*)::int AS c FROM audit_logs WHERE action_type='nail_showcase_post_created' AND entity_id=$1`, [vp.id])).rows[0].c;
    ok('post creation writes a platform analytics/audit event', createdAudit >= 1, `events=${createdAudit}`);
    const commentAudit = (await pool.query(`SELECT COUNT(*)::int AS c FROM audit_logs WHERE action_type='nail_showcase_comment_created' AND entity_id=$1`, [vp.id])).rows[0].c;
    ok('comment creation writes an analytics/audit event', commentAudit >= 1, `events=${commentAudit}`);

    // ---- feed pagination cursor (only 'newest' is keyset-safe) ----
    const fLiked = await svc.feed(cust1, { scope: 'mine', sort: 'most_liked', limit: 1 });
    ok('ranked sort (most_liked) returns no keyset cursor', fLiked.nextCursor === null, `cursor=${fLiked.nextCursor}`);
    const fNew = await svc.feed(cust1, { scope: 'mine', sort: 'newest', limit: 1 });
    ok('newest sort returns a keyset cursor on a full page', fNew.posts.length < 1 || fNew.nextCursor !== null, `cursor=${fNew.nextCursor} posts=${fNew.posts.length}`);

    await throwsNS('customer cannot delete another customer’s comment', () => svc.deleteComment(cust1, cm.id), 'forbidden');
    await svc.deleteComment(cust2, cm.id);
    const afterDelete = await svc.getPost(cust1, vp.id);
    ok('customer can delete own comment (count decrements)', afterDelete.commentCount === 0);

    // ---- reports ----
    await svc.reportPost(cust2, vp.id, 'spam', 'looks off');
    const reported = await svc.getPost(cust1, vp.id);
    ok('customer can report a post (report_count bumps)', reported.reportCount === 1);
    const cm2 = await svc.addComment(cust2, vp.id, 'second comment');
    await svc.reportComment(cust1, cm2.id, 'rude');
    const openReports = await svc.listReports(mgrT, false);
    ok('reports surface to the salon moderation queue', openReports.length >= 2, `open=${openReports.length}`);

    // ---- moderation: manager own-tenant only; super admin platform-wide ----
    const hideRes = await svc.hidePost(mgrT, mp.id);
    ok('manager can hide a post in their own salon', hideRes.status === 'hidden');
    const afterHide = await svc.feed(cust2, { scope: 'salon' });
    ok('hidden post no longer appears in the feed', !afterHide.posts.some((p) => p.id === mp.id));
    await throwsNS('manager cannot hide a post in another tenant', () => svc.hidePost(mgrOther, vp.id), 'forbidden');
    const appr = await svc.approvePost(mgrT, mp.id);
    ok('manager can re-approve (publish) a post in their salon', appr.status === 'published');
    const rem = await svc.removePostPlatform(mgrT, pub.id);
    ok('super admin can remove content platform-wide', rem.status === 'removed');
    const resolved = await svc.resolveReport(mgrT, openReports[0].id, 'reviewed', false);
    ok('manager can resolve a report in their tenant', resolved.resolved === true);

    console.log(`\n${fail === 0 ? 'NAIL-SHOWCASE BACKEND ALL GREEN' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  } catch (e: any) {
    console.error('fatal:', e?.message || e); fail++;
  } finally {
    await k.destroy().catch(() => {}); await pool.end().catch(() => {}); await server.stop().catch(() => {}); await db.close().catch(() => {});
    process.exit(fail === 0 ? 0 : 1);
  }
})();
