#!/usr/bin/env node
// live-fair-turn.mjs — the Fair Turn Engine (wave 2), proved on the real API and PostgreSQL. Nothing is stubbed:
//   • three technicians clock in through the real time clock → they JOIN the turn rotation in clock-in order (the ONE
//     workforce state move writes the turn event in the same transaction); the board, the health strip and the
//     Technician App view (visibility setting respected) read it back;
//   • a walk-in: the recommendation is the Fair Turn Engine's (traditional weighted rotation) with its "why" lines;
//     assigning someone else needs a reason (400 MANUAL_OVERRIDE_REASON_REQUIRED, then 200) — the skipped technician
//     keeps her place (SKIP event), the assigned one moves to the back; an accepted recommendation retried replays;
//   • Service Done credits the turn (COMPLETE + TURN_CREDIT); a short break keeps the place; manager hold / release /
//     adjust / set-next all need a reason and are role-gated; a guest who declined a technician is not offered her again;
//   • history is append-only (an UPDATE is refused by the database), the fairness dashboard and the team report read
//     the same events, the simulator changes nothing, the settings save is versioned (preview first) and widens what
//     the Technician App shows, today cannot be "closed", and every change is announced through the outbox.
//
// Run:  DATABASE_URL=postgres://…/<scratch db> node scripts/live-fair-turn.mjs   (apps/api built). Never point it at
// production: it creates a proof branch, staff and technicians, may add the AI queue package for the run, and removes
// everything it made except the append-only turn history rows (kept by design, counted in the last check).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.PORT_PROOF || 3071), API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const TZ = 'America/New_York';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 300);

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Fair Turn Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);

const STARTED = new Date();
const tag = String(Date.now()).slice(-6);
const B = randomUUID(), OWN = randomUUID(), REC = randomUUID(), CAT = randomUUID(), SVC = randomUUID();
const PW = 'FairT!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const email = (k) => `ft-${k}-${tag}@aipowersalon.test`;
const TECHS = ['Lisa', 'Mary', 'Anna'].map((n) => ({ key: n.toLowerCase(), name: n, id: randomUUID(), user: randomUUID() }));
const [LISA, MARY, ANNA] = TECHS.map((t) => t.id);
const nameOf = (id) => TECHS.find((t) => t.id === id)?.name ?? id;
const hadPackage = (await q(`select 1 from tenant_ai_subscriptions where tenant_id = $1 and package_code = 'ai_queue_technician_assignment' and status in ('active','trialing')`, [T])).length > 0;
const SUB = randomUUID();
if (!hadPackage) await q(`insert into tenant_ai_subscriptions (id, tenant_id, package_code, status) values ($1, $2, 'ai_queue_technician_assignment', 'active')`, [SUB, T]);

await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active',$4,'7 Rotation Row')`, [B, T, `Live Fair Turn Proof ${tag}`, TZ]);
await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,$4)`, [CAT, T, B, `FT Manicure ${tag}`]);
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, commission_type, commission_value) values ($1,$2,$3,$4,'FT Gel Manicure',45,4500,'active','percent',50)`, [SVC, T, B, CAT]);
const addUser = async (id, role, key, level, fn) => {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,'Turn',$4 || ' Turn',$5,$6,'active',$7)`, [id, T, B, fn, email(key), hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [T, B, id, level]);
};
await addUser(OWN, 'OWNER', 'owner', 'manager', 'Olga');
await addUser(REC, 'RECEPTION', 'rec', 'staff', 'Rae');
for (const t of TECHS) {
  await addUser(t.user, 'TECHNICIAN', t.key, 'staff', t.name);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status) values ($1,$2,$3,$4,$5,'FT',$5 || ' FT','active')`, [t.id, T, B, t.user, t.name]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,true)`, [T, B, t.id, SVC]);
}
const allUsers = [OWN, REC, ...TECHS.map((t) => t.user)];

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY']) delete env[k];
Object.assign(env, { AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off' });   // the auto-run would race the proof's own calls
let proc = null; let errs = '';
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1200);
  for (const u of allUsers) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[email('owner'), email('rec'), ...TECHS.map((t) => email(t.key))]]).catch(() => undefined);
  if (!hadPackage) await q(`delete from tenant_ai_subscriptions where id = $1`, [SUB]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[])`, [allUsers]).catch(() => undefined);
  const left = (await q(`select (select count(*)::int from branches where id = $1) + (select count(*)::int from users where id = any($2::uuid[]))
      + (select count(*)::int from pos_queue_items where branch_id = $1) + (select count(*)::int from technician_turn_state where branch_id = $1)
      + (select count(*)::int from technicians where branch_id = $1) + (select count(*)::int from tenant_ai_subscriptions where id = $3) as n`, [B, allUsers, SUB]))[0].n;
  const keptEvents = (await q(`select count(*)::int as n from technician_turn_events where branch_id = $1`, [B]))[0].n;
  const keptOk = (a.kept ?? []).every((t) => ['technician_turn_events', 'audit_logs', 'audit_events'].includes(t));
  check('the proof branch, staff, technicians, queue, turn state and the AI package it added are removed (append-only turn history stays, by design)', a.removed && left === 0 && keptOk,
    `kept ${(a.kept ?? []).join(', ')} (${keptEvents} turn events) left=${left}`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 8 * 60_000);

const signIn = async (key) => {
  const jar = new Map(); const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); } };
  const hdr = (extra = {}) => ({ 'content-type': 'application/json', cookie: [...jar.values()].join('; '), ...extra });
  const l = await fetch(API + '/auth/login', { method: 'POST', headers: hdr(), body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: email(key), password: PW }) }); keep(l);
  const s = await fetch(API + '/auth/select-branch', { method: 'POST', headers: hdr(), body: JSON.stringify({ branchId: B }) }); keep(s);
  return { ok: l.status === 200 && s.status === 200, detail: `${key}: login ${l.status} select ${s.status}`, call: (method, path, body, extra = {}) => fetch(API + path, { method, headers: hdr(extra), body: body ? JSON.stringify(body) : undefined }).then(j) };
};
const events = async (where = '', p = []) => q(`select sequence_number, technician_id, event_type, reason_code, queue_item_id, turn_units_delta, position_before, position_after, policy_version, business_date::text as d from technician_turn_events where tenant_id = $1 and branch_id = $2 ${where} order by sequence_number`, [T, B, ...p]);
const state = async (id) => (await q(`select status, in_rotation, rotation_position::float as pos, accumulated_units, provisional_units, pending_units from technician_turn_state where tenant_id = $1 and branch_id = $2 and technician_id = $3 order by business_date desc limit 1`, [T, B, id]))[0];
const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');
  const own = await signIn('owner'); const rec = await signIn('rec');
  const tech = Object.fromEntries(await Promise.all(TECHS.map(async (t) => [t.id, await signIn(t.key)])));
  check('the owner, a receptionist and three technicians sign in at the proof branch', own.ok && rec.ok && Object.values(tech).every((x) => x.ok), [own.detail, rec.detail, ...Object.values(tech).map((x) => x.detail)].join(' / '));

  // ── 0. the salon's turn rules: traditional weighted rotation, recommend & confirm (the ONE versioned settings source) ──
  const st0 = await own.call('GET', '/pos/ai-queue-assignment/settings');
  const put0 = await own.call('PUT', '/pos/ai-queue-assignment/settings', { scope: 'branch', patch: { rotationPolicy: 'traditional_weighted_rotation', assignmentMode: 'RECOMMEND_AND_CONFIRM' }, expectedVersion: st0.body?.branch?.version ?? 0, reason: 'live fair turn proof' });
  const recPut = await rec.call('PUT', '/pos/ai-queue-assignment/settings', { scope: 'branch', patch: { assignmentMode: 'AUTOMATIC' } });
  check('the owner sets the fairness mode + RECOMMEND_AND_CONFIRM on the ONE settings source; the front desk cannot (403)',
    ok2(put0.status) && recPut.status === 403, `${put0.status} ${short(put0.body?.effective ? { r: put0.body.effective.rotationPolicy, m: put0.body.effective.assignmentMode } : put0.body)} rec ${recPut.status}`);

  // ── 1. clock in → JOIN in clock-in order ──────────────────────────────────────────────────────────────────────────
  for (const t of TECHS) { const r = await own.call('POST', '/pos/time-clock/clock-in', { technicianId: t.id }); if (!ok2(r.status)) check(`${t.name} clocks in`, false, `${r.status} ${short(r.body)}`); await sleep(30); }
  const joins = await events(`and event_type = 'JOIN'`);
  const board1 = await rec.call('GET', '/pos/turn-queue/board');
  const ranks = Object.fromEntries((board1.body?.technicians ?? []).map((x) => [x.technicianId, x.rank]));
  check('three clock-ins through the real time clock JOIN the rotation in clock-in order (Lisa #1, Mary #2, Anna #3); the board says Lisa is next, in the branch day',
    joins.length === 3 && joins.map((e) => nameOf(e.technician_id)).join() === 'Lisa,Mary,Anna' && board1.status === 200 && ranks[LISA] === 1 && ranks[MARY] === 2 && ranks[ANNA] === 3
      && board1.body?.nextUpTechnicianId === LISA && board1.body?.timeZone === TZ && board1.body?.businessDate === localToday && joins.every((e) => e.d === localToday),
    `${board1.status} ${short({ joins: joins.map((e) => nameOf(e.technician_id)), ranks: Object.entries(ranks).map(([k, v]) => [nameOf(k), v]), next: nameOf(board1.body?.nextUpTechnicianId), day: board1.body?.businessDate, tz: board1.body?.timeZone })}`);
  const health1 = await rec.call('GET', '/pos/turn-queue/floor-health');
  check('the queue health strip reads the same floor (3 ready, 0 waiting)', health1.status === 200 && health1.body?.readyTechnicians === 3 && health1.body?.waitingCustomers === 0, `${health1.status} ${short(health1.body)}`);
  const maryView = await tech[MARY].call('GET', '/tech/turn-queue');
  const maryBoard = await tech[MARY].call('GET', '/pos/turn-queue/board');
  check('the Technician App shows Mary her own place (#2 of 3) and, under POSITION_ONLY, nobody else\'s; a technician cannot read the manager board (403)',
    maryView.status === 200 && maryView.body?.myRank === 2 && maryView.body?.queueLength === 3 && (maryView.body?.team ?? []).length === 0 && maryView.body?.visibility === 'POSITION_ONLY' && maryBoard.status === 403,
    `${maryView.status} ${short({ r: maryView.body?.myRank, n: maryView.body?.queueLength, team: maryView.body?.team, v: maryView.body?.visibility })} board ${maryBoard.status}`);

  // ── 2. a walk-in: the Fair Turn Engine recommends; assigning someone else needs a reason ────────────────────────────
  const add = async (name) => { const r = await rec.call('POST', '/pos/queue/items', { customerName: name, serviceIds: [SVC], source: 'walk_in' }); return r.body?.queueItemId ?? r.body?.id ?? null; };
  const G1 = await add(`Turn Guest One ${tag}`);
  const r1 = await rec.call('POST', `/pos/ai-queue-assignment/entries/${G1}/recommend`);
  const ft1 = r1.body?.envelope?.fairTurn ?? r1.body?.fairTurn ?? null;
  const top1 = r1.body?.envelope?.recommendedTechnicianId ?? r1.body?.recommendedTechnicianId ?? ft1?.recommendedTechnicianId ?? null;
  check('the recommendation for the walk-in is the Fair Turn Engine\'s: Lisa (next in rotation), with the plain "why" lines and the rules version',
    ok2(r1.status) && top1 === LISA && !!ft1 && (ft1.why ?? []).some((w) => /^Lisa\b.* selected because/.test(w)), `${r1.status} top ${nameOf(top1)} ${short(ft1 ? { why: ft1.why?.slice(0, 3), mode: ft1.mode } : r1.body)}`);
  const noWhy = await rec.call('POST', `/pos/queue/items/${G1}/assign-technician`, { technicianId: MARY });
  const withWhy = await rec.call('POST', `/pos/queue/items/${G1}/assign-technician`, { technicianId: MARY, overrideReasonCode: 'SKILL_MATCH' });
  const ma = await events(`and event_type = 'MANUAL_ASSIGN' and queue_item_id = $3`, [G1]);
  const sk = await events(`and event_type = 'SKIP' and queue_item_id = $3`, [G1]);
  check('assigning Mary instead needs a reason: 400 MANUAL_OVERRIDE_REASON_REQUIRED, then 200 with SKILL_MATCH → ONE MANUAL_ASSIGN (reason recorded) and a SKIP for Lisa',
    noWhy.status === 400 && noWhy.body?.code === 'MANUAL_OVERRIDE_REASON_REQUIRED' && ok2(withWhy.status) && ma.length === 1 && ma[0].technician_id === MARY && ma[0].reason_code === 'SKILL_MATCH'
      && sk.length === 1 && sk[0].technician_id === LISA && !!sk[0].policy_version,
    `${noWhy.status} ${noWhy.body?.code} → ${withWhy.status}; ${short({ ma: ma.map((e) => [nameOf(e.technician_id), e.reason_code]), sk: sk.map((e) => [nameOf(e.technician_id), e.reason_code]) })}`);
  const board2 = await rec.call('GET', '/pos/turn-queue/board');
  const lisa2 = await state(LISA); const mary2 = await state(MARY);
  check('the skipped technician keeps her place (Lisa still next); Mary is ASSIGNED and moved to the back with 1.0 provisional turn',
    board2.body?.nextUpTechnicianId === LISA && lisa2.status === 'READY' && mary2.status === 'ASSIGNED' && mary2.provisional_units === 100 && mary2.pos > lisa2.pos && mary2.pos > (await state(ANNA)).pos,
    short({ next: nameOf(board2.body?.nextUpTechnicianId), lisa: lisa2, mary: mary2 }));

  // ── 3. an accepted recommendation, retried, replays ───────────────────────────────────────────────────────────────
  const G2 = await add(`Turn Guest Two ${tag}`);
  const r2 = await rec.call('POST', `/pos/ai-queue-assignment/entries/${G2}/recommend`);
  const KEY = 'live-ft-accept-' + tag;
  const acc = await rec.call('POST', `/pos/ai-queue-assignment/recommendations/${r2.body?.recommendationId}/decision`, { decision: 'accepted', idempotencyKey: KEY });
  const acc2 = await rec.call('POST', `/pos/ai-queue-assignment/recommendations/${r2.body?.recommendationId}/decision`, { decision: 'accepted', idempotencyKey: KEY });
  const as2 = await events(`and event_type in ('ASSIGN','MANUAL_ASSIGN') and queue_item_id = $3`, [G2]);
  check('the next guest\'s recommendation (Lisa) accepted → ONE ASSIGN turn event; the same accept retried replays (no second event)',
    ok2(acc.status) && ok2(acc2.status) && as2.length === 1 && as2[0].technician_id === LISA && as2[0].event_type === 'ASSIGN', `${acc.status}/${acc2.status} ${short(as2.map((e) => [nameOf(e.technician_id), e.event_type]))}`);

  // ── 4. Service Done credits the turn ──────────────────────────────────────────────────────────────────────────────
  const mv = await rec.call('POST', `/pos/queue/items/${G1}/move-to-tech-queue`);
  const part = (await q(`select id from pos_tech_queue_tickets where queue_item_id = $1 order by visit_part limit 1`, [G1]))[0]?.id;
  const t1 = await tech[MARY].call('POST', `/tech/tickets/${part}/accept`, {});
  const t2 = await tech[MARY].call('POST', `/tech/tickets/${part}/start-service`, undefined, { 'idempotency-key': randomUUID() });
  const t3 = await tech[MARY].call('POST', `/tech/tickets/${part}/service-done`, {}, { 'idempotency-key': randomUUID() });
  const done = await events(`and event_type in ('START','COMPLETE','TURN_CREDIT') and technician_id = $3`, [MARY]);
  const mary4 = await state(MARY);
  check('Mary starts and finishes the service in the Tech app → START, COMPLETE and ONE TURN_CREDIT (+1.0); she is READY again with 1.0 credited, 0 provisional',
    [mv, t1, t2, t3].every((r) => ok2(r.status)) && done.map((e) => e.event_type).join() === 'START,COMPLETE,TURN_CREDIT' && done[2].turn_units_delta === 100
      && mary4.status === 'READY' && mary4.accumulated_units === 100 && mary4.provisional_units === 0,
    `${mv.status}/${t1.status}/${t2.status}/${t3.status} ${short({ ev: done.map((e) => [e.event_type, e.turn_units_delta]), mary4 })}`);

  // ── 5. a short break keeps the place ──────────────────────────────────────────────────────────────────────────────
  const annaBefore = (await state(ANNA)).pos;
  const b1 = await own.call('POST', '/pos/time-clock/break-start', { technicianId: ANNA, kind: 'break' });
  const onBreak = (await state(ANNA)).status;
  const b2 = await own.call('POST', '/pos/time-clock/break-end', { technicianId: ANNA });
  const anna5 = await state(ANNA);
  const brk = (await q(`select classification, paid_minutes from technician_breaks where tenant_id = $1 and technician_id = $2 order by started_at desc limit 1`, [T, ANNA]))[0];
  check('Anna takes a short break (BREAK while away) and comes back to the SAME place; the break is classified by the salon\'s break policy (paid rest)',
    ok2(b1.status) && ok2(b2.status) && onBreak === 'BREAK' && anna5.status === 'READY' && anna5.pos === annaBefore && brk?.classification === 'paid_rest'
      && (await events(`and technician_id = $3 and event_type in ('BREAK_START','BREAK_END')`, [ANNA])).length === 2,
    `${b1.status}/${b2.status} ${onBreak} → ${anna5.status} pos ${annaBefore}→${anna5.pos} brk ${short(brk)}`);

  // ── 6. manager actions: a reason every time, role-gated ───────────────────────────────────────────────────────────
  const holdNoWhy = await own.call('POST', `/pos/turn-queue/technicians/${ANNA}/hold`, {});
  const hold = await own.call('POST', `/pos/turn-queue/technicians/${ANNA}/hold`, { reason: 'Helping with inventory' });
  const recReorder = await rec.call('POST', `/pos/turn-queue/technicians/${MARY}/reorder`, { setNext: true, reason: 'front desk tries' });
  const held = await state(ANNA);
  const rel = await own.call('POST', `/pos/turn-queue/technicians/${ANNA}/release`, {});
  const adj = await own.call('POST', `/pos/turn-queue/technicians/${LISA}/adjust`, { turns: '0.5', reason: 'Credit for a fix done off the books' });
  const nxt = await own.call('POST', `/pos/turn-queue/technicians/${MARY}/reorder`, { setNext: true, reason: 'Her regular is due any minute' });
  const board6 = await rec.call('GET', '/pos/turn-queue/board');
  const adjEv = await events(`and event_type = 'ADJUST' and technician_id = $3`, [LISA]);
  check('manager hold without a reason is refused (400); with one → HOLD; the front desk cannot reorder (403); release / adjust (+0.5) / set-next all land as turn events and Mary is next',
    holdNoWhy.status === 400 && ok2(hold.status) && held.status === 'HOLD' && recReorder.status === 403 && ok2(rel.status) && (await state(ANNA)).status === 'READY'
      && ok2(adj.status) && adjEv.length === 1 && adjEv[0].turn_units_delta === 50 && ok2(nxt.status) && board6.body?.nextUpTechnicianId === MARY,
    `${holdNoWhy.status} ${hold.status}(${held.status}) rec ${recReorder.status} rel ${rel.status} adj ${adj.status}${short(adjEv.map((e) => e.turn_units_delta))} next ${nxt.status} → ${nameOf(board6.body?.nextUpTechnicianId)}`);

  // ── 7. the guest declined a technician → she is not offered this guest again (and keeps her place) ─────────────────
  const G3 = await add(`Turn Guest Three ${tag}`);
  const cd = await rec.call('POST', '/pos/turn-queue/guest-declined', { queueItemId: G3, technicianId: MARY, reason: 'Guest prefers someone else' });
  const r3 = await rec.call('POST', `/pos/ai-queue-assignment/entries/${G3}/recommend`);
  const top3 = r3.body?.envelope?.recommendedTechnicianId ?? r3.body?.recommendedTechnicianId ?? (r3.body?.envelope?.fairTurn ?? r3.body?.fairTurn)?.recommendedTechnicianId ?? null;
  check('the guest declines Mary → CUSTOMER_DECLINED recorded; the next recommendation for that guest is not Mary, and Mary is still next for everyone else',
    ok2(cd.status) && ok2(r3.status) && !!top3 && top3 !== MARY && (await events(`and event_type = 'CUSTOMER_DECLINED' and queue_item_id = $3`, [G3])).length === 1
      && (await rec.call('GET', '/pos/turn-queue/board')).body?.nextUpTechnicianId === MARY, `${cd.status} ${r3.status} → ${nameOf(top3)}`);

  // ── 8. history: append-only, ordered, explained ───────────────────────────────────────────────────────────────────
  const hist = await own.call('GET', '/pos/turn-queue/history');
  const seqs = (hist.body?.events ?? []).map((e) => e.sequenceNumber);
  let refused = false; try { await q(`update technician_turn_events set reason_text = 'tampered' where tenant_id = $1 and branch_id = $2`, [T, B]); } catch { refused = true; }
  let delRefused = false; try { await q(`delete from technician_turn_events where tenant_id = $1 and branch_id = $2`, [T, B]); } catch { delRefused = true; }
  check('the turn history lists every event in sequence with a plain sentence and the rules version; the database refuses UPDATE and DELETE of history',
    hist.status === 200 && seqs.length >= 15 && seqs.every((s, i) => i === 0 || s > seqs[i - 1]) && (hist.body?.events ?? []).every((e) => typeof e.text === 'string' && e.text.length > 5) && refused && delRefused,
    `${hist.status} ${seqs.length} events; update refused ${refused}, delete refused ${delRefused}; e.g. ${short((hist.body?.events ?? []).slice(-2).map((e) => e.text))}`);
  const recHist = await rec.call('GET', '/pos/turn-queue/history');
  check('the front desk cannot read the turn history (turn_queue.history.read is a manager key) — 403', recHist.status === 403, `${recHist.status}`);

  // ── 9. fairness + team report read the same events ────────────────────────────────────────────────────────────────
  const fair = await own.call('GET', '/pos/turn-queue/fairness');
  const rep = await own.call('GET', '/pos/turn-queue/reports/team?period=day');
  const repNames = (rep.body?.rows ?? []).map((r) => r.name);
  check('the fairness dashboard has a row per technician with neutral labels and says it is not payroll; the team report is alphabetical',
    fair.status === 200 && (fair.body?.rows ?? []).length === 3 && fair.body?.operationalDiagnosticNotPayroll === true && !/unfair/i.test(JSON.stringify(fair.body))
      && rep.status === 200 && repNames.length === 3 && JSON.stringify(repNames) === JSON.stringify([...repNames].sort((a, b) => a.localeCompare(b))),
    `${fair.status} ${short((fair.body?.rows ?? []).map((r) => [r.name, r.actualUnits, r.indicator]))} report ${rep.status} ${short(repNames)}`);

  // ── 10. the simulator changes nothing ─────────────────────────────────────────────────────────────────────────────
  const nBefore = (await events()).length;
  const sim = await own.call('POST', '/pos/ai-queue-assignment/fair-turn/simulate', { mode: 'lowest_turn_units', serviceLabel: 'Gel Manicure', technicians: [{ name: 'Lisa', turns: 2, readyMinutes: 20 }, { name: 'Mary', turns: 1.5, readyMinutes: 8 }, { name: 'Anna', turns: 1.5, readyMinutes: 3, onBreak: true }] });
  check('the simulator recommends Mary (fewest units; Anna on break is skipped) and changes nothing on the floor',
    ok2(sim.status) && sim.body?.recommended === 'Mary' && sim.body?.productionStateChanged === false && (await events()).length === nBefore, `${sim.status} ${short(sim.body)}`);

  // ── 11. settings: preview, versioned save, the Technician App widens ──────────────────────────────────────────────
  const prev = await own.call('POST', '/pos/turn-queue/settings/preview', { scope: 'branch', turnPolicy: { technicianQueueVisibility: 'FULL_TEAM_QUEUE' } });
  const st1 = await own.call('GET', '/pos/ai-queue-assignment/settings');
  const put1 = await own.call('PUT', '/pos/ai-queue-assignment/settings', { scope: 'branch', patch: { turnPolicy: { technicianQueueVisibility: 'FULL_TEAM_QUEUE' } }, expectedVersion: st1.body?.branch?.version ?? 0, reason: 'Team asked to see the line' });
  const bad = await own.call('PUT', '/pos/ai-queue-assignment/settings', { scope: 'branch', patch: { turnPolicy: { appointmentProtectionBufferMinutes: -5 } } });
  const st2 = await own.call('GET', '/pos/ai-queue-assignment/settings');
  const maryView2 = await tech[MARY].call('GET', '/tech/turn-queue');
  check('the settings preview shows Current → New; the save is versioned; an invalid turn policy is refused; Mary now sees the whole team (no money)',
    ok2(prev.status) && (prev.body?.changes ?? []).some((c) => c.key === 'technicianQueueVisibility') && ok2(put1.status) && (st2.body?.branch?.version ?? 0) > (st1.body?.branch?.version ?? 0)
      && bad.status === 400 && maryView2.status === 200 && (maryView2.body?.team ?? []).length === 3 && !/Cents/.test(JSON.stringify(maryView2.body?.team ?? [])),
    `${prev.status} ${short(prev.body?.changes)} put ${put1.status} v${st1.body?.branch?.version}→${st2.body?.branch?.version} bad ${bad.status} team ${(maryView2.body?.team ?? []).length}`);

  // ── 12. turn rules (versioned), day close, clock out, realtime ────────────────────────────────────────────────────
  const ru1 = await own.call('POST', '/pos/turn-queue/rules', { scope: 'category', category: `FT Manicure ${tag}`, turns: '1', reason: 'baseline' });
  const ru2 = await own.call('POST', '/pos/turn-queue/rules', { ruleKey: ru1.body?.ruleKey, scope: 'category', category: `FT Manicure ${tag}`, turns: '1.5', reason: 'longer service' });
  const rules = await own.call('GET', '/pos/turn-queue/rules?includeHistory=true');
  const mine = (rules.body?.rules ?? []).filter((r) => r.ruleKey === ru1.body?.ruleKey);
  check('a turn-unit rule saved twice keeps its history: v1 superseded, v2 active at 1.5 turns',
    ok2(ru1.status) && ok2(ru2.status) && mine.length === 2 && mine.some((r) => r.version === 2 && r.active && r.turnUnits === 150) && mine.some((r) => r.version === 1 && !r.active),
    `${ru1.status}/${ru2.status} ${short(mine.map((r) => [r.version, r.active, r.turnUnits]))}`);
  const closeToday = await own.call('POST', '/pos/turn-queue/day/close', { businessDate: localToday });
  const out = await own.call('POST', '/pos/time-clock/clock-out', { technicianId: ANNA });
  const anna12 = await state(ANNA);
  const announced = (await q(`select count(*)::int as n from outbox_events where tenant_id = $1 and event_type = 'technician.turn_queue_changed' and created_at >= $2`, [T, STARTED]))[0].n;
  check('today cannot be closed (only a finished business day); clocking out leaves the rotation (CLOCK_OUT); every change was announced (technician.turn_queue_changed in the outbox)',
    closeToday.status === 400 && ok2(out.status) && anna12.status === 'CLOCKED_OUT' && !anna12.in_rotation && (await events(`and event_type = 'CLOCK_OUT' and technician_id = $3`, [ANNA])).length === 1 && announced >= 10,
    `close ${closeToday.status} ${closeToday.body?.code} out ${out.status} ${short(anna12)} announced ${announced}`);
} catch (e) {
  check('the proof ran to completion', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
