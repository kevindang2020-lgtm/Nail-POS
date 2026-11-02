/* auth-matrix-e2e.mjs — LIVE login proof for EVERY app's door (Jul 29, 2026).
 *
 * The four portals of POST /auth/login are the login doors of all ten workspaces:
 *   'tenant'      → pos-web, tech-web, manager-pay-web, customer-display (salon code + identifier)
 *   'owner'       → owner-web (salon-code-free; optional server-validated Owner Access Code, mig 382)
 *   'customer'    → customer-web (role=CUSTOMER only, structural; no salon code)
 *   'super-admin' → admin-web (MFA required; unenrolled local admin accepts any 6-digit — see seed.ts)
 *
 * Boots the REAL stack exactly like browser-e2e (PGlite socket + migrations + seed.ts + dist/main.js), inserts the
 * extra principals seed.ts doesn't create (staff-with-phone, owner-with-access-code, customer), then runs a
 * 13-check matrix: every success must set the session cookie; every negative must refuse. Nothing is mocked.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PG_PORT = 5459, APP_PORT = 4611;
const DB_URL = `postgres://postgres@127.0.0.1:${PG_PORT}/postgres`;
const base = { ...process.env, DATABASE_URL: DB_URL, REPO_DRIVER: 'postgres' };
const sh = (cmd, args, extra = {}) => new Promise((res) => { const p = spawn(cmd, args, { cwd: API, env: { ...base, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('exit', (code) => res({ code, o })); });

let dbserver, app;
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); }

async function login(body) {
  const r = await fetch(`http://127.0.0.1:${APP_PORT}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const cookie = r.headers.get('set-cookie') || '';
  let j = {}; try { j = await r.json(); } catch { /* non-json */ }
  return { status: r.status, cookie, body: j };
}

try {
  // 1) DB + schema + seed — identical to browser-e2e.
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const lite = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  dbserver = new PGLiteSocketServer({ db: lite, port: PG_PORT, host: '127.0.0.1' });
  await dbserver.start();
  let r = await sh('node', ['scripts/migrate.mjs']); if (r.code) throw new Error('migrate failed\n' + r.o.slice(-800));
  r = await sh('npx', ['tsx', 'scripts/seed.ts']); if (r.code) throw new Error('seed failed\n' + r.o.slice(-800));
  console.log('▸ schema + PALACE seed ok');

  // 2) Extra principals the seed does not create — via the same hashPassword the API uses (from dist).
  const { hashPassword } = await import(path.join(API, 'dist', 'auth', 'password.js'));
  const pg = await import('pg');
  const c = new pg.default.Client({ connectionString: DB_URL }); await c.connect();
  const trow = (await c.query(`SELECT id, tenant_code FROM tenants ORDER BY created_at ASC LIMIT 1`)).rows[0];
  const T = trow.id; const SALON = trow.tenant_code;
  const seededOwner = (await c.query(`SELECT email FROM users WHERE tenant_id=$1 AND role='OWNER' AND owner_access_code_hash IS NULL ORDER BY created_at ASC LIMIT 1`, [T])).rows[0].email;
  console.log('▸ seeded tenant code =', SALON, '· owner =', seededOwner);
  const B = (await c.query(`SELECT id FROM branches WHERE tenant_id=$1 LIMIT 1`, [T])).rows[0].id;
  const staffHash = await hashPassword('Staff!2345');
  await c.query(`INSERT INTO users (tenant_id, branch_id, email, normalized_phone, password_hash, role, status, full_name)
                 VALUES ($1,$2,'staff@palace.test','+16095551234',$3,'MANAGER','active','Matrix Staff')`, [T, B, staffHash]);
  const ownerCodeHash = await hashPassword('7788');
  const owner2Hash = await hashPassword('Owner2!2345');
  await c.query(`INSERT INTO users (tenant_id, branch_id, email, password_hash, role, status, full_name, owner_access_code_hash)
                 VALUES ($1,$2,'owner2@palace.test',$3,'OWNER','active','Coded Owner',$4)`, [T, B, owner2Hash, ownerCodeHash]);
  const custHash = await hashPassword('Cust!2345');
  await c.query(`INSERT INTO users (tenant_id, branch_id, email, normalized_phone, password_hash, role, status, full_name)
                 VALUES ($1,$2,'cust@palace.test','+16095559876',$3,'CUSTOMER','active','Matrix Customer')`, [T, B, custHash]);
  // Owner portfolio grants (what Add-Salon / invite writes in production; the first-run seed omits them).
  const seededOwnerId = (await c.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='OWNER' AND owner_access_code_hash IS NULL ORDER BY created_at ASC LIMIT 1`, [T])).rows[0].id;
  const codedOwnerId  = (await c.query(`SELECT id FROM users WHERE email='owner2@palace.test'`)).rows[0].id;
  for (const uid of [seededOwnerId, codedOwnerId]) {
    await c.query(`INSERT INTO user_branch_access (tenant_id, branch_id, user_id, access_level, is_primary_owner)
                   VALUES ($1,$2,$3,'owner',true)`, [T, B, uid]);
  }
  await c.end();
  console.log('▸ matrix principals inserted (staff-with-phone, coded owner, customer)');

  // 3) API up.
  app = spawn('node', ['dist/main.js'], { cwd: API, env: { ...base, PG_POOL_MAX: '1', PORT: String(APP_PORT), AUTH_SESSION_SECRET: 'e2e-secret', PAYMENTS_ALLOW_ENV_FALLBACK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 120; i++) { try { const h = await fetch(`http://127.0.0.1:${APP_PORT}/health`); if (h.ok) break; } catch {} await new Promise((s) => setTimeout(s, 500)); }
  console.log(`▸ API listening on :${APP_PORT}\n`);

  // 4) THE MATRIX.
  let x = await login({ portal: 'tenant', salonCode: SALON, identifier: seededOwner, password: (process.env.SEED_OWNER_PASSWORD || 'ChangeMe!Owner1') });
  check('tenant portal: email + password → 200 + cookie', x.status === 200 && x.cookie.length > 0, `status ${x.status}`);
  x = await login({ portal: 'tenant', salonCode: SALON, identifier: '+1 (609) 555-1234', password: 'Staff!2345' });
  check('tenant portal: PHONE identifier (messy formatting) → 200', x.status === 200 && x.cookie.length > 0, `status ${x.status}`);
  x = await login({ portal: 'tenant', salonCode: SALON, identifier: 'owner@palace.test', password: 'wrong' });
  check('tenant portal: wrong password refused', x.status >= 400 && !x.cookie, `status ${x.status}`);
  x = await login({ portal: 'tenant', salonCode: 'NOPE', identifier: seededOwner, password: (process.env.SEED_OWNER_PASSWORD || 'ChangeMe!Owner1') });
  check('tenant portal: unknown salon code refused', x.status >= 400, `status ${x.status}`);
  x = await login({ portal: 'tenant', salonCode: SALON, identifier: 'cust@palace.test', password: 'Cust!2345' });
  check('tenant portal: CUSTOMER creds structurally invisible (spec §11)', x.status >= 400, `status ${x.status}`);

  x = await login({ portal: 'owner', identifier: seededOwner, password: (process.env.SEED_OWNER_PASSWORD || 'ChangeMe!Owner1') });
  check('owner portal: salon-code-free, codeless owner → 200', x.status === 200 && x.cookie.length > 0, `status ${x.status}`);
  x = await login({ portal: 'owner', identifier: 'owner2@palace.test', password: 'Owner2!2345' });
  check('owner portal: access code CONFIGURED + omitted → refused', x.status >= 400 && !x.cookie, `status ${x.status}`);
  x = await login({ portal: 'owner', identifier: 'owner2@palace.test', password: 'Owner2!2345', ownerAccessCode: '7788' });
  check('owner portal: correct access code → 200', x.status === 200 && x.cookie.length > 0, `status ${x.status}`);
  x = await login({ portal: 'owner', identifier: 'owner2@palace.test', password: 'Owner2!2345', ownerAccessCode: '0000' });
  check('owner portal: wrong access code refused', x.status >= 400, `status ${x.status}`);

  x = await login({ portal: 'customer', identifier: 'cust@palace.test', password: 'Cust!2345' });
  check('customer portal: email login → 200 (no salon code needed)', x.status === 200 && x.cookie.length > 0, `status ${x.status}`);
  x = await login({ portal: 'customer', identifier: seededOwner, password: (process.env.SEED_OWNER_PASSWORD || 'ChangeMe!Owner1') });
  check('customer portal: STAFF creds structurally invisible', x.status >= 400, `status ${x.status}`);

  x = await login({ portal: 'super-admin', identifier: 'admin@aipowersalon.com', password: 'ChangeMe!SuperAdmin1', mfaCode: '123456' });
  check('super-admin portal: password + 6-digit MFA → 200', x.status === 200 && x.cookie.length > 0, `status ${x.status}`);
  x = await login({ portal: 'super-admin', identifier: 'admin@aipowersalon.com', password: 'ChangeMe!SuperAdmin1' });
  check('super-admin portal: missing MFA does NOT grant a session', !x.cookie && x.body?.outcome !== 'SUCCESS', `status ${x.status} outcome ${x.body?.outcome}`);

  const fails = results.filter((r) => !r.ok);
  console.log(`\n${fails.length === 0 ? '✅ AUTH MATRIX PASSED' : '❌ AUTH MATRIX FAILED'} — ${results.length - fails.length}/${results.length} checks green`);
  process.exitCode = fails.length === 0 ? 0 : 1;
} catch (e) {
  console.error('HARNESS ERROR:', e?.message || e);
  process.exitCode = 1;
} finally {
  try { app?.kill(); } catch {}
  try { await dbserver?.stop(); } catch {}
}
