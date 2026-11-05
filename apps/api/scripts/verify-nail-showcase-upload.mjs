// verify-nail-showcase-upload.mjs — proves the REAL photo-upload path end-to-end over HTTP: a customer registers, logs
// in, creates a NailShowcase post, and uploads an actual multipart image. Verifies the FilesInterceptor → per-file
// validation → MediaStorage write → photo-row pipeline by (a) getting a /media/ URL back, (b) finding the bytes on disk
// under MEDIA_ROOT, (c) seeing the photo on the post via GET, and (d) rejecting a non-image file. The service-level
// verify-nail-showcase.ts covers domain logic; this covers the controller/storage glue it can't reach.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, rmSync, readdirSync } from 'node:fs';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const PG = 5483, APP = 3009, BASE = `http://127.0.0.1:${APP}`;
const MEDIA_ROOT = '/tmp/ns-media-test';
const base = { ...process.env, DATABASE_URL: `postgres://postgres@127.0.0.1:${PG}/postgres`, REPO_DRIVER: 'postgres' };
const sh = (c, a, e = {}) => new Promise((r) => { const p = spawn(c, a, { cwd: API, env: { ...base, ...e }, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('exit', (code) => r({ code, o })); });

let pass = 0, fail = 0;
const mark = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${extra ? ' - ' + extra : ''}`); ok ? pass++ : fail++; return ok; };
const jar = {};
async function req(method, path, body, multipart) {
  const headers = { ...(jar.cookie ? { Cookie: jar.cookie } : {}) };
  let payload;
  if (multipart) { payload = body; } else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const sc = res.headers.get('set-cookie'); if (sc) { const m = sc.match(/aps_session=[^;]+/); if (m) jar.cookie = m[0]; }
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

let db = null, server = null, app = null;
const teardown = async () => { try { app?.kill('SIGKILL'); } catch {} try { await server?.stop(); } catch {} try { await db?.close(); } catch {} try { rmSync(MEDIA_ROOT, { recursive: true, force: true }); } catch {} };

try {
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  db = await PGlite.create({ extensions: { pgcrypto } });
  server = new PGLiteSocketServer({ db, port: PG, host: '127.0.0.1', maxConnections: 20 }); await server.start();
  let r = await sh('node', ['scripts/migrate.mjs']); if (r.code) throw new Error('migrate\n' + r.o.slice(-600));
  r = await sh('npx', ['tsx', 'scripts/seed.ts'], { SEED_TENANT_CODE: 'PALACE', SEED_OWNER_EMAIL: 'owner@palace.test', SEED_OWNER_PASSWORD: 'Owner!2345', SEED_TENANT_NAME: 'Palace Nails' }); if (r.code) throw new Error('seed\n' + r.o.slice(-600));
  app = spawn('node', ['dist/main.js'], { cwd: API, env: { ...base, PG_POOL_MAX: '4', PORT: String(APP), AUTH_SESSION_SECRET: 'up-secret', MEDIA_ROOT }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; app.stdout.on('data', (d) => (log += d)); app.stderr.on('data', (d) => (log += d));
  const ready = await (async () => { for (let i = 0; i < 80; i++) { try { const x = await fetch(`${BASE}/`); if (x.status) return true; } catch {} await new Promise((s) => setTimeout(s, 500)); } return false; })();
  if (!ready) throw new Error('API did not start\n' + log.slice(-1000));
  console.log(`> API on :${APP}, MEDIA_ROOT=${MEDIA_ROOT}\n`);

  const rnd = Math.floor(1000 + Math.random() * 8999);
  const email = `up${rnd}@cust.test`;
  await req('POST', '/customer/auth/register', { salonCode: 'PALACE', firstName: 'Sophia', lastName: 'Nguyen', email, phone: `+1609${rnd}0123`, password: 'Cust!2345' });
  let res = await req('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: email, password: 'Cust!2345' });
  if (!mark('customer registers + logs in', res.status === 200 && !!jar.cookie, `${res.status}`)) { await teardown(); process.exit(1); }

  res = await req('POST', '/customer/nail-showcase/posts', { caption: 'French chrome tips ✨', tags: ['Chrome', 'French Tips'], visibility: 'salon_only', allowComments: true });
  const postId = res.json?.id || res.json?.post?.id;
  mark('customer creates a post to upload into', res.status < 300 && !!postId, `${res.status} post=${postId || JSON.stringify(res.json).slice(0, 90)}`);

  // Real multipart upload: a minimal JPEG-typed blob (validator checks MIME + size, not pixels). Field name 'files'.
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
  const form = new FormData();
  form.append('files', new Blob([jpegBytes], { type: 'image/jpeg' }), 'nails.jpg');
  res = await req('POST', `/customer/nail-showcase/posts/${postId}/photos`, form, true);
  const photos = Array.isArray(res.json) ? res.json : (res.json?.photos || []);
  const url = photos[0]?.imageUrl || photos[0]?.image_url;
  mark('multipart image upload returns a stored photo with a /media/ URL', res.status < 300 && !!url && url.startsWith('/media/'), `${res.status} url=${url || JSON.stringify(res.json).slice(0, 90)}`);

  // The bytes actually landed on disk under the tenant/customer/post-scoped key.
  const onDisk = existsSync(MEDIA_ROOT) && (() => { try { return JSON.stringify(walk(MEDIA_ROOT)).includes('.jpg'); } catch { return false; } })();
  mark('uploaded bytes persisted to MediaStorage on disk', onDisk, onDisk ? 'found .jpg under MEDIA_ROOT' : 'no file written');

  res = await req('GET', `/customer/nail-showcase/posts/${postId}`);
  const got = (res.json?.photos || []).some((p) => (p.imageUrl || p.image_url) === url);
  mark('the post now shows the uploaded photo via GET', res.status === 200 && got, `${res.status} photos=${(res.json?.photos || []).length}`);

  // Non-image is rejected by the per-file validator (wrong MIME).
  const badForm = new FormData();
  badForm.append('files', new Blob([new TextEncoder().encode('not an image')], { type: 'text/plain' }), 'x.txt');
  res = await req('POST', `/customer/nail-showcase/posts/${postId}/photos`, badForm, true);
  mark('non-image upload is rejected (400)', res.status === 400, `${res.status}`);

  console.log(`\n${fail === 0 ? 'UPLOAD PATH ALL GREEN' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  await teardown();
  process.exit(fail === 0 ? 0 : 1);
} catch (e) { console.error('fatal:', e?.message || e); await teardown(); process.exit(1); }

function walk(dir) { const out = []; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
