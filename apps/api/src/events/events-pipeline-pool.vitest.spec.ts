// events-pipeline-pool.vitest.spec.ts — M4 lanes follow-up (Oct 26 2026). Commit 3c6c8294 said "2 × 2 stays within the
// worker pool (PG_WORKER_POOL_MAX 5)" while events.module injected DATABASE — the PRIMARY pool (PG_POOL_MAX 10, shared
// with every HTTP request) — and nothing bounded the open consumer transactions to any pool at all. What this pins:
//   • publisherDatabase sizes the pool it is given (it still accepts a worker handle, but events.module passes none);
//   • consumerBudgetFor = min(lanes × consumers per event, poolMax − 2), never below 1;
//   • ConsumerBudget is a real bound: a transport allowed 4 at once with a budget of 2 never has more than 2 running;
//   • the PRODUCTION wiring (the @Module metadata, not a re-implementation): the runner, transport, publisher and the
//     event workers take EVENT_PIPELINE_DB, whose factory injects DATABASE only (Oct 26: never the least-privilege worker
//     role); the budget provider derives its limit from PG_POOL_MAX.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { DATABASE } from '@aipowersalon/database';
import { ConsumerBudget, consumerBudgetFor, ConsumerRegistry, InProcessTransport, TRANSPORT } from './event-transport';
import { OutboxPublisher, PUBLISHER, publisherDatabase } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';
import { EventsModule, EVENT_PIPELINE_DB, EVENT_CONSUMER_BUDGET, EVENT_TRANSPORT } from './events.module';
import { EventRetentionWorker } from './event-retention';
import { DeadLetterRetryWorker } from './event-ops.service';
import { EventReplayService } from './event-replay.service';
import { DOMAIN_EVENTS, createDomainEvent, type EventConsumer } from '@aipowersalon/events';

const primary = { name: 'primary' } as any, worker = { name: 'worker' } as any;

describe('publisherDatabase — which pool the event pipeline runs on', () => {
  it('the worker pool when the process has one, sized by PG_WORKER_POOL_MAX (default 5)', () => {
    expect(publisherDatabase(primary, worker, { REPO_DRIVER: 'postgres', DATABASE_URL: 'postgres://x/y' })).toEqual({ db: worker, pool: 'worker', poolMax: 5 });
    expect(publisherDatabase(primary, worker, { REPO_DRIVER: 'postgres', DATABASE_URL: 'postgres://x/y', PG_WORKER_POOL_MAX: '8' })).toEqual({ db: worker, pool: 'worker', poolMax: 8 });
  });
  it('the primary (PG_POOL_MAX, default 10) when there is no worker handle', () => {
    expect(publisherDatabase(primary, null, { PG_POOL_MAX: '12' })).toEqual({ db: primary, pool: 'primary', poolMax: 12 });
    expect(publisherDatabase(primary, undefined, {})).toEqual({ db: primary, pool: 'primary', poolMax: 10 });
    expect(publisherDatabase(null, null, {}).db).toBeNull();
  });
});

describe('consumerBudgetFor — open consumer transactions a pool can carry', () => {
  it('min(lanes × consumers, poolMax − 2), never below 1', () => {
    expect(consumerBudgetFor(5, PUBLISHER.lanes, TRANSPORT.consumerConcurrency)).toBe(3);    // the default worker pool
    expect(consumerBudgetFor(6, 2, 2)).toBe(4);                                               // room for the full demand
    expect(consumerBudgetFor(10, 2, 2)).toBe(4);                                              // the primary fallback
    expect(consumerBudgetFor(2, 2, 2)).toBe(1);
    expect(consumerBudgetFor(0, 2, 2)).toBe(1);
    expect(consumerBudgetFor(10, 1, 1)).toBe(1);
  });
  it('ConsumerBudget refuses a non-positive limit', () => {
    expect(() => new ConsumerBudget(0)).toThrow(/positive integer/);
    expect(() => new ConsumerBudget(2.5)).toThrow(/positive integer/);
  });
});

describe('ConsumerBudget bounds the transport', () => {
  it('four consumers, concurrency 4, budget 2: never more than 2 running at once; every consumer still runs', async () => {
    const budget = new ConsumerBudget(2);
    let live = 0, peak = 0; const ran: string[] = [];
    const mk = (name: string): EventConsumer => ({ name, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE', async handle() { /* unused: the runner is stubbed */ } });
    const reg = new ConsumerRegistry(); for (const n of ['a', 'b', 'c', 'd']) reg.register(mk(n));
    const runner = { async run(c: EventConsumer) { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 10)); live--; ran.push(c.name); return { status: 'processed' as const }; } } as unknown as ConsumerRunner;
    const t = new InProcessTransport(null as any, reg, runner, 4, budget);
    const e = createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, tenantId: '11111111-1111-1111-1111-111111111111', aggregateType: 'appointment', aggregateId: 'a1', actorType: 'user', payload: { appointmentId: 'a1' } });
    const r = await t.publish(e);
    expect(r.delivered).toBe(4); expect(ran.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(peak).toBe(2); expect(budget.active).toBe(0);
  });
  it('the budget is shared ACROSS transports (the publisher\'s lanes): two transports of concurrency 2, budget 3 → peak 3', async () => {
    const budget = new ConsumerBudget(3);
    let live = 0, peak = 0;
    const mk = (name: string): EventConsumer => ({ name, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE', async handle() { /* stubbed */ } });
    const reg = new ConsumerRegistry(); for (const n of ['a', 'b', 'c', 'd']) reg.register(mk(n));
    const runner = { async run() { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 10)); live--; return { status: 'processed' as const }; } } as unknown as ConsumerRunner;
    const e = createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, tenantId: '11111111-1111-1111-1111-111111111111', aggregateType: 'appointment', aggregateId: 'a1', actorType: 'user', payload: { appointmentId: 'a1' } });
    await Promise.all([new InProcessTransport(null as any, reg, runner, 2, budget).publish(e), new InProcessTransport(null as any, reg, runner, 2, budget).publish(e)]);
    expect(peak).toBe(3);
  });
  it('a runner that throws releases its permit', async () => {
    const budget = new ConsumerBudget(1);
    await expect(budget.run(async () => { throw new Error('db down'); })).rejects.toThrow('db down');
    expect(budget.active).toBe(0);
    expect(await budget.run(async () => 7)).toBe(7);
  });
});

describe('the production wiring (events.module metadata)', () => {
  const providers: any[] = Reflect.getMetadata('providers', EventsModule);
  const provider = (token: unknown) => providers.find((p) => p && typeof p === 'object' && p.provide === token);
  const injects = (token: unknown) => (provider(token)?.inject ?? []).map((i: any) => (i && typeof i === 'object' && 'token' in i ? i.token : i));

  it('EVENT_PIPELINE_DB is the PRIMARY pool only — never the least-privilege worker role (no grants on event / consumer tables)', () => {
    const p = provider(EVENT_PIPELINE_DB);
    expect(p.inject).toEqual([DATABASE]);
    expect(p.useFactory(primary)).toMatchObject({ db: primary, pool: 'primary' });
  });
  it('the runner, transport, publisher, dead-letter retry, replay and retention all take EVENT_PIPELINE_DB — never DATABASE', () => {
    for (const token of [ConsumerRunner, EVENT_TRANSPORT, OutboxPublisher, DeadLetterRetryWorker, EventReplayService, EventRetentionWorker]) {
      const inj = injects(token);
      expect(inj[0], String(token)).toBe(EVENT_PIPELINE_DB);
      expect(inj, String(token)).not.toContain(DATABASE);
    }
  });
  it('the budget is derived from the pipeline pool\'s size and handed to the transport', () => {
    const b = provider(EVENT_CONSUMER_BUDGET);
    expect(b.inject).toEqual([EVENT_PIPELINE_DB]);
    expect(b.useFactory({ db: worker, pool: 'worker', poolMax: 5 }).limit).toBe(3);
    expect(b.useFactory({ db: worker, pool: 'worker', poolMax: 6 }).limit).toBe(4);
    expect(injects(EVENT_TRANSPORT)).toContain(EVENT_CONSUMER_BUDGET);
    const budget = new ConsumerBudget(3);
    const t = provider(EVENT_TRANSPORT).useFactory({ db: worker, pool: 'worker', poolMax: 5 }, new ConsumerRegistry(), new ConsumerRunner(worker), budget);
    expect(t).toBeInstanceOf(InProcessTransport);
    expect((t as any).budget).toBe(budget);
    expect((t as any).concurrency).toBe(TRANSPORT.consumerConcurrency);
    const pub = provider(OutboxPublisher).useFactory({ db: worker, pool: 'worker', poolMax: 5 }, t);
    expect(pub).toBeInstanceOf(OutboxPublisher);
    expect((pub as any).db).toBe(worker);
    expect((pub as any).lanes).toBe(PUBLISHER.lanes);
  });
});
