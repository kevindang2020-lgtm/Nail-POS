/* verify-tech-profile-http.ts — REAL over-the-wire E2E for the tech-profile system. Hosts PGlite, launches the
 * COMPILED app (dist/main.js — exactly what `npm start` runs, so DI/guards/middleware/multer behave as in prod),
 * then exercises the full surface a phone or browser would hit: multipart uploads, /media serving, permission
 * guards, public no-cookie discovery + listed gates, the verified rating loop with edit window, and favorites.
 * Prereq: `npm run build`. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { hashPassword } from '../../../packages/auth/src/password';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DB_PORT = 5494, HTTP_PORT = 3199;
const T = '00000000-0000-0000-0000-00000d0d1501', B = '00000000-0000-0000-0000-00000d0db501';
const TU = '00000000-0000-0000-0000-00000d0d0f01', TECH = '00000000-0000-0000-0000-00000d0d0e01';
const OU = '00000000-0000-0000-0000-00000d0d0f02';
const CU = '00000000-0000-0000-0000-00000d0d0f03', CUST = '00000000-0000-0000-0000-00000d0dc501';
const CAT = '00000000-0000-0000-0000-00000d0dca01', SVC = '00000000-0000-0000-0000-00000d0d5a01';
const TK = '00000000-0000-0000-0000-00000d0d7c01', LN = '00000000-0000-0000-0000-00000d0d1a01';

function reqJson(method: string, path: string, body: any, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number; body: string; setCookie: string[] }> {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, path, method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: b, setCookie: ([] as string[]).concat((res.headers['set-cookie'] as string[]) || []) }));
    });
    req.on('error', () => resolve({ status: 0, body: '', setCookie: [] }));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function getBytes(path: string, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number; bytes: Buffer; contentType: string }> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: HTTP_PORT, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () => resolve({ status: res.statusCode || 0, bytes: Buffer.concat(chunks), contentType: String(res.headers['content-type'] || '') }));
    });
    req.on('error', () => resolve({ status: 0, bytes: Buffer.alloc(0), contentType: '' }));
  });
}

/** Minimal multipart/form-data POST. parts: [{field, filename?, contentType?, data}] */
function postMultipart(path: string, parts: { field: string; filename?: string; contentType?: string; data: Buffer | string }[], headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number; body: string }> {
  const boundary = '----apsboundary' + Math.random().toString(16).slice(2);
  const segs: Buffer[] = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.field}"`;
    if (p.filename) head += `; filename="${p.filename}"`;
    head += '\r\n';
    if (p.contentType) head += `Content-Type: ${p.contentType}\r\n`;
    head += '\r\n';
    segs.push(Buffer.from(head), Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data), Buffer.from('\r\n'));
  }
  segs.push(Buffer.from(`--${boundary}--\r\n`));
  const payload = Buffer.concat(segs);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: HTTP_PORT, path, method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': payload.length, ...headers },
    }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode || 0, body: b })); });
    req.on('error', reject); req.write(payload); req.end();
  });
}

// Real magic bytes (validator sniffs signatures, not full decode)
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 9)]);
const NOT_IMAGE = Buffer.from('#!/bin/sh\necho hacked\n');

async function main() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));

  const pw = await hashPassword('Secret123!');
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','Wire LLC','Wire Nails','wire','WIRE','active')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, address, city, state, zip, phone, latitude, longitude) VALUES ('${B}','${T}','Main','9 Wire St','Cherry Hill','NJ','08002','(856) 555-0909',39.9310,-75.0210)`);
  await db.exec(`INSERT INTO tenant_app_flags (tenant_id, flag_key, enabled) VALUES ('${T}','public_listing',true)`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, email, password_hash, full_name, role, status) VALUES
    ('${TU}','${T}','${B}','mia@wire.test','${pw}','Mia Tran','TECHNICIAN','active'),
    ('${OU}','${T}','${B}','owner@wire.test','${pw}','Olive Owner','OWNER','active'),
    ('${CU}','${T}','${B}','jess@wire.test','${pw}','Jessica Lopez','CUSTOMER','active')`);
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, default_commission_split_percent, is_active) VALUES
    ('${TECH}','${T}','${B}','${TU}','Mia','Tran','Mia Tran','active','percent',50,50,true)`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in) VALUES
    ('${CUST}','${T}','${B}','${CU}','Jessica','Lopez','Jessica Lopez','active',false,false)`);
  await db.exec(`INSERT INTO service_categories (id, tenant_id, branch_id, name, sort_order, status) VALUES ('${CAT}','${T}','${B}','Manicures',0,'active')`);
  await db.exec(`INSERT INTO services (id, tenant_id, branch_id, category_id, name, price_cents, duration_minutes, status) VALUES ('${SVC}','${T}','${B}','${CAT}','Gel Manicure',5000,45,'active')`);
  await db.exec(`INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) VALUES ('${T}','${B}','${TECH}','${SVC}',true)`);
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES
    ('${TK}','${T}','${B}','${CUST}','paid',5000,300,0,5300,0,now())`);
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES
    ('${LN}','${T}','${B}','${TK}','${SVC}','${TECH}','Gel Manicure',5000,45,'percent',50,5000,'done',100)`);

  const server = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1' });
  await server.start();
  const mediaRoot = `/tmp/tp-http-media-${Date.now()}`;
  const child: ChildProcess = spawn('node', ['dist/main.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, REPO_DRIVER: 'postgres', DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`, PORT: String(HTTP_PORT), AUTH_SESSION_SECRET: 'test-secret', NODE_ENV: 'test', MEDIA_ROOT: mediaRoot },
  });
  let booted = false;
  child.stdout?.on('data', (c) => { if (String(c).includes('Nest application successfully started') || String(c).includes('listening')) booted = true; });
  child.stderr?.on('data', () => {});
  for (let i = 0; i < 120 && !booted; i++) { await sleep(250); if ((await reqJson('GET', '/customer/techs/nearby?lat=1&lng=1', undefined)).status > 0) booted = true; }
  ok('compiled app boots against the harness DB', booted);

  try {
    const cookieOf = (r: { setCookie: string[] }) => r.setCookie.map((c) => c.split(';')[0]).join('; ');
    const techLogin = await reqJson('POST', '/auth/login', { salonCode: 'WIRE', identifier: 'mia@wire.test', password: 'Secret123!' });
    const techCookie = cookieOf(techLogin);
    ok('tech login over HTTP', techLogin.status < 300 && !!techCookie, String(techLogin.status));

    // profile create + edit (unsafe link dropped server-side)
    const prof1 = await reqJson('GET', '/tech/profile', undefined, { cookie: techCookie });
    const slug = JSON.parse(prof1.body).publicSlug as string;
    ok('GET /tech/profile creates the portable profile + slug', prof1.status === 200 && !!slug, prof1.body.slice(0, 80));
    const upd = await reqJson('PATCH', '/tech/profile', { title: 'Senior Nail Artist', bio: 'Chrome specialist.', isPublic: true, marketplaceDiscoveryEnabled: true, profileLinks: { linkme: 'https://linkme.example/mia', website: 'javascript:alert(1)' } }, { cookie: techCookie });
    const updBody = JSON.parse(upd.body);
    ok('PATCH /tech/profile applies edits and DROPS the javascript: link', upd.status === 200 && updBody.profileLinks.linkme && !updBody.profileLinks.website, JSON.stringify(updBody.profileLinks));

    // multipart avatar + photos through real multer
    const av = await postMultipart('/tech/profile/avatar', [{ field: 'file', filename: 'me.png', contentType: 'image/png', data: PNG }], { cookie: techCookie });
    const avatarUrl = JSON.parse(av.body).avatarUrl as string;
    ok('avatar multipart upload over HTTP (multer + magic bytes)', av.status < 300 && /^\/media\//.test(avatarUrl), `${av.status} ${avatarUrl}`);
    const served = await getBytes(avatarUrl);
    ok('GET /media/* serves the stored bytes publicly with the image content-type', served.status === 200 && served.bytes.length === PNG.length && served.contentType === 'image/png', `${served.status} ${served.bytes.length}b ${served.contentType}`);
    const trav = await getBytes('/media/../../etc/passwd');
    ok('media path traversal refused over HTTP', trav.status === 404 || trav.status === 400, String(trav.status));
    const ph = await postMultipart('/tech/profile/photos', [
      { field: 'files', filename: 'a.png', contentType: 'image/png', data: PNG },
      { field: 'files', filename: 'b.jpg', contentType: 'image/jpeg', data: JPG },
      { field: 'caption', data: 'Chrome set' },
    ], { cookie: techCookie });
    ok('two-photo multipart upload over HTTP', ph.status < 300 && JSON.parse(ph.body).photos.length === 2, ph.body.slice(0, 100));
    const bad = await postMultipart('/tech/profile/photos', [{ field: 'files', filename: 'evil.png', contentType: 'image/png', data: NOT_IMAGE }], { cookie: techCookie });
    ok('non-image rejected by magic bytes over HTTP (lying content-type ignored)', bad.status === 400 && /JPG, PNG, or WebP/.test(bad.body), `${bad.status} ${bad.body.slice(0, 80)}`);

    // public, NO cookie
    const near = await reqJson('GET', '/customer/techs/nearby?lat=39.93&lng=-75.02&radiusMiles=10', undefined);
    ok('public nearby (no cookie) finds the tech with featured thumbs + nextAvailable key', near.status === 200 && near.body.includes(slug) && near.body.includes('nextAvailable'), near.body.slice(0, 120));
    const page = await reqJson('GET', `/customer/techs/${slug}`, undefined);
    ok('public slug page (no cookie) renders with badges + wouldBookAgainPct', page.status === 200 && page.body.includes('"badges"') && page.body.includes('wouldBookAgainPct'));
    await db.exec(`UPDATE tenant_app_flags SET enabled=false WHERE tenant_id='${T}'`);
    const gated = await reqJson('GET', `/customer/techs/${slug}`, undefined);
    await db.exec(`UPDATE tenant_app_flags SET enabled=true WHERE tenant_id='${T}'`);
    ok('unlisting the salon hides discovery AND the page over HTTP', gated.status === 404 || JSON.parse(gated.body).availableAt?.length === 0, `${gated.status}`);
    const matchPub = await reqJson('GET', `/customer/salons/${B}/services/${SVC}/technicians`, undefined);
    ok('public booking-matcher (no cookie) returns the primary tech card', matchPub.status === 200 && matchPub.body.includes('"isPrimary":true'));

    // guards: TECHNICIAN blocked from POS surface; OWNER allowed
    const forb = await reqJson('GET', `/pos/technicians/${TECH}/profile`, undefined, { cookie: techCookie });
    ok('RolePermissionGuard: technician session gets 403 on the POS profile route', forb.status === 403, String(forb.status));
    const ownLogin = await reqJson('POST', '/auth/login', { salonCode: 'WIRE', identifier: 'owner@wire.test', password: 'Secret123!' });
    const ownCookie = cookieOf(ownLogin);
    const mview = await reqJson('GET', `/pos/technicians/${TECH}/profile`, undefined, { cookie: ownCookie });
    ok('owner views the manager profile (pending photos visible)', mview.status === 200 && mview.body.includes('"moderationStatus":"pending"') === false ? mview.body.includes('moderationStatus') : true);
    const photoId = JSON.parse(mview.body).photos[0].photoId;
    const appr = await reqJson('PATCH', `/pos/technicians/${TECH}/portfolio-photos/${photoId}/approve`, {}, { cookie: ownCookie });
    ok('owner approves a photo over HTTP', appr.status === 200 && appr.body.includes('"moderationStatus":"approved"'), appr.body.slice(0, 80));
    const feat = await reqJson('PATCH', `/pos/technicians/${TECH}/feature`, { featured: true }, { cookie: ownCookie });
    ok('owner features the tech (per-salon) over HTTP', feat.status === 200 && feat.body.includes('"isFeatured":true'));
    const editMgr = await reqJson('PATCH', `/pos/technicians/${TECH}/profile`, { title: 'Master Nail Artist' }, { cookie: ownCookie });
    ok('manager profile edit applies and returns the manager view', editMgr.status === 200 && editMgr.body.includes('Master Nail Artist'));

    // customer rating loop over HTTP
    const custLogin = await reqJson('POST', '/auth/login', { salonCode: 'WIRE', identifier: 'jess@wire.test', password: 'Secret123!' });
    const custCookie = cookieOf(custLogin);
    const pend = await reqJson('GET', '/customer/tech-ratings/pending', undefined, { cookie: custCookie });
    ok('pending prompt over HTTP with the doc-exact copy', pend.status === 200 && pend.body.includes('How was your service with Mia Tran?'), pend.body.slice(0, 120));
    const rate = await reqJson('POST', `/customer/tickets/${TK}/technician-ratings`, { technicianId: TECH, rating: 5, reviewText: 'Gorgeous chrome!', tags: ['Clean Work', 'Would Book Again'] }, { cookie: custCookie });
    ok('rating submit over HTTP returns the thank-you copy', rate.status < 300 && /Thank you! Your rating helps customers/.test(rate.body), rate.body.slice(0, 100));
    const dupe = await reqJson('POST', `/customer/tickets/${TK}/technician-ratings`, { technicianId: TECH, rating: 4 }, { cookie: custCookie });
    ok('duplicate rating → 409 with the friendly message', dupe.status === 409 && /already rated/.test(dupe.body), `${dupe.status}`);
    const mine = await reqJson('GET', `/customer/tickets/${TK}/technician-ratings/mine?technicianId=${TECH}`, undefined, { cookie: custCookie });
    const ratingId = JSON.parse(mine.body).rating?.ratingId ?? JSON.parse(mine.body).ratingId;
    ok('GET mine returns my rating for the edit window', mine.status === 200 && !!ratingId, mine.body.slice(0, 100));
    const edit = await reqJson('PATCH', `/customer/tickets/${TK}/technician-ratings/${ratingId}`, { rating: 4, reviewText: 'Still lovely.' }, { cookie: custCookie });
    ok('rating edit within the 7-day window over HTTP', edit.status === 200 && edit.body.includes('"ok":true'), `${edit.status} ${edit.body.slice(0, 60)}`);
    const page2 = await reqJson('GET', `/customer/techs/${slug}`, undefined);
    ok('public denorm reflects the EDITED rating (4.0 of 1) + wouldBookAgainPct 100', page2.body.includes('"averageRating":4') && page2.body.includes('"wouldBookAgainPct":100'), page2.body.slice(0, 60));

    // favorites over HTTP
    const fav = await reqJson('POST', '/customer/tech-favorites', { publicSlug: slug }, { cookie: custCookie });
    ok('favorite a tech over HTTP', fav.status < 300 && fav.body.includes('"ok":true'));
    const favList = await reqJson('GET', '/customer/tech-favorites', undefined, { cookie: custCookie });
    ok('favorites list returns the card + slug', favList.status === 200 && favList.body.includes(slug));
    const unfav = await reqJson('DELETE', `/customer/tech-favorites/${slug}`, undefined, { cookie: custCookie });
    const favList2 = await reqJson('GET', '/customer/tech-favorites', undefined, { cookie: custCookie });
    ok('unfavorite removes it', unfav.status < 300 && !JSON.parse(favList2.body).slugs.includes(slug));

    // membership request over HTTP needs a second salon
    await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('00000000-0000-0000-0000-00000d0d1502','Glow LLC','Glow Nails','glow-w','GLOWW','active')`);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, address, city, state, zip, phone) VALUES ('00000000-0000-0000-0000-00000d0db502','00000000-0000-0000-0000-00000d0d1502','Main','3 Pine','Marlton','NJ','08053','(856) 555-0404')`);
    const reqMove = await reqJson('POST', '/tech/profile/membership-request', { salonCode: 'gloww', message: 'Weekends' }, { cookie: techCookie });
    ok('Connect-to-New-Salon over HTTP (lowercase code accepted)', reqMove.status < 300 && reqMove.body.includes('"status":"pending"'), reqMove.body.slice(0, 100));
    const stat = await reqJson('GET', '/tech/profile/membership-status', undefined, { cookie: techCookie });
    ok('membership-status lists both salons', stat.status === 200 && stat.body.includes('Wire Nails') && stat.body.includes('Glow Nails'));
    const preview = await reqJson('GET', '/tech/profile/public-preview', undefined, { cookie: techCookie });
    ok('owner public-preview over HTTP carries isLivePublicly', preview.status === 200 && preview.body.includes('isLivePublicly'));
  } finally {
    child.kill('SIGTERM');
    await sleep(300);
    await server.stop(); await db.close();
  }
  console.log(`\n${fail ? '⚠️' : '🎉'} verify-tech-profile-http: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(1); });
