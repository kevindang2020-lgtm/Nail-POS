#!/usr/bin/env node
// live-display-ads.mjs — 23-inch dual-screen spec §47–§78, §108–§111: a LIVE proof of Customer Display Advertising against
// the real API (dist/main.js), real PostgreSQL and real local object storage. It seeds proof displays (and a second salon
// with its own display and ad), signs in as the salon owner and checks, over HTTP and SSE:
//   1. upload: original + three copies land in object storage (not the database); the display's copy is served back
//      byte-identical; an HTML page renamed .png is refused and leaves nothing behind
//   2. create → publish: the IDLE display hears customer_display_ads_updated on its own channel (and how fast); its
//      playlist has the ad — and nothing internal (no ad name, status, targeting, tenant or branch)
//   3. tenant isolation: the other salon's display plays only ITS ad; ours never contains it
//   4. branch targeting: an ad for the second branch reaches that branch's display only
//   5. pause and schedule take an ad off the display; refreshAfterSeconds says when to ask again
//   6. the layers: branch off, display off — each with the right offReason
//   7. display reports: counted, a resend counted once, analytics shows them (as displays, never views)
//   8. a stale edit is a 409 VERSION_CONFLICT; forged device tokens and a missing session are refused
//   9. archive + delete removes the images from storage; every action left its audit row
// Usage (from apps/api, after `npx tsc -p tsconfig.json`):
//   DATABASE_URL=postgres://… SALON_CODE=PILOT01 OWNER_EMAIL=… OWNER_PASSWORD=… node scripts/live-display-ads.mjs
// Seeds rows marked "Live Ads Proof"; archives and deletes its own ads at the end. Never point it at production.
import { spawn } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { PNG } = require('pngjs');
const DB = process.env.DATABASE_URL;
const PORT = Number(process.env.PORT || 3032);
const BASE = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const EMAIL = process.env.OWNER_EMAIL || 'owner@pilotsalon.com';
const PASSWORD = process.env.OWNER_PASSWORD || 'ChangeMe!Owner1';
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), 'ads-proof-media-'));

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms) { const end = Date.now() + ms; while (Date.now() < end) { const v = pred(); if (v) return v; await sleep(10); } return null; }
function openStream(path, headers) {
  const events = []; const ctl = new AbortController();
  const done = (async () => {
    const res = await fetch(BASE + path, { headers: { accept: 'text/event-stream', ...headers }, signal: ctl.signal });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done: end } = await reader.read(); if (end) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (data) { try { const d = JSON.parse(data); events.push({ at: Date.now(), event: d.event ?? d.eventType, d }); } catch { /* not JSON */ } }
      }
    }
  })().catch(() => undefined);
  return { events, close: () => { ctl.abort(); return done; } };
}
// a patterned PNG so the copies are real, distinct images
function png(w, h, seed) {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; p.data[i] = (x * 7 + seed) & 255; p.data[i + 1] = (y * 3 + seed) & 255; p.data[i + 2] = ((x ^ y) + seed) & 255; p.data[i + 3] = 255; }
  return PNG.sync.write(p);
}
const files = () => ({ original: png(1080, 1620, 11), large: png(1080, 1620, 12), medium: png(720, 1080, 13), thumb: png(213, 320, 14) });
function form(f, names = {}) {
  const fd = new FormData();
  for (const k of ['original', 'large', 'medium', 'thumb']) fd.append(k, new Blob([f[k]], { type: 'image/png' }), names[k] ?? `${k}.png`);
  fd.append('focalX', '0.45'); fd.append('focalY', '0.35');
  return fd;
}
const walk = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])) : []);

const client = new pg.Client({ connectionString: DB });
await client.connect();
const salon = (await client.query(`select t.id as tenant_id, b.id as branch_id from tenants t join branches b on b.tenant_id = t.id where t.tenant_code = $1 and b.deleted_at is null order by b.created_at limit 1`, [SALON])).rows[0];
if (!salon) { console.error(`salon ${SALON} not found`); process.exit(2); }
const T = salon.tenant_id, B1 = salon.branch_id;
// a second branch of the same salon, a second salon, three displays
await client.query(`update customer_display_devices set revoked_at = now() where device_name like 'Live Ads Proof%' and revoked_at is null`);
// the proof branch exists only while the proof runs — removed at the end (the POS branch switcher lists every branch
// row, soft-deleted or not, so a leftover would show up in the salon's POS)
const B2 = randomUUID();
await client.query(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Live Ads Proof Branch','active','America/New_York')`, [B2, T]);
let T2 = (await client.query(`select id from tenants where tenant_code = 'LADSX'`)).rows[0]?.id;
if (!T2) { T2 = randomUUID(); await client.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Live Ads Proof Other Salon','Live Ads Proof Other Salon','live-ads-proof-other','LADSX','active')`, [T2]); }
let B3 = (await client.query(`select id from branches where tenant_id = $1`, [T2])).rows[0]?.id;
if (!B3) { B3 = randomUUID(); await client.query(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Other Main','active','America/New_York')`, [B3, T2]); }
const tok = () => randomBytes(24).toString('base64url');
const D1 = randomUUID(), D2 = randomUUID(), D3 = randomUUID(); const K1 = tok(), K2 = tok(), K3 = tok();
for (const [d, t, b, k, n] of [[D1, T, B1, K1, 'A'], [D2, T, B2, K2, 'B'], [D3, T2, B3, K3, 'C']]) {
  await client.query(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status, device_token_hash) values ($1,$2,$3,$4,'android','paired',$5)`, [d, t, b, `Live Ads Proof ${n}`, createHash('sha256').update(k).digest('hex')]);
}
// the other salon's own published ad (its image rows are its own)
await client.query(`delete from display_ads where tenant_id = $1`, [T2]);
const M3 = randomUUID(), A3 = randomUUID();
await client.query(`insert into display_ad_media (id, tenant_id, mime_type, width, height, byte_size, total_bytes, sha256, storage_key, variants) values ($1,$2,'image/png',1080,1620,100,400,repeat('b',64),'display-ads/other/original.png',$3::jsonb)`,
  [M3, T2, JSON.stringify({ large: { key: 'display-ads/other/large.png', url: '/media/display-ads/other/large.png', width: 1080, height: 1620, bytes: 100, mime: 'image/png' }, medium: { key: 'display-ads/other/medium.png', url: '/media/display-ads/other/medium.png', width: 720, height: 1080, bytes: 100, mime: 'image/png' }, thumb: { key: 'display-ads/other/thumb.png', url: '/media/display-ads/other/thumb.png', width: 213, height: 320, bytes: 100, mime: 'image/png' } })]);
await client.query(`insert into display_ads (id, tenant_id, name, media_id, status, published_at) values ($1,$2,'Other salon ad',$3,'published',now())`, [A3, T2, M3]);
// start from a clean slate for this salon's settings (a previous run may have switched things off)
await client.query(`delete from tenant_settings where tenant_id = $1 and category = 'customer-display-ads'`, [T]);

const api = spawn('node', ['dist/main.js'], { env: { ...process.env, REPO_DRIVER: 'postgres', PORT: String(PORT), MEDIA_ROOT, AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET || 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
let apiErr = ''; api.stderr.on('data', (c) => { apiErr += c; });
const created = [];
let pos;
try {
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(BASE + '/health/ready')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  check('API booted (health/ready)', !!up);
  const login = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: EMAIL, password: PASSWORD }) });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  check('owner signed in', login.ok && !!cookie, String(login.status));
  pos = (method, path, body) => fetch(BASE + path, { method, headers: { cookie, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const dev = (method, path, token, body) => fetch(BASE + '/customer-display/device' + path, { method, headers: { 'x-device-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const playlist = async (token) => (await dev('GET', '/ads', token)).json();
  const A = '/pos/marketing/display-ads';

  // 0. no session → refused
  const anon = await fetch(BASE + A + '/state');
  check('the POS routes need a signed-in session', anon.status === 401 || anon.status === 403, String(anon.status));
  const st = await (await pos('GET', A + '/state')).json();
  check('state: available, limits from the platform', st.availability?.active === true && st.limits?.maxAds > 0 && st.branches?.some((b) => b.id === B2), `${st.availability?.detail ?? ''} maxAds=${st.limits?.maxAds}`);

  // 1. upload
  const f = files();
  const up1 = await pos('POST', A + '/media', form(f, { original: 'fall-promo.png' }));
  const m = await up1.json();
  check('upload accepted (original + 3 optimized copies)', up1.ok && m.width === 1080 && m.medium?.width === 720 && m.thumb?.height === 320, `${up1.status} ${m.width}×${m.height}`);
  const onDisk = walk(MEDIA_ROOT).filter((p) => p.includes(m.id));
  check('the four files are in object storage (local disk), keyed by the image id', onDisk.length === 4, onDisk.map((p) => p.split('/').pop()).join(', '));
  const row = (await client.query(`select storage_key, variants from display_ad_media where tenant_id = $1 and id = $2`, [T, m.id])).rows[0];
  check('the database holds keys and metadata only (no bytes)', !!row && typeof row.storage_key === 'string' && !('bytes' in row), row?.storage_key);
  const served = await fetch(BASE + m.medium.url);
  const servedBytes = Buffer.from(await served.arrayBuffer());
  check('the display\'s copy is served back byte-identical', served.ok && served.headers.get('content-type') === 'image/png' && servedBytes.equals(f.medium), `${served.status} ${served.headers.get('content-type')} ${servedBytes.length} bytes`);
  const before = walk(MEDIA_ROOT).length;
  const bad = { ...files(), original: Buffer.from('<!doctype html><script>alert(document.cookie)</script>'.padEnd(200, ' ')) };
  const up2 = await pos('POST', A + '/media', form(bad, { original: 'promo.png' }));
  const up2b = await up2.json();
  check('an HTML page named promo.png is refused by its bytes', up2.status === 400 && up2b.error?.code === 'VALIDATION_FAILED' && up2b.error?.details?.reason === 'UNSUPPORTED_TYPE', `${up2.status} ${up2b.error?.details?.reason}`);
  check('…and nothing was stored', walk(MEDIA_ROOT).length === before);

  // 2. create → publish → the idle display hears it
  const c1 = await pos('POST', A, { name: 'Live Ads Proof — Fall pedicure', mediaId: m.id, headline: 'Deluxe spa pedicure', subheadline: 'Relax • Refresh • Renew', ctaText: 'Ask your technician today', qr: { kind: 'book_online', url: 'https://book.example.com/pilot' } });
  const ad = await c1.json(); created.push(ad.id);
  check('ad created as a draft', c1.ok && ad.status === 'DRAFT' && ad.version === 1, `${c1.status} ${ad.status}`);
  const s1 = openStream('/customer-display/device/stream', { 'x-device-token': K1 });
  await waitFor(() => s1.events.find((e) => e.event === 'connected'), 3000);
  const t0 = Date.now();
  const p1 = await (await pos('POST', `${A}/${ad.id}/publish`, { expectedVersion: 1 })).json();
  check('published → ACTIVE and showing now', p1.status === 'ACTIVE' && p1.showingNow === true && p1.version === 2, `${p1.status} v${p1.version}`);
  const heard = await waitFor(() => s1.events.find((e) => e.event === 'customer_display_ads_updated' && e.at >= t0), 3000);
  check('the IDLE display heard customer_display_ads_updated on its own channel', !!heard, heard ? `${heard.at - t0} ms after the POS call` : 'never arrived');
  const pl1 = await playlist(K1);
  const mine = pl1.ads?.find((x) => x.id === ad.id);
  check('the display\'s playlist has the ad, with the panel copy and the QR', !!mine && mine.image?.url === m.medium.url && mine.qr?.url === 'https://book.example.com/pilot' && mine.durationSeconds === 10, mine ? `${mine.image.width}×${mine.image.height} ${mine.qr?.label}` : JSON.stringify(pl1).slice(0, 160));
  const leak = JSON.stringify(pl1);
  check('nothing internal reaches the display (no ad name, status, targeting, tenant, branch, ids of other salons)', !/"name"|"status"|"storedStatus"|"branchIds"|"allBranches"|"tenant|"branch|Live Ads Proof|canManage/.test(leak) && !leak.includes(A3), leak.length + ' bytes');

  // 3. tenant isolation
  const pl3 = await playlist(K3);
  check('the other salon\'s display plays only its own ad', pl3.ads?.length === 1 && pl3.ads[0].id === A3, pl3.ads?.map((x) => x.id === A3 ? 'own' : 'FOREIGN').join(','));
  check('our display never contains the other salon\'s ad', !JSON.stringify(await playlist(K1)).includes(A3) && !JSON.stringify(await playlist(K2)).includes(A3));
  const foreign = await pos('GET', `${A}/${A3}`);
  check('the other salon\'s ad id is "not found" from our POS', foreign.status === 404, String(foreign.status));
  const steal = await pos('POST', A, { name: 'steal', mediaId: M3 });
  check('the other salon\'s image cannot be used', steal.status === 400, String(steal.status));

  // 4. branch targeting
  const c2 = await (await pos('POST', A, { name: 'Live Ads Proof — Branch only', mediaId: m.id, allBranches: false, branchIds: [B2] })).json(); created.push(c2.id);
  await pos('POST', `${A}/${c2.id}/publish`, { expectedVersion: 1 });
  check('an ad for the second branch reaches that branch\'s display…', (await playlist(K2)).ads?.some((x) => x.id === c2.id));
  check('…and not the first branch\'s', !(await playlist(K1)).ads?.some((x) => x.id === c2.id));
  const preview = await (await pos('GET', `${A}/branches/${B2}/playlist`)).json();
  const devView = await playlist(K2);
  check('the POS preview of a branch is exactly what that branch\'s display plays', preview.enabled === true && JSON.stringify(preview.ads) === JSON.stringify(devView.ads) && preview.playlistVersion === devView.playlistVersion, `${preview.ads?.length} ads, version ${preview.playlistVersion}`);

  // 5. pause and schedule
  const t1 = Date.now();
  const pz = await (await pos('POST', `${A}/${ad.id}/pause`, { expectedVersion: 2 })).json();
  const heard2 = await waitFor(() => s1.events.find((e) => e.event === 'customer_display_ads_updated' && e.at >= t1), 3000);
  check('pause → PAUSED, and the display heard it', pz.status === 'PAUSED' && !!heard2, heard2 ? `${heard2.at - t1} ms` : 'never arrived');
  check('a paused ad is off the display', !(await playlist(K1)).ads?.some((x) => x.id === ad.id));
  await pos('POST', `${A}/${ad.id}/publish`, { expectedVersion: 3 });
  const nowNy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const later = (h) => `${String((nowNy.getHours() + h) % 24).padStart(2, '0')}:00`;
  const win = nowNy.getHours() <= 20 ? [later(2), later(3)] : ['01:00', '02:00'];
  const sch = await pos('PATCH', `${A}/${ad.id}`, { expectedVersion: 4, dailyStartTime: win[0], dailyEndTime: win[1] });
  const schB = await sch.json();
  check('a schedule outside the current hours: still ACTIVE, not showing now', sch.ok && schB.status === 'ACTIVE' && schB.showingNow === false, `${win.join('–')} ${schB.status} showingNow=${schB.showingNow}`);
  const pl5 = await playlist(K1);
  check('…so the display does not play it, and knows when to ask again', !pl5.ads?.some((x) => x.id === ad.id) && pl5.refreshAfterSeconds > 0 && pl5.refreshAfterSeconds <= 900, `refreshAfterSeconds=${pl5.refreshAfterSeconds}`);
  const audit = (await client.query(`select action_type from audit_logs where tenant_id = $1 and entity_id = $2 order by created_at`, [T, ad.id])).rows.map((r) => r.action_type);
  check('audit: created, published, paused, published, updated + schedule_changed', JSON.stringify(audit) === JSON.stringify(['display_ad_created', 'display_ad_published', 'display_ad_paused', 'display_ad_published', 'display_ad_updated', 'display_ad_schedule_changed']), audit.join(','));
  await pos('PATCH', `${A}/${ad.id}`, { expectedVersion: 5, dailyStartTime: null, dailyEndTime: null });

  // 6. the layers
  const offB = await pos('PATCH', `${A}/branches/${B1}/settings`, { enabled: false });
  check('a branch\'s ads switched off from the POS', offB.ok, String(offB.status));
  check('branch switched off → that display gets the branded panel', (await playlist(K1)).offReason === 'disabled_for_branch');
  check('…the other branch still plays', (await playlist(K2)).enabled === true);
  await pos('PATCH', `${A}/branches/${B1}/settings`, { enabled: null });
  await pos('PATCH', `${A}/devices/${D1}`, { adsEnabled: false });
  check('one display switched off → only that display', (await playlist(K1)).offReason === 'disabled_for_display' && (await playlist(K2)).enabled === true);
  await pos('PATCH', `${A}/devices/${D1}`, { adsEnabled: true });
  check('back on → it plays again', (await playlist(K1)).ads?.some((x) => x.id === ad.id));
  const dev3 = await pos('PATCH', `${A}/devices/${D3}`, { adsEnabled: false });
  check('the other salon\'s display cannot be switched from our POS', dev3.status === 404, String(dev3.status));

  // 7. display reports
  const shownAt = new Date(Date.now() - 60_000).toISOString();
  const rep = { batchId: 'live-proof-' + randomBytes(6).toString('hex'), displays: [{ adId: ad.id, shownAt, durationMs: 10_000 }, { adId: ad.id, shownAt, durationMs: 10_000 }, { adId: A3, shownAt, durationMs: 10_000 }] };
  const r1 = await (await dev('POST', '/ads/displays', K1, rep)).json();
  const r2 = await (await dev('POST', '/ads/displays', K1, rep)).json();
  check('displays recorded; the other salon\'s ad id dropped; a resend counted once', r1.accepted === 2 && r1.duplicate === false && r2.duplicate === true && r2.accepted === 0, `${JSON.stringify(r1)} then ${JSON.stringify(r2)}`);
  const an = await (await pos('GET', A + '/analytics?days=7')).json();
  const byAd = an.byAd?.find((x) => x.adId === ad.id);
  check('analytics: 2 displays, 20 s on screen, this display showing ads now', byAd?.displayCount === 2 && byAd?.displaySeconds === 20 && an.totals?.devicesShowingNow >= 1, `${byAd?.displayCount} displays, ${byAd?.displaySeconds}s, showing now ${an.totals?.devicesShowingNow}/${an.totals?.displaysRegistered}`);
  check('analytics never says "views"', !/view/i.test(JSON.stringify(an)));
  const anB = await (await pos('GET', `${A}/branches/${B2}/analytics?days=7`)).json();
  check('branch analytics is scoped to that branch', anB.branchId === B2 && anB.byBranch?.length === 1 && anB.byBranch[0].branchId === B2 && !anB.byAd?.some((x) => x.adId === ad.id), `${anB.byBranch?.map((b) => b.name).join(',')} · ${anB.totals?.displayCount} displays`);

  // 8. conflicts and refusals
  const stale = await pos('PATCH', `${A}/${ad.id}`, { expectedVersion: 1, headline: 'stale' });
  const staleB = await stale.json();
  check('a stale edit is a 409 VERSION_CONFLICT (no silent overwrite)', stale.status === 409 && staleB.error?.code === 'VERSION_CONFLICT', `${stale.status} ${staleB.error?.code}`);
  const forged = await dev('GET', '/ads', 'forged-token');
  const forged2 = await dev('POST', '/ads/displays', 'forged-token', rep);
  check('a forged device token is refused on both device routes', forged.status === 403 && forged2.status === 403, `${forged.status}/${forged2.status}`);
  await s1.close();

  // 9. archive + delete → images gone
  const cur = await (await pos('GET', `${A}/${ad.id}`)).json();
  const ar = await (await pos('POST', `${A}/${ad.id}/archive`, { expectedVersion: cur.version })).json();
  const del = await pos('DELETE', `${A}/${ad.id}?version=${ar.version}`);
  check('archive then delete', ar.status === 'ARCHIVED' && del.ok, `${ar.status} ${del.status}`);
  const c2cur = await (await pos('GET', `${A}/${c2.id}`)).json();
  const c2ar = await (await pos('POST', `${A}/${c2.id}/archive`, { expectedVersion: c2cur.version })).json();
  await pos('DELETE', `${A}/${c2.id}?version=${c2ar.version}`);
  check('the images left object storage with the last ad that used them', walk(MEDIA_ROOT).filter((p) => p.includes(m.id)).length === 0, walk(MEDIA_ROOT).filter((p) => p.includes(m.id)).length + ' files left');
  const delAudit = (await client.query(`select count(*)::int as n from audit_logs where tenant_id = $1 and entity_id = $2 and action_type in ('display_ad_archived','display_ad_deleted')`, [T, ad.id])).rows[0].n;
  check('archive and delete are audited', delAudit === 2, String(delAudit));
} catch (e) {
  check('proof ran to the end', false, String(e?.stack || e).slice(0, 300));
} finally {
  // never leave proof ads playing on the salon's displays
  for (const id of created) await client.query(`delete from display_ads where tenant_id = $1 and id = $2`, [T, id]).catch(() => undefined);
  await client.query(`update customer_display_devices set revoked_at = now() where device_name like 'Live Ads Proof%' and revoked_at is null`).catch(() => undefined);
  await client.query(`delete from display_ad_device_settings where device_id in ($1, $2, $3)`, [D1, D2, D3]).catch(() => undefined);
  await client.query(`delete from customer_display_devices where tenant_id = $1 and branch_id = $2 and device_name like 'Live Ads Proof%'`, [T, B2]).catch(() => undefined);
  await client.query(`delete from branches where tenant_id = $1 and id = $2`, [T, B2]).catch((e) => console.error('proof branch not removed:', e.message));
  api.kill('SIGTERM');
  await client.end();
}
console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed && apiErr) console.log('\nAPI stderr (tail):\n' + apiErr.split('\n').slice(-15).join('\n'));
process.exit(failed ? 1 : 0);
