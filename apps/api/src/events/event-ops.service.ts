// event-ops.service.ts — Constitution 8, Phase 15: Super Admin event operations (§145–155) + the RETRY WORKER.
//
// Health (§147–149): outbox by status + oldest-pending age; dead letters by status and by consumer; consumer
// lag. Search (§151–152, §196): by correlation id, event id, event type, tenant. Controls (§153–155): retry one,
// discard one — both audited and permission-gated at the controller.
//
// The retry worker closes the gap left by Phase 10: a dead letter at status 'retrying' with next_attempt_at due
// is re-run through the §24 runner, which resolves it on success or advances it toward 'open'.
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ConsumerRegistry } from './event-transport';
import { ConsumerRunner, type RunOutcome } from './consumer-runner';
import { replayClassOf } from '@aipowersalon/events';
import { eventPublisherEnabled } from './outbox-publisher';
import { runsBackgroundJob } from '@aipowersalon/config';
import { runTick } from '@aipowersalon/observability';
import { canMoveToSql } from '@aipowersalon/database';
import { EVENT_DEAD_LETTER } from './event-lifecycles';

export type OutboxHealth = {
  outbox: { pending: number; claimed: number; published: number; failed: number; oldestPendingAgeSec: number | null; publishedLastHour: number };
  deadLetters: { open: number; retrying: number; resolved: number; discarded: number; byConsumer: { consumerName: string; open: number; retrying: number }[] };
  /** TECH QUEUE 15 (migration 940): duplicateEventsLastDay = events this consumer received AGAIN after processing them, with a
   *  repeat in the last 24 h; duplicateDeliveries = how many repeat deliveries those events had in all (each absorbed, never re-run) */
  consumers: { consumerName: string; eventTypes: string[]; critical: boolean; processedLastHour: number; lagSec: number | null; duplicateEventsLastDay: number; duplicateDeliveries: number }[];
};

export class EventOpsService {
  constructor(private readonly db: Kysely<DB>, private readonly registry: ConsumerRegistry) {}

  async health(): Promise<OutboxHealth> {
    const ob: any = (await sql`
      SELECT count(*) FILTER (WHERE publish_status = 'pending')::int AS pending,
             count(*) FILTER (WHERE publish_status = 'claimed')::int AS claimed,
             count(*) FILTER (WHERE publish_status = 'published')::int AS published,
             count(*) FILTER (WHERE publish_status = 'failed')::int AS failed,
             extract(epoch FROM (now() - min(created_at) FILTER (WHERE publish_status IN ('pending','failed'))))::int AS oldest_pending_age_sec,
             count(*) FILTER (WHERE published_at >= now() - interval '1 hour')::int AS published_last_hour
        FROM outbox_events`.execute(this.db)).rows[0];
    const dl: any = (await sql`
      SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'retrying')::int AS retrying,
             count(*) FILTER (WHERE status = 'resolved')::int AS resolved, count(*) FILTER (WHERE status = 'discarded')::int AS discarded
        FROM event_dead_letters`.execute(this.db)).rows[0];
    const byC = (await sql<any>`
      SELECT consumer_name, count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'retrying')::int AS retrying
        FROM event_dead_letters WHERE status IN ('open','retrying') GROUP BY consumer_name ORDER BY open DESC, retrying DESC`.execute(this.db)).rows;
    // §147 lag per consumer: the oldest PUBLISHED event of a subscribed type that this consumer has not processed.
    const consumers = [] as OutboxHealth['consumers'];
    for (const c of this.registry.list()) {
      const types = c.eventTypes as readonly string[];
      const r: any = (await sql`
        SELECT count(p.event_id)::int AS processed_last_hour,
               (SELECT count(*)::int FROM processed_events dp WHERE dp.consumer_name = ${c.name} AND dp.last_duplicate_at >= now() - interval '1 day') AS dup_events,
               (SELECT coalesce(sum(dp.duplicate_deliveries), 0)::int FROM processed_events dp WHERE dp.consumer_name = ${c.name} AND dp.last_duplicate_at >= now() - interval '1 day') AS dup_deliveries,
               (SELECT extract(epoch FROM (now() - min(o.published_at)))::int FROM outbox_events o
                 WHERE o.publish_status = 'published' AND o.event_type = ANY(${types})
                   AND NOT EXISTS (SELECT 1 FROM processed_events pe WHERE pe.consumer_name = ${c.name} AND pe.event_id = o.id)) AS lag_sec
          FROM processed_events p WHERE p.consumer_name = ${c.name} AND p.processed_at >= now() - interval '1 hour'`.execute(this.db)).rows[0];
      consumers.push({ consumerName: c.name, eventTypes: [...types], critical: !!c.critical, processedLastHour: Number(r?.processed_last_hour ?? 0), lagSec: r?.lag_sec == null ? null : Number(r.lag_sec), duplicateEventsLastDay: Number(r?.dup_events ?? 0), duplicateDeliveries: Number(r?.dup_deliveries ?? 0) });
    }
    return {
      outbox: { pending: ob.pending, claimed: ob.claimed, published: ob.published, failed: ob.failed, oldestPendingAgeSec: ob.oldest_pending_age_sec ?? null, publishedLastHour: ob.published_last_hour },
      deadLetters: { open: dl.open, retrying: dl.retrying, resolved: dl.resolved, discarded: dl.discarded, byConsumer: byC.map((r: any) => ({ consumerName: r.consumer_name, open: r.open, retrying: r.retrying })) },
      consumers,
    };
  }

  /** §44: the replay classification of every registered consumer, so an operator can see what is replayable
   *  BEFORE trying. A consumer that never declared one reads as NOT_REPLAYABLE — the safe default. */
  replayClasses() {
    return this.registry.list().map((c) => ({ consumerName: c.name, replayClass: replayClassOf(c), eventTypes: [...c.eventTypes], critical: !!c.critical }));
  }

  async listDeadLetters(q: { status?: string; consumerName?: string; tenantId?: string; limit?: number }) {
    let qb = this.db.selectFrom('event_dead_letters')
      .select(['id', 'event_id', 'consumer_name', 'tenant_id', 'event_type', 'correlation_id', 'attempts', 'error_class', 'last_error_code', 'first_failed_at', 'last_failed_at', 'status', 'next_attempt_at'])
      .orderBy('last_failed_at', 'desc').limit(Math.min(200, q.limit ?? 50));
    if (q.status) qb = qb.where('status', '=', q.status);
    if (q.consumerName) qb = qb.where('consumer_name', '=', q.consumerName);
    if (q.tenantId) qb = qb.where('tenant_id', '=', q.tenantId);
    return qb.execute();
  }

  /** §151–152 / §196: the event and everything correlated with it — outbox rows + per-consumer outcomes. */
  async search(q: { correlationId?: string; eventId?: string; eventType?: string; tenantId?: string; limit?: number }) {
    let qb = this.db.selectFrom('outbox_events')
      .select(['id', 'event_type', 'event_version', 'tenant_id', 'branch_id', 'aggregate_type', 'aggregate_id', 'correlation_id', 'causation_id', 'occurred_at', 'publish_status', 'published_at', 'attempt_count', 'last_error_code'])
      .orderBy('occurred_at', 'desc').limit(Math.min(200, q.limit ?? 50));
    if (q.correlationId) qb = qb.where('correlation_id', '=', q.correlationId);
    if (q.eventId) qb = qb.where('id', '=', q.eventId);
    if (q.eventType) qb = qb.where('event_type', '=', q.eventType);
    if (q.tenantId) qb = qb.where('tenant_id', '=', q.tenantId);
    const events = await qb.execute();
    if (!events.length) return { events: [], outcomes: [] };
    const ids = events.map((e) => e.id);
    const processed = await this.db.selectFrom('processed_events').select(['event_id', 'consumer_name', 'processed_at']).where('event_id', 'in', ids).execute();
    const dead = await this.db.selectFrom('event_dead_letters').select(['event_id', 'consumer_name', 'status', 'error_class', 'attempts']).where('event_id', 'in', ids).execute();
    return { events, outcomes: [...processed.map((p) => ({ ...p, status: 'processed' as const })), ...dead] };   // §197: no payloads here — the detail endpoint decides
  }

  /** §153: put a dead letter back on the retry path. Attempts are NOT reset — the history stays honest. */
  async retryDeadLetter(id: string, actor: string): Promise<{ ok: boolean; reason?: string }> {
    const row = await this.db.selectFrom('event_dead_letters').select(['status', 'consumer_name']).where('id', '=', id).executeTakeFirst();
    if (!row) return { ok: false, reason: 'not_found' };
    if (!this.registry.get(row.consumer_name)) return { ok: false, reason: 'consumer_not_registered' };
    if (row.status === 'resolved' || row.status === 'discarded') return { ok: false, reason: `already_${row.status}` };
    const moved = await this.db.updateTable('event_dead_letters').set({ status: 'retrying', next_attempt_at: new Date() as any, resolved_by: actor }).where('id', '=', id)
      .where('status', '=', row.status).where(canMoveToSql(EVENT_DEAD_LETTER, 'retrying') as any).executeTakeFirst();
    if (!Number(moved?.numUpdatedRows ?? 0)) return { ok: false, reason: 'changed_concurrently' };   // Phase 12 (#27): no lost update
    return { ok: true };
  }

  /** §155: discard — never deletes the row, so the failure remains visible in history. */
  async discardDeadLetter(id: string, actor: string): Promise<{ ok: boolean; reason?: string }> {
    const r = await this.db.updateTable('event_dead_letters').set({ status: 'discarded', resolved_by: actor, resolved_at: new Date() as any })
      .where('id', '=', id).where('status', 'in', ['open', 'retrying']).where(canMoveToSql(EVENT_DEAD_LETTER, 'discarded') as any).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0 ? { ok: true } : { ok: false, reason: 'not_found_or_final' };
  }
}

/** The retry worker: re-runs due 'retrying' dead letters through the §24 runner. Env-gated with the publisher. */
export class DeadLetterRetryWorker {
  private readonly log = new Logger(DeadLetterRetryWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  static readonly tickMs = 5_000;
  static readonly batch = 50;
  constructor(private readonly db: Kysely<DB>, private readonly registry: ConsumerRegistry, private readonly runner: ConsumerRunner) {}

  start(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!eventPublisherEnabled()) return;   // one flag governs the event workers
    this.timer = setInterval(() => { void runTick({ jobType: 'events.dead_letter_retry', jobClass: 'critical', everyMs: DeadLetterRetryWorker.tickMs }, () => this.tick()).catch(() => undefined); }, DeadLetterRetryWorker.tickMs);
    this.log.log('Dead-letter retry worker started.');
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  async tick(): Promise<{ due: number; outcomes: Record<string, RunOutcome['status']> }> {
    if (this.running) return { due: 0, outcomes: {} };
    this.running = true;
    try {
      const due = await this.db.selectFrom('event_dead_letters').select(['id', 'consumer_name', 'envelope_json'])
        .where('status', '=', 'retrying').where('next_attempt_at', '<=', new Date())
        .orderBy('next_attempt_at', 'asc').limit(DeadLetterRetryWorker.batch).execute();
      const outcomes: Record<string, RunOutcome['status']> = {};
      for (const d of due) {
        const consumer = this.registry.get(d.consumer_name);
        if (!consumer) { outcomes[d.id] = 'dead_lettered'; continue; }       // consumer gone: leave it for a human (stays 'retrying' until they discard)
        const env = typeof d.envelope_json === 'string' ? JSON.parse(d.envelope_json) : d.envelope_json;
        const r = await this.runner.run(consumer, env);
        outcomes[d.id] = r.status;
      }
      return { due: due.length, outcomes };
    } finally { this.running = false; }
  }
}
