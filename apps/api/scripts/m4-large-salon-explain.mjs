#!/usr/bin/env node
// m4-large-salon-explain.mjs — M4 200-technician scale (Oct 24 2026): the before / after measurement behind migration 691.
//
// Creates a scratch database (default m4_explain) on the server DATABASE_URL points at, migrates it with the real runner,
// seeds a MULTI-TENANT fixture with plain SQL (60 salons — salon 0 has 200 technicians and 1,000 appointments a day, the
// others 20 and 80 — 120 days of history + 14 ahead: ~772k appointments, ~687k queue items, ~240k tech-queue tickets,
// ~37k blocked times), then runs EXPLAIN (ANALYZE, BUFFERS) for every lookup shape below (copied from the repository
// that issues it) twice: with migration 691's indexes DROPPED ("before") and rebuilt ("after"). Best of 5 runs each.
// Prints a TSV; PERFORMANCE_REPORT.md "Indexes (M4)" records one run. Drops the database unless --keep.
//   DATABASE_URL=postgres://… node apps/api/scripts/m4-large-salon-explain.mjs [--keep]
// Never point it at production: it creates and DROPS the database named M4_EXPLAIN_DB (default m4_explain).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pg = require('pg');
const HERE = dirname(fileURLToPath(import.meta.url));
const base = process.env.DATABASE_URL;
if (!base) { console.error('DATABASE_URL is required'); process.exit(2); }
const NAME = process.env.M4_EXPLAIN_DB || 'm4_explain';
if (!/^[a-z0-9_]+$/.test(NAME) || !/explain|scratch|perf/.test(NAME)) { console.error('M4_EXPLAIN_DB must look like a scratch name (explain / scratch / perf)'); process.exit(2); }
const url = (db) => { const u = new URL(base); u.pathname = '/' + db; return u.toString(); };

const FIXTURE = `-- Multi-tenant bulk fixture for M4 index measurement (scratch DB only). 60 salons, salon 0 = 200 technicians,
-- the others 20 each; 120 days of history ending 2026-10-24 plus 14 days ahead.
SET session_replication_role = replica;
CREATE TEMP TABLE fx_t AS
SELECT g AS n, gen_random_uuid() AS tenant_id, gen_random_uuid() AS branch_id, CASE WHEN g = 0 THEN 200 ELSE 20 END AS techs,
       CASE WHEN g = 0 THEN 1000 ELSE 80 END AS appts_per_day
FROM generate_series(0, 59) g;
INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, email, normalized_phone)
SELECT gen_random_uuid(), t.tenant_id, t.branch_id, 'Tech', 'N' || k, 'Tech N' || k || ' s' || t.n, 'active',
       'tech' || k || '.s' || t.n || '@example.test', '+1555' || lpad((t.n * 1000 + k)::text, 7, '0')
FROM fx_t t, generate_series(1, t.techs) k;
CREATE TEMP TABLE fx_tech AS
SELECT tech.id, tech.tenant_id, tech.branch_id, row_number() OVER (PARTITION BY tech.tenant_id ORDER BY tech.id) - 1 AS k, t.techs
FROM technicians tech JOIN fx_t t ON t.tenant_id = tech.tenant_id;
CREATE INDEX ON fx_tech (tenant_id, k);
ANALYZE fx_tech;
-- appointments: appts_per_day per salon per day, spread across technicians, 30-minute slots 09:00–19:00
INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, duration_minutes, status, overbook_ok, created_at, updated_at)
SELECT gen_random_uuid(), t.tenant_id, t.branch_id, tech.id, 'Guest', d::date,
       lpad((9 + (i / t.techs) / 2)::text, 2, '0') || ':' || CASE WHEN (i / t.techs) % 2 = 0 THEN '00' ELSE '30' END,
       lpad((9 + (i / t.techs) / 2)::text, 2, '0') || ':' || CASE WHEN (i / t.techs) % 2 = 0 THEN '29' ELSE '59' END,
       29, CASE WHEN d < DATE '2026-10-24' THEN 'completed' ELSE 'booked' END, true, d, d
FROM fx_t t
CROSS JOIN generate_series(DATE '2026-06-26', DATE '2026-11-07', INTERVAL '1 day') d
CROSS JOIN LATERAL generate_series(0, t.appts_per_day - 1) i
JOIN fx_tech tech ON tech.tenant_id = t.tenant_id AND tech.k = i % t.techs;
-- queue items: 70 % of past appointments checked in (with appointment_id), plus 30 % as many walk-ins
INSERT INTO pos_queue_items (id, tenant_id, branch_id, customer_name, source, status, appointment_id, assigned_technician_id, checked_in_at, started_at, created_at, updated_at)
SELECT gen_random_uuid(), a.tenant_id, a.branch_id, 'Guest', 'appointment', 'completed', a.id, a.technician_id,
       a.appt_date + (a.start_time)::time, a.appt_date + (a.start_time)::time, a.appt_date + (a.start_time)::time, a.appt_date + (a.start_time)::time
FROM pos_tech_appointments a WHERE a.appt_date < DATE '2026-10-24' AND random() < 0.7;
INSERT INTO pos_queue_items (id, tenant_id, branch_id, customer_name, source, status, assigned_technician_id, checked_in_at, started_at, created_at, updated_at)
SELECT gen_random_uuid(), a.tenant_id, a.branch_id, 'Walk-in', 'walk_in', 'completed', a.technician_id,
       a.appt_date + TIME '12:00', a.appt_date + TIME '12:05', a.appt_date + TIME '12:00', a.appt_date + TIME '12:05'
FROM pos_tech_appointments a WHERE a.appt_date < DATE '2026-10-24' AND random() < 0.3;
-- tech-queue tickets: half of the appointment check-ins went through the Tech Queue
INSERT INTO pos_tech_queue_tickets (id, tenant_id, branch_id, customer_name, status, assigned_technician_id, appointment_id, queue_item_id, assigned_at, created_at, updated_at)
SELECT gen_random_uuid(), q.tenant_id, q.branch_id, 'Guest', 'service_done', q.assigned_technician_id, q.appointment_id, q.id, q.checked_in_at, q.checked_in_at, q.checked_in_at
FROM pos_queue_items q WHERE q.appointment_id IS NOT NULL AND random() < 0.5;
-- blocked times: each technician ~one block every five days
INSERT INTO technician_blocked_times (id, tenant_id, branch_id, technician_id, block_date, start_time, end_time, reason)
SELECT gen_random_uuid(), tech.tenant_id, tech.branch_id, tech.id, d::date, '13:00', '14:00', 'lunch'
FROM fx_tech tech CROSS JOIN generate_series(DATE '2026-06-26', DATE '2026-11-07', INTERVAL '1 day') d
WHERE random() < 0.2;
SET session_replication_role = origin;
CREATE TABLE IF NOT EXISTS m4_fx_tenants AS SELECT * FROM fx_t;
ANALYZE technicians; ANALYZE pos_tech_appointments; ANALYZE pos_queue_items; ANALYZE pos_tech_queue_tickets; ANALYZE technician_blocked_times;
`;
const MIGRATION = readFileSync(join(HERE, '../db/migrations/691_large_salon_lookup_indexes.sql'), 'utf8');
const CREATES = MIGRATION.split('\n').filter((l) => /^CREATE INDEX/.test(l)).map((l) => l.replace(/;\s*$/, ''));
const NAMES = CREATES.map((l) => /IF NOT EXISTS (\w+)/.exec(l)[1]);

const admin = new pg.Client({ connectionString: url('postgres') });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
await admin.query(`CREATE DATABASE ${NAME}`);
const mig = spawnSync(process.execPath, [join(HERE, 'migrate.mjs')], { env: { ...process.env, DATABASE_URL: url(NAME) }, encoding: 'utf8' });
if (mig.status !== 0) { console.error(mig.stdout, mig.stderr); process.exit(1); }
const c = new pg.Client({ connectionString: url(NAME) });
await c.connect();
const t0s = Date.now();
await c.query(FIXTURE);
await c.query(`SET session_replication_role = replica`);
await c.query(`UPDATE pos_queue_items SET ticket_id = gen_random_uuid() WHERE status = 'completed'`);
await c.query(`UPDATE pos_tech_queue_tickets t SET ticket_id = q.ticket_id FROM pos_queue_items q WHERE q.id = t.queue_item_id`);
await c.query(`SET session_replication_role = origin`);
for (const t of ['pos_queue_items', 'pos_tech_queue_tickets', 'pos_tech_appointments', 'technician_blocked_times', 'technicians']) await c.query(`VACUUM ANALYZE ${t}`);
console.error(`seeded in ${((Date.now() - t0s) / 1000).toFixed(1)} s`);

const t0 = (await c.query(`select tenant_id, branch_id from m4_fx_tenants where n = 0`)).rows[0];
const T = t0.tenant_id, B = t0.branch_id;
const techs = (await c.query(`select id from technicians where tenant_id=$1 order by id`, [T])).rows.map((r) => r.id);
const appt = (await c.query(`select a.id from pos_tech_appointments a join pos_queue_items q on q.appointment_id=a.id where a.tenant_id=$1 and a.appt_date='2026-09-15' limit 1`, [T])).rows[0].id;
const pageAppts = (await c.query(`select id from pos_tech_appointments where tenant_id=$1 and appt_date='2026-10-20' order by id limit 50`, [T])).rows.map((r) => r.id);
const ticket = (await c.query(`select ticket_id from pos_tech_queue_tickets where tenant_id=$1 and ticket_id is not null limit 1`, [T])).rows[0].ticket_id;
const email = (await c.query(`select email from technicians where tenant_id=$1 limit 1`, [T])).rows[0].email;
const D = '2026-10-24';
const Q = [
  ['blocked: board day (tenant, branch-or-null, date)', `select id, technician_id, start_time, end_time, reason from technician_blocked_times where tenant_id=$1 and (branch_id=$2 or branch_id is null) and block_date=$3`, [T, B, D]],
  ['blocked: one tech one day (availability port)', `select block_date, start_time, end_time from technician_blocked_times where tenant_id=$1 and technician_id=$2 and block_date=$3`, [T, techs[7], D]],
  ['blocked: 200 techs one day (go check-in / queue state)', `select technician_id, start_time, end_time from technician_blocked_times where tenant_id=$1 and technician_id = any($2::uuid[]) and block_date=$3`, [T, techs, D]],
  ['blocked: 200 techs 14-day range (payroll autobuild)', `select technician_id, block_date, start_time, end_time from technician_blocked_times where tenant_id=$1 and technician_id = any($2::uuid[]) and block_date >= '2026-10-11' and block_date <= $3 and (cast($4 as uuid) is null or branch_id = cast($4 as uuid))`, [T, techs, D, B]],
  ['queue: last served today per tech (queue state)', `select assigned_technician_id, max(started_at) from pos_queue_items where tenant_id=$1 and (branch_id=$2 or branch_id is null) and assigned_technician_id = any($3::uuid[]) and started_at >= $4::timestamptz group by assigned_technician_id`, [T, B, techs, D + 'T04:00:00Z']],
  ['queue: tech in_service (identity transfer)', `select 1 from pos_queue_items where assigned_technician_id=$2 and tenant_id=$1 and status='in_service' limit 1`, [T, techs[3]]],
  ['queue: by appointment (booking reassign / check-in)', `select id from pos_queue_items where tenant_id=$1 and (branch_id=$2 or branch_id is null) and appointment_id=$3`, [T, B, appt]],
  ['queue: by ticket (service done)', `select id from pos_queue_items where tenant_id=$1 and (ticket_id=$2 or id=$2)`, [T, ticket]],
  ['techq: by appointment (booking detail)', `select status from pos_tech_queue_tickets where tenant_id=$1 and (branch_id=$2 or branch_id is null) and appointment_id=$3`, [T, B, appt]],
  ['techq: 50 page appointments (booking list)', `select appointment_id, status from pos_tech_queue_tickets where tenant_id=$1 and (branch_id=$2 or branch_id is null) and appointment_id = any($3::uuid[])`, [T, B, pageAppts]],
  ['techq: by ticket (service done)', `select id, appointment_id, queue_item_id from pos_tech_queue_tickets where tenant_id=$1 and ticket_id=$2`, [T, ticket]],
  ['technicians: email duplicate at create', `select id from technicians where tenant_id=$1 and lower(email)=lower($2) and archived_at is null`, [T, email]],
  ['appointments: day, 12 visible techs', `select id from pos_tech_appointments where tenant_id=$1 and (branch_id=$2 or branch_id is null) and appt_date=$3 and technician_id = any($4::uuid[])`, [T, B, D, techs.slice(0, 12)]],
  ['appointments: day, whole salon', `select id, technician_id, start_time, status from pos_tech_appointments where tenant_id=$1 and (branch_id=$2 or branch_id is null) and appt_date=$3`, [T, B, D]],
  ['appointments: day, 200 techs (queue state)', `select technician_id, start_time, status from pos_tech_appointments where tenant_id=$1 and (branch_id=$2 or branch_id is null) and technician_id = any($3::uuid[]) and appt_date=$4`, [T, B, techs, D]],
];

async function measure(label) {
  for (const [name, q, p] of Q) {
    let best = Infinity, plan;
    for (let i = 0; i < 5; i++) {
      const j = (await c.query(`explain (analyze, buffers, format json) ${q}`, p)).rows[0]['QUERY PLAN'][0];
      if (j['Execution Time'] < best) { best = j['Execution Time']; plan = j; }
    }
    const nodes = []; (function walk(n) { nodes.push(n['Node Type'] + (n['Index Name'] ? ` ${n['Index Name']}` : n['Relation Name'] ? ` on ${n['Relation Name']}` : '')); (n.Plans || []).forEach(walk); })(plan.Plan);
    console.log([label, name, `${best.toFixed(3)} ms`, `${plan.Plan['Shared Hit Blocks'] + plan.Plan['Shared Read Blocks']} buf`, `${plan.Plan['Actual Rows']} rows`, nodes.filter((x) => /Scan/.test(x)).join(' / ')].join('\t'));
  }
}
for (const n of NAMES) await c.query(`DROP INDEX IF EXISTS ${n}`);
await c.query('ANALYZE');
await measure('before');
for (const s of CREATES) await c.query(s.replace(' CONCURRENTLY', ''));
await c.query('ANALYZE');
await measure('after');
for (const n of NAMES) { const r = await c.query(`select pg_size_pretty(pg_relation_size($1::regclass)) s`, [n]); console.log(['size', n, r.rows[0].s].join('\t')); }
await c.end();
if (!process.argv.includes('--keep')) await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
await admin.end();
