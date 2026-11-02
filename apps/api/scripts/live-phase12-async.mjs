#!/usr/bin/env node
// live-phase12-async.mjs — BUILD_PLAN Phase 12 (Constitution 5 §32–33): the ONE async operation contract, proved on the
// real API, a SEPARATE worker process and PostgreSQL. Nothing is stubbed:
//   1. the API (PROCESS_ROLE=api — it runs no job) answers three exports with `Prefer: respond-async` → 202 + Location +
//      { operationId, status: 'queued', statusUrl, pollAfterMs }: POS customers (a manager), Super Admin settlements
//      (a platform user), an owner report (the owner's staff report);
//   2. while they wait, the manager is DEMOTED (role → FRONT_DESK, which has no customer export) and asks again — that
//      second request is refused at the door (403), and the export already queued must not run;
//   3. the worker process (dist/worker.js, PROCESS_ROLE=worker) starts and drains: the owner's and the platform user's
//      operations reach `succeeded`; the demoted manager's ends `failed` / PERMISSION_DENIED (re-authorized from the
//      CURRENT grants at run time);
//   4. each file is downloaded and checked: CSV header, the rows, salon scope (the proof salon's rows only — salon B's
//      customer and technician never appear), the Phase 9 export snapshot written by the worker;
//   5. another salon's owner gets 404 on the operation and its download; the realm list shows only one's own;
//   6. a small export WITHOUT the header still answers synchronously (200) — no client breaks;
//   7. cleanup: every row, job and private file this proof made.
// Run:  DATABASE_URL=postgres://… node scripts/live-phase12-async.mjs   (apps/api built). Never point it at production.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { rmSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const R = {
  login: '/auth/login', selectBranch: '/auth/select-branch',
  posCustomersExport: '/pos/customers/export', saSettlementsExport: '/super-admin/settlements/export',
  ownerReportExport: (id) => `/owner/reports/${id}/export`, posOps: '/pos/operations', posOp: (id) => `/pos/operations/${id}`,
};
const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = 3062, API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (x) => JSON.stringify(x ?? null).slice(0, 220);
const code = (b) => b?.code ?? b?.error?.code ?? b?.message?.code ?? null;

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const TA = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!TA) { console.error(`salon ${SALON} not found`); process.exit(2); }

async function removeProofTenant(tenantId) {
  await client.query('begin');
  try {
    for (const t of ['user_branch_access', 'sessions', 'refresh_tokens']) await client.query(`delete from ${t} where user_id in (select id from users where tenant_id = $1)`, [tenantId]).catch(() => undefined);
    for (const t of ['api_operations', 'technicians', 'customers', 'users', 'branches']) { await client.query('savepoint s'); try { await client.query(`delete from ${t} where tenant_id = $1`, [tenantId]); await client.query('release savepoint s'); } catch { await client.query('rollback to savepoint s'); } }
    await client.query('savepoint s');
    let removed = false;
    try { await client.query(`delete from tenants where id = $1`, [tenantId]); await client.query('release savepoint s'); removed = true; } catch { await client.query('rollback to savepoint s'); }
    await client.query('commit');
    return { removed };
  } catch (e) { await client.query('rollback').catch(() => undefined); throw e; }
}
for (const r of await q(`select id from tenants where tenant_slug like 'live-phase12-proof-%'`)) await removeProofTenant(r.id);
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase12 Proof%'`, [TA])) await removeProofBranchTx(client, TA, r.id).catch(() => undefined);

const STARTED = new Date();
const tag = String(Date.now()).slice(-6);
const PW = 'Phase12!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const BA = randomUUID(), TB = randomUUID(), BB = randomUUID();
const OWN = randomUUID(), MGR = randomUUID(), O_B = randomUUID(), SA = randomUUID();
const CUST = [randomUUID(), randomUUID(), randomUUID()], CUST_B = randomUUID(), TECH = randomUUID(), TECH_B = randomUUID();
const email = (k) => `phase12-${k}-${tag}@aipowersalon.test`;
const allUsers = [OWN, MGR, O_B, SA];
const PRIVATE_ROOT = mkdtempSync(join(tmpdir(), 'p12-private-'));

await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1, $2, $3, 'active', 'America/New_York', '12 Proof Way')`, [BA, TA, `Live Phase12 Proof ${tag}`]);
for (const [i, id] of CUST.entries()) await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, $3, $4, 'Twelve', $4 || ' Twelve')`, [id, TA, BA, `P12A${tag}c${i}`]);
await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1, $2, $3, 'Tia', 'P12', $4, 'active')`, [TECH, TA, BA, `Tia P12A${tag}`]);
const addUser = async (id, tenant, branch, role, key, level) => {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,'P12','Twelve','P12 Twelve',$4,$5,'active',$6)`, [id, tenant, branch, email(key), hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [tenant, branch, id, level]);
};
await addUser(OWN, TA, BA, 'OWNER', 'own', 'manager');
await addUser(MGR, TA, BA, 'MANAGER', 'mgr', 'manager');
await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, lifecycle_state) values ($1, $2, $2, $3, $4, 'active', 'ACTIVE')`, [TB, `Live Phase12 Proof Salon B ${tag}`, `live-phase12-proof-${tag}`, `P12B${tag}`]);
await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1, $2, 'Live Phase12 Proof B', 'active', 'America/New_York', '13 Proof Way')`, [BB, TB]);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, $3, $4, 'Twelve', $4 || ' Twelve')`, [CUST_B, TB, BB, `P12B${tag}cust`]);
await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1, $2, $3, 'Tob', 'P12', $4, 'active')`, [TECH_B, TB, BB, `Tob P12B${tag}`]);
await addUser(O_B, TB, BB, 'OWNER', 'ob', 'manager');
await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'Pat', 'Twelve', 'Pat Twelve', $2, $3, 'active', 'SUPER_ADMIN', false, 'PLATFORM_SUPER_ADMIN')`, [SA, email('sa'), hash]);

const baseEnv = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true', PRIVATE_FILES_ROOT: PRIVATE_ROOT };
for (const k of ['CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'WORKER_JOB_CLASSES']) delete baseEnv[k];
Object.assign(baseEnv, { AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off' });
let api = null, worker = null; let errs = '', werrs = '';
const opIds = [];

const cleanup = async () => {
  try { api?.kill('SIGTERM'); } catch { /* */ }
  try { worker?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1500);
  const ops = (await q(`select id, job_id from api_operations where actor_user_id = any($1::text[])`, [allUsers])).map((r) => r);
  await q(`delete from jobs where id = any($1::uuid[]) or (job_type = 'api.export' and payload->>'operationId' = any($2::text[]))`, [ops.map((o) => o.job_id).filter(Boolean), ops.map((o) => o.id)]).catch(() => undefined);
  await q(`delete from api_operations where actor_user_id = any($1::text[])`, [allUsers]).catch(() => undefined);
  for (const u of allUsers) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices', 'authorization_denials']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [['own', 'mgr', 'ob', 'sa'].map(email)]).catch(() => undefined);
  await q(`delete from technicians where id = $1`, [TECH]).catch(() => undefined);
  const a = await removeProofBranchTx(client, TA, BA).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[]) and (tenant_id = $2 or tenant_id is null)`, [[OWN, MGR, SA], TA]).catch(() => undefined);
  await q(`delete from users where id = $1`, [SA]).catch(() => undefined);
  const b = await removeProofTenant(TB).catch(() => ({ removed: false }));
  rmSync(PRIVATE_ROOT, { recursive: true, force: true });
  const left = (await q(`select (select count(*)::int from users where id = any($1::uuid[])) + (select count(*)::int from api_operations where actor_user_id = any($2::text[]))
      + (select count(*)::int from branches where id = any($3::uuid[])) + (select count(*)::int from tenants where id = $4) as n`, [allUsers, allUsers, [BA, BB], TB]))[0].n;
  const snaps = (await q(`select count(*)::int as n from export_snapshots where user_id = any($1::uuid[])`, [allUsers]).catch(() => [{ n: '?' }]))[0].n;
  check('cleanup: proof branch, salon B, the proof people, their sessions, operations, jobs and private files are gone', a.removed && b.removed && left === 0 && !existsSync(PRIVATE_ROOT),
    `branch ${a.removed} [${(a.kept ?? []).join(', ')}] tenantB ${b.removed} left=${left} (append-only export_snapshots kept: ${snaps})`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); console.log(results.join('\n')); process.exit(1); }, 8 * 60_000);

const cookieJar = (...lists) => { const jar = new Map(); for (const c of lists.flat()) { const k = c.split('=')[0]; if (k) jar.set(k, c); } return [...jar.values()].join('; '); };
const setCookies = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
const call = (cookie) => async (path, hdr = {}) => {
  const r = await fetch(API + path, { headers: { cookie, ...hdr } });
  const buf = Buffer.from(await r.arrayBuffer()); const text = buf.toString('utf8'); let body = text; try { body = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, body, text, headers: r.headers };
};
const login = async (body, branchId) => {
  const l = await fetch(API + R.login, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const c1 = setCookies(l);
  if (!branchId) return { ok: l.status === 200, detail: `login ${l.status}`, get: call(cookieJar(c1)) };
  const sel = await fetch(API + R.selectBranch, { method: 'POST', headers: { cookie: cookieJar(c1), 'content-type': 'application/json' }, body: JSON.stringify({ branchId }) });
  return { ok: l.status === 200 && sel.status === 200, detail: `login ${l.status} select ${sel.status}`, get: call(cookieJar(c1, setCookies(sel))) };
};
const ASYNC = { prefer: 'respond-async' };
const isAccepted = (r) => r.status === 202 && r.body?.status === 'queued' && typeof r.body?.operationId === 'string' && r.body?.statusUrl === r.headers.get('location') && Number(r.body?.pollAfterMs) > 0;
const poll = async (who, statusUrl, ms = 90_000) => {
  const end = Date.now() + ms; let s;
  do { s = await who.get(statusUrl); if (['succeeded', 'failed', 'expired', 'canceled'].includes(s.body?.status)) return s; await sleep(400); } while (Date.now() < end);
  return s;
};

try {
  api = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env: { ...baseEnv, PORT: String(PORT), PROCESS_ROLE: 'api' }, stdio: ['ignore', 'ignore', 'pipe'] });
  api.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL with PROCESS_ROLE=api (it runs no job)', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');

  const own = await login({ portal: 'tenant', salonCode: SALON, identifier: email('own'), password: PW }, BA);
  const mgr = await login({ portal: 'tenant', salonCode: SALON, identifier: email('mgr'), password: PW }, BA);
  const ob = await login({ portal: 'tenant', salonCode: `P12B${tag}`, identifier: email('ob'), password: PW }, BB);
  const sa = await login({ portal: 'super-admin', identifier: email('sa'), password: PW, mfaCode: '123456' });
  check('owner, manager (salon A), owner (salon B) and a platform user sign in', own.ok && mgr.ok && ob.ok && sa.ok, `${own.detail} / ${mgr.detail} / ${ob.detail} / ${sa.detail}`);

  // 6 first: no header → the synchronous answer, exactly as before
  const sync = await own.get(R.posCustomersExport);
  check('a small export without the header still answers synchronously (200, { csv }) — no client breaks', sync.status === 200 && typeof sync.body?.csv === 'string' && sync.body.csv.includes(`P12A${tag}c0`), `${sync.status} ${short(sync.body).slice(0, 120)}`);

  // 1. three exports asked for asynchronously
  const mAcc = await mgr.get(R.posCustomersExport, ASYNC);
  const sAcc = await sa.get(R.saSettlementsExport, ASYNC);
  const oAcc = await own.get(R.ownerReportExport('staff') + '?period=month', ASYNC);
  const oCust = await own.get(R.posCustomersExport + '?async=1');
  check('POS customers (manager), Super Admin settlements, an owner report and ?async=1 → 202 + Location + { operationId, queued, statusUrl, pollAfterMs }',
    isAccepted(mAcc) && isAccepted(sAcc) && isAccepted(oAcc) && isAccepted(oCust) && mAcc.headers.get('preference-applied') === 'respond-async',
    `${mAcc.status} ${short(mAcc.body)} | ${sAcc.status} ${sAcc.body?.statusUrl} | ${oAcc.status} ${oAcc.body?.statusUrl} | ${oCust.status}`);
  for (const r of [mAcc, sAcc, oAcc, oCust]) if (r.body?.operationId) opIds.push(r.body.operationId);
  const rows = await q(`select id, status, realm, tenant_id, job_id, params from api_operations where id = any($1::uuid[])`, [opIds]);
  check('each is an api_operations row (queued, its realm, its salon — the platform one has none) with a queued api.export job, nothing run yet',
    rows.length === 4 && rows.every((r) => r.status === 'queued' && r.job_id) && rows.find((r) => r.id === sAcc.body?.operationId)?.tenant_id === null
      && rows.find((r) => r.id === oAcc.body?.operationId)?.realm === 'owner' && rows.find((r) => r.id === mAcc.body?.operationId)?.tenant_id === TA,
    rows.map((r) => `${r.realm}:${r.status}:${r.tenant_id ? 'salon' : 'platform'}`).join(' '));
  const queuedStatus = await mgr.get(mAcc.body.statusUrl);
  check('the status URL reads queued (no file yet)', queuedStatus.status === 200 && queuedStatus.body?.status === 'queued' && !queuedStatus.body?.result, `${queuedStatus.status} ${short(queuedStatus.body)}`);

  // 2. demote the manager while the export waits
  await q(`update users set role = 'FRONT_DESK' where id = $1`, [MGR]);
  // The API's request path reads authorization through the Phase 9 cache (≤ 30 s, dropped at once only when THIS process
  // made the change — here the change is a direct SQL update). So within that window the door may still say 202; the
  // worker reads the CURRENT grants fresh, and that export must fail too. After the window the door refuses.
  const again = await mgr.get(R.posCustomersExport, ASYNC);
  if (again.body?.operationId) opIds.push(again.body.operationId);

  // 5 (before the worker): another salon
  const foreign = await ob.get(R.posOp(mAcc.body.operationId)), foreignDl = await ob.get(R.posOp(mAcc.body.operationId) + '/download');
  const foreignOwner = await ob.get(`/owner/operations/${oAcc.body.operationId}`);
  check("another salon's owner gets 404 on the operation, its download and an owner-realm one (never 403)", foreign.status === 404 && foreignDl.status === 404 && foreignOwner.status === 404, `${foreign.status} ${foreignDl.status} ${foreignOwner.status}`);
  const wrongRealm = await own.get(R.posOp(oAcc.body.operationId));
  check('an operation is read only in its own realm (the owner report under /pos/operations → 404)', wrongRealm.status === 404, `${wrongRealm.status}`);

  // 3. the worker process
  worker = spawn('node', ['dist/worker.js'], { cwd: new URL('../', import.meta.url).pathname, env: { ...baseEnv, PROCESS_ROLE: 'worker', WORKER_JOB_CLASSES: 'report' }, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stderr.on('data', (c) => { werrs += c; }); worker.stdout.on('data', (c) => { werrs += c; });
  const sDone = await poll(sa, sAcc.body.statusUrl), oDone = await poll(own, oAcc.body.statusUrl), cDone = await poll(own, oCust.body.statusUrl), mDone = await poll(own, mAcc.body.statusUrl);
  check('a separate worker process drains them: the platform user\'s, the owner\'s report and the owner\'s customers → succeeded',
    sDone.body?.status === 'succeeded' && oDone.body?.status === 'succeeded' && cDone.body?.status === 'succeeded',
    `sa ${sDone.status}/${sDone.body?.status} ${short(sDone.body?.error)} | owner ${oDone.body?.status} ${short(oDone.body?.error)} | cust ${cDone.body?.status} ${short(cDone.body?.error)} | ${werrs.split('\n').filter((l) => /error/i.test(l)).slice(-2).join(' | ')}`);
  check("the demoted manager's queued export ends failed / PERMISSION_DENIED (re-authorized from the CURRENT grants when it ran)",
    mDone.body?.status === 'failed' && mDone.body?.error?.code === 'PERMISSION_DENIED' && !mDone.body?.result, `${mDone.status} ${short(mDone.body)}`);
  const againDone = again.status === 202 ? await poll(own, again.body.statusUrl) : null;
  check('asked again after the demotion: refused at the door (403), or — inside the ≤30 s authorization cache — queued and then failed PERMISSION_DENIED at run time; never a file',
    again.status === 403 || (againDone?.body?.status === 'failed' && againDone.body.error?.code === 'PERMISSION_DENIED' && !againDone.body.result),
    `door ${again.status}${againDone ? ` → ${againDone.body?.status}/${againDone.body?.error?.code}` : ''}`);
  await sleep(31_000);
  const later = await mgr.get(R.posCustomersExport, ASYNC);
  check('once the authorization cache window has passed, the demoted manager is refused at the door (403 — nothing queued)', later.status === 403 || later.status === 401, `${later.status} ${short(later.body)}`);
  if (later.body?.operationId) opIds.push(later.body.operationId);
  const succeededRow = (await q(`select result_key from api_operations where id = $1`, [cDone.body.operationId]))[0];
  check('the file went to the PRIVATE store under <env>/operations/<tenant>/<operationId>/<filename> (never /media)',
    !!succeededRow?.result_key && succeededRow.result_key.includes(`/operations/${TA}/${cDone.body.operationId}/`) && existsSync(join(PRIVATE_ROOT, succeededRow.result_key)), String(succeededRow?.result_key));

  // 4. the files
  const cFile = await own.get(cDone.body.result.downloadUrl);
  const lines = String(cFile.text).split(/\r?\n/).filter(Boolean);
  check('POS customers: the download is the CSV (header + the proof salon\'s rows), attachment, private no-store; salon B\'s customer is absent',
    cFile.status === 200 && /text\/csv/.test(cFile.headers.get('content-type') ?? '') && /attachment/.test(cFile.headers.get('content-disposition') ?? '')
      && /no-store/.test(cFile.headers.get('cache-control') ?? '') && /name/i.test(lines[0] ?? '') && CUST.every((_, i) => cFile.text.includes(`P12A${tag}c${i}`)) && !cFile.text.includes(`P12B${tag}`)
      && cDone.body.result.rows === lines.length - 1 && cDone.body.result.body?.contentField === 'csv',
    `${cFile.status} ${cFile.headers.get('content-type')} header=${(lines[0] ?? '').slice(0, 60)} rows=${lines.length - 1}/${cDone.body.result.rows}`);
  const oFile = await own.get(oDone.body.result.downloadUrl);
  check("the owner's staff report: CSV with its header and the proof branch's technician — never salon B's",
    oFile.status === 200 && /Technician/.test(oFile.text.split('\n')[0] ?? '') && oFile.text.includes(`Tia P12A${tag}`) && !oFile.text.includes(`P12B${tag}`), `${oFile.status} ${oFile.text.slice(0, 120)}`);
  const sFile = await sa.get(sDone.body.result.downloadUrl);
  check('Super Admin settlements: the file downloads with a CSV header for the platform user', sFile.status === 200 && (sFile.text.split('\n')[0] ?? '').includes(',') && sDone.body.result.filename.endsWith('.csv'),
    `${sFile.status} ${sDone.body.result.filename} ${(sFile.text.split('\n')[0] ?? '').slice(0, 80)}`);
  const foreignAfter = await ob.get(R.posOp(cDone.body.operationId) + '/download');
  check("salon B still gets 404 on salon A's finished file", foreignAfter.status === 404, `${foreignAfter.status}`);
  const snaps = await q(`select user_id, permission, row_count, route from export_snapshots where created_at >= $1 and user_id = any($2::uuid[]) order by created_at`, [STARTED, [OWN, SA]]);
  check('the Phase 9 export snapshot was written by the worker when each file was produced (who, key, rows)',
    snaps.some((s) => s.user_id === OWN && /customers/.test(s.permission) && s.row_count === lines.length - 1) && snaps.some((s) => s.user_id === SA) && snaps.filter((s) => s.user_id === OWN).length >= 3,
    snaps.map((s) => `${s.user_id === SA ? 'sa' : 'own'}:${s.permission}:${s.row_count}`).join(' '));
  const list = await own.get(R.posOps);
  check("the realm list shows the owner's own POS operation (and not the manager's)", list.status === 200 && list.body?.items?.some((i) => i.operationId === cDone.body.operationId) && !list.body.items.some((i) => i.operationId === mAcc.body.operationId),
    `${list.status} ${list.body?.items?.length}`);
  const audit = (await q(`select count(*)::int as n from audit_events where module = 'api_operations' and created_at >= $1 and tenant_id = $2`, [STARTED, TA]).catch(() => [{ n: -1 }]))[0].n;
  check('the operations are audited (requested / completed / failed / downloaded)', audit >= 5, `audit_events rows: ${audit}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).slice(0, 400));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
