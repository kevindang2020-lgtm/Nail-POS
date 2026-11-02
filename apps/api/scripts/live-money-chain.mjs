#!/usr/bin/env node
// live-money-chain.mjs — Kevin's Oct 13 2026 FLOW mandate, end to end on ONE booted API and the real PostgreSQL. The
// whole floor-to-payroll chain, every hop asserted and every hop linked back to the one before it:
//
//   FAIR TURN ASSIGN (all three manager modes: RECOMMEND_AND_CONFIRM → MANUAL → AUTOMATIC, each with its turn history)
//     → SERVICE DONE in the Technician App (TURN_CREDIT) → CHECKOUT (tip) → PAYMENT (card through the sandbox processor —
//     the fake; cash for one ticket) → COMMISSION + TIP EARNINGS (the immutable compensation snapshot; the Tech App's
//     dashboard, earnings and the POS / owner money reads all equal it) → PAY PERIOD (salon zone, branch-scoped) →
//     PREPARE (validation, preview hash) → APPROVE (step-up) → LOCK / PAY (payout + mark paid, DB lock) → EXPORT (CSV,
//     audited) → REFUND AFTER THE LOCK → REVERSAL in the NEXT open period (pending → approved → on the next line, linked to
//     the locked period; the locked lines byte-for-byte unchanged).
//   Multi-location: the same technician is paid for a ticket at a SECOND location; each location's period carries only its
//   own earnings (branch attribution), the Technician App shows both, and the second location's refund stays there.
//   Linkage: turn event (queue item) → ticket → snapshot rows → payroll line drill-down (ticket listed) → adjustment
//   (ticket + original period). Nothing is stubbed except the card processor (PAYMENTS_SANDBOX=1, never a real gateway).
//
// Run:  DATABASE_URL=postgres://…/<scratch db> node scripts/live-money-chain.mjs   (apps/api built). Never point it at
// production: it creates two proof branches, staff, technicians, tickets and periods, and removes everything it made at the
// end except the append-only turn history and audit rows (kept by design, counted in the last check).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.PORT_PROOF || 3073), API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const TZ = 'America/New_York';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 320);
const code = (r) => r.body?.code ?? r.body?.error?.code ?? r.body?.details?.code ?? null;

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Money Chain%'`, [T])) {
  const ps = (await q(`select id from payroll_periods where branch_id = $1`, [r.id])).map((x) => x.id);
  await removeProofBranchTx(client, T, r.id);
  if (ps.length) await q(`delete from payroll_lines where period_id = any($1::uuid[])`, [ps]);
}

const STARTED = new Date();
const tag = String(Date.now()).slice(-6);
const B = randomUUID(), B2 = randomUUID(), OWN = randomUUID(), REC = randomUUID(), CAT = randomUUID(), SVC = randomUUID(), CAT2 = randomUUID(), SVC2 = randomUUID(), CUST = randomUUID();
const PW = 'Chain!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const email = (k) => `mc-${k}-${tag}@aipowersalon.test`;
const TECHS = ['Lisa', 'Mary', 'Anna'].map((n) => ({ key: n.toLowerCase(), name: n, id: randomUUID(), user: randomUUID() }));
const [LISA, MARY, ANNA] = TECHS.map((t) => t.id);
const nameOf = (id) => TECHS.find((t) => t.id === id)?.name ?? id;
const hadPackage = (await q(`select 1 from tenant_ai_subscriptions where tenant_id = $1 and package_code = 'ai_queue_technician_assignment' and status in ('active','trialing')`, [T])).length > 0;
const SUB = randomUUID();
if (!hadPackage) await q(`insert into tenant_ai_subscriptions (id, tenant_id, package_code, status) values ($1, $2, 'ai_queue_technician_assignment', 'active')`, [SUB, T]);

await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active',$4,'1 Chain Street'), ($5,$2,$6,'active',$4,'2 Chain Street')`, [B, T, `Live Money Chain Proof ${tag}`, TZ, B2, `Live Money Chain Proof B ${tag}`]);
await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,$4), ($5,$2,$6,$7)`, [CAT, T, B, `MC Manicure ${tag}`, CAT2, B2, `MC Pedicure ${tag}`]);
// 60 % commission on the Gel ($45.00 → $27.00); the second location's Pedicure 50 % ($60.00 → $30.00)
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, commission_type, commission_value) values ($1,$2,$3,$4,'MC Gel Manicure',45,4500,'active','percent',60), ($5,$2,$6,$7,'MC Spa Pedicure',60,6000,'active','percent',50)`, [SVC, T, B, CAT, SVC2, B2, CAT2]);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Pat','Chain','Pat Chain')`, [CUST, T, B2]);
const addUser = async (id, role, key, fn, access) => {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,'Chain',$4 || ' Chain',$5,$6,'active',$7)`, [id, T, B, fn, email(key), hash, role]);
  for (const [br, level] of access) await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [T, br, id, level]);
};
await addUser(OWN, 'OWNER', 'owner', 'Olga', [[B, 'manager'], [B2, 'manager']]);
await addUser(REC, 'RECEPTION', 'rec', 'Rae', [[B, 'staff']]);
for (const t of TECHS) {
  await addUser(t.user, 'TECHNICIAN', t.key, t.name, [[B, 'staff']]);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status) values ($1,$2,$3,$4,$5,'MC',$5 || ' MC','active')`, [t.id, T, B, t.user, t.name]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,true)`, [T, B, t.id, SVC]);
}
const allUsers = [OWN, REC, ...TECHS.map((t) => t.user)];

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true', PAYMENTS_SANDBOX: '1' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY']) delete env[k];
// the background auto-run / recovery worker would race the proof's own calls
Object.assign(env, { AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off', COMPENSATION_RECOVERY: 'off' });
let proc = null; let errs = '';
const periodIds = []; const ticketIds = [];
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1200);
  for (const u of allUsers) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[email('owner'), email('rec'), ...TECHS.map((t) => email(t.key))]]).catch(() => undefined);
  if (!hadPackage) await q(`delete from tenant_ai_subscriptions where id = $1`, [SUB]).catch(() => undefined);
  const kept = [];
  for (const br of [B, B2]) { const a = await removeProofBranchTx(client, T, br).catch((e) => ({ removed: false, kept: [String(e?.message || e)] })); if (!a.removed) kept.push('branch'); kept.push(...(a.kept ?? [])); }
  if (periodIds.length) await q(`delete from payroll_lines where period_id = any($1::uuid[])`, [periodIds]).catch(() => undefined);
  await q(`delete from users where id = any($1::uuid[])`, [allUsers]).catch(() => undefined);
  const left = (await q(`select (select count(*)::int from branches where id = any($1::uuid[])) + (select count(*)::int from users where id = any($2::uuid[]))
      + (select count(*)::int from payroll_periods where id = any($3::uuid[])) + (select count(*)::int from payroll_lines where period_id = any($3::uuid[]))
      + (select count(*)::int from payroll_payouts where period_id = any($3::uuid[])) + (select count(*)::int from compensation_adjustments where branch_id = any($1::uuid[]))
      + (select count(*)::int from tickets where id = any($4::uuid[])) + (select count(*)::int from technicians where branch_id = any($1::uuid[]))
      + (select count(*)::int from tenant_ai_subscriptions where id = $5) as n`, [[B, B2], allUsers, periodIds, ticketIds, SUB]))[0].n;
  const okKept = kept.every((t) => ['technician_turn_events', 'audit_logs', 'audit_events', 'export_snapshots'].includes(t));
  check('the two proof branches, staff, technicians, tickets, periods, lines, payouts, adjustments and the AI package it added are removed (append-only turn history / audit stay, by design)',
    left === 0 && okKept, `kept ${[...new Set(kept)].join(', ')} left=${left}`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 10 * 60_000);

const signIn = async (key, branch = B) => {
  const jar = new Map(); const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); } };
  const hdr = (extra = {}) => ({ 'content-type': 'application/json', cookie: [...jar.values()].join('; '), ...extra });
  const l = await fetch(API + '/auth/login', { method: 'POST', headers: hdr(), body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: email(key), password: PW }) }); keep(l);
  const s = await fetch(API + '/auth/select-branch', { method: 'POST', headers: hdr(), body: JSON.stringify({ branchId: branch }) }); keep(s);
  return { ok: l.status === 200 && s.status === 200, detail: `${key}@${branch === B ? 'B1' : 'B2'}: login ${l.status} select ${s.status}`,
    call: (method, path, body, extra = {}) => fetch(API + path, { method, headers: hdr(extra), body: body ? JSON.stringify(body) : undefined }).then((r) => { keep(r); return j(r); }) };
};
const events = async (where = '', p = []) => q(`select sequence_number, technician_id, event_type, reason_code, queue_item_id, turn_units_delta, policy_version, actor_type from technician_turn_events where tenant_id = $1 and branch_id = $2 ${where} order by sequence_number`, [T, B, ...p]);
const item = async (id) => (await q(`select status, assigned_technician_id, ticket_id from pos_queue_items where id = $1`, [id]))[0];
const localDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const d = (n) => localDay(Date.now() + n * 86_400_000);
const recOf = (r) => r.body?.envelope?.recommendedTechnicianId ?? r.body?.recommendedTechnicianId ?? (r.body?.envelope?.fairTurn ?? r.body?.fairTurn)?.recommendedTechnicianId ?? null;
const putSettings = async (who, patch, reason) => {
  const st = await who.call('GET', '/pos/ai-queue-assignment/settings');
  return who.call('PUT', '/pos/ai-queue-assignment/settings', { scope: 'branch', patch, expectedVersion: st.body?.branch?.version ?? 0, reason });
};

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 320 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL (card processor = the sandbox fake)', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');
  const own = await signIn('owner'); const rec = await signIn('rec');
  const tech = Object.fromEntries(await Promise.all(TECHS.map(async (t) => [t.id, await signIn(t.key)])));
  check('the owner, a receptionist and three technicians sign in at location 1', own.ok && rec.ok && Object.values(tech).every((x) => x.ok), [own.detail, rec.detail, ...Object.values(tech).map((x) => x.detail)].join(' / '));

  // ══ 1. FAIR TURN — the three manager modes ═════════════════════════════════════════════════════════════════════════
  const s0 = await putSettings(own, { rotationPolicy: 'traditional_weighted_rotation', assignmentMode: 'RECOMMEND_AND_CONFIRM' }, 'money chain proof');
  for (const t of TECHS) { const r = await own.call('POST', '/pos/time-clock/clock-in', { technicianId: t.id }); if (!ok2(r.status)) check(`${t.name} clocks in`, false, `${r.status} ${short(r.body)}`); await sleep(30); }
  const joins = await events(`and event_type = 'JOIN'`);
  check('settings on the ONE source (traditional weighted rotation, RECOMMEND_AND_CONFIRM); three clock-ins JOIN the rotation in order Lisa, Mary, Anna',
    ok2(s0.status) && joins.map((e) => nameOf(e.technician_id)).join() === 'Lisa,Mary,Anna', `${s0.status} ${short(joins.map((e) => nameOf(e.technician_id)))}`);
  const add = async (name) => { const r = await rec.call('POST', '/pos/queue/items', { customerName: name, serviceIds: [SVC], source: 'walk_in' }); return r.body?.queueItemId ?? r.body?.id ?? null; };

  // 1a. RECOMMEND_AND_CONFIRM: the engine recommends Lisa with the "why"; the receptionist confirms
  const G1 = await add(`Chain Guest One ${tag}`);
  const r1 = await rec.call('POST', `/pos/ai-queue-assignment/entries/${G1}/recommend`);
  const ft1 = r1.body?.envelope?.fairTurn ?? r1.body?.fairTurn;
  const acc1 = await rec.call('POST', `/pos/ai-queue-assignment/recommendations/${r1.body?.recommendationId}/decision`, { decision: 'accepted', idempotencyKey: 'mc-acc-' + tag });
  const acc1b = await rec.call('POST', `/pos/ai-queue-assignment/recommendations/${r1.body?.recommendationId}/decision`, { decision: 'accepted', idempotencyKey: 'mc-acc-' + tag });
  const ev1 = await events(`and queue_item_id = $3 and event_type in ('ASSIGN','MANUAL_ASSIGN')`, [G1]);
  check('RECOMMEND_AND_CONFIRM: the Fair Turn Engine recommends Lisa (next) with the "why" lines; confirming assigns her — ONE ASSIGN turn event with the rules version; the retried confirm replays',
    ok2(r1.status) && recOf(r1) === LISA && (ft1?.why ?? []).some((w) => /Lisa\b.*selected because/.test(w)) && ft1?.assignmentMode === 'RECOMMEND_AND_CONFIRM'
      && ok2(acc1.status) && ok2(acc1b.status) && ev1.length === 1 && ev1[0].technician_id === LISA && ev1[0].event_type === 'ASSIGN' && !!ev1[0].policy_version && (await item(G1))?.assigned_technician_id === LISA,
    `${r1.status} rec ${nameOf(recOf(r1))} mode ${ft1?.assignmentMode} acc ${acc1.status}/${acc1b.status} ${short(ev1.map((e) => [nameOf(e.technician_id), e.event_type, e.policy_version]))}`);

  // 1b. MANUAL: staff choose; no reason needed; the turn history still records it (and who was passed over)
  const sM = await putSettings(own, { assignmentMode: 'MANUAL' }, 'manual floor for the afternoon');
  const G2 = await add(`Chain Guest Two ${tag}`);
  const r2 = await rec.call('POST', `/pos/ai-queue-assignment/entries/${G2}/recommend`);
  const asg2 = await rec.call('POST', `/pos/queue/items/${G2}/assign-technician`, { technicianId: ANNA });
  const ev2 = await events(`and queue_item_id = $3`, [G2]);
  const board2 = await own.call('GET', '/pos/turn-queue/board');
  check('MANUAL: the engine still tracks the rotation (Mary is next) but staff pick Anna with NO reason required (200); the history records the MANUAL_ASSIGN for Anna and Mary keeps her place (still next)',
    ok2(sM.status) && ok2(r2.status) && recOf(r2) === MARY && ok2(asg2.status) && ev2.some((e) => e.event_type === 'MANUAL_ASSIGN' && e.technician_id === ANNA)
      && board2.body?.nextUpTechnicianId === MARY && (await item(G2))?.assigned_technician_id === ANNA,
    `${sM.status} rec ${nameOf(recOf(r2))} assign ${asg2.status} ${short(asg2.status >= 300 ? asg2.body : ev2.map((e) => [nameOf(e.technician_id), e.event_type, e.reason_code]))} next ${nameOf(board2.body?.nextUpTechnicianId)}`);

  // 1c. AUTOMATIC: the auto-run assigns the next fair technician on its own, explained the same way
  const sA = await putSettings(own, { assignmentMode: 'AUTOMATIC', autoEnabled: true, autoDelaySeconds: 0, autoConfidenceFloor: 0 }, 'trust the rules');
  const G3 = await add(`Chain Guest Three ${tag}`);
  const run = await own.call('POST', '/pos/ai-queue-assignment/auto/run');
  const ev3 = await events(`and queue_item_id = $3 and event_type in ('ASSIGN','MANUAL_ASSIGN')`, [G3]);
  const dec3 = (await q(`select decision, chosen_technician as chosen_technician_id from queue_assignment_decisions where tenant_id = $1 and queue_entry_id = $2`, [T, G3]).catch(() => []));
  check('AUTOMATIC: the auto-run assigns guest three to Mary (the next fair technician) by itself — an ASSIGN turn event and an auto_assigned decision row; no human picked',
    ok2(sA.status) && ok2(run.status) && (run.body?.assigned ?? 0) >= 1 && (await item(G3))?.assigned_technician_id === MARY && ev3.length === 1 && ev3[0].technician_id === MARY
      && dec3.some((x) => x.decision === 'auto_assigned' && x.chosen_technician_id === MARY),
    `${sA.status} ${short(sA.status >= 300 ? sA.body : null)} run ${run.status} ${short(run.body)} ev ${short(ev3.map((e) => [nameOf(e.technician_id), e.event_type, e.actor_type]))} dec ${short(dec3)}`);
  const sBack = await putSettings(own, { assignmentMode: 'RECOMMEND_AND_CONFIRM', autoEnabled: false }, 'back to confirm');
  if (!ok2(sBack.status)) check('back to RECOMMEND_AND_CONFIRM', false, `${sBack.status} ${short(sBack.body)}`);

  // ══ 2. SERVICE DONE → turn credit, one ticket per guest ════════════════════════════════════════════════════════════
  const serve = async (G, techId) => {
    const mv = await rec.call('POST', `/pos/queue/items/${G}/move-to-tech-queue`);
    const part = (await q(`select id from pos_tech_queue_tickets where queue_item_id = $1 order by visit_part limit 1`, [G]))[0]?.id;
    const t = tech[techId];
    const a = await t.call('POST', `/tech/tickets/${part}/accept`, {});
    const s = await t.call('POST', `/tech/tickets/${part}/start-service`, undefined, { 'idempotency-key': randomUUID() });
    const dn = await t.call('POST', `/tech/tickets/${part}/service-done`, {}, { 'idempotency-key': randomUUID() });
    return { statuses: [mv, a, s, dn].map((r) => r.status), ok: [mv, a, s, dn].every((r) => ok2(r.status)), body: [mv, a, s, dn].find((r) => !ok2(r.status))?.body };
  };
  const sv = [await serve(G1, LISA), await serve(G2, ANNA), await serve(G3, MARY)];
  const T1 = (await item(G1))?.ticket_id, T2 = (await item(G2))?.ticket_id, T3 = (await item(G3))?.ticket_id;
  ticketIds.push(T1, T2, T3);
  const credits = await events(`and event_type = 'TURN_CREDIT' and queue_item_id = any($3::uuid[])`, [[G1, G2, G3]]);
  const tstat = await q(`select id, status from tickets where id = any($1::uuid[])`, [[T1, T2, T3]]);
  check('each technician starts and finishes in the Tech App → ONE TURN_CREDIT (+1.0) per guest, on the right technician, and ONE service_done ticket per guest',
    sv.every((x) => x.ok) && credits.length === 3 && credits.every((c) => c.turn_units_delta === 100)
      && credits.find((c) => c.queue_item_id === G1)?.technician_id === LISA && credits.find((c) => c.queue_item_id === G2)?.technician_id === ANNA && credits.find((c) => c.queue_item_id === G3)?.technician_id === MARY
      && !!T1 && !!T2 && !!T3 && tstat.length === 3 && tstat.every((t) => t.status === 'service_done'),
    `${short(sv.map((x) => x.statuses))} ${short(sv.find((x) => !x.ok)?.body)} credits ${short(credits.map((c) => [nameOf(c.technician_id), c.turn_units_delta]))} tickets ${short(tstat)}`);

  // ══ 3. CHECKOUT → PAYMENT (sandbox card + cash) → COMMISSION + TIP earnings ═════════════════════════════════════════
  const tip1 = await rec.call('POST', `/pos/checkout/tickets/${T1}/apply-tip`, { tipType: 'custom', tipAmountCents: 1000, source: 'pos' });
  const pay1 = await rec.call('POST', `/pos/checkout/tickets/${T1}/pay/card`, { idempotencyKey: 'mc-card-1-' + tag });
  const pay2 = await rec.call('POST', `/pos/checkout/tickets/${T2}/pay/cash`, { amountReceivedCents: 10000 }, { 'idempotency-key': 'mc-cash-2-' + tag });
  const pay3 = await rec.call('POST', `/pos/checkout/tickets/${T3}/pay/card`, { idempotencyKey: 'mc-card-3-' + tag });
  const pay1b = await rec.call('POST', `/pos/checkout/tickets/${T1}/pay/card`, { idempotencyKey: 'mc-card-1-' + tag });
  let snaps = []; for (let i = 0; i < 40; i++) { snaps = await q(`select ticket_id, service_line_id, technician_id, tech_service_earnings_cents::int as earn, (card_tip_cents + cash_tip_cents)::int as tip, card_tip_cents::int as card_tip, branch_id, rule_source from ticket_compensation_snapshots where ticket_id = any($1::uuid[])`, [[T1, T2, T3]]); if (snaps.length >= 3) break; await sleep(250); }
  const snapOf = (t) => snaps.find((s) => s.ticket_id === t);
  const lineIds = (await q(`select id, ticket_id from ticket_service_lines where ticket_id = any($1::uuid[]) and removed_at is null`, [[T1, T2, T3]]));
  check('PAYMENT: Lisa\'s ticket by card (sandbox fake) with a $10.00 tip, Anna\'s in cash, Mary\'s by card; the repeated card request replays the approved payment (no second charge)',
    ok2(tip1.status) && ok2(pay1.status) && pay1.body?.status === 'approved' && ok2(pay2.status) && ok2(pay3.status) && pay3.body?.status === 'approved' && ok2(pay1b.status) && pay1b.body?.paymentId === pay1.body?.paymentId
      && (await q(`select count(*)::int as n from payments where ticket_id = $1 and status = 'approved'`, [T1]).catch(() => [{ n: -1 }]))[0].n === 1,
    `tip ${tip1.status} card ${pay1.status} ${short(pay1.body)} cash ${pay2.status} card ${pay3.status} replay ${pay1b.status}`);
  check('COMMISSION + TIP: the payment wrote the immutable snapshot — Lisa 60 % of $45.00 = $27.00 + her $10.00 card tip; Anna $27.00; Mary $27.00; each row points at its ticket AND its service line, branch = location 1, rule provenance stamped',
    snaps.length === 3 && snapOf(T1)?.technician_id === LISA && snapOf(T1)?.earn === 2700 && snapOf(T1)?.tip === 1000 && snapOf(T1)?.card_tip === 1000
      && snapOf(T2)?.technician_id === ANNA && snapOf(T2)?.earn === 2700 && snapOf(T3)?.technician_id === MARY && snapOf(T3)?.earn === 2700
      && snaps.every((s) => lineIds.some((l) => l.id === s.service_line_id && l.ticket_id === s.ticket_id) && s.branch_id === B && !!s.rule_source),
    short(snaps.map((s) => [nameOf(s.technician_id), s.earn, s.tip, s.rule_source])));

  // the money reads all equal the snapshot (one authority): Tech App dashboard + earnings + canonical, POS team list
  const dash = await tech[LISA].call('GET', '/tech');
  const earn = await tech[LISA].call('GET', '/tech/earnings');
  const canon = await tech[LISA].call('GET', '/tech/earnings/canonical?period=day');
  const ownDetail = await own.call('GET', `/pos/checkout/tickets/${T1}`);
  check('ONE money authority: the Tech App dashboard, /tech/earnings and the canonical earnings all say Lisa earned $27.00 commission + $10.00 tips today — the snapshot\'s numbers',
    dash.status === 200 && earn.status === 200 && canon.status === 200 && dash.body?.earnings?.estimatedCommissionCents === 2700 && dash.body?.earnings?.tipsCents === 1000
      && earn.body?.estimatedCommissionCents === 2700 && earn.body?.tipsCents === 1000 && (canon.body?.commissionCents ?? canon.body?.serviceCommissionCents ?? canon.body?.techServiceEarningsCents) === 2700,
    `dash ${dash.status} ${short(dash.body?.earnings)} earn ${short(earn.body)} canon ${short(canon.body ? { c: canon.body.commissionCents, s: canon.body.serviceCommissionCents, t: canon.body.tipsCents } : canon.body)}`);
  // the merged duplicate readers (Oct 13 2026, D3/D4/D8): the Live Technician Schedule detail, the POS team list and
  // the Commission Report all say the snapshot's $27.00 for Lisa — none of them re-prices the lines any more
  const ls = await own.call('GET', `/pos/technicians/${LISA}/live-detail?date=${localDay(Date.now())}`);
  const team = await own.call('GET', '/pos/team/state?search=Lisa&pageSize=50');
  const lisaTeam = (team.body?.rows?.items ?? []).find((r) => r.technicianId === LISA) ?? (team.body?.tabs ?? []).flatMap((t) => t.rows ?? t.items ?? []).find((r) => r.technicianId === LISA);
  const rep = await own.call('GET', '/pos/commission-report/state?preset=today');
  const lisaRep = (rep.body?.rows ?? []).find((r) => r.technicianId === LISA);
  check('ONE money authority (merged readers): the Live Technician Schedule detail ($27.00 commission, $10.00 tips, $45.00 sales), the POS team list ($27.00) and the Commission Report ($27.00 + $10.00) all equal the snapshot',
    ls.status === 200 && ls.body?.commissionPreviewCents === 2700 && ls.body?.tipsTodayCents === 1000 && ls.body?.salesTodayCents === 4500
      && team.status === 200 && lisaTeam?.commissionCents === 2700 && rep.status === 200 && lisaRep?.commissionCents === 2700 && lisaRep?.tipsCents === 1000,
    `ls ${ls.status} ${short(ls.body && { c: ls.body.commissionPreviewCents, t: ls.body.tipsTodayCents, s: ls.body.salesTodayCents })} team ${team.status} ${short(lisaTeam && { c: lisaTeam.commissionCents })} rep ${rep.status} ${short(lisaRep && { c: lisaRep.commissionCents, t: lisaRep.tipsCents })}`);
  // ONE-PAY (Oct 13 2026): the POS Technicians screen (row + KPI + payroll summary) and the POS Tech Queue tips are the
  // snapshot too — they used to say today's sales × Lisa's CURRENT rate, tips 0, and the whole ticket tip to the primary
  const pt = await own.call('GET', '/pos/technicians/state?search=Lisa&pageSize=50');
  const lisaRow = (pt.body?.rows?.items ?? []).find((r) => r.technicianId === LISA);
  const tq = await own.call('GET', '/pos/tech-queue/state');
  const lisaTq = (tq.body?.technicianRows ?? []).find((r) => r.technicianId === LISA);
  check('ONE-PAY: the POS Technicians row ($27.00 commission, $10.00 tips) and the POS Tech Queue tips ($10.00) for Lisa equal the snapshot — no sales × current rate, no whole-tip-to-primary',
    pt.status === 200 && lisaRow?.estimatedCommissionCents === 2700 && lisaRow?.todayTipsCents === 1000 && tq.status === 200 && lisaTq?.tipsTodayCents === 1000,
    `technicians ${pt.status} ${short(lisaRow && { c: lisaRow.estimatedCommissionCents, t: lisaRow.todayTipsCents, s: lisaRow.todaySalesCents })} tech-queue ${tq.status} ${short(lisaTq && { t: lisaTq.tipsTodayCents })}`);
  check('the checkout ticket detail\'s commission block for the PAID ticket IS the snapshot ($27.00 for Lisa, source "snapshot"), not a re-resolved rate',
    ownDetail.status === 200 && ownDetail.body?.commission?.estimatedPayoutCents === 2700 && ownDetail.body?.commission?.source === 'snapshot', `${ownDetail.status} ${short(ownDetail.body?.commission)}`);

  // ══ 4. a SECOND location: Lisa also serves there (multi-location) ═══════════════════════════════════════════════════
  const own2 = await signIn('owner', B2);
  const TB2 = randomUUID(); ticketIds.push(TB2);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, tip_cents, ready_checkout_at) values ($1,$2,$3,$4,'ready_for_payment',$5,500, now())`, [TB2, T, B2, CUST, LISA]);
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,'MC Spa Pedicure',6000,60,6000)`, [T, B2, TB2, SVC2, LISA]);
  const payB2 = await own2.call('POST', `/pos/checkout/tickets/${TB2}/pay/cash`, { amountReceivedCents: 10000 }, { 'idempotency-key': 'mc-b2-' + tag });
  let snapB2 = []; for (let i = 0; i < 40; i++) { snapB2 = await q(`select technician_id, branch_id, tech_service_earnings_cents::int as earn, (card_tip_cents + cash_tip_cents)::int as tip from ticket_compensation_snapshots where ticket_id = $1`, [TB2]); if (snapB2.length) break; await sleep(250); }
  check('location 2: the owner takes cash for Lisa\'s $60 pedicure (+$5 tip) → her snapshot there is $30.00 + $5.00, attributed to location 2',
    own2.ok && ok2(payB2.status) && snapB2.length === 1 && snapB2[0].technician_id === LISA && snapB2[0].branch_id === B2 && snapB2[0].earn === 3000 && snapB2[0].tip === 500,
    `${own2.detail} ${payB2.status} ${short(payB2.status >= 300 ? payB2.body : snapB2)}`);

  // ══ 5. PAY PERIOD → PREPARE → APPROVE → EXPORT → PAYOUT → LOCK ══════════════════════════════════════════════════════
  const cp = await own.call('POST', '/pos/payroll/periods', { label: `Chain ${tag}`, periodStart: d(-1), periodEnd: d(1) });
  const P1 = cp.body?.id; if (P1) periodIds.push(P1);
  const cpB2 = await own2.call('POST', '/pos/payroll/periods', { label: `Chain B2 ${tag}`, periodStart: d(-1), periodEnd: d(1) });
  const PB2 = cpB2.body?.id; if (PB2) periodIds.push(PB2);
  const prep = await own.call('POST', `/pos/payroll/periods/${P1}/prepare`, {});
  const lineOf = (body, t) => (body?.lines ?? []).find((l) => l.technicianId === t);
  const lisaP1 = lineOf(prep.body, LISA);
  check('PAY PERIOD (location 1, salon dates): PREPARE builds the lines from the snapshot ONLY for this location — Lisa $27.00 commission + $10.00 tips (her location-2 work is NOT here); Anna and Mary $27.00; review + preview hash; no blocking issue',
    ok2(cp.status) && ok2(prep.status) && prep.body?.period?.status === 'review' && /^[0-9a-f]{64}$/.test(prep.body?.period?.previewHash ?? '') && prep.body?.validation?.blocking === 0
      && lisaP1?.commissionCents === 2700 && lisaP1?.tipsCents === 1000 && lineOf(prep.body, ANNA)?.commissionCents === 2700 && lineOf(prep.body, MARY)?.commissionCents === 2700,
    `${cp.status} ${prep.status} ${short({ st: prep.body?.period?.status, v: prep.body?.validation, lisa: lisaP1 && { c: lisaP1.commissionCents, t: lisaP1.tipsCents, p: lisaP1.payableCents } })}`);
  const drill = await own.call('GET', `/pos/payroll/periods/${P1}/technicians/${LISA}`);
  check('LINKAGE: the payroll line drill-down for Lisa lists ticket one (the ticket her TURN_CREDIT event\'s queue item became) with its $27.00 commission and $10.00 tip',
    drill.status === 200 && JSON.stringify(drill.body).includes(T1) && credits.find((c) => c.queue_item_id === G1)?.technician_id === LISA && JSON.stringify(drill.body).includes('2700'),
    `${drill.status} ${short(drill.body?.services ?? drill.body)}`);

  const V = prep.body?.period?.version, H = prep.body?.period?.previewHash;
  const noStep = await own.call('POST', `/pos/payroll/periods/${P1}/finalize`, { expectedVersion: V, calculationHash: H });
  const su = await own.call('POST', '/auth/step-up', { password: PW });
  const ap = await own.call('POST', `/pos/payroll/periods/${P1}/finalize`, { expectedVersion: V, calculationHash: H });
  const recAp = await rec.call('POST', `/pos/payroll/periods/${P1}/finalize`, { expectedVersion: V });
  check('APPROVE: refused without a fresh step-up (403), refused for the receptionist (403); after the owner\'s step-up it is approved ONCE with the hash she reviewed',
    noStep.status === 403 && ok2(su.status) && ok2(ap.status) && ap.body?.period?.status === 'finalized' && recAp.status === 403
      && (await q(`select approval_hash from payroll_periods where id = $1`, [P1]))[0]?.approval_hash === H, `${noStep.status} su ${su.status} ap ${ap.status} rec ${recAp.status}`);
  const ex = await own.call('POST', `/pos/payroll/periods/${P1}/export`, { format: 'csv' });
  const csv = ex.body?.base64 ? Buffer.from(ex.body.base64, 'base64').toString('utf8') : '';
  check('EXPORT: the CSV carries Lisa\'s exact cents ($27.00 = 2700) and the export is audited with its sha256', ok2(ex.status) && /,2700,27\.00,/.test(csv)
    && (await q(`select content_sha256 from payroll_exports where period_id = $1`, [P1]))[0]?.content_sha256 === ex.body?.sha256, `${ex.status} ${csv.split('\n').slice(0, 2).join(' | ').slice(0, 200)}`);
  const lisaPayable = Number((await q(`select payable_cents from payroll_lines where period_id = $1 and technician_id = $2`, [P1, LISA]))[0]?.payable_cents);
  const po = await own.call('POST', `/pos/payroll/periods/${P1}/payouts`, { technicianId: LISA, amountCents: 1000, method: 'cash', idempotencyKey: 'mc-po-' + tag });
  const pay = await own.call('POST', `/pos/payroll/periods/${P1}/pay`, { method: 'direct_deposit', reference: 'ACH-MC-' + tag });
  const paid = await q(`select l.technician_id, l.payable_cents::int as payable, coalesce((select sum(amount_cents) from payroll_payouts o where o.period_id = l.period_id and o.technician_id = l.technician_id and o.status = 'paid'), 0)::int as paid from payroll_lines l where l.period_id = $1`, [P1]);
  const dbLock = await q(`update payroll_lines set payable_cents = payable_cents + 1 where period_id = $1`, [P1]).then(() => 'updated', (e) => String(e.message));
  check('PAYOUT + LOCK: a $10 cash payout, then MARK PAID settles every outstanding cent (Σ paid == payable, Lisa $37.00); the paid lines are refused at the DATABASE',
    ok2(po.status) && ok2(pay.status) && pay.body?.period?.status === 'paid' && lisaPayable === 3700 && paid.every((x) => x.paid === x.payable) && /locked/.test(dbLock),
    `${po.status} ${pay.status} payable ${lisaPayable} ${short(paid)} lock: ${dbLock.slice(0, 80)}`);
  const tp = await tech[LISA].call('GET', '/tech/payroll');
  // location 2's period: Lisa's line there carries ONLY the location-2 ticket. While it is still in REVIEW the technician
  // does NOT see it (unapproved numbers never reach her); once the owner approves it, her Tech App lists BOTH periods.
  const prepB2 = await own2.call('POST', `/pos/payroll/periods/${PB2}/prepare`, {});
  const lisaB2 = lineOf(prepB2.body, LISA);
  const tp2 = await tech[LISA].call('GET', '/tech/payroll');
  const suB2 = await own2.call('POST', '/auth/step-up', { password: PW });
  const apB2 = await own2.call('POST', `/pos/payroll/periods/${PB2}/finalize`, { expectedVersion: prepB2.body?.period?.version, calculationHash: prepB2.body?.period?.previewHash });
  const tp3 = await tech[LISA].call('GET', '/tech/payroll');
  const pOf = (r, id) => (r.body?.periods ?? []).find((p) => p.periodId === id);
  check('MULTI-LOCATION: location 2\'s period has Lisa\'s location-2 work only ($30.00 + $5.00 tip, no location-1 money); in REVIEW it is hidden from her Tech App; once approved her Tech App lists BOTH periods (location 1 paid in full, location 2 $35.00 outstanding)',
    ok2(cpB2.status) && ok2(prepB2.status) && lisaB2?.commissionCents === 3000 && lisaB2?.tipsCents === 500 && (prepB2.body?.lines ?? []).length === 1
      && tp2.status === 200 && !!pOf(tp2, P1) && !pOf(tp2, PB2) && ok2(suB2.status) && ok2(apB2.status)
      && tp3.status === 200 && pOf(tp3, P1)?.paidCents === 3700 && pOf(tp3, P1)?.outstandingCents === 0 && pOf(tp3, PB2)?.outstandingCents === 3500 && pOf(tp3, PB2)?.status === 'finalized',
    `${cpB2.status} ${prepB2.status} ${short(lisaB2 && { c: lisaB2.commissionCents, t: lisaB2.tipsCents })} tech ${tp.status}/${tp2.status}/${tp3.status} ap ${apB2.status} ${short((tp3.body?.periods ?? []).map((p) => [p.periodId === P1 ? 'P1' : p.periodId === PB2 ? 'PB2' : '?', p.status, p.paidCents, p.outstandingCents]))}`);

  // ══ 6. REFUND AFTER THE LOCK → REVERSAL in the NEXT open period ════════════════════════════════════════════════════
  const cp2 = await own.call('POST', '/pos/payroll/periods', { label: `Chain next ${tag}`, periodStart: d(2), periodEnd: d(15) });
  const P2 = cp2.body?.id; if (P2) periodIds.push(P2);
  const before = await q(`select technician_id, commission_cents, tips_cents, payable_cents from payroll_lines where period_id = $1 order by technician_id`, [P1]);
  const rf = await own.call('POST', `/pos/checkout/tickets/${T1}/refund`, { reason: 'Gel lifted the next day — full service refund', amountCents: 4500 }, { 'idempotency-key': 'mc-refund-' + tag });
  const rf2 = await own.call('POST', `/pos/checkout/tickets/${T1}/refund`, { reason: 'Gel lifted the next day — full service refund', amountCents: 4500 }, { 'idempotency-key': 'mc-refund-' + tag });
  let adj = []; for (let i = 0; i < 40; i++) { adj = await q(`select id, technician_id, category, amount_cents::int as amount, status, period_id, original_period_id, ticket_id from compensation_adjustments where ticket_id = $1 and source = 'refund'`, [T1]); if (adj.length) break; await sleep(250); }
  const after = await q(`select technician_id, commission_cents, tips_cents, payable_cents from payroll_lines where period_id = $1 order by technician_id`, [P1]);
  const exc = await own.call('GET', '/pos/payroll/exceptions?status=open');
  const lisaRev = adj.filter((a) => a.technician_id === LISA).reduce((s, a) => s + a.amount, 0);
  check('REFUND after the period was PAID (sandbox refund, replayed once by its key): Lisa\'s $27.00 commission is reversed ONCE as a PENDING entry in the NEXT open period, linked to ticket one and to the locked period; the locked lines are byte-for-byte unchanged; the owner has a refund_closed_period exception',
    ok2(rf.status) && ok2(rf2.status) && adj.length >= 1 && lisaRev === -2700 && adj.every((a) => a.period_id === P2 && a.original_period_id === P1 && a.status === 'pending' && a.ticket_id === T1)
      && JSON.stringify(before) === JSON.stringify(after) && (exc.body ?? []).some((e) => e.kind === 'refund_closed_period'),
    `${rf.status}/${rf2.status} ${short(rf.status >= 300 ? rf.body : adj.map((a) => [nameOf(a.technician_id), a.category, a.amount, a.status]))} exc ${short((exc.body ?? []).map((e) => e.kind))}`);
  const pend = await own.call('GET', '/pos/payroll/adjustments?status=pending');
  let decided = 0; for (const a of (pend.body ?? []).filter((x) => x.periodId === P2)) { const r = await own.call('POST', `/pos/payroll/adjustments/${a.id}/decide`, { decision: 'approve' }); if (ok2(r.status)) decided++; }
  const prep2 = await own.call('POST', `/pos/payroll/periods/${P2}/prepare`, {});
  const lisaP2 = lineOf(prep2.body, LISA);
  check('REVERSAL in the next period: the owner approves it; PREPARE of the next period carries Lisa\'s −$27.00 (net negative → payable $0, REVIEW_REQUIRED, never a negative payment)',
    decided === adj.length && ok2(prep2.status) && lisaP2?.adjustmentCents === -2700 && (lisaP2?.payableCents ?? -1) === 0 && lisaP2?.reviewRequired === true && (lisaP2?.netCents ?? 0) < 0,
    `decided ${decided}/${adj.length} prep ${prep2.status} ${short(prep2.status >= 300 ? prep2.body : lisaP2 && { a: lisaP2.adjustmentCents, n: lisaP2.netCents, p: lisaP2.payableCents, r: lisaP2.reviewRequired })}`);

  // location 2's refund stays at location 2
  const rfB2 = await own2.call('POST', `/pos/checkout/tickets/${TB2}/refund`, { reason: 'Polish chipped', amountCents: 3000 }, { 'idempotency-key': 'mc-refund-b2-' + tag });
  let adjB2 = []; for (let i = 0; i < 40; i++) { adjB2 = await q(`select technician_id, amount_cents::int as amount, status, period_id, branch_id from compensation_adjustments where ticket_id = $1 and source = 'refund'`, [TB2]); if (adjB2.length) break; await sleep(250); }
  check('location 2: a half refund ($30.00) of Lisa\'s $60.00 pedicure (its period approved, not paid) reverses exactly half her commission (−$15.00) at location 2 only — never in location 1\'s periods',
    ok2(rfB2.status) && adjB2.length >= 1 && adjB2.filter((a) => a.technician_id === LISA).reduce((s, a) => s + a.amount, 0) === -1500 && adjB2.every((a) => a.branch_id === B2 && a.period_id !== P1 && a.period_id !== P2),
    `${rfB2.status} ${short(rfB2.status >= 300 ? rfB2.body : adjB2)}`);

  // ══ 7. the day's turn history explains every hop, read by the manager screen ══════════════════════════════════════
  const hist = await own.call('GET', '/pos/turn-queue/history');
  const hev = hist.body?.events ?? [];
  const forG1 = hev.filter((e) => e.queueItemId === G1).map((e) => e.eventType);
  check('the Turn History screen\'s read lists every event in sequence with a plain sentence; guest one\'s line reads ASSIGN → START → COMPLETE → TURN_CREDIT',
    hist.status === 200 && hev.every((e, i) => i === 0 || e.sequenceNumber > hev[i - 1].sequenceNumber) && hev.every((e) => typeof e.text === 'string' && e.text.length > 5)
      && ['ASSIGN', 'START', 'COMPLETE', 'TURN_CREDIT'].every((t) => forG1.includes(t)), `${hist.status} ${hev.length} events; G1 ${short(forG1)}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
