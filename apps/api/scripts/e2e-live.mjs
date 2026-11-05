// e2e-live.mjs — run the REAL e2e suite against a REAL Postgres engine, with zero external infrastructure.
// Spins up Postgres in-process (PGlite over the wire protocol via pglite-socket), then drives the actual app stack
// unchanged: scripts/migrate.mjs → scripts/seed.ts → dist/main.js (the NestJS API) → the scripts/e2e-*.mjs harnesses.
// Finishes with a Row-Level-Security confirmation on the same live database.
//
//   npm run e2e:live            # gate suite (no external deps) + RLS confirmation
//   E2E_CARD=1 npm run e2e:live # also gate the card harnesses (needs a CardPointe/Fiserv sandbox configured)
//
// Requires the app to be built first (npm run build --workspace @aipowersalon/api → dist/main.js).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

// PGlite is a dev/CI-only test dependency loaded on demand (it declares awkward peers, so it's intentionally NOT in
// package.json to keep the normal `npm install` clean). Install once:
//   npm i -D @electric-sql/pglite@0.5.1 @electric-sql/pglite-socket@0.2.1 --legacy-peer-deps
let PGlite, pgcrypto, pg_trgm, btree_gist, PGLiteSocketServer;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
  ({ pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto'));
  ({ pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm'));       // migration 107's trigram indexes (the harness failed there since 107 landed)
  ({ btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist'));   // migration 372's booking-hold exclusion constraint
  ({ PGLiteSocketServer } = await import('@electric-sql/pglite-socket'));
} catch {
  console.error('e2e-live: missing test deps. Install once:\n  npm i -D @electric-sql/pglite@0.5.1 @electric-sql/pglite-socket@0.2.1 --legacy-peer-deps');
  process.exit(2);
}

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const API = join(SCRIPTS, '..');
const PORT = Number(process.env.E2E_PG_PORT) || 5440;
const APP = Number(process.env.E2E_APP_PORT) || 3000;
const DB_URL = `postgres://postgres@127.0.0.1:${PORT}/postgres`;
const base = { ...process.env, DATABASE_URL: DB_URL, REPO_DRIVER: 'postgres' };
const CREDS = { SEED_TENANT_CODE: 'PALACE', SEED_OWNER_EMAIL: 'owner@palace.test', SEED_OWNER_PASSWORD: 'Owner!2345', SEED_TENANT_NAME: 'Palace Nails' };

// async spawn (NOT spawnSync — that would block the event loop and starve the in-process socket server)
const sh = (cmd, args, extra = {}) => new Promise((res) => {
  const p = spawn(cmd, args, { cwd: API, env: { ...base, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d));
  p.on('exit', (code) => res({ code, o }));
});
const tail = (o, n = 3) => o.trim().split('\n').slice(-n).join('\n');
const summary = (o) => (o.match(/(\d+) passed, (\d+) failed/) || [])[0];

const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } });
const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1', maxConnections: 20 });
await server.start();
let app = null, mock = null;
const teardown = async () => { try { app?.kill('SIGKILL'); } catch {} try { mock?.kill('SIGKILL'); } catch {} try { await server.stop(); } catch {} try { await db.close(); } catch {} };

try {
  console.log(`▸ live Postgres (PGlite) on :${PORT}`);
  let r = await sh('node', ['scripts/migrate.mjs']);
  console.log(`▸ migrate: ${r.code === 0 ? 'ok — ' + tail(r.o, 1) : 'FAILED\n' + r.o.slice(-1200)}`);
  if (r.code) { await teardown(); process.exit(1); }
  r = await sh('npx', ['tsx', 'scripts/seed.ts'], CREDS);
  if (r.code) { console.log('▸ seed FAILED\n' + r.o.slice(-1200)); await teardown(); process.exit(1); }
  console.log('▸ seed: ok (PALACE + owner@palace.test)');
  r = await sh('npx', ['tsx', 'scripts/seed-frontdesk.ts']); // for e2e-rbac; best-effort
  console.log(`▸ seed-frontdesk: ${r.code === 0 ? 'ok' : 'skipped'}`);

  // Card gateway for the CardPointe path. Targets a REAL sandbox if CARDPOINTE_BASE_URL/SITE is exported; otherwise a
  // faithful local CardPointe-shaped mock (scripts/cardpointe-mock-server.mjs). Either way the REAL CardPointeClient runs.
  const liveSandbox = !!(process.env.CARDPOINTE_BASE_URL || process.env.CARDPOINTE_SITE);
  let cardEnv;
  if (liveSandbox) {
    cardEnv = { PAYMENTS_ALLOW_ENV_FALLBACK: '1', CARDPOINTE_CURRENCY: process.env.CARDPOINTE_CURRENCY || 'USD' }; // CARDPOINTE_* inherited from env
    console.log('▸ card gateway: LIVE CardPointe sandbox (from CARDPOINTE_* env)');
  } else {
    const MOCK = Number(process.env.MOCK_PORT) || 4599;
    mock = spawn('node', ['scripts/cardpointe-mock-server.mjs'], { cwd: API, env: { ...process.env, MOCK_PORT: String(MOCK) }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((s) => setTimeout(s, 600));
    cardEnv = { PAYMENTS_ALLOW_ENV_FALLBACK: '1', CARDPOINTE_BASE_URL: `http://127.0.0.1:${MOCK}`, CARDPOINTE_MERCHID: '496160873888', CARDPOINTE_USERNAME: 'apiuser', CARDPOINTE_PASSWORD: 's3cret', CARDPOINTE_CURRENCY: 'USD' };
    console.log(`▸ card gateway: faithful local mock on :${MOCK} (export CARDPOINTE_* to target a real sandbox)`);
  }

  app = spawn('node', ['dist/main.js'], { cwd: API, env: { ...base, ...cardEnv, PG_POOL_MAX: '1', PORT: String(APP), AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET || 'e2e-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; app.stdout.on('data', (d) => (log += d)); app.stderr.on('data', (d) => (log += d));
  const ready = await (async () => { for (let i = 0; i < 80; i++) { try { const x = await fetch(`http://127.0.0.1:${APP}/`); if (x.status) return true; } catch {} await new Promise((s) => setTimeout(s, 500)); } return false; })();
  if (!ready) { console.log('▸ API did not start:\n' + log.slice(-1800)); await teardown(); process.exit(1); }
  console.log(`▸ API listening on :${APP}\n`);

  const E2E_ENV = { E2E_BASE: `http://127.0.0.1:${APP}`, E2E_PG_PORT: String(PORT) };
  const GATE = ['e2e-flow', 'e2e-customer-journey', 'e2e-tech-journey', 'e2e-owner-journey', 'e2e-rbac', 'e2e-receipts', 'e2e-skill', 'e2e-cardpointe']; // *-journey = per-app live self-service (customer register→book; tech accept/serve; owner sees live data across dashboards); e2e-cardpointe = real CardPointe client over the gateway above
  const SYNTH = ['e2e-payments', 'e2e-giftcard'];  // these target the separate PAYMENTS_SANDBOX synth path (sbx_ refs), not the live client
  let gateOk = true;
  console.log(`— Gate suite (live DB; CardPointe client → ${liveSandbox ? 'LIVE sandbox' : 'mock gateway'}) —`);
  for (const h of GATE) { const x = await sh('node', [`scripts/${h}.mjs`], E2E_ENV); console.log(`  ${x.code === 0 ? '✅' : '❌'} ${h}: ${summary(x.o) || (x.code === 0 ? 'passed' : 'failed')}`); if (x.code) { gateOk = false; console.log('     ' + x.o.split('\n').filter((l) => l.includes('❌')).slice(0, 4).join('\n     ')); } }
  console.log('\n— Synth-mode harnesses (need PAYMENTS_SANDBOX=1; informational in live-client mode) —');
  for (const h of SYNTH) { const x = await sh('node', [`scripts/${h}.mjs`], E2E_ENV); console.log(`  ⏭︎ ${h}: ${summary(x.o) || (x.code === 0 ? 'passed' : 'n/a in live-client mode')}`); }

  app.kill('SIGKILL'); app = null; await new Promise((s) => setTimeout(s, 500));

  // RLS confirmation on the same live DB (app stopped → single connection). Mirrors staged-patches/tenant-rls/042.
  console.log('\n— RLS confirmation (same live DB) —');
  const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres' });
  await c.connect();
  await c.query(`DO $$ DECLARE t text; BEGIN
    FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id' LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
      EXECUTE format($f$CREATE POLICY tenant_isolation ON public.%I USING (tenant_id::text = current_setting('app.current_tenant', true)) WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true))$f$, t);
    END LOOP; END $$;`);
  const pol = (await c.query(`SELECT count(*)::int n FROM pg_policies WHERE policyname='tenant_isolation'`)).rows[0].n;
  const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  await c.query(`INSERT INTO pos_payment_terminals (id,tenant_id,label) VALUES ('rls-A',$1,'A'),('rls-B',$2,'B')`, [A, B]);
  await c.query(`CREATE ROLE app_user; GRANT USAGE ON SCHEMA public TO app_user; GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA public TO app_user`);
  const seen = async (t) => { await c.query('SET ROLE app_user'); await c.query(`SELECT set_config('app.current_tenant',$1,false)`, [t ?? '']); const n = (await c.query(`SELECT count(*)::int n FROM pos_payment_terminals WHERE id LIKE 'rls-%'`)).rows[0].n; await c.query('RESET ROLE'); return n; };
  const sa = await seen(A), sb = await seen(B), sn = await seen(null);
  await c.end();
  const rlsOk = pol > 0 && sa === 1 && sb === 1 && sn === 0;
  console.log(`  ${rlsOk ? '✅' : '❌'} ${pol} policies; GUC=A→${sa}, GUC=B→${sb}, unset→${sn} (cross-tenant blocked, fail-closed)`);

  await teardown();
  const gating = gateOk && rlsOk;
  console.log(`\n${gating ? '✅ LIVE-DB E2E + CARD + RLS: PASS' : '❌ LIVE-DB E2E + CARD + RLS: FAIL'}`);
  process.exit(gating ? 0 : 1);
} catch (e) {
  console.error('e2e-live fatal:', e?.message || e);
  await teardown();
  process.exit(1);
}
