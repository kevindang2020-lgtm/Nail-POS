#!/usr/bin/env node
// live-phase9-permissions.mjs — BUILD_PLAN Phase 9 (Constitution 2, Permissions & Authorization), proved on the real API
// and PostgreSQL. Nothing is stubbed: owners, a manager, front-desk staff and a technician sign in and call the endpoints
// the POS calls (contract §2.6 /pos/access/*, §3.4 /pos/security/*, §5.3 /pos/approvals/*). The exit criteria:
//   1. a manager cannot escalate — self-assign General Manager, a custom role above their own permissions, an ALLOW
//      override on themselves (or above their ceiling on someone else) — all refused, nothing stored;
//   2. the owner demotes the manager → the manager's NEXT request on the SAME session is refused for a key they lost
//      (authorization version; the response says x-authorization-changed: 1); restoring the role restores the access;
//   3. a temporary ALLOW works, then expires on its own; a DENY override beats the role (and the denial is recorded);
//   4. a branch-scoped person cannot select a branch outside their access;
//   5. salon B (a proof tenant with exactly two owners): two owners demote each other at once → one wins, the other is
//      409 LAST_OWNER; ownership transfer needs step-up (refused without, stamped in sessions.last_step_up_at with) and
//      moves tenants.owner_user_id;
//   6. a front-desk cash refund over the threshold becomes an approval → the manager approves → it executes ONCE;
//   7. an access-review "revoke" ends the person's sessions; /pos/security/high-risk lists a fresh high-risk override;
//      /pos/security/denials counts the recorded denial.
// Every route / template / table name the proof relies on is in the two tables right below — adjust there, not inline.
//
// Run:  DATABASE_URL=postgres://… node scripts/live-phase9-permissions.mjs   (apps/api built). Never point it at
// production: it creates two proof branches in SALON_CODE (default PILOT01), a proof tenant (salon B) with its branch, and
// proof staff; it removes everything it made. Append-only rows (authorization_audit_events) stay and are counted.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

// ── the contract, in one place ─────────────────────────────────────────────────────────────────────────────────────
const R = {
  stepUp: '/auth/step-up', login: '/auth/login', selectBranch: '/auth/select-branch', me: '/auth/me',
  members: '/pos/access/members', member: (u) => `/pos/access/members/${u}`, role: (u) => `/pos/access/members/${u}/role`,
  overrides: (u) => `/pos/access/members/${u}/overrides`, revokeOverride: (id) => `/pos/access/overrides/${id}/revoke`,
  effective: (u) => `/pos/access/members/${u}/effective`, ownership: '/pos/access/ownership/transfer',
  customRole: '/pos/staff-roles',
  reviews: '/pos/security/access-reviews', reviewDecisions: (id) => `/pos/security/access-reviews/${id}/decisions`,
  highRisk: '/pos/security/high-risk', denials: '/pos/security/denials',
  approvals: '/pos/approvals', approval: (id) => `/pos/approvals/${id}`, decide: (id) => `/pos/approvals/${id}/decide`,
  payCash: (t) => `/pos/checkout/tickets/${t}/pay/cash`, refund: (t) => `/pos/checkout/tickets/${t}/refund`,
  reportsProbe: '/pos/reports/kpis',          // pos.reports.view → reports.view (the front desk does not hold it)
  customersProbe: '/pos/customers/kpis',      // pos.customers.view → customers.view (the front desk holds it)
};
const ASSUME = {
  SELF_TEMPLATE: 'GENERAL_MANAGER',           // what the manager tries to give themselves
  DEMOTE_TEMPLATE: 'ACCOUNTANT',              // a MANAGER-based template WITHOUT roles.view → GET /pos/access/members is lost
  FRONT_DESK_TEMPLATE: 'RECEPTIONIST',        // BRANCH-scoped: confined to its user_branch_access branches (default (1))
  OWNER_DEMOTE_TEMPLATE: 'GENERAL_MANAGER',   // assigning a MANAGER-based template to an OWNER demotes them (base role changes)
  KEEP_PREVIOUS_OWNER_AS: 'GENERAL_MANAGER',  // the previous owner's template after the transfer
  ABOVE_CEILING_KEY: 'settings.edit',         // the MANAGER role does not hold it
  OVERRIDE_KEY_FOR_MANAGER: 'permissions.override',   // the owner lets the manager try overrides at all
  TEMP_KEY: 'reports.view', DENY_KEY: 'customers.view', HIGH_RISK_KEY: 'customers.export',
  TEMP_GRANT_SECONDS: 8, EXPIRY_WAIT_MS: 45_000,      // decision-time expiry; the version cache is ≤ 30 s
  PAY_CENTS: 10_000, REFUND_CENTS: 8_000,     // a cash refund over the $50 default threshold → an approval
  APPROVALS_TABLE: 'tenant_approval_requests', ACCESS_REVIEW_TABLE_LIKE: 'access_review%',
  // the ticket refund answers { tenders: [{ status: 'approval_pending', approvalId }] } (checkout.service refundNeedsApproval)
  approvalIdFrom: (b) => b?.tenders?.find?.((t) => t?.approvalId)?.approvalId ?? b?.approvalId ?? b?.approval?.id ?? null,
  isDenialFor: (row, key) => row.permission === key || row.permission === `pos.${key}`,
};

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = 3059, API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const waitForRows = async (fn, ok, ms) => { const end = Date.now() + ms; let v = await fn(); while (!ok(v) && Date.now() < end) { await sleep(250); v = await fn(); } return v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); let body = t; try { body = JSON.parse(t); } catch { /* text */ } return { status: r.status, body, text: t, authzChanged: r.headers.get('x-authorization-changed') }; };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 220);
const code = (b) => b?.code ?? b?.error?.code ?? b?.message?.code ?? null;
const refused = (r) => r.status >= 400 && r.status < 500 && code(r.body) !== 'STEP_UP_REQUIRED';

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const TA = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!TA) { console.error(`salon ${SALON} not found`); process.exit(2); }

/** every row of a proof tenant in any table with a *tenant_id column, then the tenant (same as live-phase8; append-only rows stay) */
async function removeProofTenant(tenantId) {
  const cols = await q(`select c.table_name, c.column_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name like '%tenant_id' and c.table_name <> 'tenants' and c.data_type = 'uuid'`);
  const kept = new Set();
  await client.query('begin');
  try {
    const tables = [...new Set(cols.map((r) => r.table_name))];
    for (const t of tables) {
      const refs = await q(`select c.conrelid::regclass::text as ref, a.attname as col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.contype = 'f' and c.confrelid = $1::regclass and array_length(c.conkey, 1) = 1`, [t]);
      if (!cols.find((r) => r.table_name === t && r.column_name === 'tenant_id')) continue;
      for (const r of refs) {
        if (tables.includes(r.ref.replace(/"/g, ''))) continue;
        await client.query('savepoint p');
        try { await client.query(`delete from ${r.ref} where "${r.col}" in (select id from "${t}" where tenant_id = $1)`, [tenantId]); await client.query('release savepoint p'); }
        catch { await client.query('rollback to savepoint p'); }
      }
    }
    let pending = cols;
    for (let pass = 0; pass < 10 && pending.length; pass++) {
      const next = [];
      for (const r of pending) {
        await client.query('savepoint p');
        try { await client.query(`delete from "${r.table_name}" where "${r.column_name}" = $1`, [tenantId]); await client.query('release savepoint p'); }
        catch { await client.query('rollback to savepoint p'); next.push(r); }
      }
      if (next.length === pending.length) { pending = next; break; }
      pending = next;
    }
    for (const r of pending) {
      const n = (await q(`select count(*)::int as n from "${r.table_name}" where "${r.column_name}" = $1`, [tenantId]))[0].n;
      if (n) kept.add(`${r.table_name}(${n})`);
    }
    await client.query('savepoint p');
    let removed = false;
    try { await client.query(`delete from tenants where id = $1`, [tenantId]); await client.query('release savepoint p'); removed = true; }
    catch (e) { await client.query('rollback to savepoint p'); kept.add(`tenants: ${String(e?.message || e).slice(0, 80)}`); }
    await client.query('commit');
    return { removed, kept: [...kept] };
  } catch (e) { await client.query('rollback').catch(() => undefined); throw e; }
}

// leftovers of an interrupted earlier run
for (const r of await q(`select id from tenants where tenant_slug like 'live-phase9-proof-%'`)) await removeProofTenant(r.id);
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase9 Proof%'`, [TA])) await removeProofBranchTx(client, TA, r.id);

const STARTED = new Date();
const tag = String(Date.now()).slice(-6);
const PW = 'Phase9!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const BA = randomUUID(), BA2 = randomUUID(), GEL = randomUUID(), TECH = randomUUID(), CW = randomUUID();
const OWN = randomUUID(), MGR = randomUUID(), FD = randomUUID(), REV = randomUUID();
const TB = randomUUID(), BB = randomUUID(), O1 = randomUUID(), O2 = randomUUID(), M3 = randomUUID();
const CODE_B = `P9B${tag}`;
const email = (k) => `phase9-${k}-${tag}@aipowersalon.test`;
const usersA = [OWN, MGR, FD, REV], usersB = [O1, O2, M3], allUsers = [...usersA, ...usersB];
const cat = (await q(`select category_id from services where tenant_id = $1 and status = 'active' and category_id is not null limit 1`, [TA]))[0]?.category_id;
if (!cat) { console.error('the salon needs an active service (for its category)'); process.exit(2); }

await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York','9 Proof Way'), ($4,$2,$5,'active','America/New_York','10 Proof Way')`, [BA, TA, `Live Phase9 Proof ${tag}`, BA2, `Live Phase9 Proof Other ${tag}`]);
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Live P9 Gel',45,${ASSUME.PAY_CENTS},'active')`, [GEL, TA, BA, cat]);
await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Tech','P9','Tech P9','active')`, [TECH, TA, BA]);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Walk','In','Walk In')`, [CW, TA, BA]);
const addUser = async (id, tenant, branch, role, key, fn, level) => {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,'Nine',$4 || ' Nine',$5,$6,'active',$7)`, [id, tenant, branch, fn, email(key), hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [tenant, branch, id, level]);
};
await addUser(OWN, TA, BA, 'OWNER', 'own', 'Olga', 'manager');
await addUser(MGR, TA, BA, 'MANAGER', 'mgr', 'Max', 'manager');
await addUser(FD, TA, BA, 'FRONT_DESK', 'fd', 'Fay', 'staff');
await addUser(REV, TA, BA, 'FRONT_DESK', 'rev', 'Rex', 'staff');
// salon B — a proof tenant with EXACTLY two owners (O1 primary) and a manager
await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,$2,$2,$3,$4,'active')`, [TB, `Live Phase9 Proof Salon B ${tag}`, `live-phase9-proof-${tag}`, CODE_B]);
await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York','11 Proof Way')`, [BB, TB, `Live Phase9 Proof B ${tag}`]);
await addUser(O1, TB, BB, 'OWNER', 'o1', 'Ona', 'manager');
await addUser(O2, TB, BB, 'OWNER', 'o2', 'Oto', 'manager');
await addUser(M3, TB, BB, 'MANAGER', 'm3', 'Mia', 'manager');
await q(`update tenants set owner_user_id = $2 where id = $1`, [TB, O1]);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY']) delete env[k];
env.AI_QUEUE_OPS_JOBS = 'off'; env.AI_SCHEDULING_JOBS = 'off'; env.COMMUNITY_JOBS = 'off';
let proc = null; let errs = '';
let reviewId = null;
const tickets = [];

const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1200);
  // the access review (B's tables): rows of THIS review only
  if (reviewId) for (const t of (await q(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name like $1 order by length(table_name) desc`, [ASSUME.ACCESS_REVIEW_TABLE_LIKE])).map((r) => r.table_name)) {
    const cs = (await q(`select column_name from information_schema.columns where table_name = $1`, [t])).map((r) => r.column_name);
    for (const c of ['review_id', 'access_review_id', 'id'].filter((x) => cs.includes(x))) await q(`delete from "${t}" where "${c}" = $1`, [reviewId]).catch(() => undefined);
  }
  await q(`delete from ${ASSUME.APPROVALS_TABLE} where tenant_id = $1 and (branch_id = $2 or requested_by_user_id = any($3::uuid[]))`, [TA, BA, allUsers]).catch(() => undefined);
  await q(`delete from authorization_denials where user_id = any($1::uuid[])`, [allUsers]).catch(() => undefined);
  await q(`delete from tenant_user_permission_overrides where user_id = any($1::uuid[])`, [allUsers]).catch(() => undefined);
  await q(`delete from staff_role_assignments where user_id = any($1::uuid[])`, [allUsers]).catch(() => undefined);
  await q(`delete from tenant_custom_roles where tenant_id = $1 and name like 'Live P9%'`, [TA]).catch(() => undefined);
  for (const u of allUsers) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [['own', 'mgr', 'fd', 'rev', 'o1', 'o2', 'm3'].map(email)]).catch(() => undefined);
  await q(`delete from outbox_events where created_at >= $1 and tenant_id = $2 and (payload_json->>'userId' = any($3::text[]))`, [STARTED, TA, allUsers]).catch(() => undefined);
  const a = await removeProofBranchTx(client, TA, BA).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  const a2 = await removeProofBranchTx(client, TA, BA2).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[]) and tenant_id = $2`, [usersA, TA]).catch(() => undefined);
  const b = await removeProofTenant(TB).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  const left = (await q(`select (select count(*)::int from users where id = any($1::uuid[])) + (select count(*)::int from branches where id = any($2::uuid[]))
      + (select count(*)::int from tenants where id = $3) + (select count(*)::int from tenant_user_permission_overrides where user_id = any($1::uuid[]))
      + (select count(*)::int from sessions where user_id = any($1::uuid[])) + (select count(*)::int from tickets where id = any($4::uuid[]))
      + (select count(*)::int from ${ASSUME.APPROVALS_TABLE} where tenant_id = $5 and requested_by_user_id = any($1::uuid[])) as n`,
    [allUsers, [BA, BA2, BB], TB, tickets, TA]))[0].n;
  const appendOnly = (await q(`select count(*)::int as n from authorization_audit_events where target_user_id = any($1::uuid[]) or actor_user_id = any($1::uuid[])`, [allUsers]).catch(() => [{ n: '?' }]))[0].n;
  check('cleanup: both proof branches, salon B, the proof staff, their sessions, overrides, approvals and the review are gone',
    a.removed && a2.removed && b.removed && left === 0,
    `branch ${a.removed}/${a2.removed} [${[...(a.kept ?? []), ...(a2.kept ?? [])].join(', ')}] tenantB ${b.removed} [${(b.kept ?? []).join(', ')}] left=${left} (append-only authorization_audit_events kept: ${appendOnly})`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); console.log(results.join('\n')); process.exit(1); }, 12 * 60_000);

// ── HTTP helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
const cookieJar = (...lists) => { const jar = new Map(); for (const c of lists.flat()) { const k = c.split('=')[0]; if (k) jar.set(k, c); } return [...jar.values()].join('; '); };
const setCookies = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
const as = (cookie) => (method, path, body, hdr = {}) => fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json', ...hdr }, body: body ? JSON.stringify(body) : undefined }).then(j);
const signIn = async (salon, key, branchId) => {
  const l = await fetch(API + R.login, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode: salon, identifier: email(key), password: PW }) });
  const c1 = setCookies(l);
  const sel = await fetch(API + R.selectBranch, { method: 'POST', headers: { cookie: cookieJar(c1), 'content-type': 'application/json' }, body: JSON.stringify({ branchId }) });
  const cookie = cookieJar(c1, setCookies(sel));
  return { ok: l.status === 200 && sel.status === 200, detail: `login ${l.status} select ${sel.status}`, cookie, call: as(cookie) };
};
const stepUp = (who) => who.call('POST', R.stepUp, { password: PW });
const reason = (s) => `Live P9: ${s}`;

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');

  const own = await signIn(SALON, 'own', BA), mgr = await signIn(SALON, 'mgr', BA), rev = await signIn(SALON, 'rev', BA);
  check('the owner, the manager and a front-desk person sign in at the proof branch', own.ok && mgr.ok && rev.ok, `${own.detail} / ${mgr.detail} / ${rev.detail}`);
  const ownUp = await stepUp(own), mgrUp = await stepUp(mgr);
  check('step-up with the password stamps the session (owner + manager)', ok2(ownUp.status) && ok2(mgrUp.status), `${ownUp.status} ${short(ownUp.body)} / ${mgrUp.status}`);
  // the front desk gets the BRANCH-scoped Receptionist template (also exercises the role route for the owner)
  const fdTpl = await own.call('PUT', R.role(FD), { templateKey: ASSUME.FRONT_DESK_TEMPLATE, reason: reason('front desk template') });
  check('the owner assigns the front desk the branch-scoped Receptionist template', ok2(fdTpl.status), `${fdTpl.status} ${short(fdTpl.body)}`);
  const fd = await signIn(SALON, 'fd', BA);

  // ── 1. escalation attempts by the manager ───────────────────────────────────────────────────────────────────────
  const selfGM = await mgr.call('PUT', R.role(MGR), { templateKey: ASSUME.SELF_TEMPLATE, reason: reason('self') });
  const tplNow = (await q(`select template_key from staff_role_assignments where user_id = $1`, [MGR]))[0]?.template_key ?? null;
  check('a manager cannot give THEMSELVES General Manager (refused after step-up, nothing stored)', refused(selfGM) && tplNow !== ASSUME.SELF_TEMPLATE, `${selfGM.status} ${code(selfGM.body)} template=${tplNow}`);
  const custom = await mgr.call('POST', R.customRole, { name: `Live P9 Above ${tag}`, baseRole: 'MANAGER', scope: 'TENANT', permissions: ['pos.login', ASSUME.ABOVE_CEILING_KEY] });
  const customRows = (await q(`select count(*)::int as n from tenant_custom_roles where tenant_id = $1 and name = $2`, [TA, `Live P9 Above ${tag}`]))[0].n;
  check('a manager cannot create a custom role holding a key they do not hold (settings.edit)', refused(custom) && customRows === 0, `${custom.status} ${code(custom.body)} rows=${customRows}`);
  const letTry = await own.call('POST', R.overrides(MGR), { permission: ASSUME.OVERRIDE_KEY_FOR_MANAGER, effect: 'ALLOW', reason: reason('let the manager try overrides') });
  const selfAllow = await mgr.call('POST', R.overrides(MGR), { permission: ASSUME.ABOVE_CEILING_KEY, effect: 'ALLOW', reason: reason('self allow') });
  const peerAbove = await mgr.call('POST', R.overrides(FD), { permission: ASSUME.ABOVE_CEILING_KEY, effect: 'ALLOW', reason: reason('above my ceiling') });
  const liveAbove = (await q(`select count(*)::int as n from tenant_user_permission_overrides where user_id = any($1::uuid[]) and permission = $2 and revoked_at is null`, [[MGR, FD], ASSUME.ABOVE_CEILING_KEY]))[0].n;
  check('with permissions.override granted, the manager still cannot ALLOW anything on themselves, nor ALLOW a key above their own on someone else',
    ok2(letTry.status) && refused(selfAllow) && refused(peerAbove) && liveAbove === 0, `grant ${letTry.status} ${code(letTry.body)} · self ${selfAllow.status} ${code(selfAllow.body)} · peer ${peerAbove.status} ${code(peerAbove.body)} · stored ${liveAbove}`);
  if (letTry.body?.id) await own.call('POST', R.revokeOverride(letTry.body.id), { reason: reason('done') });
  const superKey = await own.call('POST', R.overrides(FD), { permission: 'super_admin.tenants.view', effect: 'ALLOW', reason: reason('platform key') });
  check('not even the owner can hand out a super_admin.* key through an override', refused(superKey), `${superKey.status} ${code(superKey.body)}`);

  // ── 2. authorization version: demote → the SAME session is refused on its next request ───────────────────────────
  const before = await mgr.call('GET', R.members);
  const v0 = (await q(`select authorization_version as v from users where id = $1`, [MGR]))[0].v;
  const demote = await own.call('PUT', R.role(MGR), { templateKey: ASSUME.DEMOTE_TEMPLATE, reason: reason('demote') });
  const v1 = (await q(`select authorization_version as v from users where id = $1`, [MGR]))[0].v;
  const after = await mgr.call('GET', R.members);
  check('the owner demotes the manager (Accountant): their version moves, and their NEXT request on the same session is refused for roles.view',
    ok2(before.status) && ok2(demote.status) && v1 > v0 && after.status === 403 && (after.body?.permission ?? '').includes('roles.view'),
    `before ${before.status} demote ${demote.status} v ${v0}→${v1} after ${after.status} ${short(after.body)}`);
  check('… and that response tells the app its authorization changed (x-authorization-changed: 1)', after.authzChanged === '1', `header=${after.authzChanged}`);
  const restore = await own.call('PUT', R.role(MGR), { templateKey: null, reason: reason('restore') });
  const again = await mgr.call('GET', R.members);
  check('restoring the default Manager role restores the access on the same session', ok2(restore.status) && ok2(again.status), `${restore.status} ${again.status}`);

  // ── 3. temporary ALLOW expires; DENY beats the role; the denial is recorded ──────────────────────────────────────
  const r0 = await fd.call('GET', R.reportsProbe);
  const expiresAt = new Date(Date.now() + ASSUME.TEMP_GRANT_SECONDS * 1000).toISOString();
  const temp = await own.call('POST', R.overrides(FD), { permission: ASSUME.TEMP_KEY, effect: 'ALLOW', reason: reason('temporary'), expiresAt });
  const r1 = await fd.call('GET', R.reportsProbe);
  const t0 = Date.now(); let r2 = null;
  await sleep(Math.max(0, Date.parse(expiresAt) - Date.now()) + 500);
  while (Date.now() - t0 < ASSUME.EXPIRY_WAIT_MS) { r2 = await fd.call('GET', R.reportsProbe); if (r2.status === 403) break; await sleep(1000); }
  check('a temporary ALLOW of reports.view: refused before, allowed during, refused again after it expires (no one revoked it)',
    r0.status === 403 && ok2(temp.status) && temp.body?.temporary === true && ok2(r1.status) && r2?.status === 403,
    `before ${r0.status} grant ${temp.status} during ${r1.status} after ${r2?.status} (${Math.round((Date.now() - t0) / 1000)} s)`);
  const c0 = await fd.call('GET', R.customersProbe);
  const deny = await own.call('POST', R.overrides(FD), { permission: ASSUME.DENY_KEY, effect: 'DENY', reason: reason('deny beats role') });
  const c1 = await fd.call('GET', R.customersProbe);
  check('a DENY override beats the role: customers.view (a Receptionist key) is refused with reason denied_by_override',
    ok2(c0.status) && ok2(deny.status) && c1.status === 403 && (c1.body?.reason ?? c1.body?.error?.reason) === 'denied_by_override', `${c0.status} ${deny.status} ${c1.status} ${short(c1.body)}`);
  // the denial sink writes after the response (never on the request's path) — wait for it
  const denialRows = await waitForRows(async () => (await q(`select permission, reason from authorization_denials where tenant_id = $1 and user_id = $2`, [TA, FD])), (rows) => rows.some((d) => ASSUME.isDenialFor(d, ASSUME.DENY_KEY) && d.reason === 'denied_by_override'), 5000);
  check('the denial is recorded in authorization_denials (key + reason)', denialRows.some((d) => ASSUME.isDenialFor(d, ASSUME.DENY_KEY) && d.reason === 'denied_by_override'), short(denialRows));
  if (deny.body?.id) await own.call('POST', R.revokeOverride(deny.body.id), { reason: reason('lift the deny') });
  const c2 = await fd.call('GET', R.customersProbe);
  check('revoking the DENY gives the access back', ok2(c2.status), `${c2.status}`);

  // ── 4. branch scope ──────────────────────────────────────────────────────────────────────────────────────────────
  const selOther = await fd.call('POST', R.selectBranch, { branchId: BA2 });
  const selOwn = await fd.call('POST', R.selectBranch, { branchId: BA });
  check('a branch-scoped person cannot select a branch outside their access; their own branch works', selOther.status >= 400 && selOther.status < 500 && ok2(selOwn.status), `other ${selOther.status} ${code(selOther.body)} own ${selOwn.status}`);

  // ── 5. high-risk report lists a fresh high-risk override ─────────────────────────────────────────────────────────
  const hr = await own.call('POST', R.overrides(FD), { permission: ASSUME.HIGH_RISK_KEY, effect: 'ALLOW', reason: reason('high risk') });
  const report = await own.call('GET', R.highRisk);
  const fdRow = (report.body?.rows ?? []).find((r) => r.userId === FD);
  check('/pos/security/high-risk lists the new customers.export override for the front desk (via an override)',
    ok2(hr.status) && ok2(report.status) && !!fdRow?.permissions?.some((p) => p.key === ASSUME.HIGH_RISK_KEY && String(p.via).startsWith('granted_by_override')), `${hr.status} ${report.status} ${short(fdRow)}`);
  const dm = await own.call('GET', `${R.denials}?from=${STARTED.toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`);
  check('/pos/security/denials counts the front desk’s refusals', ok2(dm.status) && (dm.body?.byUser ?? []).some((u) => u.userId === FD && u.count >= 1), `${dm.status} total ${dm.body?.total}`);

  // ── 6. a front-desk refund over the threshold → approval → the manager approves → executes ONCE ─────────────────
  const T1 = randomUUID(); tickets.push(T1);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, tip_cents, ready_checkout_at) values ($1,$2,$3,$4,'ready_for_payment',$5,0, now())`, [T1, TA, BA, CW, TECH]);
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,'Live P9 Gel',$6,45,$6)`, [TA, BA, T1, GEL, TECH, ASSUME.PAY_CENTS]);
  const pay = await fd.call('POST', R.payCash(T1), { amountReceivedCents: 50_000 }, { 'idempotency-key': 'live-p9-' + randomUUID() });
  const payment = (await q(`select id from payments where tenant_id = $1 and ticket_id = $2 and status = 'approved'`, [TA, T1]))[0];
  // The stock front desk holds no refund key, so it ASKS through the approvals engine (agent D: the refund route itself
  // answers approval_pending only for a refund-key holder without checkout.approve_refund).
  const direct = await fd.call('POST', R.refund(T1), { reason: reason('customer unhappy'), amountCents: ASSUME.REFUND_CENTS }, { 'idempotency-key': 'live-p9-r-' + randomUUID() });
  check('the front desk cannot refund directly (no refund key) — refused, nothing refunded', direct.status === 403, `${direct.status} ${code(direct.body)}`);
  const ask = await fd.call('POST', R.approvals, { kind: 'refund', subjectType: 'payment', subjectId: payment?.id ?? null, amountCents: ASSUME.REFUND_CENTS, reason: reason('customer unhappy') });
  let approvalId = ask.body?.request?.id ?? ask.body?.id ?? ASSUME.approvalIdFrom(ask.body);
  if (!approvalId) approvalId = (await q(`select id from ${ASSUME.APPROVALS_TABLE} where tenant_id = $1 and kind = 'refund' and requested_by_user_id = $2 order by created_at desc limit 1`, [TA, FD]).catch(() => []))[0]?.id ?? null;
  const refundsNow = async () => (await q(`select count(*)::int as n, coalesce(sum(amount_cents), 0)::int as cents from payment_refunds where tenant_id = $1 and payment_id = $2`, [TA, payment?.id ?? '00000000-0000-0000-0000-000000000000']))[0];
  const rf0 = await refundsNow();
  check('a front-desk $80 cash refund (over the $50 default) is SENT FOR APPROVAL, not refused and not executed',
    ok2(pay.status) && !!payment && ask.status < 400 && !!approvalId && rf0.n === 0, `pay ${pay.status} refund ${ask.status} ${short(ask.body)} approval=${approvalId} refunds=${rf0.n}`);
  const inbox = await mgr.call('GET', `${R.approvals}?status=pending&kind=refund`);
  const item = (inbox.body?.items ?? []).find((a) => a.id === approvalId);
  const fdDecide = await fd.call('POST', R.decide(approvalId), { decision: 'approve', expectedVersion: item?.version ?? 1 });
  const ok = await mgr.call('POST', R.decide(approvalId), { decision: 'approve', note: 'ok', expectedVersion: item?.version ?? 1 });
  let rf1 = await refundsNow(); for (let i = 0; i < 20 && rf1.n === 0; i++) { await sleep(500); rf1 = await refundsNow(); }
  const twice = await mgr.call('POST', R.decide(approvalId), { decision: 'approve', expectedVersion: item?.version ?? 1 });
  await sleep(500);
  const rf2 = await refundsNow();
  const view = await mgr.call('GET', R.approval(approvalId));
  check('the manager sees it in the inbox; the requester cannot approve their own; the manager approves → the refund executes ONCE ($80); a second approve changes nothing',
    ok2(inbox.status) && !!item && fdDecide.status >= 400 && ok2(ok.status) && rf1.n === 1 && rf1.cents === ASSUME.REFUND_CENTS && twice.status >= 400 && rf2.n === 1 && ['executed', 'approved'].includes(view.body?.status),
    `inbox ${inbox.status} item ${!!item} self ${fdDecide.status} approve ${ok.status} refunds ${rf1.n}/${rf1.cents} again ${twice.status} → ${rf2.n} status ${view.body?.status}`);

  // ── 7. access review: revoke ends the person's sessions ──────────────────────────────────────────────────────────
  await stepUp(own);
  const meBefore = await rev.call('GET', R.me);
  const started = await own.call('POST', R.reviews, {});
  reviewId = started.body?.id ?? null;
  const inReview = (started.body?.items ?? []).some((i) => i.userId === REV);
  const dec = reviewId ? await own.call('POST', R.reviewDecisions(reviewId), { userId: REV, decision: 'revoke', note: reason('left the salon') }) : { status: 0, body: null };
  await sleep(300);
  const meAfter = await rev.call('GET', R.me);
  const liveSessions = (await q(`select count(*)::int as n from sessions where user_id = $1 and revoked_at is null`, [REV]))[0].n;
  const revStatus = (await q(`select status from users where id = $1`, [REV]))[0]?.status;
  check('an access review lists the person; "revoke" deactivates them and ends their sessions (their next call is 401)',
    ok2(meBefore.status) && ok2(started.status) && inReview && ok2(dec.status) && revStatus !== 'active' && liveSessions === 0 && meAfter.status === 401,
    `me ${meBefore.status} review ${started.status} listed ${inReview} decide ${dec.status} ${code(dec.body)} status ${revStatus} live sessions ${liveSessions} me after ${meAfter.status}`);

  // ── 8. salon B: last owner + ownership transfer ──────────────────────────────────────────────────────────────────
  const o1 = await signIn(CODE_B, 'o1', BB), o2 = await signIn(CODE_B, 'o2', BB);
  check('salon B’s two owners sign in', o1.ok && o2.ok, `${o1.detail} / ${o2.detail}`);
  const noStep = await o1.call('POST', R.ownership, { toUserId: M3, reason: reason('no step-up'), keepPreviousOwnerAs: ASSUME.KEEP_PREVIOUS_OWNER_AS });
  check('ownership transfer without a fresh step-up is refused (STEP_UP_REQUIRED) and moves nothing',
    noStep.status === 403 && code(noStep.body) === 'STEP_UP_REQUIRED' && (await q(`select owner_user_id from tenants where id = $1`, [TB]))[0].owner_user_id === O1, `${noStep.status} ${code(noStep.body)}`);
  await stepUp(o1); await stepUp(o2);
  const [d12, d21] = await Promise.all([
    o1.call('PUT', R.role(O2), { templateKey: ASSUME.OWNER_DEMOTE_TEMPLATE, reason: reason('race') }),
    o2.call('PUT', R.role(O1), { templateKey: ASSUME.OWNER_DEMOTE_TEMPLATE, reason: reason('race') }),
  ]);
  const owners = (await q(`select id from users where tenant_id = $1 and role = 'OWNER' and status = 'active'`, [TB])).map((r) => r.id);
  const wins = [d12, d21].filter((r) => ok2(r.status)).length;
  const lastOwner = [d12, d21].filter((r) => r.status === 409 && code(r.body) === 'LAST_OWNER').length;
  check('two owners demote each other at once: exactly one wins, the other is 409 LAST_OWNER — the salon keeps one owner',
    wins === 1 && lastOwner === 1 && owners.length === 1, `${d12.status} ${code(d12.body)} / ${d21.status} ${code(d21.body)} owners=${owners.length}`);
  const keeper = owners[0] === O1 ? o1 : o2; const keeperId = owners[0];
  const tr = await keeper.call('POST', R.ownership, { toUserId: M3, reason: reason('transfer'), keepPreviousOwnerAs: ASSUME.KEEP_PREVIOUS_OWNER_AS });
  const tAfter = (await q(`select owner_user_id from tenants where id = $1`, [TB]))[0]?.owner_user_id;
  const m3Role = (await q(`select role from users where id = $1`, [M3]))[0]?.role;
  const stamped = (await q(`select count(*)::int as n from sessions where user_id = $1 and revoked_at is null and last_step_up_at is not null`, [keeperId]))[0].n;
  const audited = (await q(`select count(*)::int as n from authorization_audit_events where tenant_id = $1 and action like 'ownership%'`, [TB]))[0].n;
  check('with step-up (stamped on the session in the DB) the owner transfers the salon: tenants.owner_user_id moves, the new owner is OWNER, it is audited',
    ok2(tr.status) && tr.body?.newOwnerUserId === M3 && tAfter === M3 && m3Role === 'OWNER' && stamped >= 1 && audited >= 1,
    `${tr.status} ${short(tr.body)} owner=${tAfter === M3 ? 'M3' : tAfter} role=${m3Role} stamped=${stamped} audit=${audited}`);

  const authzAudit = (await q(`select count(*)::int as n from authorization_audit_events where tenant_id = $1 and created_at >= $2 and (target_user_id = any($3::uuid[]))`, [TA, STARTED, usersA]))[0].n;
  check('every grant / revoke / role change in salon A is in authorization_audit_events', authzAudit >= 8, `rows ${authzAudit}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
