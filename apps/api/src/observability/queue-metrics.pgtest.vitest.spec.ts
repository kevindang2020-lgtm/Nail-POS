// queue-metrics.pgtest — BUILD_PLAN Phase 14 B (Constitution 11 §45–48, §111): queue metrics in the registry, read from the
// durable queue itself (jobs + outbox_events + event_dead_letters) on the real migrated schema. Depth by class + priority,
// the age of the oldest DUE job, running, dead letters (last 24 h); outbox pending / failed and the oldest pending age.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { QueueMetrics, queueJobs, queueOldestDueAge, outboxEvents, outboxOldestPendingAge, eventDeadLetters } from './queue-metrics';

const NOW = new Date('2026-10-01T12:00:00Z');
let db: any; let qm: QueueMetrics;
const g = (m: any, labels: Record<string, string>) => m.snapshot().find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value as number | undefined;

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  const job = (cls: string, prio: number, status: string, runAfter: string, finished: string | null = null) =>
    sql`insert into jobs (job_class, job_type, priority, status, run_after, lease_owner, lease_until, finished_at)
        values (${cls}, 'unit.test', ${prio}, ${status}, ${runAfter}::timestamptz, ${status === 'running' ? 'w1' : null}, ${status === 'running' ? '2026-10-01T12:05:00Z' : null}::timestamptz, ${finished}::timestamptz)`.execute(db);
  await job('standard', 3, 'queued', '2026-10-01T11:50:00Z');   // due, 10 min old
  await job('standard', 3, 'queued', '2026-10-01T11:59:00Z');
  await job('standard', 3, 'queued', '2026-10-01T13:00:00Z');   // NOT due yet — counts in depth, not in the oldest-due age
  await job('critical', 1, 'queued', '2026-10-01T11:59:30Z');
  await job('critical', 1, 'running', '2026-10-01T11:58:00Z');
  await job('ai', 2, 'dead', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z');   // dead within 24 h
  await job('ai', 2, 'dead', '2026-09-20T09:00:00Z', '2026-09-20T10:00:00Z');   // old dead letter: not in the 24 h count
  await job('ai', 2, 'succeeded', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z');
  const ev = (id: string, status: string, at: string) => sql`insert into outbox_events (id, event_type, aggregate_type, aggregate_id, correlation_id, payload_json, occurred_at, publish_status)
        values (${id}, 'unit.test', 'unit', 'u1', 'c1', '{}'::jsonb, ${at}::timestamptz, ${status})`.execute(db);
  await ev('00000000-0000-4000-8000-000000000001', 'pending', '2026-10-01T11:55:00Z');
  await ev('00000000-0000-4000-8000-000000000002', 'pending', '2026-10-01T11:59:00Z');
  await ev('00000000-0000-4000-8000-000000000003', 'failed', '2026-10-01T11:00:00Z');
  await ev('00000000-0000-4000-8000-000000000004', 'published', '2026-10-01T10:00:00Z');
  await sql`insert into event_dead_letters (event_id, consumer_name, event_type, envelope_json, error_class, status)
            values ('00000000-0000-4000-8000-0000000000e1', 'c', 'unit.test', '{}'::jsonb, 'PERMANENT', 'open'), ('00000000-0000-4000-8000-0000000000e2', 'c', 'unit.test', '{}'::jsonb, 'TRANSIENT', 'retrying'), ('00000000-0000-4000-8000-0000000000e3', 'c', 'unit.test', '{}'::jsonb, 'PERMANENT', 'resolved')`.execute(db);
  qm = new QueueMetrics(db);
});

describe('queue gauges from the durable queue', () => {
  it('depth by class + priority + state, oldest DUE age, running, dead in 24 h', async () => {
    await qm.refresh(NOW);
    expect(g(queueJobs, { job_class: 'standard', priority: '3', state: 'queued' })).toBe(3);
    expect(g(queueJobs, { job_class: 'critical', priority: '1', state: 'queued' })).toBe(1);
    expect(g(queueJobs, { job_class: 'critical', priority: '1', state: 'running' })).toBe(1);
    expect(g(queueJobs, { job_class: 'ai', priority: '2', state: 'dead_24h' })).toBe(1);
    expect(g(queueOldestDueAge, { job_class: 'standard' })).toBe(600);
    expect(g(queueOldestDueAge, { job_class: 'critical' })).toBe(30);
  });
  it('outbox pending / failed, oldest pending age, open dead letters', async () => {
    await qm.refresh(NOW);
    expect(g(outboxEvents, { status: 'pending' })).toBe(2);
    expect(g(outboxEvents, { status: 'failed' })).toBe(1);
    expect(g(outboxOldestPendingAge, {})).toBe(300);
    expect(g(eventDeadLetters, { status: 'open' })).toBe(1);
    expect(g(eventDeadLetters, { status: 'retrying' })).toBe(1);
    expect(g(eventDeadLetters, { status: 'resolved' })).toBeUndefined();
  });
  it('a class whose queue drained reads 0, not its last value', async () => {
    await sql`update jobs set status = 'succeeded', finished_at = now() where job_class = 'critical' and status = 'queued'`.execute(db);
    await qm.refresh(NOW);
    expect(g(queueJobs, { job_class: 'critical', priority: '1', state: 'queued' })).toBe(0);
    expect(g(queueOldestDueAge, { job_class: 'critical' })).toBe(0);
  });
  it('a failing database leaves the gauges and never throws (§286)', async () => {
    const broken = new QueueMetrics({ executeQuery: async () => { throw new Error('db down'); } } as any);
    await expect(broken.refresh(NOW)).resolves.toBe(false);
  });
});
