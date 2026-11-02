// integration-webhook.kysely.repository.ts — persistence for inbound webhook events: the dedup ledger + processing
// lifecycle. Raw payloads are never stored; only a redacted summary.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

const nz = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export class IntegrationWebhookRepo {
  constructor(private readonly db: Kysely<DB>) {}

  // Record a rejected/replay-blocked attempt for the security feed, under a synthetic id so it never consumes the
  // dedup key of a real event.
  async recordRejected(i: { connectionId: string; tenantId: string | null; syntheticId: string; signatureResult: string; replayResult: string; errorCategory: string; errorMessage: string; correlationId: string }): Promise<void> {
    await sql`insert into integration_webhook_events (connection_id, tenant_id, provider_event_id, signature_result, replay_result, status, error_category, error_message, correlation_id)
      values (${i.connectionId}::uuid, ${i.tenantId ?? null}::uuid, ${i.syntheticId}, ${i.signatureResult}, ${i.replayResult}, 'rejected', ${i.errorCategory}, ${i.errorMessage}, ${i.correlationId}::uuid)`.execute(this.db).catch(() => undefined);
  }

  // Idempotent accept: inserts the event under the real provider_event_id. Returns {inserted:false} if the event was
  // already recorded (duplicate → do not process again).
  async dedupInsert(i: { connectionId: string; tenantId: string | null; providerEventId: string; eventType?: string; summary?: Record<string, unknown>; correlationId: string }): Promise<{ id: string | null; inserted: boolean }> {
    const r: any = await sql<any>`insert into integration_webhook_events (connection_id, tenant_id, provider_event_id, event_type, signature_result, replay_result, status, redacted_summary, correlation_id)
      values (${i.connectionId}::uuid, ${i.tenantId ?? null}::uuid, ${i.providerEventId}, ${i.eventType ?? null}, 'valid', 'ok', 'queued', ${JSON.stringify(i.summary ?? {})}::jsonb, ${i.correlationId}::uuid)
      on conflict (connection_id, provider_event_id) do nothing returning id::text as id`.execute(this.db);
    return { id: r.rows[0]?.id ?? null, inserted: (r.rows?.length ?? 0) > 0 };
  }

  async getEvent(id: string): Promise<any | undefined> {
    const r: any = await sql<any>`select id::text as id, connection_id::text as connection_id, tenant_id::text as tenant_id, provider_event_id, event_type,
      signature_result, replay_result, status, attempt_count, max_attempts, error_category, correlation_id::text as correlation_id
      from integration_webhook_events where id = ${id}::uuid`.execute(this.db);
    return r.rows[0];
  }

  async setStatus(id: string, status: string, p: { processed?: boolean; errorCategory?: string | null; errorMessage?: string | null } = {}): Promise<void> {
    await sql`update integration_webhook_events set status = ${status}, error_category = ${p.errorCategory ?? null}, error_message = ${p.errorMessage ?? null},
      processed_at = ${p.processed ? sql`now()` : sql`processed_at`}, updated_at = now() where id = ${id}::uuid`.execute(this.db);
  }

  /** The attempt's CLAIM (Phase 14, Constitution 12): one statement moves a queued / failed event to processing, so two
   *  drains racing over the same event cannot both run its handler — the loser gets null. A 'processing' row is taken
   *  over only once it has been stuck for 5 minutes (its worker died mid-handler). */
  async incrementAttempt(id: string): Promise<number | null> {
    const r: any = await sql<any>`update integration_webhook_events set attempt_count = attempt_count + 1, status = 'processing', updated_at = now()
      where id = ${id}::uuid and (status in ('queued', 'failed') or (status = 'processing' and updated_at < now() - interval '5 minutes'))
      returning attempt_count`.execute(this.db);
    return r.rows[0] ? nz(r.rows[0].attempt_count) : null;
  }

  async markDead(id: string, cat: string, msg: string): Promise<void> {
    await sql`update integration_webhook_events set status = 'dead', error_category = ${cat}, error_message = ${msg}, next_attempt_at = null, updated_at = now() where id = ${id}::uuid`.execute(this.db);
  }

  async listEvents(connectionId: string, limit = 20): Promise<any[]> {
    const r: any = await sql<any>`select id::text as id, provider_event_id, event_type, signature_result, replay_result, status, attempt_count,
      error_category, to_char(received_at,'YYYY-MM-DD"T"HH24:MI:SS') as received_at, to_char(processed_at,'YYYY-MM-DD"T"HH24:MI:SS') as processed_at
      from integration_webhook_events where connection_id = ${connectionId}::uuid order by received_at desc limit ${Math.min(200, Math.max(1, limit))}`.execute(this.db);
    return r.rows ?? [];
  }

  async queuedEvents(limit: number): Promise<any[]> {
    const r: any = await sql<any>`select id::text as id from integration_webhook_events where status = 'queued' order by received_at asc limit ${Math.min(100, Math.max(1, limit))}`.execute(this.db);
    return r.rows ?? [];
  }
}
