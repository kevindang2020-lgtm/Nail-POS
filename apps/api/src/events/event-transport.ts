// event-transport.ts — Constitution 8, Phase 8: the transport abstraction (§26–27) and its first implementation.
//
// §27: producers and consumers never touch the transport directly; the publisher calls transport.publish(),
// consumers are registered in one place. Swapping to Redis Streams or a broker later (§131–132) changes THIS
// file, not the domains. §219: do not migrate prematurely — the first transport is in-process dispatch from
// the publisher to registered consumers, with durability provided by the outbox (unpublished rows are retried)
// and idempotency by processed_events. That is enough for the current scale and measurable later (§147).
import { type DomainEvent, type DomainEventType, type EventConsumer } from '@aipowersalon/events';
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { ConsumerRunner, type RunOutcome } from './consumer-runner';

export interface EventTransport {
  /** Deliver one event to every subscribed consumer. Resolves when delivery is DURABLY accepted; consumer
   *  failures are NOT transport failures (they are recorded per consumer). Throws only on infrastructure failure. */
  publish(event: DomainEvent<any>, opts?: PublishOptions): Promise<PublishResult>;
  /** 200-technician §90 (Oct 26 2026) — the REALTIME-FIRST lane. Optional: run the transport's FIRST consumers (the
   *  realtime projection) over a whole claimed batch, in batch order, before any other consumer of the batch runs.
   *  Resolves with the ids of the events whose first consumers are all done; the publisher then publishes those with
   *  `skipFirst`. A transport without it is published the ordinary way (every consumer per event). */
  publishFirst?(events: DomainEvent<any>[]): Promise<Set<string>>;
}
export type PublishOptions = { /** the first-lane consumers already ran for this event (publishFirst) — run only the others */ skipFirst?: boolean };
export type PublishResult = { delivered: number; outcomes: Record<string, RunOutcome> };

/** §89: the single place consumers are registered. §30: a consumer that fails does not block the others. */
export class ConsumerRegistry {
  private readonly byType = new Map<string, EventConsumer[]>();
  private readonly all = new Map<string, EventConsumer>();
  register(consumer: EventConsumer): void {
    if (this.all.has(consumer.name)) throw new Error(`consumer already registered: ${consumer.name}`);
    this.all.set(consumer.name, consumer);
    for (const t of consumer.eventTypes) {
      const list = this.byType.get(t) ?? [];
      list.push(consumer); this.byType.set(t, list);
    }
  }
  consumersFor(type: DomainEventType): EventConsumer[] { return this.byType.get(type) ?? []; }
  get(name: string): EventConsumer | undefined { return this.all.get(name); }
  list(): EventConsumer[] { return [...this.all.values()]; }
}

/** M4 (Oct 24 2026, M5-1 realtime lag): how many of ONE event's consumers run at the same time. An appointment_created
 *  has five consumers; run one after another (each its own transaction, ~5 round trips) the event took ~25 round trips
 *  and every event behind it in a burst waited for all of them — the realtime projection of the 3,500th booking of the
 *  M5 burst arrived ~30 s late. Concurrent per event, the event costs its slowest consumer. Ordering is unchanged for
 *  every consumer: the next event starts only when every consumer of this one has finished, so each consumer still
 *  sees the events of one aggregate in exactly the publisher's order (§38 — see PUBLISHER.lanes). */
export const TRANSPORT = { consumerConcurrency: 2 } as const;

/** M4 follow-up (Oct 26 2026): the ONE bound on how many consumer transactions the publisher has open at once, across
 *  all of its lanes. lanes × consumerConcurrency is the most a batch would open by itself (2 × 2 = 4); the budget caps
 *  it at what the pool can carry — a consumer transaction holds one pooled connection from BEGIN to COMMIT, and the
 *  publisher's own claim / mark-published statements and the runner's dead-letter writes need connections of the same
 *  pool between them. Without the cap, four open transactions on a five-connection worker pool left one connection for
 *  everything else, and a consumer that reaches for a second connection while its transaction is open (push through its
 *  queue repository, receipts through CheckoutService) could wait on a pool it was itself exhausting. A plain counting
 *  semaphore: `run` waits for a permit, runs, releases. */
export class ConsumerBudget {
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(readonly limit: number) { if (!(Number.isInteger(limit) && limit >= 1)) throw new Error(`ConsumerBudget: limit must be a positive integer (got ${limit})`); }
  get active(): number { return this.inFlight; }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inFlight >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.inFlight++;
    try { return await fn(); } finally { this.inFlight--; this.waiting.shift()?.(); }
  }
}
/** How many consumer transactions a pool of `poolMax` connections may carry at once: the lanes' own demand, capped at
 *  poolMax − 2 (one connection for the publisher's claim / mark statements, one for the runner's failure records and
 *  whatever else shares the pool), never below 1. The default worker pool (PG_WORKER_POOL_MAX 5) → 3; a 6-connection
 *  pool carries the full 2 × 2; a 10-connection primary (the fallback) does too. */
export function consumerBudgetFor(poolMax: number, lanes: number, perEvent: number = TRANSPORT.consumerConcurrency): number {
  const demand = Math.max(1, Math.floor(lanes) || 1) * Math.max(1, Math.floor(perEvent) || 1);
  const room = Math.floor(Number(poolMax) || 0) - 2;
  return Math.max(1, Math.min(demand, room));
}

/** In-process transport: run every subscribed consumer through the §24 runner, isolated (§30). */
export class InProcessTransport implements EventTransport {
  private readonly runner: ConsumerRunner;
  // `concurrency` defaults to 1 (one consumer at a time): concurrent consumer transactions need a connection POOL. The
  // production wiring (events.module) passes TRANSPORT.consumerConcurrency and a ConsumerBudget sized to the pool;
  // single-connection test harnesses (PGlite) keep the serial default, where two open transactions would share one session.
  /** names of the consumers that run in the realtime-first lane (empty = no first lane; publishFirst is then absent) */
  private readonly first: Set<string>;
  readonly publishFirst?: (events: DomainEvent<any>[]) => Promise<Set<string>>;
  constructor(db: Kysely<DB>, private readonly registry: ConsumerRegistry, runner?: ConsumerRunner, private readonly concurrency: number = 1, private readonly budget: ConsumerBudget | null = null,
              opts: { first?: string[] } = {}) {
    this.runner = runner ?? new ConsumerRunner(db);
    this.first = new Set(opts.first ?? []);
    if (this.first.size) this.publishFirst = (events) => this.runFirst(events);
  }
  /** 200-technician §90: the first-lane consumers over the batch (ConsumerRunner.runBatch — one read + one write per
   *  consumer, not a transaction per event). An event is DONE when every first consumer it is subscribed to is done with
   *  it; an event no first consumer subscribes to is trivially done (skipFirst then changes nothing). */
  private async runFirst(events: DomainEvent<any>[]): Promise<Set<string>> {
    const doneBy = new Map<string, Set<string>>();
    for (const name of this.first) {
      const c = this.registry.get(name); if (!c) continue;
      const mine = events.filter((e) => (c.eventTypes as readonly string[]).includes(e.eventType));
      doneBy.set(name, mine.length ? await this.runner.runBatch(c, mine) : new Set());
    }
    const out = new Set<string>();
    for (const e of events) {
      const firsts = this.registry.consumersFor(e.eventType).filter((c) => this.first.has(c.name));
      if (firsts.every((c) => doneBy.get(c.name)?.has(e.eventId))) out.add(e.eventId);
    }
    return out;
  }
  async publish(event: DomainEvent<any>, opts?: PublishOptions): Promise<PublishResult> {
    const consumers = this.registry.consumersFor(event.eventType).filter((c) => !(opts?.skipFirst && this.first.has(c.name)));
    const outcomes: Record<string, RunOutcome> = {};
    // §30 consumer isolation: each in its own transaction, none can abort the others (the runner records a consumer's
    // failure and never throws for it). Up to `concurrency` at once — and never more than the shared budget across every
    // lane of the publisher; the event is done when ALL are. A runner that throws (the database itself is unavailable)
    // still lets the others finish, then fails the publish — the event goes back to pending and the consumers that did
    // finish are skipped on redelivery (processed_events).
    const limit = Math.max(1, Math.floor(this.concurrency) || 1);
    let next = 0; let failure: unknown = null;
    const runOne = (c: EventConsumer) => (this.budget ? this.budget.run(() => this.runner.run(c, event)) : this.runner.run(c, event));
    const lane = async () => {
      while (next < consumers.length) {
        const c = consumers[next++];
        try { outcomes[c.name] = await runOne(c); } catch (e) { failure ??= e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, consumers.length) }, lane));
    if (failure) throw failure;
    return { delivered: consumers.length, outcomes };
  }
}
