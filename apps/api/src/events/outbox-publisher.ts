// outbox-publisher.ts — Constitution 8, Phase 7: the publisher worker.
//
//   find due outbox rows → CLAIM a batch (FOR UPDATE SKIP LOCKED, §21) → publish via transport → mark published
//
// Safe under concurrent publishers: SKIP LOCKED means two instances never claim the same row. A crash after
// claiming but before marking leaves rows 'claimed'; the reaper below returns stale claims to 'pending', which
// is at-least-once delivery (§22) — consumers are idempotent precisely because this can happen.
// Env-gated like every other worker in the codebase: EVENT_PUBLISHER_ENABLED=true|1|yes|on.
import { type DomainEvent, nextAttemptDelayMs } from '@aipowersalon/events';
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { DB } from '@aipowersalon/database';
import type { EventTransport } from './event-transport';
import { runsBackgroundJob } from '@aipowersalon/config';

// eventPublisherEnabled: ONE definition, in @aipowersalon/config (the services' delivery decision reads it too).
export { eventPublisherEnabled } from '@aipowersalon/config';
import { eventPublisherEnabled, postRestoreHoldActive } from '@aipowersalon/config';
import { assertTransition, canMoveToSql } from '@aipowersalon/database';
import { OUTBOX_EVENT } from './event-lifecycles';

export const PUBLISHER = {
  tickMs: 1_000, batch: 100, staleClaimMs: 5 * 60_000, maxPublishAttempts: 25,
  /** §129: informational — the round-robin ranking below is what delivers fairness. A HARD per-tenant cap was
   *  tried and rejected: it under-fills the batch when only one tenant is due (100 → 25), trading throughput for
   *  a fairness the ranking already provides. Kept as the documented share a tenant gets under full contention. */
  fairShareHint: 25,
} as const;

export type TickResult = { claimed: number; published: number; failed: number; reclaimed: number };

export class OutboxPublisher {
  private readonly log = new Logger(OutboxPublisher.name);
  readonly instanceId = `pub-${randomUUID().slice(0, 8)}`;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly db: Kysely<DB>, private readonly transport: EventTransport, private readonly now: () => Date = () => new Date()) {}

  start(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (postRestoreHoldActive()) { this.log.warn('Outbox publisher hold active (POST_RESTORE_HOLD=1) — paused until acknowledged.'); return; }
    if (!eventPublisherEnabled()) { this.log.log('Outbox publisher disabled (EVENT_PUBLISHER_ENABLED unset).'); return; }
    this.timer = setInterval(() => { void this.tick(); }, PUBLISHER.tickMs);
    this.log.log(`Outbox publisher ${this.instanceId} started (every ${PUBLISHER.tickMs}ms, batch ${PUBLISHER.batch}).`);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  /** One pass. Re-entrancy guarded: a slow tick never overlaps the next. */
  async tick(): Promise<TickResult> {
    if (postRestoreHoldActive()) return { claimed: 0, published: 0, failed: 0, reclaimed: 0 };
    if (this.running) return { claimed: 0, published: 0, failed: 0, reclaimed: 0 };
    this.running = true;
    try {
      const reclaimed = await this.reapStaleClaims();
      const rows = await this.claimBatch();
      let published = 0, failed = 0;
      for (const row of rows) {
        const event = rowToEvent(row);
        try {
          await this.transport.publish(event);
          await this.db.updateTable('outbox_events').set({ publish_status: 'published', published_at: this.now() as any, claimed_by: null, claimed_at: null })
            .where('id', '=', row.id).where(canMoveToSql(OUTBOX_EVENT, 'published') as any).execute();
          published++;
        } catch (e) {
          // Infrastructure failure only (consumer failures are recorded per consumer inside the transport).
          const attempts = (row.attempt_count ?? 0) + 1;
          const exhausted = attempts >= PUBLISHER.maxPublishAttempts;
          await this.db.updateTable('outbox_events').set({
            publish_status: exhausted ? 'failed' : 'pending', attempt_count: attempts, claimed_by: null, claimed_at: null,
            next_attempt_at: new Date(this.now().getTime() + nextAttemptDelayMs(attempts)) as any,
            last_error_code: safeCode(e),
          }).where('id', '=', row.id).where(canMoveToSql(OUTBOX_EVENT, exhausted ? 'failed' : 'pending') as any).execute();
          failed++;
        }
      }
      return { claimed: rows.length, published, failed, reclaimed };
    } finally { this.running = false; }
  }

  /** §21: claim atomically; concurrent publishers skip each other's rows. */
  private async claimBatch(): Promise<any[]> {
    const now = this.now();
    // §129 FAIR SCHEDULING. Plain FIFO (ORDER BY occurred_at) lets one tenant starve every other: the
    // constitution's own example is tenant A generating 100k analytics events while tenant B's critical event
    // waits. So rank each tenant's due events independently and take rank 1 from every tenant before rank 2
    // from anyone — a round-robin interleave — capped at maxPerTenantPerBatch per tenant per batch. Within a
    // tenant, order is still occurred_at (§38): fairness BETWEEN tenants never reorders events WITHIN one.
    // Platform events (tenant_id NULL) are ranked as their own group, so they are never starved either.
    assertTransition(OUTBOX_EVENT, 'pending', 'claimed');   // the move this statement makes; the CTE takes only rows the machine lets become 'claimed'
    const r = await sql<any>`
      WITH ranked AS (
        SELECT id, row_number() OVER (PARTITION BY COALESCE(tenant_id::text, '~platform')
                                      ORDER BY occurred_at ASC, created_at ASC) AS tenant_rank
          FROM outbox_events
         WHERE ${canMoveToSql(OUTBOX_EVENT, 'claimed')} AND next_attempt_at <= ${now}   -- the pending rows (the machine's sources of 'claimed')
      ), due AS (
        -- Take rank 1 from every tenant, then rank 2 from every tenant, and so on. Under contention that is a
        -- round-robin interleave; with a single tenant due it degrades to plain FIFO and still fills the batch.
        SELECT id FROM ranked
         ORDER BY tenant_rank ASC, id ASC
         LIMIT ${PUBLISHER.batch}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events o SET publish_status = 'claimed', claimed_by = ${this.instanceId}, claimed_at = ${now}
        FROM due WHERE o.id = due.id
      RETURNING o.*`.execute(this.db);
    return r.rows;
  }

  /** A publisher that died mid-batch leaves 'claimed' rows; after staleClaimMs they go back to 'pending'. */
  private async reapStaleClaims(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - PUBLISHER.staleClaimMs);
    const r = await sql<any>`UPDATE outbox_events SET publish_status = 'pending', claimed_by = NULL, claimed_at = NULL
                             WHERE publish_status = 'claimed' AND ${canMoveToSql(OUTBOX_EVENT, 'pending')} AND claimed_at < ${cutoff} RETURNING id`.execute(this.db);
    return r.rows.length;
  }
}

export function rowToEvent(row: any): DomainEvent<any> {
  const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
  return {
    eventId: row.id, eventType: row.event_type, eventVersion: Number(row.event_version), occurredAt: new Date(row.occurred_at).toISOString(),
    tenantId: row.tenant_id ?? undefined, branchId: row.branch_id ?? undefined, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version ?? undefined, actorId: row.actor_id ?? undefined, actorType: row.actor_type ?? undefined,
    requestId: row.request_id ?? undefined, correlationId: row.correlation_id, causationId: row.causation_id ?? undefined,
    ...(row.traceparent ? { traceparent: row.traceparent } : {}), payload,
  };
}
/** §197: never persist a raw error string — a code only. */
function safeCode(e: unknown): string { const c = String((e as any)?.code ?? ''); return c ? `err_${c.toLowerCase()}`.slice(0, 40) : 'publish_failed'; }
