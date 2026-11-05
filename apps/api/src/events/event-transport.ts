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
  publish(event: DomainEvent<any>): Promise<PublishResult>;
}
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

/** In-process transport: run every subscribed consumer through the §24 runner, isolated (§30). */
export class InProcessTransport implements EventTransport {
  private readonly runner: ConsumerRunner;
  constructor(db: Kysely<DB>, private readonly registry: ConsumerRegistry, runner?: ConsumerRunner) {
    this.runner = runner ?? new ConsumerRunner(db);
  }
  async publish(event: DomainEvent<any>): Promise<PublishResult> {
    const consumers = this.registry.consumersFor(event.eventType);
    const outcomes: Record<string, RunOutcome> = {};
    // §30 consumer isolation: sequential, each in its own transaction, none can abort the others.
    for (const c of consumers) outcomes[c.name] = await this.runner.run(c, event);
    return { delivered: consumers.length, outcomes };
  }
}
