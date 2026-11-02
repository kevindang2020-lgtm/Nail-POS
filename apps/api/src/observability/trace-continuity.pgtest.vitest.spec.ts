// trace-continuity.pgtest — BUILD_PLAN Phase 11 (Constitution 4 §101, Constitution 11 §16–19), on a migrated database:
// a request that enqueues a job and writes an outbox event is ONE trace. The enqueuing span's traceparent is stored on
// the jobs / outbox_events rows (migration 548); the worker's job span and the consumer span continue it, and the DB
// queries they make join it (pool-hook spans; proved in the unit test and the live script). Production code paths throughout: RequestContextMiddleware,
// enqueueJob, JobClassLoop, OutboxWriter, OutboxPublisher → InProcessTransport → ConsumerRunner.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { enqueueJob, registerJobHandler, setJobTraceparentSource } from '@aipowersalon/database';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, type EventConsumer } from '@aipowersalon/events';
import { configureTracing, currentTraceparent, InMemorySpanExporter, getContext } from '@aipowersalon/observability';
import { RequestContextMiddleware } from '@aipowersalon/observability/nest';
import { JobClassLoop } from '../jobs/job-worker';
import { ConsumerRegistry, InProcessTransport } from '../events/event-transport';
import { OutboxPublisher } from '../events/outbox-publisher';
import { ConsumerRunner } from '../events/consumer-runner';

const T = '54800000-0000-4000-8000-000000000001';
const TID = '0af7651916cd43dd8448eb211c80319c', REMOTE = 'b7ad6b7169203331';
const quiet = { warn: () => undefined, error: () => undefined, log: () => undefined } as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let db: any; const mem = new InMemorySpanExporter();

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','Trace LLC','Trace','trace548','TRACE548','active') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg);
  configureTracing({ exporter: mem, sampleRatio: 1 });
  setJobTraceparentSource(currentTraceparent);   // what TracingLifecycle installs at boot
}, 120_000);
afterAll(() => { configureTracing(null); setJobTraceparentSource(null); });

describe('one request → job + outbox event → worker + consumer: one trace', () => {
  it('stores the traceparent at enqueue/write and continues it when the work runs', async () => {
    let jobRan = false, consumed = false;
    registerJobHandler('trace.continuity', async () => { jobRan = true; await sql`select 1 as one from tenants where id = ${T}`.execute(db); });
    const registry = new ConsumerRegistry();
    const consumer: EventConsumer = { name: 'trace.consumer', eventTypes: [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], critical: false,
      async handle(_e, trx: any) { consumed = true; expect(getContext()?.traceId).toBe(TID); await sql`select 2 as two from tenants where id = ${T}`.execute(trx); } };
    registry.register(consumer);

    const req: any = { method: 'POST', path: '/appointments/a1/complete', headers: { traceparent: `00-${TID}-${REMOTE}-01` } };
    const res: any = Object.assign(new EventEmitter(), { statusCode: 200, setHeader() { /* */ } });
    let jobId = '', serverSpan = '';
    await new Promise<void>((done) => new RequestContextMiddleware().use(req, res, async () => {
      serverSpan = getContext()!.spanId!;
      jobId = (await enqueueJob(db, { jobClass: 'standard', jobType: 'trace.continuity', tenantId: T })).id;
      await db.transaction().execute(async (trx: any) => {
        await new OutboxWriter().write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_COMPLETED, tenantId: T, aggregateType: 'appointment', aggregateId: 'a1', actorType: 'user', payload: { appointmentId: 'a1' } }));
      });
      req.route = { path: '/appointments/:id/complete' };
      res.emit('finish'); done();
    }));

    // the rows carry the ENQUEUING span (the server span), in W3C shape
    const job = (await sql<any>`select traceparent from jobs where id = ${jobId}`.execute(db)).rows[0];
    expect(job.traceparent).toBe(`00-${TID}-${serverSpan}-01`);
    const ev = (await sql<any>`select traceparent from outbox_events where aggregate_id = 'a1'`.execute(db)).rows[0];
    expect(ev.traceparent).toBe(`00-${TID}-${serverSpan}-01`);

    // later, elsewhere: the worker and the publisher (no ambient context)
    const loop = new JobClassLoop(db, 'standard', 'trace-worker', { pollMs: 10, idlePollMs: 20, leaseMs: 60_000, concurrency: 1, perTenantCap: 5 }, quiet);
    await loop.pump();
    for (let i = 0; i < 100 && !jobRan; i++) await sleep(20);
    await loop.stop(2_000);
    const pub = await new OutboxPublisher(db, new InProcessTransport(db, registry, new ConsumerRunner(db))).tick();
    expect(jobRan).toBe(true); expect(consumed).toBe(true); expect(pub.published).toBe(1);

    const named = (p: string) => mem.spans.filter((s) => s.name.startsWith(p));
    const [server] = named('POST /appointments/:id/complete'), [jobSpan] = named('job trace.continuity'), [consumeSpan] = named('consume appointment.completed');
    expect(server).toMatchObject({ traceId: TID, parentSpanId: REMOTE, kind: 'server' });
    expect(jobSpan).toMatchObject({ traceId: TID, parentSpanId: server.spanId, kind: 'consumer', links: [{ traceId: TID, spanId: server.spanId }] });
    expect(consumeSpan).toMatchObject({ traceId: TID, parentSpanId: server.spanId, kind: 'consumer' });
    // (DB spans under these come from the pg pool hook — proved in packages/observability tracing.test.ts and live in
    //  scripts/live-tracing.mjs; this harness's PGlite driver has no pool to hook.)
  }, 60_000);

  it('work enqueued outside any request starts its own trace (no traceparent stored)', async () => {
    const { id } = await enqueueJob(db, { jobClass: 'standard', jobType: 'trace.continuity.orphan', tenantId: T });
    expect((await sql<any>`select traceparent from jobs where id = ${id}`.execute(db)).rows[0].traceparent).toBeNull();
    // a malformed explicit value is dropped, never stored (the column CHECK would refuse it anyway)
    const bad = await enqueueJob(db, { jobClass: 'standard', jobType: 'trace.continuity.orphan', tenantId: T, traceparent: 'not-a-traceparent' });
    expect((await sql<any>`select traceparent from jobs where id = ${bad.id}`.execute(db)).rows[0].traceparent).toBeNull();
  });
});
