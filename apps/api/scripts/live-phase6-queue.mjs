#!/usr/bin/env node
// live-phase6-queue.mjs — BUILD_PLAN Phase 6 (ai_queue_assignment), proved on the real API and PostgreSQL with REAL
// queue entries. Nothing is stubbed: a receptionist, a manager-owner, a customer and a Super Admin sign in and call the
// same endpoints the apps call. The exit criteria:
//   • a suggestion is ACCEPTED through the queue's own assign (version + status history + idempotency), a rejection
//     needs a reason, an override is recorded; a stale board is refused (409), a manager's lock is honoured;
//   • CONCURRENCY on real Postgres: the auto-run and three receptionists assign ONE guest at the same moment → exactly
//     one assignment, one history row, nobody overwritten;
//   • the switches: the location's kill switch, the Super Admin's salon kill (step-up required), the per-run cap, and
//     the auto-run sees the WHOLE queue (no 20-row page);
//   • alerts: a guest waiting too long raises an alert (and notifies the owner); assigning them auto-resolves it;
//   • settings: versioned, a stale save is a 409; the role matrix (front desk cannot change rules or run automation);
//   • the customer accepts another technician from their own app (and cannot touch someone else's visit);
//   • reorder, groups, the overview / analytics / owner summary / CSV export / Super Admin oversight answer.
//
// Run:  DATABASE_URL=postgres://… node scripts/live-phase6-queue.mjs   (apps/api built). Never point it at production:
// it creates a proof branch, staff, two customer accounts and a Super Admin, may add the AI package to the salon for the
// run, and removes everything it made (the salon's own queue-assignment settings row is restored exactly).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.PORT_PROOF || 3056), API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 240);

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase6 Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);

const STARTED = new Date();
const tag = String(Date.now()).slice(-6);
const B = randomUUID(), OWN = randomUUID(), REC = randomUUID(), SA = randomUUID(), GEL = randomUUID();
const techs = Array.from({ length: 4 }, () => randomUUID());
const custs = Array.from({ length: 2 }, (_, i) => ({ user: randomUUID(), customer: randomUUID(), ident: randomUUID(), email: `phase6-c${i}-${tag}@aipowersalon.test`, phone: `+1856571${String(i).padStart(2, '0')}${tag.slice(-2)}` }));
const PW = 'Phase6!' + randomUUID().slice(0, 10);
const OWN_EMAIL = `phase6-owner-${tag}@aipowersalon.test`, REC_EMAIL = `phase6-rec-${tag}@aipowersalon.test`, SA_EMAIL = `phase6-sa-${tag}@aipowersalon.test`;
const cat = (await q(`select category_id from services where tenant_id = $1 and status = 'active' and category_id is not null limit 1`, [T]))[0]?.category_id;
if (!cat) { console.error('the salon needs an active service (for its category)'); process.exit(2); }
const hash = await hashPassword(PW);
// the salon-wide settings row and the AI package, exactly as they were — restored at the end
const salonRowBefore = (await q(`select * from queue_assignment_tenant_settings where tenant_id = $1`, [T]))[0] ?? null;
const hadPackage = (await q(`select 1 from tenant_ai_subscriptions where tenant_id = $1 and package_code = 'ai_queue_technician_assignment' and status in ('active','trialing')`, [T])).length > 0;
const SUB = randomUUID();
if (!hadPackage) await q(`insert into tenant_ai_subscriptions (id, tenant_id, package_code, status) values ($1, $2, 'ai_queue_technician_assignment', 'active')`, [SUB, T]);

await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York','6 Proof Way')`, [B, T, `Live Phase6 Proof ${tag}`]);
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Live P6 Gel',45,5000,'active')`, [GEL, T, B, cat]);
for (const [u, email, role, fn] of [[OWN, OWN_EMAIL, 'OWNER', 'Olga'], [REC, REC_EMAIL, 'RECEPTION', 'Rae']]) {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,'Six',$4 || ' Six',$5,$6,'active',$7)`, [u, T, B, fn, email, hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [T, B, u, role === 'OWNER' ? 'manager' : 'staff']).catch(() => q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'staff')`, [T, B, u]).catch(() => undefined));
}
for (const [i, t] of techs.entries()) {
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Tech',$4,'Tech ' || $4,'active')`, [t, T, B, `P6-${i}`]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,true)`, [T, B, t, GEL]);
}
for (const c of custs) {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, normalized_phone, password_hash, status, role) values ($1,$2,$3,'Cust','Six','Cust Six',$4,$5,$6,'active','CUSTOMER')`, [c.user, T, B, c.email, c.phone, hash]);
  await q(`insert into customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, normalized_phone, phone_display, phone_verified_at) values ($1,$2,$3,$4,'Cust','Six','Cust Six',$5,$5, now())`, [c.customer, T, B, c.user, c.phone]);
  await q(`insert into customer_identities (id, normalized_phone, email, full_name, password_hash, phone_verified_at) values ($1,$2,$3,'Cust Six',$4, now())`, [c.ident, c.phone, c.email, hash]);
  await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [c.ident, T, c.user, c.customer]);
}
await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'Pat', 'Six', 'Pat Six', $2, $3, 'active', 'SUPER_ADMIN', false, 'PLATFORM_SUPER_ADMIN')`, [SA, SA_EMAIL, hash]);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'AI_QUEUE_OPS_JOBS']) delete env[k];
env.AI_QUEUE_OPS_JOBS = 'off';   // the background scan / auto-run would race the proof's own calls; their jobs are proved by tests
let proc = null; let errs = '';
const allUsers = [OWN, REC, SA, ...custs.map((c) => c.user)];
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1200);
  for (const c of custs) { await q(`delete from customer_identity_links where identity_id = $1`, [c.ident]).catch(() => undefined); await q(`delete from customer_identities where id = $1`, [c.ident]).catch(() => undefined); }
  for (const u of allUsers) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[OWN_EMAIL, REC_EMAIL, SA_EMAIL, ...custs.map((c) => c.email)]]).catch(() => undefined);
  await q(`update customers set user_id = null where id = any($1::uuid[])`, [custs.map((c) => c.customer)]).catch(() => undefined);
  // the salon-wide rows this run touched (no branch, so the branch sweep does not see them)
  await q(`delete from queue_assignment_settings_versions where tenant_id = $1 and branch_id is null and created_at >= $2`, [T, STARTED]).catch(() => undefined);
  await q(`delete from outbox_events where tenant_id = $1 and branch_id is null and event_type like 'queue.%' and created_at >= $2`, [T, STARTED]).catch(() => undefined);
  if (salonRowBefore) {
    const cols = Object.keys(salonRowBefore).filter((k) => k !== 'tenant_id');
    await q(`update queue_assignment_tenant_settings set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where tenant_id = $1`, [T, ...cols.map((c) => (c === 'auto_exclusions' && salonRowBefore[c] != null ? JSON.stringify(salonRowBefore[c]) : salonRowBefore[c]))]).catch((e) => check('salon settings restore', false, String(e?.message)));
  } else await q(`delete from queue_assignment_tenant_settings where tenant_id = $1`, [T]).catch(() => undefined);
  if (!hadPackage) await q(`delete from tenant_ai_subscriptions where id = $1`, [SUB]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[])`, [allUsers]).catch(() => undefined);
  const after = (await q(`select * from queue_assignment_tenant_settings where tenant_id = $1`, [T]))[0] ?? null;
  const restored = JSON.stringify(after) === JSON.stringify(salonRowBefore);
  const left = (await q(`select (select count(*)::int from branches where id = $1) + (select count(*)::int from users where id = any($2::uuid[])) + (select count(*)::int from customers where id = any($3::uuid[]))
      + (select count(*)::int from pos_queue_items where branch_id = $1) + (select count(*)::int from queue_assignment_decisions where branch_id = $1) + (select count(*)::int from queue_alerts where branch_id = $1)
      + (select count(*)::int from customer_identities where id = any($4::uuid[])) + (select count(*)::int from tenant_ai_subscriptions where id = $5) as n`,
    [B, allUsers, custs.map((c) => c.customer), custs.map((c) => c.ident), SUB]))[0].n;
  check('the proof branch, staff, customers, queue, decisions, alerts and the Super Admin are removed; the salon settings row is exactly as before', a.removed && left === 0 && restored, (a.kept ?? []).join(', ') + ` left=${left} restored=${restored}`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 10 * 60_000);

const login = async (body, ip) => {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
};
const as = (cookie, extra = {}) => (method, path, body, hdr = {}) => fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json', ...extra, ...hdr }, body: body ? JSON.stringify(body) : undefined }).then(j);
const staff = async (email) => {
  const l = await login({ portal: 'tenant', salonCode: SALON, identifier: email, password: PW });
  const sel = await fetch(API + '/auth/select-branch', { method: 'POST', headers: { cookie: l.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branchId: B }) });
  const jar = new Map(); for (const c of [...l.cookie.split('; '), ...(sel.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])]) { const k = c.split('=')[0]; if (k) jar.set(k, c); }
  return { ok: l.status === 200 && sel.status === 200, detail: `login ${l.status} select ${sel.status}`, call: as([...jar.values()].join('; ')) };
};
const item = async (id) => (await q(`select status, assigned_technician_id, version, requested_technician_id, position from pos_queue_items where id = $1`, [id]))[0];
const hist = async (id, action) => (await q(`select action, source, from_technician, to_technician, version from pos_queue_status_history where queue_item_id = $1 ${action ? 'and action = $2' : ''} order by version`, action ? [id, action] : [id]));
const outbox = async (type, id) => (await q(`select count(*)::int as n from outbox_events where tenant_id = $1 and event_type = $2 and (aggregate_id::text = $3 or payload_json->>'queueItemId' = $3 or payload_json->>'queueEntryId' = $3)`, [T, type, id]))[0].n;
const setStatus = async (ids, status) => { for (const t of ids) await q(`insert into technician_statuses (tenant_id, branch_id, technician_id, status, changed_at) values ($1,$2,$3,$4, clock_timestamp())`, [T, B, t, status]); };
const backdate = (id, minutes) => q(`update pos_queue_items set checked_in_at = now() - ($2 || ' minutes')::interval where id = $1`, [id, String(minutes)]);

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');

  const own = await staff(OWN_EMAIL); const rec = await staff(REC_EMAIL);
  check('the owner (manager rights) and a receptionist sign in at the proof branch', own.ok && rec.ok, `${own.detail} / ${rec.detail}`);

  // ── 1. real queue entries ─────────────────────────────────────────────────────────────────────────────────────────
  const add = async (name, extra = {}) => { const r = await rec.call('POST', '/pos/queue/items', { customerName: name, serviceIds: [GEL], source: 'walk_in', ...extra }); return r.body?.queueItemId ?? r.body?.id ?? null; };
  const G1 = await add('Guest One'), G2 = await add('Guest Two'), G3 = await add('Guest Three');
  check('the receptionist checks three guests into the queue (real rows, version 1)', [G1, G2, G3].every(Boolean) && (await item(G1))?.version === 1, `${G1} ${G2} ${G3} ${short(await item(G1))}`);

  // ── 2. suggestion → accept acts through the queue ─────────────────────────────────────────────────────────────────
  const r1 = await rec.call('POST', `/pos/ai-queue-assignment/entries/${G1}/recommend`);
  const sug = r1.body?.recommended?.technicianId;
  check('a suggestion for guest 1 names one of the branch\'s technicians, with the queue version and the settings version it used', ok2(r1.status) && techs.includes(sug) && r1.body?.queueVersion === 1 && typeof r1.body?.configVersion === 'string', `${r1.status} ${short({ sug, v: r1.body?.queueVersion, cv: r1.body?.configVersion, act: r1.body?.requiredAction })}`);
  const panel = await rec.call('GET', `/pos/ai-queue-assignment/entries/${G1}/panel`);
  check('the per-customer panel shows the guest as the engine sees it, every candidate, and the latest suggestion', panel.status === 200 && panel.body?.recommendation?.recommendationId === r1.body?.recommendationId && (panel.body?.candidates ?? []).length === 4 && panel.body?.entry?.version === 1,
    `${panel.status} candidates ${(panel.body?.candidates ?? []).length} ${short(panel.body?.entry)}`);
  const KEY = 'live-p6-accept-' + tag;
  const acc = await rec.call('POST', `/pos/ai-queue-assignment/recommendations/${r1.body?.recommendationId}/decision`, { decision: 'accepted', idempotencyKey: KEY });
  const i1 = await item(G1); const h1 = await hist(G1, 'assign');
  check('ACCEPT assigns through the queue: the guest is assigned to the suggested technician, version 2, one history row (source ai_suggestion), the decision event in the outbox',
    ok2(acc.status) && acc.body?.applied === true && i1?.assigned_technician_id === sug && i1?.version === 2 && h1.length === 1 && h1[0].source === 'ai_suggestion' && (await outbox('queue.assignment_decided', G1)) >= 1,
    `${acc.status} ${short(i1)} ${short(h1)}`);
  const again = await rec.call('POST', `/pos/ai-queue-assignment/recommendations/${r1.body?.recommendationId}/decision`, { decision: 'accepted', idempotencyKey: KEY });
  check('the same accept retried (same key) replays — no second assignment, no second history row', ok2(again.status) && again.body?.replayed === true && (await hist(G1, 'assign')).length === 1 && (await item(G1))?.version === 2, `${again.status} ${short(again.body?.decision?.decision)}`);

  // ── 3. reject needs a reason; override is recorded ──────────────────────────────────────────────────────────────
  const r2 = await rec.call('POST', `/pos/ai-queue-assignment/entries/${G2}/recommend`);
  const noWhy = await rec.call('POST', `/pos/ai-queue-assignment/recommendations/${r2.body?.recommendationId}/decision`, { decision: 'rejected' });
  const why = await rec.call('POST', `/pos/ai-queue-assignment/recommendations/${r2.body?.recommendationId}/decision`, { decision: 'rejected', reason: 'Guest prefers to wait for her usual technician' });
  check('a REJECT without a reason is a 400; with one it is recorded and nothing is assigned', noWhy.status === 400 && ok2(why.status) && why.body?.applied === false && !(await item(G2))?.assigned_technician_id, `${noWhy.status} ${why.status} ${short(why.body?.decision)}`);
  const other = techs.find((t) => t !== r2.body?.recommended?.technicianId && t !== sug);
  const recOverride = await rec.call('POST', `/pos/ai-queue-assignment/recommendations/${r2.body?.recommendationId}/decision`, { decision: 'overridden', chosenTechnicianId: other, reason: 'x' });
  const ovr = await own.call('POST', `/pos/ai-queue-assignment/recommendations/${r2.body?.recommendationId}/decision`, { decision: 'overridden', chosenTechnicianId: other, reason: 'Manager moved her to a free chair' });
  check('an OVERRIDE needs the override right (receptionist 403); the manager\'s override assigns the chosen technician through the queue',
    recOverride.status === 403 && ok2(ovr.status) && (await item(G2))?.assigned_technician_id === other, `${recOverride.status} ${ovr.status} ${short(await item(G2))}`);

  // ── 4. stale board, lock ────────────────────────────────────────────────────────────────────────────────────────
  const stale = await rec.call('POST', `/pos/queue/items/${G1}/assign-technician`, { technicianId: techs[3], expectedTechnicianId: null });
  check('a stale board (it thought guest 1 was unassigned) is refused with 409 and the current technician — nothing overwritten', stale.status === 409 && (await item(G1))?.assigned_technician_id === sug, `${stale.status} ${short(stale.body)}`);
  const lk = await own.call('POST', `/pos/queue/items/${G3}/lock`, { technicianId: techs[0], reason: 'Regular of Tech 0' });
  const lockedOut = await rec.call('POST', `/pos/queue/items/${G3}/assign-technician`, { technicianId: techs[1], expectedTechnicianId: null });
  const r3 = await rec.call('POST', `/pos/ai-queue-assignment/entries/${G3}/recommend`);
  check('a manager LOCKS guest 3 to Tech 0: another technician is refused, and the suggestion respects the lock',
    ok2(lk.status) && [409, 423].includes(lockedOut.status) && !(await item(G3))?.assigned_technician_id && (r3.body?.recommended?.technicianId ?? techs[0]) === techs[0], `${lk.status} ${lockedOut.status} ${short(r3.body?.recommended)}`);
  const ul = await own.call('POST', `/pos/queue/items/${G3}/unlock`, { reason: 'Tech 0 went home' });
  check('… and the unlock is recorded', ok2(ul.status) && (await q(`select count(*)::int as n from pos_queue_status_history where queue_item_id = $1 and action in ('lock','unlock')`, [G3]))[0].n >= 2, `${ul.status}`);

  // ── 5. reorder + groups ─────────────────────────────────────────────────────────────────────────────────────────
  const G4 = await add('Guest Four'), G5 = await add('Guest Five');
  const ro = await rec.call('POST', '/pos/queue/reorder', { order: [{ queueItemId: G5 }, { queueItemId: G4 }, { queueItemId: G3 }] });
  const [p5, p4] = [(await item(G5))?.position, (await item(G4))?.position];
  check('REORDER moves guest 5 ahead of guest 4 (positions saved, history kept, event in the outbox)', ok2(ro.status) && p5 != null && p4 != null && p5 < p4 && (await q(`select count(*)::int as n from outbox_events where tenant_id = $1 and branch_id = $2 and event_type = 'queue.reordered'`, [T, B]))[0].n >= 1, `${ro.status} p5 ${p5} p4 ${p4} ${short(ro.body)}`);
  const grp = await rec.call('POST', '/pos/queue/groups', { label: 'Bridal party', queueItemIds: [G4, G5], together: true });
  const groups = await rec.call('GET', '/pos/queue/groups');
  check('a GROUP visit (two guests together) is created and listed', ok2(grp.status) && grp.body?.size === 2 && groups.status === 200 && (groups.body ?? []).some?.((g) => g.groupId === grp.body?.groupId), `${grp.status} ${short(grp.body)}`);

  // ── 6. settings: versioned, stale save refused, role matrix ─────────────────────────────────────────────────────
  const st = await own.call('GET', '/pos/ai-queue-assignment/settings');
  const v0 = st.body?.branch?.version ?? 0;
  const put = await own.call('PUT', '/pos/ai-queue-assignment/settings', { scope: 'branch', patch: { autoEnabled: true, autoConfidenceFloor: 0, autoDelaySeconds: 0, autoMaxPerRun: 1, autoExclusions: {} }, expectedVersion: v0, reason: 'live proof' });
  const stalePut = await own.call('PUT', '/pos/ai-queue-assignment/settings', { scope: 'branch', patch: { autoMaxPerRun: 3 }, expectedVersion: v0, reason: 'stale' });
  const vers = await own.call('GET', '/pos/ai-queue-assignment/settings/versions');
  check('the owner turns automatic assignment on (version saved, the history lists it); a save from a stale screen is a 409',
    ok2(put.status) && put.body?.effective?.autoAllowed === true && stalePut.status === 409 && vers.status === 200 && (vers.body ?? []).length >= 1, `${put.status} ${short(put.body?.effective?.autoBlockedBy)} stale ${stalePut.status} versions ${(vers.body ?? []).length}`);
  const recPut = await rec.call('PUT', '/pos/ai-queue-assignment/settings', { scope: 'branch', patch: { waitExceededMin: 5 } });
  const recRun = await rec.call('POST', '/pos/ai-queue-assignment/auto/run');
  check('ROLE MATRIX: the front desk cannot change the rules or run automation (403, 403)', recPut.status === 403 && recRun.status === 403, `${recPut.status} ${recRun.status}`);

  // ── 7. auto-run sees the whole queue; the cap; the switches ─────────────────────────────────────────────────────
  const extra = []; for (let i = 0; i < 22; i++) extra.push(await add(`Walk-in ${i}`));
  // guests 1 and 2 hold two technicians (one guest each is their capacity); of the two free ones, one steps away, so
  // the engine has ONE clear choice and is confident (two equal free technicians is a tie — rightly left to staff)
  const [F1, F2] = techs.filter((t) => t !== sug && t !== other);
  await setStatus(techs.filter((t) => t !== F1), 'on_break');
  const waitingNow = (await q(`select count(*)::int as n from pos_queue_items where branch_id = $1 and status = 'waiting' and assigned_technician_id is null`, [B]))[0].n;
  const run1 = await own.call('POST', '/pos/ai-queue-assignment/auto/run');
  const autoRows = await q(`select count(*)::int as n from pos_queue_status_history h join pos_queue_items i on i.id = h.queue_item_id where i.branch_id = $1 and h.source = 'auto_assign'`, [B]);
  check(`the AUTO-RUN considers every waiting guest (${waitingNow} > 20 — no 20-row page) and assigns at most the per-run cap (1) — the rest wait for the next run — through the queue (source auto_assign)`,
    ok2(run1.status) && run1.body?.considered === waitingNow && waitingNow > 20 && run1.body?.assigned === 1 && autoRows[0].n === 1 && (run1.body?.skipped ?? []).filter((x) => x.reason === 'max_per_run_reached').length === waitingNow - 1, `${run1.status} ${short({ c: run1.body?.considered, a: run1.body?.assigned, b: run1.body?.blockedBy })} rows ${autoRows[0].n} skipped ${short([...new Set((run1.body?.skipped ?? []).map((x) => x.reason))])}`);
  const kill = await own.call('POST', '/pos/ai-queue-assignment/auto/kill', { scope: 'branch', reason: 'Busy Saturday — staff only' });
  const run2 = await own.call('POST', '/pos/ai-queue-assignment/auto/run');
  check('the location KILL SWITCH stops the auto-run (blocked, nothing assigned)', ok2(kill.status) && run2.body?.allowed === false && run2.body?.assigned === 0, `${kill.status} ${short(run2.body)}`);
  const unkill = await own.call('POST', '/pos/ai-queue-assignment/auto/unkill', { scope: 'branch', reason: 'Back to normal' });
  check('… and switches back on', ok2(unkill.status) && unkill.body?.autoAllowed !== false, `${unkill.status} ${short(unkill.body)}`);

  // ── 8. Super Admin: oversight + the salon kill (step-up) ────────────────────────────────────────────────────────
  const sl = await login({ portal: 'super-admin', identifier: SA_EMAIL, password: PW, mfaCode: '123456' });
  const sa = as(sl.cookie);
  const ov = await sa('GET', '/super-admin/ai-queue-assignment/overview');
  const det = await sa('GET', `/super-admin/ai-queue-assignment/tenants/${T}`);
  check('the Super Admin oversight answers (platform overview, the salon\'s detail with its proof branch)', sl.status === 200 && ov.status === 200 && det.status === 200 && JSON.stringify(det.body).includes(B), `login ${sl.status} ov ${ov.status} det ${det.status}`);
  const noStep = await sa('POST', `/super-admin/ai-queue-assignment/tenants/${T}/auto-kill`, { killed: true, reason: 'Live proof: platform review of auto actions' });
  // the step-up flow itself (password + TOTP) is proved by its own tests; here the session is stamped as stepped-up
  await q(`update sessions set last_step_up_at = now() where user_id = $1 and revoked_at is null`, [SA]);
  const pk = await sa('POST', `/super-admin/ai-queue-assignment/tenants/${T}/auto-kill`, { killed: true, reason: 'Live proof: platform review of auto actions' });
  const run3 = await own.call('POST', '/pos/ai-queue-assignment/auto/run');
  check('the Super Admin\'s salon kill needs a step-up (403 STEP_UP_REQUIRED), then stops every location\'s auto-run (blocked by the salon switch)',
    noStep.status === 403 && /STEP_UP/.test(short(noStep.body)) && ok2(pk.status) && pk.body?.killed === true && run3.body?.allowed === false && run3.body?.blockedBy === 'salon_kill_switch' && run3.body?.assigned === 0,
    `${noStep.status} ${pk.status} ${short(run3.body)}`);
  const pu = await sa('POST', `/super-admin/ai-queue-assignment/tenants/${T}/auto-kill`, { killed: false, reason: 'Live proof: review finished, restore' });
  check('… and releases it (audited)', ok2(pu.status) && pu.body?.killed === false && (await q(`select count(*)::int as n from audit_logs where tenant_id = $1 and user_id = $2 and action_type like 'super_admin_ai_queue_auto_%'`, [T, SA]))[0].n >= 2, `${pu.status} ${short(pu.body)}`);

  // ── 9. CONCURRENCY: auto-run and three receptionists on one guest at the same moment ────────────────────────────
  await q(`update pos_queue_items set status = 'cancelled' where branch_id = $1 and status = 'waiting' and assigned_technician_id is null`, [B]);
  const GR = await add('Race Guest'); await backdate(GR, 30);
  const [ra, rb, rc] = await Promise.all([staff(REC_EMAIL), staff(REC_EMAIL), staff(REC_EMAIL)]);
  // one more technician comes back from break: the auto-run's one clear choice AND the technician three front-desk
  // screens pick — all for the same guest at the same moment
  await setStatus([F2], 'available');
  const raceRes = await Promise.all([
    own.call('POST', '/pos/ai-queue-assignment/auto/run'),
    ...[ra, rb, rc].map((r) => r.call('POST', `/pos/queue/items/${GR}/assign-technician`, { technicianId: F2, expectedTechnicianId: null, expectedVersion: 1 })),
  ]);
  await setStatus(techs, 'available');
  const staffWins = raceRes.slice(1).filter((r) => ok2(r.status)).length; const staff409 = raceRes.slice(1).filter((r) => r.status === 409).length;
  const autoWon = raceRes[0].body?.assigned ?? 0;
  const gr = await item(GR); const grH = await hist(GR, null);
  check('CONCURRENCY (real Postgres): auto-run + 3 receptionists assign ONE guest at once → exactly one assignment, version 2, one assign history row; every loser got 409 / skipped',
    staffWins + autoWon === 1 && staff409 === 3 - staffWins && gr?.version === 2 && grH.filter((h) => h.action === 'assign' || h.action === 'auto_assign').length === 1 && raceRes.every((r) => r.status < 500),
    `staff ok ${staffWins} 409 ${staff409} auto ${autoWon} ${short(raceRes[0].body?.skipped)} item ${short(gr)} hist ${short(grH.map((h) => h.action + '/' + h.source))}`);

  // ── 10. alerts: raised, notified, auto-resolved ─────────────────────────────────────────────────────────────────
  const GA = await add('Long Wait Guest'); await backdate(GA, 150);
  const scan1 = await rec.call('POST', '/pos/ai-queue-assignment/alerts/scan');
  const al = await rec.call('GET', '/pos/ai-queue-assignment/alerts');
  const mine = (al.body?.alerts ?? al.body ?? []).filter?.((a) => a.queueEntryId === GA) ?? [];
  const ownerAlerts = (await q(`select count(*)::int as n from owner_alerts where tenant_id = $1 and branch_id = $2`, [T, B]))[0].n;
  check('a guest waiting 150 minutes raises an ALERT (critical) and the owner is notified once (owner alert feed); the event is in the outbox',
    ok2(scan1.status) && mine.length >= 1 && ['high', 'critical'].includes(mine[0]?.severity) && ownerAlerts >= 1 && (await outbox('queue.alert_raised', mine[0]?.id ?? '-')) >= 1,
    `${scan1.status} ${short(mine.map((a) => `${a.type}/${a.severity}`))} owner_alerts ${ownerAlerts}`);
  const scan1b = await rec.call('POST', '/pos/ai-queue-assignment/alerts/scan');
  check('… scanning again does not notify again', ok2(scan1b.status) && (await q(`select count(*)::int as n from owner_alerts where tenant_id = $1 and branch_id = $2`, [T, B]))[0].n === ownerAlerts, `${scan1b.status}`);
  await rec.call('POST', `/pos/queue/items/${GA}/assign-technician`, { technicianId: techs[3], expectedTechnicianId: null });
  const scan2 = await rec.call('POST', '/pos/ai-queue-assignment/alerts/scan');
  const gaA = async () => q(`select type, status, auto_resolved, resolution from queue_alerts where tenant_id = $1 and queue_entry_id::text = $2 order by type`, [T, GA]);
  const afterAssign = await gaA();
  check('assigning the guest AUTO-RESOLVES the "nobody assigned" alert on the next scan; the long-wait alert stays while she still waits',
    ok2(scan2.status) && afterAssign.some((a) => a.type === 'unassigned' && a.status === 'resolved' && a.auto_resolved) && afterAssign.some((a) => a.type === 'waiting_too_long' && a.status !== 'resolved'), `${scan2.status} ${short(afterAssign)}`);
  const started = await rec.call('POST', `/pos/queue/items/${GA}/start-service`);
  const scan3 = await rec.call('POST', '/pos/ai-queue-assignment/alerts/scan');
  const afterStart = await gaA();
  check('… and once her service starts, the long-wait alert auto-resolves too (condition cleared) — no open alert left for her',
    ok2(started.status) && ok2(scan3.status) && afterStart.length >= 2 && afterStart.every((a) => a.status === 'resolved' && a.auto_resolved && a.resolution === 'condition_cleared'), `${started.status} ${short(afterStart)}`);

  // ── 11. the customer accepts another technician ─────────────────────────────────────────────────────────────────
  const GC = await add('Cust Six', { customerId: custs[0].customer, requestedTechnicianId: techs[1] });
  const cl = await login({ portal: 'customer', identifier: custs[0].email, password: PW }, '10.66.0.1');
  const cust = as(cl.cookie, { 'x-forwarded-for': '10.66.0.1' });
  const alts = await cust('GET', `/customer/queue/${GC}/alternates`);
  const pick = (alts.body?.alternates ?? []).find((a) => a.technicianId !== techs[1])?.technicianId;
  const accA = await cust('POST', `/customer/queue/${GC}/accept-alternate`, { technicianId: pick });
  const gcH = await q(`select source from pos_queue_status_history where queue_item_id = $1 and action = 'accept_alternate'`, [GC]).catch(() => []);
  check('the CUSTOMER sees who else could take them and accepts one from their own app (request recorded, history source customer)',
    cl.status === 200 && alts.status === 200 && !!pick && pick !== techs[1] && ok2(accA.status) && (await item(GC))?.requested_technician_id === pick && gcH.some((h) => h.source === 'customer'),
    `login ${cl.status} alts ${alts.status} ${short(alts.body?.alternates?.length)} accept ${accA.status} ${short(accA.body)} hist ${short(gcH)}`);
  const cl2 = await login({ portal: 'customer', identifier: custs[1].email, password: PW }, '10.66.0.2');
  const other2 = await as(cl2.cookie, { 'x-forwarded-for': '10.66.0.2' })('POST', `/customer/queue/${GC}/accept-alternate`, { technicianId: techs[2] });
  check('… another customer cannot touch that visit (refused, nothing changed)', !ok2(other2.status) && other2.status < 500 && (await item(GC))?.requested_technician_id === pick, `${other2.status}`);

  // ── 12. overview, analytics, owner summary, export ──────────────────────────────────────────────────────────────
  const ovw = await rec.call('GET', '/pos/ai-queue-assignment/overview');
  const an = await own.call('GET', '/pos/ai-queue-assignment/analytics');
  const os = await own.call('GET', '/owner/ai-queue-assignment/summary');
  const ex = await own.call('GET', '/pos/ai-queue-assignment/export?type=decisions');
  const recEx = await rec.call('GET', '/pos/ai-queue-assignment/export?type=decisions');
  const csv = String(ex.body?.csv ?? '');
  check('the overview, analytics and the owner app summary answer with today\'s decisions', ovw.status === 200 && an.status === 200 && os.status === 200 && (an.body?.decisions?.autoAssigned ?? 0) >= 1 && (an.body?.decisions?.staffTotal ?? 0) >= 3, `${ovw.status} ${an.status} ${os.status} ${short(an.body?.decisions)}`);
  check('the CSV export lists the accept, the reject (with its reason), the override and the auto-assignments; the front desk cannot export (403)',
    ex.status === 200 && /accepted/.test(csv) && /rejected/.test(csv) && /usual technician/.test(csv) && /overridden/.test(csv) && /auto_assigned/.test(csv) && recEx.status === 403, `${ex.status} rows ${ex.body?.rows} rec ${recEx.status}`);
  const audits = (await q(`select count(*)::int as n from audit_logs where tenant_id = $1 and branch_id = $2 and action_type like 'ai_queue_assignment_settings_%'`, [T, B]))[0].n;
  check('every settings change is audited (audit_logs) as well as versioned', audits >= 2, `audit rows ${audits}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
