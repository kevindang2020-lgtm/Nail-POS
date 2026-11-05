// job-correlation.pgtest — BUILD_PLAN Phase 14 A (Constitution 11 §292, correlation search): a job enqueued inside a request
// carries the request's correlation id, so "find by correlation id" returns the request AND the job it started. Before
// this, enqueueJob() stored the ambient traceparent (Phase 11) but not the correlation id unless every caller passed it —
// the live proof (scripts/live-phase14-telemetry.mjs) found the job by trace but not by correlation. Production paths:
// TracingLifecycle (installs the ambient sources at boot) → RequestContextMiddleware → enqueueJob.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { enqueueJob, setJobCorrelationSource, setJobTraceparentSource } from '@aipowersalon/database';
import { RequestContextMiddleware } from '@aipowersalon/observability/nest';
import { TracingLifecycle } from '../health/tracing-lifecycle';

let db: any;
beforeAll(async () => { db = kyselyFor(await migratedPglite()); new TracingLifecycle().onModuleInit(); }, 120_000);
afterAll(() => { setJobCorrelationSource(null); setJobTraceparentSource(null); });

async function inRequest(headers: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const req: any = { method: 'POST', path: '/x', headers };
  const res: any = Object.assign(new EventEmitter(), { statusCode: 200, setHeader() { /* */ } });
  await new Promise<void>((done, fail) => new RequestContextMiddleware().use(req, res, async () => { try { await fn(); res.emit('finish'); done(); } catch (e) { fail(e); } }));
}
const corrOf = async (id: string) => (await sql<any>`select correlation_id from jobs where id = ${id}`.execute(db)).rows[0].correlation_id;

describe('enqueueJob inherits the ambient correlation id', () => {
  it('a job enqueued inside a request carries that request\'s x-correlation-id', async () => {
    let id = '';
    await inRequest({ 'x-correlation-id': 'corr_job_chain_0001' }, async () => { id = (await enqueueJob(db, { jobClass: 'standard', jobType: 'corr.ambient' })).id; });
    expect(await corrOf(id)).toBe('corr_job_chain_0001');
  });
  it('an explicit correlationId wins over the ambient one', async () => {
    let id = '';
    await inRequest({ 'x-correlation-id': 'corr_job_chain_0002' }, async () => { id = (await enqueueJob(db, { jobClass: 'standard', jobType: 'corr.explicit', correlationId: 'corr_explicit_9' })).id; });
    expect(await corrOf(id)).toBe('corr_explicit_9');
  });
  it('outside any request / job context nothing is invented', async () => {
    const { id } = await enqueueJob(db, { jobClass: 'standard', jobType: 'corr.none' });
    expect(await corrOf(id)).toBeNull();
  });
});
