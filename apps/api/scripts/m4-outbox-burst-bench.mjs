#!/usr/bin/env node
// m4-outbox-burst-bench.mjs — M4 / NEXT_STEPS M5-1 (Oct 24 2026): realtime publish lag under a booking burst, measured
// on real PostgreSQL with the REAL consumers an appointment_created reaches (realtime projection, push, analytics rollup,
// in-app notifications, platform live-ops — five, as in production), wired the way consumers.module.ts wires them
// (push without a provider, the realtime emitter replaced by a recorder that stamps when each frame would leave).
//
//   1. writes N appointment_created events for one salon through the real OutboxWriter (one burst, occurred_at = now);
//   2. drains them with the real OutboxPublisher + InProcessTransport + ConsumerRunner, at a given consumer concurrency;
//   3. reports drain time and the realtime lag per event (frame emitted − event written): p50 / p95 / max.
//   DATABASE_URL=postgres://…/<a migrated scratch db> node apps/api/scripts/m4-outbox-burst-bench.mjs [--events 1000] [--concurrency 1x1,1x4,4x1] [--pool 5]   (LANESxCONSUMERS per event)
// --pool N (Oct 26 2026): the size of the pool the publisher runs on in production (the worker pool, PG_WORKER_POOL_MAX,
// default 5); the ConsumerBudget is derived from it exactly as events.module does (consumerBudgetFor). --pool 0 = unbounded
// (the Oct 24 numbers). The pg pool here is sized to that same number so the measurement sees the same connection limit.
// --first 1|0 (Oct 26 2026, 200-technician §90): 1 (default, as shipped) = the realtime-first lane — the realtime projection
// runs over each claimed batch right after the claim and the other consumers follow, batch after batch, while the next
// batches are claimed (the publisher's timer mode, drain({ wait: false })); 0 = the M4 publisher (every consumer per event).
// Uses the salon with the most technicians in that database (a pilot copy) or a synthetic tenant id. Writes rows; scratch only.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '../dist');
const pg = require('pg');
const { Kysely, PostgresDialect, sql } = require('kysely');
const { OutboxWriter, createDomainEvent, DOMAIN_EVENTS } = require('@aipowersalon/events');
const { ConsumerRegistry, InProcessTransport, ConsumerBudget, consumerBudgetFor } = require(join(DIST, 'events/event-transport.js'));
const { OutboxPublisher } = require(join(DIST, 'events/outbox-publisher.js'));
const { ConsumerRunner } = require(join(DIST, 'events/consumer-runner.js'));
const { RealtimeProjectionConsumer, REALTIME_PROJECTION_CONSUMER } = require(join(DIST, 'events/consumers/realtime-projection.consumer.js'));
const { PushNotificationConsumer } = require(join(DIST, 'events/consumers/push-notification.consumer.js'));
const { AnalyticsRollupConsumer } = require(join(DIST, 'events/consumers/analytics-rollup.consumer.js'));
const { InAppNotificationConsumer } = require(join(DIST, 'events/consumers/in-app-notification.consumer.js'));
const { PlatformLiveOpsConsumer } = require(join(DIST, 'realtime/platform-live-ops.js'));

const url = process.env.DATABASE_URL;
if (!url || !/bench|scratch|perf|explain|race|pilot/.test(url)) { console.error('DATABASE_URL must name a scratch database'); process.exit(2); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--events', 1000));
const LEVELS = String(arg('--concurrency', '1x1,1x4,4x1')).split(',').map((x) => { const [lanes, c] = x.split('x').map(Number); return { lanes, c }; });   // LANESxCONSUMERS
const POOL = Number(arg('--pool', 5));
const FIRST = String(arg('--first', '1')) !== '0';
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0; };

const pool = new pg.Pool({ connectionString: url, max: POOL > 0 ? POOL : Number(process.env.PG_POOL_MAX || 10) });
const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
const big = (await sql`select t.tenant_id, t.branch_id from technicians t group by 1, 2 order by count(*) desc limit 1`.execute(db)).rows[0];
const T = big?.tenant_id ?? '44444444-4444-4444-8444-444444444444', B = big?.branch_id ?? null;
const techs = (await sql`select id from technicians where tenant_id = ${T} limit 200`.execute(db)).rows.map((r) => r.id);

for (const { lanes, c: level } of LEVELS) {
  await sql`update outbox_events set publish_status = 'published', published_at = now() where publish_status in ('pending', 'claimed')`.execute(db);
  const emitted = new Map();
  const stamp = (_room, _event, payload) => { const id = payload?.resourceId; if (id && !emitted.has(id)) emitted.set(id, Date.now()); };
  const rt = { toTenant: (c, e, p) => stamp(c, e, p), toTechnician: (t, e, p) => stamp(t, e, p), toTicket: (t, e, p) => stamp(t, e, p), toCustomer: (t, e, p) => stamp(t, e, p), toOwner: (t, e, p) => stamp(t, e, p) };
  const registry = new ConsumerRegistry();
  for (const c of [new RealtimeProjectionConsumer(rt), new PushNotificationConsumer(null, null), new AnalyticsRollupConsumer(), new InAppNotificationConsumer(), new PlatformLiveOpsConsumer({ touchTenant() {}, bump() {} })]) registry.register(c);
  const budget = POOL > 0 ? consumerBudgetFor(POOL, lanes, level) : null;
  const publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, new ConsumerRunner(db), level, budget ? new ConsumerBudget(budget) : null, FIRST ? { first: [REALTIME_PROJECTION_CONSUMER] } : {}), () => new Date(), lanes);
  // the burst: N bookings written as fast as the writer goes (one multi-row insert per 500, as the booking path batches)
  const w = new OutboxWriter(); const written = new Map(); const tag = `${lanes}x${level}-${Date.now()}`;
  const evs = Array.from({ length: N }, (_, i) => createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_CREATED, tenantId: T, branchId: B ?? undefined, aggregateType: 'appointment',
    aggregateId: `bench-${tag}-${i}`, actorType: 'user', payload: { appointmentId: `bench-${tag}-${i}`, technicianId: techs[i % Math.max(1, techs.length)] ?? null, date: '2026-10-25', startTime: '10:00' } }));
  const t0 = Date.now();
  for (let i = 0; i < evs.length; i += 500) { const chunk = evs.slice(i, i + 500); await (w.writeAll ? w.writeAll(db, chunk) : Promise.all(chunk.map((e) => w.write(db, e)))); for (const e of chunk) written.set(e.aggregateId, Date.now()); }
  // drain the way the publisher's 1 s timer does (back-to-back full batches), until nothing is due
  // (with the first lane: the timer's mode — drain without waiting for the follow passes, then settle at the end)
  for (;;) { const r = await publisher.drain({ wait: !FIRST }); if (r.batches === 0) { if (FIRST) await publisher.settle(); const left = (await sql`select count(*)::int n from outbox_events where publish_status in ('pending', 'claimed')`.execute(db)).rows[0].n; if (!left) break; } }
  const realtimeDoneMs = Math.max(...emitted.values()) - t0;
  const drainMs = Date.now() - t0;
  const lag = [...written].map(([id, at]) => (emitted.get(id) ?? NaN) - at).filter(Number.isFinite);
  console.log(JSON.stringify({ firstLane: FIRST, lanes, consumerConcurrency: level, pool: POOL || 'unbounded', budget: budget ?? 'none', events: N, framesEmitted: lag.length, drainMs, realtimeDoneMs, lagMs: { p50: pct(lag, 50), p95: pct(lag, 95), max: Math.max(...lag) } }));
}
await db.destroy();
