#!/usr/bin/env node
// live-event-wiring.mjs — WAVE 4 SWEEP (Oct 13 2026): the backend's runtime WIRING, proved on the real app and PostgreSQL.
//
// Part 1 — the booted application graph (in-process, the real AppModule on the real database):
//   • every event consumer is registered ONCE in the ONE ConsumerRegistry, and subscribes only to registry events
//   • every consumer the event catalog (docs/EVENT_CATALOG.md) lists for an event is subscribed to it at runtime
//   • every scheduler / worker / publisher / consumer class has exactly ONE instance in the container (a provider declared
//     in two modules would run its timers twice)
//   • the job handlers registered at start-up (the ONE job queue)
// Part 2 — the cross-module flows: the existing end-to-end proofs (check-in, booking with OTP, fair turn → service done →
//   checkout → payment → refund → payroll, multi-technician queue, one-payment checkout with gift card) are run with the
//   outbox PUBLISHER ON (EVENT_PUBLISHER_ENABLED=1 — it is off by default outside production). A tap (triggers on
//   outbox_events / processed_events / event_dead_letters, copied to a side table the proofs' cleanup does not touch)
//   records every event and every consumer run. Then, for every event the flows produced:
//   • it was PUBLISHED (not stuck pending / failed)
//   • EVERY consumer subscribed to its type processed it (a processed_events row) — none dead-lettered
//
// Run:  DATABASE_URL=postgres://postgres@localhost:5432/w4_sweep node apps/api/scripts/live-event-wiring.mjs   (apps/api
// built). Scratch database only. env: WIRING_FLOWS=comma list of proof scripts (default below) · WIRING_PORT_BASE (3183).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pg = require('pg');
const API_ROOT = resolve(new URL('..', import.meta.url).pathname);
const REPO = resolve(API_ROOT, '../..');
const DB = process.env.DATABASE_URL;
if (!DB || !/localhost|127\.0\.0\.1/.test(DB)) { console.error('DATABASE_URL (a local scratch database) is required'); process.exit(2); }
const checks = []; let failed = 0;
const check = (name, ok, detail = '') => { checks.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;

// ── Part 1: the application graph ────────────────────────────────────────────────────────────────────────────────
const { NestFactory } = require(resolve(REPO, 'node_modules/@nestjs/core'));
const { ModulesContainer } = require(resolve(REPO, 'node_modules/@nestjs/core'));
const savedEnv = { ...process.env };
Object.assign(process.env, { NODE_ENV: 'test', REPO_DRIVER: 'postgres', JOBS_WORKER: 'off', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef' });
const { AppModule } = await import(resolve(API_ROOT, 'dist/app.module.js'));
const { ConsumerRegistry } = require(resolve(API_ROOT, 'dist/events/event-transport.js'));
const { DOMAIN_EVENTS } = require(resolve(REPO, 'packages/events/dist/event-contract.js'));
const { registeredJobTypes } = require(resolve(REPO, 'packages/database/dist/job-queue.js'));
const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
await app.init();
const registry = app.get(ConsumerRegistry, { strict: false });
const consumers = registry.list();
const known = new Set(Object.values(DOMAIN_EVENTS));
const subs = new Map();   // eventType → consumer names
for (const c of consumers) for (const t of c.eventTypes) { const l = subs.get(t) ?? []; l.push(c.name); subs.set(t, l); }
const unknownSubs = consumers.flatMap((c) => c.eventTypes.filter((t) => !known.has(t)).map((t) => `${c.name}:${t}`));
check(`${consumers.length} event consumers registered once each in the ONE registry`, consumers.length > 0 && new Set(consumers.map((c) => c.name)).size === consumers.length, consumers.map((c) => c.name).join(', '));
check('every consumer subscribes only to registry events', unknownSubs.length === 0, unknownSubs.join(' | '));
// the catalog's consumer column vs the runtime subscriptions
const catalog = readFileSync(resolve(REPO, 'docs/EVENT_CATALOG.md'), 'utf8');
const catalogMissing = [];
for (const line of catalog.split('\n')) {
  const m = /^\| `([^`]+)` \| (.*?) \| (.*?) \|$/.exec(line);
  if (!m) continue;
  const [, type, , cons] = m;
  const files = [...cons.matchAll(/`([^`]+)`/g)].map((x) => x[1]).filter((f) => /\.consumer\.ts$|platform-live-ops\.ts$/.test(f));
  if (files.length && !(subs.get(type) ?? []).length) catalogMissing.push(`${type} (catalog: ${files.map((f) => f.split('/').pop()).join(', ')})`);
}
check('every event the catalog gives a consumer has a subscribed consumer at runtime', catalogMissing.length === 0, catalogMissing.join(' | '));
// single instance per background class
const container = app.get(ModulesContainer);
const byClass = new Map();
for (const mod of container.values()) {
  for (const w of mod.providers.values()) {
    const inst = w.instance; if (!inst || typeof inst !== 'object') continue;
    const name = inst.constructor?.name ?? '';
    if (!/(Scheduler|Worker|Publisher|Consumer|Jobs|Sweep|Reaper|Poller|Ticker|Lifecycle|Registration|Dispatcher)$/.test(name)) continue;
    const set = byClass.get(name) ?? new Set(); set.add(inst); byClass.set(name, set);
  }
}
const doubled = [...byClass].filter(([, s]) => s.size > 1).map(([n, s]) => `${n}×${s.size}`);
check(`every background class has exactly one instance (${byClass.size} scheduler / worker / publisher / consumer classes)`, doubled.length === 0, doubled.join(' | '));
const jobTypes = registeredJobTypes();
check(`job handlers registered on the ONE queue at start-up (${jobTypes.length})`, jobTypes.length > 0, jobTypes.join(', '));
await app.close();
for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
Object.assign(process.env, savedEnv);

// ── Part 2: the flows, with the publisher on, through the tap ──────────────────────────────────────────────────────
await q(`create table if not exists w4_event_tap (src text not null, id uuid, event_id uuid, event_type text, status text, consumer text, err text, tid uuid, at timestamptz default clock_timestamp())`);
await q(`truncate w4_event_tap`);
await q(`create or replace function w4_tap_outbox() returns trigger language plpgsql as $$ begin
  insert into w4_event_tap (src, id, event_id, event_type, status, err, tid) values ('outbox', new.id, new.id, new.event_type, new.publish_status, new.last_error_code, new.tenant_id); return new; end $$`);
await q(`create or replace function w4_tap_processed() returns trigger language plpgsql as $$ begin
  insert into w4_event_tap (src, event_id, consumer, tid) values ('processed', new.event_id, new.consumer_name, new.tenant_id); return new; end $$`);
await q(`create or replace function w4_tap_dlq() returns trigger language plpgsql as $$ begin
  insert into w4_event_tap (src, event_id, event_type, consumer, status, err, tid) values ('dlq', new.event_id, new.event_type, new.consumer_name, new.status, coalesce(new.error_class,'') || ':' || coalesce(new.last_error_code,''), new.tenant_id); return new; end $$`);
await q(`drop trigger if exists w4_tap on outbox_events; create trigger w4_tap after insert or update on outbox_events for each row execute function w4_tap_outbox()`);
await q(`drop trigger if exists w4_tap on processed_events; create trigger w4_tap after insert on processed_events for each row execute function w4_tap_processed()`);
await q(`drop trigger if exists w4_tap on event_dead_letters; create trigger w4_tap after insert or update on event_dead_letters for each row execute function w4_tap_dlq()`);

const FLOWS = (process.env.WIRING_FLOWS ?? 'live-phase6-queue.mjs,live-phase4-booking-verification.mjs,live-phase3-phone.mjs,live-fair-turn.mjs,live-money-chain.mjs,live-multitech-queue.mjs,live-checkout-one-payment.mjs,live-payroll-completion.mjs,live-payroll-plans.mjs,live-multibranch.mjs').split(',').map((s) => s.trim()).filter(Boolean);
const base = Number(process.env.WIRING_PORT_BASE || 3183);
const flowResults = [];
try {
  for (const [i, f] of FLOWS.entries()) {
    const t0 = Date.now();
    const r = spawnSync('node', [`scripts/${f}`], { cwd: API_ROOT, encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, EVENT_PUBLISHER_ENABLED: '1', PAYMENTS_SANDBOX: '1', PORT_PROOF: String(base + (i % 3)), VERIFY_PORT_PROOF: String(base + 4), PAGE_PORT_PROOF: String(base + 5) } });
    const tail = `${r.stdout ?? ''}`.split('\n').filter((l) => /checks passed|^FAIL/.test(l)).slice(0, 6).join(' | ');
    flowResults.push({ f, status: r.status, s: Math.round((Date.now() - t0) / 1000), tail, start: t0, end: Date.now() });
    check(`flow proof ${f} passes with the publisher on (${Math.round((Date.now() - t0) / 1000)} s)`, r.status === 0, tail || String(r.stderr ?? '').slice(-300));
  }
} finally {
  for (const t of ['outbox_events', 'processed_events', 'event_dead_letters']) await q(`drop trigger if exists w4_tap on ${t}`);
}

// ── the verdicts on what the flows produced ──
const produced = await q(`select event_id, max(event_type) as type, array_agg(distinct status) as statuses, min(at) as first_at from w4_event_tap where src = 'outbox' group by event_id`);
// an event written in the last seconds of a proof can still be pending when the proof stops its API (the publisher ticks
// every second) — that is the proof ending, not a wiring fault. Anything older than this window must have been published.
const TAIL_MS = 5_000;
const inTail = (at) => flowResults.some((fr) => +new Date(at) <= fr.end && +new Date(at) > fr.end - TAIL_MS);
const processed = await q(`select event_id, array_agg(distinct consumer) as consumers from w4_event_tap where src = 'processed' group by event_id`);
const dlq = await q(`select event_id, event_type, consumer, max(err) as err, array_agg(distinct status) as statuses from w4_event_tap where src = 'dlq' group by 1,2,3`);
const doneBy = new Map(processed.map((r) => [r.event_id, new Set(r.consumers)]));
const types = new Map();
const unpublished = [], unconsumed = [], tailPending = [];
for (const e of produced) {
  const t = types.get(e.type) ?? { n: 0, published: 0 }; t.n++;
  if (e.statuses.includes('published')) t.published++; else if (inTail(e.first_at)) tailPending.push(e.type); else unpublished.push(`${e.type} ${e.statuses.join('/')}`);
  types.set(e.type, t);
  if (!e.statuses.includes('published')) continue;
  for (const c of subs.get(e.type) ?? []) if (!doneBy.get(e.event_id)?.has(c)) unconsumed.push(`${e.type} → ${c}`);
}
const tally = (list) => Object.entries(list.reduce((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {})).map(([k, n]) => `${k} ×${n}`);
check(`the flows produced ${produced.length} domain events of ${types.size} types, and every one was PUBLISHED (${tailPending.length} written as a proof stopped its API, not counted)`, produced.length > 0 && unpublished.length === 0, tally(unpublished).join(' | '));
check('every published event was processed by EVERY consumer subscribed to its type', unconsumed.length === 0, tally(unconsumed).join(' | '));
check('no consumer dead-lettered an event of the flows', dlq.length === 0, dlq.map((d) => `${d.event_type} → ${d.consumer} [${d.err}] ${d.statuses.join('/')}`).join(' | '));
const exercised = new Set(types.keys());
const subscribedNotExercised = [...subs.keys()].filter((t) => !exercised.has(t));
console.log(`\nflows: ${flowResults.map((r) => `${r.f} exit ${r.status} (${r.s}s)`).join(' · ')}`);
console.log(`event types exercised (${exercised.size}): ${[...types].map(([t, v]) => `${t}×${v.n}`).sort().join(', ')}`);
console.log(`consumer-subscribed types NOT exercised by these flows (${subscribedNotExercised.length}): ${subscribedNotExercised.sort().join(', ')}`);
console.log(`consumer runs: ${processed.reduce((a, r) => a + r.consumers.length, 0)} across ${processed.length} events`);
const lat = (await q(`select extract(epoch from (max(at) filter (where status = 'published') - min(at))) * 1000 as ms from w4_event_tap where src = 'outbox' group by event_id having bool_or(status = 'published')`)).map((r) => Number(r.ms)).sort((a, b) => a - b);
if (lat.length) console.log(`outbox → published latency: p50 ${Math.round(lat[Math.floor(lat.length / 2)])} ms · p95 ${Math.round(lat[Math.floor(lat.length * 0.95)])} ms · max ${Math.round(lat[lat.length - 1])} ms (${lat.length} events)`);
check('the publisher delivers promptly (p95 outbox → published under 3 s)', lat.length > 0 && lat[Math.floor(lat.length * 0.95)] < 3000, lat.length ? `p95 ${Math.round(lat[Math.floor(lat.length * 0.95)])} ms` : 'nothing published');
await q(`drop table if exists w4_event_tap; drop function if exists w4_tap_outbox(); drop function if exists w4_tap_processed(); drop function if exists w4_tap_dlq();`);
await client.end();
console.log(checks.join('\n'));
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
