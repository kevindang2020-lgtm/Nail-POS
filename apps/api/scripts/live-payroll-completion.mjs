#!/usr/bin/env node
// live-payroll-completion.mjs — the Payroll mandate (wave 2, Oct 12 2026) end to end on the REAL API and PostgreSQL.
// Nothing is stubbed: staff sign in and call the same endpoints the POS / Tech App screens call.
//   Service lines → cash checkout with a 2-technician tip → compensation snapshot (the ONE engine) → a pay period in the
//   salon's zone → validation → PREPARE (lines frozen, preview hash) → APPROVE: refused without a fresh step-up, refused for
//   the receptionist and the manager (payroll.approve is the owner's), refused with a stale version → approved once; the
//   second approve is PAYROLL_PERIOD_ALREADY_APPROVED → EXPORT (CSV bytes on the response, exact cents, audit row; a manager
//   cannot) → PAYOUT (bounded by what is owed) → MARK PAID (every outstanding cent settled, idempotent) → the technician's
//   own payroll / payouts / question, answered by the owner → a REFUND after the lock lands in the NEXT open period
//   (pending, linked back; the locked lines untouched; an exception for the owner) → approved into the next period → TIP
//   LOCK (a paid ticket's re-split needs a reason; the correction goes to the next open period).
// Run:  DATABASE_URL=postgres://…/<scratch copy> node scripts/live-payroll-completion.mjs   (apps/api built). Never point it
// at production: it creates a proof branch, staff, technicians and tickets, and removes everything it made at the end.
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
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 300);
const code = (r) => r.body?.code ?? r.body?.error?.code ?? r.body?.details?.code ?? null;

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Payroll Proof%'`, [T])) {
  const ps = (await q(`select id from payroll_periods where branch_id = $1`, [r.id])).map((x) => x.id);
  await removeProofBranchTx(client, T, r.id);
  if (ps.length) await q(`delete from payroll_lines where period_id = any($1::uuid[])`, [ps]);
}

const STARTED = new Date();
const tag = String(Date.now()).slice(-6);
const B = randomUUID(), OWN = randomUUID(), MGR = randomUUID(), REC = randomUUID(), LISA_U = randomUUID();
const LISA = randomUUID(), MARY = randomUUID(), CUST = randomUUID(), CAT = randomUUID(), SVC1 = randomUUID(), SVC2 = randomUUID();
const PW = 'Payroll!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const email = (k) => `pay-${k}-${tag}@aipowersalon.test`;
const addUser = async (id, role, key, level, fn) => {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,'Proof',$4 || ' Proof',$5,$6,'active',$7)`, [id, T, B, fn, email(key), hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [T, B, id, level]);
};
await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York','1 Payroll Way')`, [B, T, `Live Payroll Proof ${tag}`]);
await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,$4)`, [CAT, T, B, `Payroll Proof ${tag}`]);
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, commission_type, commission_value) values ($1,$2,$3,$4,'Proof Gel',45,10000,'active','percent',60), ($5,$2,$3,$4,'Proof Pedi',60,5000,'active','percent',50)`, [SVC1, T, B, CAT, SVC2]);
await addUser(OWN, 'OWNER', 'owner', 'manager', 'Olga');
await addUser(MGR, 'MANAGER', 'mgr', 'manager', 'Max');
await addUser(REC, 'RECEPTION', 'rec', 'staff', 'Rae');
await addUser(LISA_U, 'TECHNICIAN', 'lisa', 'staff', 'Lisa');
await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status) values ($1,$2,$3,$4,'Lisa','Proof','Lisa Proof','active'), ($5,$2,$3,null,'Mary','Proof','Mary Proof','active')`, [LISA, T, B, LISA_U, MARY]);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Pat','Proof','Pat Proof')`, [CUST, T, B]);
const allUsers = [OWN, MGR, REC, LISA_U];
const ticket = async (tipCents, lines) => {
  const id = randomUUID();
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, tip_cents, ready_checkout_at) values ($1,$2,$3,$4,'ready_for_payment',$5,$6, now())`, [id, T, B, CUST, lines[0].tech, tipCents]);
  for (const l of lines) await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,$6,$7,45,$7)`, [T, B, id, l.svc, l.tech, l.svc === SVC1 ? 'Proof Gel' : 'Proof Pedi', l.price]);
  return id;
};
const TA = await ticket(2101, [{ svc: SVC1, tech: LISA, price: 10000 }, { svc: SVC2, tech: MARY, price: 5000 }]);
const TB = await ticket(0, [{ svc: SVC1, tech: LISA, price: 10000 }]);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY']) delete env[k];
Object.assign(env, { AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off', COMPENSATION_RECOVERY: 'off' });
let proc = null; let errs = '';
const periodIds = [];
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1200);
  for (const u of allUsers) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[email('owner'), email('mgr'), email('rec'), email('lisa')]]).catch(() => undefined);
  await q(`delete from outbox_events where tenant_id = $1 and created_at >= $2 and (aggregate_id::text = any($3::text[]) or branch_id = $4)`, [T, STARTED, [...periodIds, TA, TB], B]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  // payroll_lines carry no branch: removed by their periods (gone first, so the paid-period lock no longer applies)
  if (periodIds.length) await q(`delete from payroll_lines where period_id = any($1::uuid[])`, [periodIds]).catch(() => undefined);
  await q(`delete from users where id = any($1::uuid[])`, [allUsers]).catch(() => undefined);
  const left = (await q(`select (select count(*)::int from branches where id = $1) + (select count(*)::int from users where id = any($2::uuid[]))
      + (select count(*)::int from payroll_periods where id = any($3::uuid[])) + (select count(*)::int from payroll_lines where period_id = any($3::uuid[]))
      + (select count(*)::int from payroll_payouts where period_id = any($3::uuid[])) + (select count(*)::int from compensation_adjustments where branch_id = $1)
      + (select count(*)::int from tickets where branch_id = $1) as n`, [B, allUsers, periodIds]))[0].n;
  check('the proof branch, staff, technicians, tickets, periods, lines, payouts and adjustments are removed', a.removed && left === 0, (a.kept ?? []).join(', ') + ` left=${left}`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 8 * 60_000);

const signIn = async (key) => {
  const jar = new Map(); const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); } };
  const hdr = (extra = {}) => ({ 'content-type': 'application/json', cookie: [...jar.values()].join('; '), ...extra });
  const l = await fetch(API + '/auth/login', { method: 'POST', headers: hdr(), body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: email(key), password: PW }) }); keep(l);
  const s = await fetch(API + '/auth/select-branch', { method: 'POST', headers: hdr(), body: JSON.stringify({ branchId: B }) }); keep(s);
  return { ok: l.status === 200 && s.status === 200, detail: `${key}: login ${l.status} select ${s.status}`,
    call: (method, path, body, extra = {}) => fetch(API + path, { method, headers: hdr(extra), body: body ? JSON.stringify(body) : undefined }).then((r) => { keep(r); return j(r); }) };
};
const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 320 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');
  const own = await signIn('owner'), mgr = await signIn('mgr'), rec = await signIn('rec'), lisa = await signIn('lisa');
  check('owner, manager, receptionist and a technician sign in at the proof branch', own.ok && mgr.ok && rec.ok && lisa.ok, [own.detail, mgr.detail, rec.detail, lisa.detail].join(' / '));

  // ── 1. checkout → the compensation snapshot ──────────────────────────────────────────────────────────────────────────
  for (const [t, cents] of [[TA, 17101], [TB, 10000]]) {
    const r = await rec.call('POST', `/pos/checkout/tickets/${t}/pay/cash`, { amountReceivedCents: cents * 2 }, { 'idempotency-key': 'live-payroll-' + randomUUID() });
    check(`the front desk takes cash for ticket ${t === TA ? 'A (Lisa + Mary, $21.01 tip)' : 'B (Lisa)'}`, ok2(r.status), `${r.status} ${short(r.body)}`);
  }
  let snaps = []; for (let i = 0; i < 40; i++) { snaps = await q(`select ticket_id, technician_id, tech_service_earnings_cents, card_tip_cents + cash_tip_cents as tip from ticket_compensation_snapshots where ticket_id = any($1::uuid[])`, [[TA, TB]]); if (snaps.length >= 3) break; await sleep(250); }
  const tipSum = snaps.filter((s) => s.ticket_id === TA).reduce((a, s) => a + Number(s.tip), 0);
  check('payment wrote the immutable compensation snapshot: Lisa 60% of $100 on each ticket, Mary 50% of $50, the $21.01 tip split with no lost cent',
    snaps.length === 3 && snaps.filter((s) => s.technician_id === LISA).every((s) => Number(s.tech_service_earnings_cents) === 6000) && Number(snaps.find((s) => s.technician_id === MARY)?.tech_service_earnings_cents) === 2500 && tipSum === 2101,
    short(snaps.map((s) => [s.technician_id === LISA ? 'Lisa' : 'Mary', Number(s.tech_service_earnings_cents), Number(s.tip)])));

  // ── 2. pay period → validation → prepare ─────────────────────────────────────────────────────────────────────────────
  const today = new Date(); const d = (n) => ymd(new Date(today.getTime() + n * 86_400_000));
  const cp = await own.call('POST', '/pos/payroll/periods', { label: `Proof ${tag}`, periodStart: d(-1), periodEnd: d(1) });
  const P1 = cp.body?.id; if (P1) periodIds.push(P1);
  check('the owner opens a pay period around today (salon dates)', ok2(cp.status) && !!P1, `${cp.status} ${short(cp.body)}`);
  const recPrep = await rec.call('POST', `/pos/payroll/periods/${P1}/prepare`, {});
  check('the receptionist cannot prepare payroll (§191)', recPrep.status === 403, `${recPrep.status}`);
  const prep = await own.call('POST', `/pos/payroll/periods/${P1}/prepare`, {});
  const lisaLine = prep.body?.lines?.find((l) => l.technicianId === LISA);
  check('PREPARE builds the lines from the snapshot and moves the period to review with a preview hash; Lisa earns $120.00 commission',
    ok2(prep.status) && prep.body?.period?.status === 'review' && /^[0-9a-f]{64}$/.test(prep.body?.period?.previewHash ?? '') && lisaLine?.commissionCents === 12000 && prep.body?.validation?.blocking === 0,
    `${prep.status} ${short({ st: prep.body?.period?.status, lisa: lisaLine?.commissionCents, v: prep.body?.validation })}`);
  const frozen = await q(`update payroll_lines set payable_cents = 1 where period_id = $1`, [P1]).then(() => 'updated', (e) => String(e.message));
  check('a line in a period under review is refused at the DATABASE (not just the service)', /locked/.test(frozen), frozen);

  // ── 3. approve: step-up, roles, version ─────────────────────────────────────────────────────────────────────────────
  const V = prep.body?.period?.version, H = prep.body?.period?.previewHash;
  const noStep = await own.call('POST', `/pos/payroll/periods/${P1}/finalize`, { expectedVersion: V, calculationHash: H });
  check('approve without a fresh step-up → 403 STEP_UP_REQUIRED (§72)', noStep.status === 403 && JSON.stringify(noStep.body).includes('STEP_UP_REQUIRED'), `${noStep.status} ${short(noStep.body)}`);
  const recAp = await rec.call('POST', `/pos/payroll/periods/${P1}/finalize`, { expectedVersion: V });
  const mgrAp = await mgr.call('POST', `/pos/payroll/periods/${P1}/finalize`, { expectedVersion: V });
  check('the receptionist and the manager cannot approve (payroll.approve is the owner\'s by default)', recAp.status === 403 && mgrAp.status === 403, `${recAp.status} ${mgrAp.status}`);
  const su = await own.call('POST', '/auth/step-up', { password: PW });
  check('the owner re-proves the password (step-up)', ok2(su.status), `${su.status} ${short(su.body)}`);
  const stale = await own.call('POST', `/pos/payroll/periods/${P1}/finalize`, { expectedVersion: V + 5, calculationHash: H });
  check('a stale version is PAYROLL_VERSION_CONFLICT (§75), nothing approved', stale.status === 409 && code(stale) === 'PAYROLL_VERSION_CONFLICT', `${stale.status} ${short(stale.body)}`);
  const ap = await own.call('POST', `/pos/payroll/periods/${P1}/finalize`, { expectedVersion: V, calculationHash: H });
  const ap2 = await own.call('POST', `/pos/payroll/periods/${P1}/finalize`, { expectedVersion: V, calculationHash: H });
  const prow = (await q(`select status, approval_hash, approved_by from payroll_periods where id = $1`, [P1]))[0];
  const ev = (await q(`select count(*)::int as n from outbox_events where aggregate_id::text = $1 and event_type = 'payroll.period_finalized'`, [P1]))[0].n;
  check('approved ONCE with the approval hash (= the preview hash the owner reviewed); the repeat is PAYROLL_PERIOD_ALREADY_APPROVED; one event',
    ok2(ap.status) && prow?.status === 'finalized' && prow?.approval_hash === H && prow?.approved_by === OWN && ap2.status === 409 && code(ap2) === 'PAYROLL_PERIOD_ALREADY_APPROVED' && ev === 1,
    `${ap.status}/${ap2.status} ${short(prow)} events ${ev}`);

  // ── 4. export ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const mgrEx = await mgr.call('POST', `/pos/payroll/periods/${P1}/export`, { format: 'csv' });
  const ex = await own.call('POST', `/pos/payroll/periods/${P1}/export`, { format: 'csv' });
  const csv = ex.body?.base64 ? Buffer.from(ex.body.base64, 'base64').toString('utf8') : '';
  const exRow = (await q(`select content_sha256, exported_by, row_count from payroll_exports where period_id = $1`, [P1]))[0];
  check('EXPORT: the manager cannot (payroll.export); the owner gets the CSV bytes on the response with exact cents (12000 / 120.00), audited with its sha256 (§82–§84, §156)',
    mgrEx.status === 403 && ok2(ex.status) && csv.includes(',12000,120.00,') && exRow?.content_sha256 === ex.body?.sha256 && exRow?.exported_by === OWN && Number(exRow?.row_count) === 2,
    `${mgrEx.status}/${ex.status} ${short(exRow)}`);

  // ── 5. payouts → mark paid ──────────────────────────────────────────────────────────────────────────────────────────
  const lisaPayable = Number((await q(`select payable_cents from payroll_lines where period_id = $1 and technician_id = $2`, [P1, LISA]))[0].payable_cents);
  const over = await own.call('POST', `/pos/payroll/periods/${P1}/payouts`, { technicianId: LISA, amountCents: lisaPayable + 1, method: 'cash' });
  const part = await own.call('POST', `/pos/payroll/periods/${P1}/payouts`, { technicianId: LISA, amountCents: 5000, method: 'cash', idempotencyKey: 'live-' + tag });
  const partAgain = await own.call('POST', `/pos/payroll/periods/${P1}/payouts`, { technicianId: LISA, amountCents: 5000, method: 'cash', idempotencyKey: 'live-' + tag });
  check('a payout above what is owed is PAYOUT_EXCEEDS_PAYABLE (§149); a $50 cash payout is recorded once (idempotency key replayed)',
    over.status === 422 && code(over) === 'PAYOUT_EXCEEDS_PAYABLE' && ok2(part.status) && ok2(partAgain.status) && part.body?.id === partAgain.body?.id, `${over.status} ${part.status}/${partAgain.status}`);
  const pay = await own.call('POST', `/pos/payroll/periods/${P1}/pay`, { method: 'direct_deposit', reference: 'ACH-' + tag });
  const payAgain = await own.call('POST', `/pos/payroll/periods/${P1}/pay`, { method: 'direct_deposit', reference: 'ACH-' + tag });
  const sums = await q(`select l.technician_id, l.payable_cents, coalesce((select sum(amount_cents) from payroll_payouts o where o.period_id = l.period_id and o.technician_id = l.technician_id and o.status = 'paid'), 0) as paid from payroll_lines l where l.period_id = $1`, [P1]);
  check('MARK PAID settles every outstanding cent as a payout (Σ paid == payable on every line); the repeat is a no-op (§77)',
    ok2(pay.status) && pay.body?.period?.status === 'paid' && ok2(payAgain.status) && payAgain.body?.alreadyPaid === true && sums.every((s) => Number(s.paid) === Number(s.payable_cents)),
    `${pay.status}/${payAgain.status} ${short(sums)}`);

  // ── 6. the technician's own view + a question ───────────────────────────────────────────────────────────────────────
  const tp = await lisa.call('GET', '/tech/payroll');
  const tpo = await lisa.call('GET', '/tech/payroll/payouts');
  const mine = tp.body?.periods?.find((p) => p.periodId === P1);
  check('Lisa sees her period paid in full and only her own payouts (§85–§89, §189)', tp.status === 200 && mine?.paidCents === lisaPayable && mine?.outstandingCents === 0 && tpo.status === 200 && tpo.body.length === 2 && tpo.body.every((o) => o.periodId === P1),
    `${tp.status} ${short(mine)} payouts ${tpo.body?.length}`);
  const askBad = await lisa.call('POST', '/tech/payroll/inquiries', { message: 'x?', periodId: randomUUID() });
  const ask = await lisa.call('POST', '/tech/payroll/inquiries', { message: 'Is my June tip right?', periodId: P1, subjectType: 'period' });
  const inq = await own.call('GET', '/pos/payroll/inquiries');
  const qid = ask.body?.id;
  const ans = await own.call('POST', `/pos/payroll/inquiries/${qid}/respond`, { response: 'Yes — $10.51 of the $21.01 tip.', privateNote: 'checked ticket A' });
  const back = await lisa.call('GET', '/tech/payroll/inquiries');
  check('Lisa asks about her pay (not about a period that is not hers); the owner answers; she sees the answer but never the private note (§152–§153)',
    askBad.status >= 400 && ok2(ask.status) && inq.body?.some?.((x) => x.id === qid) && ok2(ans.status) && back.body?.[0]?.response?.startsWith('Yes') && !JSON.stringify(back.body).includes('checked ticket A'),
    `${askBad.status} ${ask.status} ${ans.status} ${short(back.body?.[0])}`);

  // ── 7. a refund AFTER the lock → the next open period ───────────────────────────────────────────────────────────────
  const cp2 = await own.call('POST', '/pos/payroll/periods', { label: `Proof next ${tag}`, periodStart: d(2), periodEnd: d(15) });
  const P2 = cp2.body?.id; if (P2) periodIds.push(P2);
  const before = await q(`select technician_id, payable_cents, commission_cents from payroll_lines where period_id = $1 order by technician_id`, [P1]);
  const rf = await own.call('POST', `/pos/checkout/tickets/${TA}/refund`, { reason: 'Customer unhappy with the pedicure', amountCents: 2500 }, { 'idempotency-key': 'live-refund-' + tag });
  let adj = []; for (let i = 0; i < 40; i++) { adj = await q(`select technician_id, category, amount_cents, status, period_id, original_period_id from compensation_adjustments where ticket_id = $1 and source = 'refund'`, [TA]); if (adj.length) break; await sleep(250); }
  const after = await q(`select technician_id, payable_cents, commission_cents from payroll_lines where period_id = $1 order by technician_id`, [P1]);
  const exc = await own.call('GET', '/pos/payroll/exceptions?status=open');
  check('a $25 refund after the period was PAID: reversal entries land PENDING in the next open period, linked to the locked one; the paid lines are byte-for-byte unchanged; the owner sees an exception (§54, §129, §143)',
    ok2(rf.status) && adj.length >= 1 && adj.every((a) => a.period_id === P2 && a.original_period_id === P1 && a.status === 'pending' && Number(a.amount_cents) < 0)
      && JSON.stringify(before) === JSON.stringify(after) && (exc.body ?? []).some((e) => e.kind === 'refund_closed_period'),
    `${rf.status} ${short(adj)} exc ${short((exc.body ?? []).map((e) => e.kind))}`);
  const pend = await own.call('GET', '/pos/payroll/adjustments?status=pending');
  let decided = 0; for (const a of (pend.body ?? []).filter((x) => x.periodId === P2)) { const r = await own.call('POST', `/pos/payroll/adjustments/${a.id}/decide`, { decision: 'approve' }); if (ok2(r.status)) decided++; }
  const p2 = await own.call('GET', `/pos/payroll/periods/${P2}`);
  const lisaAdj = p2.body?.lines?.find((l) => l.technicianId === LISA)?.adjustmentCents;
  check('the owner approves them (step-up still fresh); the next period\'s line carries the reversal (Lisa: her $60 commission × refunded / captured, pro-rata, exact cents)',
    decided === adj.length && typeof lisaAdj === 'number' && lisaAdj < 0 && lisaAdj === adj.filter((a) => a.technician_id === LISA).reduce((s, a) => s + Number(a.amount_cents), 0),
    `decided ${decided}/${adj.length} lisaAdj ${lisaAdj}`);

  // ── 8. tip lock ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const cur = await own.call('GET', `/pos/tickets/${TA}/tip-allocation`);
  const silent = await own.call('POST', `/pos/tickets/${TA}/tip-allocation`, { allocations: [{ technicianId: LISA, tipCents: 1500 }, { technicianId: MARY, tipCents: 601 }] });
  const withReason = await own.call('POST', `/pos/tickets/${TA}/tip-allocation`, { allocations: [{ technicianId: LISA, tipCents: 1500 }, { technicianId: MARY, tipCents: 601 }], reason: 'Customer asked: Lisa $15, Mary $6.01' });
  const corr = await q(`select technician_id, amount_cents, period_id from compensation_adjustments where ticket_id = $1 and category = 'tip_correction'`, [TA]);
  check('TIP LOCK (§28): the paid ticket shows locked; a silent re-split is TIP_ALLOCATION_LOCKED; with a reason it is a tip adjustment (Σ 0) in the next open period',
    cur.status === 200 && cur.body?.locked === true && silent.status === 409 && code(silent) === 'TIP_ALLOCATION_LOCKED' && ok2(withReason.status)
      && corr.length === 2 && corr.reduce((s, c) => s + Number(c.amount_cents), 0) === 0 && corr.every((c) => c.period_id === P2), `${cur.status} ${silent.status} ${withReason.status} ${short(corr)}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).slice(0, 400));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
