#!/usr/bin/env node
// live-multitech-queue.mjs — multi-technician routing (scratchpad CONTRACT §8), proved on the real API and PostgreSQL
// with REAL queue entries, a REAL Tech app session per technician and a REAL cash checkout. Nothing is stubbed:
//   • a 3-service visit (Pedicure / Manicure / Nail Art) whose technicians have disjoint skills → the visit plan splits it
//     over 2 technicians → ACCEPT assigns it through the ONE multi-line writer (version bump, one history row, both
//     queue.customer_assigned and queue.service_lines_assigned in the outbox) → a retry replays;
//   • moved to the Tech Queue it becomes one part per technician; each technician's /tech list and ticket show ONLY their
//     lines; both accept / start / finish; the ticket lines carry each LINE technician, the visit and the queue item
//     complete ONCE (one service.completed); a cash checkout with a tip writes compensation snapshot rows per technician;
//   • a party of 3 (together) is planned with no technician shared; a stale member → 409 and NOBODY is assigned; the
//     fresh plan assigns all three in one call; "Start party" moves them all to the Tech Queue.
//
// Run:  DATABASE_URL=postgres://…/<scratch db> node scripts/live-multitech-queue.mjs   (apps/api built). Never point it at
// production: it creates a proof branch, staff and technicians, may add the AI package to the salon for the run, and
// removes everything it made.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.PORT_PROOF || 3069), API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 260);

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Multitech Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);

const STARTED = new Date();
const tag = String(Date.now()).slice(-6);
const B = randomUUID(), OWN = randomUUID(), REC = randomUUID();
const [CP, CM, CA] = [randomUUID(), randomUUID(), randomUUID()];
const [SP, SM, SA] = [randomUUID(), randomUUID(), randomUUID()];
const PW = 'MultiT!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const email = (k) => `mt-${k}-${tag}@aipowersalon.test`;
// Pia / Yu / Zed do pedicures; Mo / Xi do manicures and nail art — nobody covers a pedicure + manicure visit alone
const TECHS = [['pia', 'Pia', [SP]], ['mo', 'Mo', [SM, SA]], ['xi', 'Xi', [SM, SA]], ['yu', 'Yu', [SP]], ['zed', 'Zed', [SP]]]
  .map(([k, n, svcs]) => ({ key: k, name: n, svcs, id: randomUUID(), user: randomUUID() }));
const hadPackage = (await q(`select 1 from tenant_ai_subscriptions where tenant_id = $1 and package_code = 'ai_queue_technician_assignment' and status in ('active','trialing')`, [T])).length > 0;
const SUB = randomUUID();
if (!hadPackage) await q(`insert into tenant_ai_subscriptions (id, tenant_id, package_code, status) values ($1, $2, 'ai_queue_technician_assignment', 'active')`, [SUB, T]);

await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York','9 Split Way')`, [B, T, `Live Multitech Proof ${tag}`]);
for (const [id, n] of [[CP, 'MT Pedicure'], [CM, 'MT Manicure'], [CA, 'MT Nail Art']]) await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,$4)`, [id, T, B, `${n} ${tag}`]);
for (const [id, c, n, d, p] of [[SP, CP, 'MT Pedicure', 50, 6000], [SM, CM, 'MT Manicure', 40, 4000], [SA, CA, 'MT Nail Art', 20, 3000]])
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, commission_type, commission_value) values ($1,$2,$3,$4,$5,$6,$7,'active','percent',50)`, [id, T, B, c, n, d, p]);
const addUser = async (id, role, key, level, fn) => {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,'Split',$4 || ' Split',$5,$6,'active',$7)`, [id, T, B, fn, email(key), hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [T, B, id, level]);
};
await addUser(OWN, 'OWNER', 'owner', 'manager', 'Olga');
await addUser(REC, 'RECEPTION', 'rec', 'staff', 'Rae');
for (const t of TECHS) {
  await addUser(t.user, 'TECHNICIAN', t.key, 'staff', t.name);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status) values ($1,$2,$3,$4,$5,'MT',$5 || ' MT','active')`, [t.id, T, B, t.user, t.name]);
  for (const s of t.svcs) await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,true)`, [T, B, t.id, s]);
}
const techName = (id) => TECHS.find((t) => t.id === id)?.name ?? id;
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
  await q(`delete from outbox_events where tenant_id = $1 and branch_id is null and event_type like 'queue.%' and created_at >= $2`, [T, STARTED]).catch(() => undefined);
  if (!hadPackage) await q(`delete from tenant_ai_subscriptions where id = $1`, [SUB]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[])`, [allUsers]).catch(() => undefined);
  const left = (await q(`select (select count(*)::int from branches where id = $1) + (select count(*)::int from users where id = any($2::uuid[]))
      + (select count(*)::int from pos_queue_items where branch_id = $1) + (select count(*)::int from queue_service_assignments where branch_id = $1)
      + (select count(*)::int from tickets where branch_id = $1) + (select count(*)::int from technicians where branch_id = $1)
      + (select count(*)::int from tenant_ai_subscriptions where id = $3) as n`, [B, allUsers, SUB]))[0].n;
  check('the proof branch, staff, technicians, queue, plans, tickets and the AI package it added are removed', a.removed && left === 0, (a.kept ?? []).join(', ') + ` left=${left}`);
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
const item = async (id) => (await q(`select status, assigned_technician_id, version, ticket_id, group_id from pos_queue_items where id = $1`, [id]))[0];
const planHist = async (id) => (await q(`select count(*)::int as n from pos_queue_status_history where queue_item_id = $1 and action = 'assign_plan'`, [id]))[0].n;
const outbox = async (type, id) => (await q(`select count(*)::int as n from outbox_events where tenant_id = $1 and event_type = $2 and aggregate_id::text = $3`, [T, type, id]))[0].n;
const setStatus = async (ids, status) => { for (const t of ids) await q(`insert into technician_statuses (tenant_id, branch_id, technician_id, status, changed_at) values ($1,$2,$3,$4, clock_timestamp())`, [T, B, t, status]); };
const byKey = (k) => TECHS.find((t) => t.key === k).id;
const lines = async (id) => q(`select service_id, technician_id, status, timing, tech_queue_ticket_id from queue_service_assignments where queue_item_id = $1 and status <> 'cancelled' order by sequence`, [id]);

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');
  const own = await signIn('owner'); const rec = await signIn('rec');
  const tech = Object.fromEntries(await Promise.all(TECHS.map(async (t) => [t.id, await signIn(t.key)])));
  check('the owner, a receptionist and five technicians sign in at the proof branch', own.ok && rec.ok && Object.values(tech).every((x) => x.ok), [own.detail, rec.detail, ...Object.values(tech).map((x) => x.detail)].join(' / '));

  // ── 1. a 3-service visit → the visit plan splits it over 2 technicians ─────────────────────────────────────────────
  const add = async (name, serviceIds) => { const r = await rec.call('POST', '/pos/queue/items', { customerName: name, serviceIds, source: 'walk_in' }); return r.body?.queueItemId ?? r.body?.id ?? null; };
  const G = await add(`Split Guest ${tag}`, [SP, SM, SA]);
  check('the receptionist checks in a 3-service guest (Pedicure / Manicure / Nail Art), version 1', !!G && (await item(G))?.version === 1, `${G} ${short(await item(G))}`);
  // Yu, Zed and Xi step away: one clear pedicure technician (Pia) and one clear manicure technician (Mo) — two equal free
  // technicians are a tie the engine rightly leaves to staff (that path is the party below)
  await setStatus([byKey('yu'), byKey('zed'), byKey('xi')], 'on_break');
  const pl = await rec.call('POST', `/pos/ai-queue-assignment/entries/${G}/plan`);
  const v = pl.body?.visit;
  const lineTechs = [...new Set((v?.lines ?? []).map((l) => l.technicianId))];
  const pedi = v?.lines?.find((l) => l.serviceId === SP); const mani = v?.lines?.find((l) => l.serviceId === SM); const art = v?.lines?.find((l) => l.serviceId === SA);
  check('nobody covers the visit → the plan SPLITS it over 2 technicians: a pedicure technician + one manicure technician for the manicure AND the nail art (after it)',
    ok2(pl.status) && pl.body?.kind === 'visit' && v?.mode === 'split' && lineTechs.length === 2 && ['Pia', 'Yu', 'Zed'].includes(techName(pedi?.technicianId)) && ['Mo', 'Xi'].includes(techName(mani?.technicianId))
      && art?.technicianId === mani?.technicianId && art?.timing === 'after' && v?.requiredAction === 'assignable' && typeof v?.estimatedFinishInMinutes === 'number' && v.estimatedFinishInMinutes < 110,
    `${pl.status} ${short({ mode: v?.mode, lines: v?.lines?.map((l) => [techName(l.technicianId), l.timing, l.estimatedStartInMinutes, l.estimatedEndInMinutes]), act: v?.requiredAction, conf: v?.confidence, w: v?.warnings, fin: v?.estimatedFinishInMinutes })}`);
  const recRow = (await q(`select envelope from queue_assignment_recommendations where id = $1`, [pl.body?.recommendationId]).catch(() => []))[0];
  check('the plan read is persisted (recommendation row with the plan) and announced (queue.assignment_recommended)', !!recRow && JSON.stringify(recRow.envelope ?? {}).includes('"mode":"split"'), `${!!recRow}`);

  // ── 2. ACCEPT → the one multi-line writer ───────────────────────────────────────────────────────────────────────────
  const KEY = 'live-mt-accept-' + tag;
  const acc = await rec.call('POST', `/pos/ai-queue-assignment/plans/${pl.body?.recommendationId}/decision`, { decision: 'accepted', idempotencyKey: KEY });
  const gi = await item(G); const gl = await lines(G);
  check('ACCEPT assigns the plan: lead technician on the guest, version 2, every line on its technician, ONE assign_plan history row, queue.customer_assigned + queue.service_lines_assigned in the outbox',
    ok2(acc.status) && acc.body?.applied === true && gi?.status === 'assigned' && gi?.version === 2 && lineTechs.includes(gi?.assigned_technician_id) && gl.length === 3
      && gl.every((l) => l.technician_id === v.lines.find((x) => x.serviceId === l.service_id)?.technicianId && l.status === 'assigned')
      && (await planHist(G)) === 1 && (await outbox('queue.customer_assigned', G)) === 1 && (await outbox('queue.service_lines_assigned', G)) === 1,
    `${acc.status} ${short(gi)} lines ${short(gl.map((l) => [techName(l.technician_id), l.status, l.timing]))} hist ${await planHist(G)}`);
  const again = await rec.call('POST', `/pos/ai-queue-assignment/plans/${pl.body?.recommendationId}/decision`, { decision: 'accepted', idempotencyKey: KEY });
  check('the same accept retried (same key) replays — no second write, no second history row, no second event',
    ok2(again.status) && again.body?.replayed === true && (await item(G))?.version === 2 && (await planHist(G)) === 1 && (await outbox('queue.service_lines_assigned', G)) === 1, `${again.status} ${short(again.body)}`);
  await setStatus(TECHS.map((t) => t.id), 'available');
  const detail = await rec.call('GET', `/pos/queue/items/${G}`);
  check('the queue detail shows a shared visit with both line technicians', detail.status === 200 && detail.body?.sharedVisit === true && (detail.body?.lineTechnicianIds ?? []).length === 2, `${detail.status} ${short({ s: detail.body?.sharedVisit, l: detail.body?.lineTechnicianIds })}`);

  // ── 3. Tech Queue: one part per technician; each sees only their lines ──────────────────────────────────────────────
  const mv = await rec.call('POST', `/pos/queue/items/${G}/move-to-tech-queue`);
  const parts = await q(`select id, assigned_technician_id, visit_part from pos_tech_queue_tickets where queue_item_id = $1 order by visit_part`, [G]);
  check('moved to the Tech Queue the visit becomes 2 parts (visit_part 1..2), one per technician, each line linked to its part',
    ok2(mv.status) && parts.length === 2 && parts.map((p) => p.visit_part).join() === '1,2' && new Set(parts.map((p) => p.assigned_technician_id)).size === 2
      && (await lines(G)).every((l) => parts.find((p) => p.id === l.tech_queue_ticket_id)?.assigned_technician_id === l.technician_id), `${mv.status} ${short(parts.map((p) => [techName(p.assigned_technician_id), p.visit_part]))}`);
  const svcNames = { [SP]: 'MT Pedicure', [SM]: 'MT Manicure', [SA]: 'MT Nail Art' };
  for (const p of parts) {
    const who = tech[p.assigned_technician_id];
    const list = await who.call('GET', '/tech/tickets');
    const d = await who.call('GET', `/tech/tickets/${p.id}`);
    const mine = v.lines.filter((l) => l.technicianId === p.assigned_technician_id).map((l) => svcNames[l.serviceId]).sort();
    const shown = (d.body?.services ?? []).map((s) => s.serviceName ?? s.name).sort();
    const other = parts.find((x) => x.id !== p.id);
    check(`${techName(p.assigned_technician_id)}'s /tech list has their part (not the other one) and the ticket shows ONLY their lines (${mine.join(' + ')}), marked as a shared visit (part ${p.visit_part} of 2)`,
      list.status === 200 && JSON.stringify(list.body).includes(p.id) && !JSON.stringify(list.body).includes(other.id) && d.status === 200 && JSON.stringify(shown) === JSON.stringify(mine)
        && d.body?.sharedVisit?.partCount === 2 && d.body?.sharedVisit?.visitPart === p.visit_part,
      `${list.status} ${d.status} shown ${short(shown)} shared ${short(d.body?.sharedVisit)}`);
  }

  // ── 4. both technicians accept / start / finish their part ──────────────────────────────────────────────────────────
  const [pa, pb] = parts; const ta = tech[pa.assigned_technician_id], tb = tech[pb.assigned_technician_id];
  const a1 = await ta.call('POST', `/tech/tickets/${pa.id}/accept`, {}); const a2 = await ta.call('POST', `/tech/tickets/${pa.id}/start-service`, undefined, { 'idempotency-key': randomUUID() });
  const b1 = await tb.call('POST', `/tech/tickets/${pb.id}/accept`, {}); const b2 = await tb.call('POST', `/tech/tickets/${pb.id}/start-service`, undefined, { 'idempotency-key': randomUUID() });
  const ticketId = (await item(G))?.ticket_id;
  const tl = async () => q(`select technician_id, status, completed_at is not null as done from ticket_service_lines where ticket_id = $1 order by technician_id, service_name_snapshot`, [ticketId]);
  check('both technicians accept and start their part; the visit is in service; ONE canonical ticket whose lines carry each LINE technician',
    [a1, a2, b1, b2].every((r) => ok2(r.status)) && (await item(G))?.status === 'in_service' && !!ticketId
      && (await q(`select count(*)::int as n from tickets where queue_item_id = $1`, [G]))[0].n === 1
      && JSON.stringify((await tl()).map((l) => l.technician_id).sort()) === JSON.stringify(v.lines.map((l) => l.technicianId).sort()),
    `${a1.status}/${a2.status}/${b1.status}/${b2.status} ${short(await tl())}`);
  const d1 = await ta.call('POST', `/tech/tickets/${pa.id}/service-done`, {}, { 'idempotency-key': randomUUID() });
  const midTicket = (await q(`select status from tickets where id = $1`, [ticketId]))[0]?.status;
  check(`${techName(pa.assigned_technician_id)} finishes part 1: only their lines are done; the visit stays in service (no service.completed yet)`,
    ok2(d1.status) && midTicket === 'serving' && (await item(G))?.status === 'in_service' && (await outbox('service.completed', ticketId)) === 0
      && (await tl()).every((l) => l.done === (l.technician_id === pa.assigned_technician_id)), `${d1.status} ticket ${midTicket} ${short(await tl())}`);
  const d2 = await tb.call('POST', `/tech/tickets/${pb.id}/service-done`, {}, { 'idempotency-key': randomUUID() });
  check('the last part finishes → the ticket is service_done, the queue item completed ONCE, ONE service.completed; every line done',
    ok2(d2.status) && (await q(`select status from tickets where id = $1`, [ticketId]))[0]?.status === 'service_done' && (await item(G))?.status === 'completed'
      && (await outbox('service.completed', ticketId)) === 1 && (await q(`select count(*)::int as n from pos_queue_status_history where queue_item_id = $1 and to_status = 'completed'`, [G]))[0].n === 1
      && (await lines(G)).every((l) => l.status === 'done'), `${d2.status} ${short(await item(G))}`);

  // ── 5. checkout: each technician is paid for THEIR lines ────────────────────────────────────────────────────────────
  const tip = await own.call('POST', `/pos/checkout/tickets/${ticketId}/apply-tip`, { tipType: 'custom', tipAmountCents: 1300, source: 'pos' });
  const pay = await own.call('POST', `/pos/checkout/tickets/${ticketId}/pay/cash`, { amountReceivedCents: 100000 }, { 'idempotency-key': 'live-mt-pay-' + randomUUID() });
  const snaps = await q(`select technician_id, sum(tech_service_earnings_cents)::int as earn, sum(card_tip_cents + cash_tip_cents)::int as tips from ticket_compensation_snapshots where ticket_id = $1 group by technician_id`, [ticketId]);
  const by = Object.fromEntries(snaps.map((s) => [s.technician_id, s]));
  const pediT = pedi.technicianId, maniT = mani.technicianId;
  check('a cash checkout with a $13 tip writes compensation snapshot rows PER technician: 50% of their own lines ($30.00 / $35.00) and the tip split over the line technicians',
    ok2(tip.status) && ok2(pay.status) && snaps.length === 2 && by[pediT]?.earn === 3000 && by[maniT]?.earn === 3500 && (by[pediT]?.tips ?? 0) + (by[maniT]?.tips ?? 0) === 1300 && by[pediT]?.tips > 0 && by[maniT]?.tips > 0,
    `tip ${tip.status} pay ${pay.status} ${short(tip.status >= 300 ? tip.body : pay.status >= 300 ? pay.body : snaps.map((s) => [techName(s.technician_id), s.earn, s.tips]))}`);

  // ── 6. a party of 3, together: planned, all-or-none, Start party ───────────────────────────────────────────────────
  const P = [await add(`Party A ${tag}`, [SP]), await add(`Party B ${tag}`, [SP]), await add(`Party C ${tag}`, [SP])];
  const grp = await rec.call('POST', '/pos/queue/groups', { label: `Bridal ${tag}`, queueItemIds: P, together: true });
  const gid = grp.body?.groupId;
  const pp = await rec.call('POST', `/pos/ai-queue-assignment/groups/${gid}/plan`);
  const members = pp.body?.party?.members ?? [];
  const partyTechs = members.flatMap((m) => m.lines.map((l) => l.technicianId));
  check('a party of 3 (served together) is planned: one plan per member, no technician shared between members, a shared start',
    ok2(grp.status) && ok2(pp.status) && pp.body?.kind === 'party' && pp.body?.party?.together === true && members.length === 3 && partyTechs.every(Boolean) && new Set(partyTechs).size === 3,
    `${grp.status} ${pp.status} ${short({ m: members.map((m) => m.lines.map((l) => techName(l.technicianId))), s: pp.body?.party?.sharedStartInMinutes, act: pp.body?.party?.requiredAction, w: pp.body?.party?.warnings })}`);
  // another device changes member B (priority → VIP, a new version) after the plan was read → the whole party is refused
  const bump = await rec.call('POST', `/pos/queue/items/${P[1]}/update-priority`, { priority: 'vip', reason: 'bride' });
  if (!ok2(bump.status)) check('member B\'s priority change (another device)', false, `${bump.status} ${short(bump.body)}`);
  const stale = await rec.call('POST', `/pos/ai-queue-assignment/plans/${pp.body?.recommendationId}/decision`, { decision: 'accepted', idempotencyKey: 'live-mt-party-stale-' + tag });
  const nobody = (await Promise.all(P.map(item))).every((i) => !i.assigned_technician_id) && (await Promise.all(P.map(lines))).every((l) => l.length === 0) && (await Promise.all(P.map(planHist))).every((n) => n === 0);
  check('a stale member → 409 VERSION_CONFLICT naming that guest, and NOBODY in the party is assigned (all or none)',
    stale.status === 409 && stale.body?.code === 'VERSION_CONFLICT' && stale.body?.queueItemId === P[1] && nobody, `${stale.status} ${short(stale.body)} nobody ${nobody}`);
  const pp2 = await rec.call('POST', `/pos/ai-queue-assignment/groups/${gid}/plan`);
  const acc2 = await rec.call('POST', `/pos/ai-queue-assignment/plans/${pp2.body?.recommendationId}/decision`, { decision: 'accepted', idempotencyKey: 'live-mt-party-' + tag });
  const after = await Promise.all(P.map(item));
  check('re-planned on the fresh state, ACCEPT assigns the whole party in ONE call: three different technicians, one history row each',
    ok2(pp2.status) && ok2(acc2.status) && acc2.body?.applied === true && after.every((i) => i.status === 'assigned' && !!i.assigned_technician_id) && new Set(after.map((i) => i.assigned_technician_id)).size === 3
      && (await Promise.all(P.map(planHist))).every((n) => n === 1), `${pp2.status} ${acc2.status} ${short(after.map((i) => techName(i.assigned_technician_id)))}`);
  const start = await rec.call('POST', `/pos/queue/groups/${gid}/move-to-tech-queue`);
  const tq = (await q(`select count(*)::int as n from pos_tech_queue_tickets where queue_item_id = any($1::uuid[])`, [P]))[0].n;
  check('"Start party" moves every member to the Tech Queue (one ticket each)', ok2(start.status) && (start.body?.moved ?? []).length === 3 && tq === 3, `${start.status} ${short(start.body)} tq ${tq}`);

  // ── 7. the manual path: the same writer refuses a partial plan ─────────────────────────────────────────────────────
  const G2 = await add(`Manual Guest ${tag}`, [SP, SM]);
  const partial = await rec.call('POST', '/pos/queue/plans/assign', { items: [{ queueItemId: G2, expectedVersion: 1, expectedTechnicianId: null, lines: [{ serviceId: SP, technicianId: TECHS[0].id, expectedTechnicianId: null }] }], idempotencyKey: 'live-mt-partial-' + tag, source: 'staff' });
  const full = await rec.call('POST', '/pos/queue/plans/assign', { items: [{ queueItemId: G2, expectedVersion: 1, expectedTechnicianId: null, lines: [{ serviceId: SP, technicianId: TECHS[0].id, expectedTechnicianId: null }, { serviceId: SM, technicianId: TECHS[2].id, expectedTechnicianId: null }] }], idempotencyKey: 'live-mt-manual-' + tag, source: 'staff' });
  check('staff manual plan (no AI): a partial plan is a 400 and writes nothing; the full plan assigns both lines',
    partial.status === 400 && ok2(full.status) && full.body?.items?.[0]?.version === 2 && (await lines(G2)).map((l) => l.technician_id).join() === [TECHS[0].id, TECHS[2].id].join(), `${partial.status} ${full.status} ${short(full.body?.items?.[0])}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
