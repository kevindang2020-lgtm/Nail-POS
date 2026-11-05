// webhook-ingest.service.ts — INBOUND webhook processing for integration connections. Authenticates synchronously
// (identify connection → verify provider signature → enforce freshness/replay window → dedup by provider event id →
// resolve tenant from the CONNECTION, never the payload) then hands business processing off asynchronously (event is
// queued; a worker/drain runs the pluggable handler), so the endpoint answers within the provider timeout. The same
// signed event is never processed twice; a stale timestamp is a replay block; a bad/missing signature is rejected;
// a disabled connection quarantines the event. Processing failures retry with backoff and exhaust to a dead-letter.
// Raw payloads are never stored (only a redacted summary), and no secret is ever returned.

import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { IntegrationWebhookRepo } from './integration-webhook.kysely.repository';
import { IntegrationConnectionsRepo } from './integration-connections.kysely.repository';
import { defaultAdapterFactory, type AdapterFactory } from './adapters/provider-registry';
import type { WebhookEventMeta } from './adapters/adapter.contract';

type Actor = { id?: string; role?: string };
const TOLERANCE_SECONDS = 300;

export type WebhookHandler = (event: { id: string; connectionId: string; tenantId: string | null; providerKey: string; eventType?: string; meta: WebhookEventMeta }, ctx: { db: any }) => Promise<void>;
const noopHandler: WebhookHandler = async () => { /* validate-and-accept; real per-provider handlers drop in here */ };

export class WebhookIngestService {
  constructor(
    private readonly repo?: IntegrationWebhookRepo,
    private readonly connections?: IntegrationConnectionsRepo,
    private readonly db?: any,
    private readonly adapters: AdapterFactory = defaultAdapterFactory,
    private readonly handlers: Record<string, WebhookHandler> = {},
  ) {}

  private handlerFor(providerKey: string, category: string): WebhookHandler { return this.handlers[providerKey] ?? this.handlers[category] ?? noopHandler; }

  private async audit(action: string, entityId: string, tenantId: string | null, meta: Record<string, unknown>) {
    if (!this.db) return;
    await sql`insert into audit_logs (tenant_id, role, action_type, entity_type, entity_id, metadata_json)
      values (${tenantId ?? null}::uuid, 'SUPER_ADMIN', ${action}, 'integration_webhook_event', ${entityId}, ${JSON.stringify(meta || {})}::jsonb)`.execute(this.db).catch(() => undefined);
  }

  private async setWebhookStatus(connId: string, status: string) { if (this.connections) await this.connections.patchConnection(connId, { webhook_status: status }); }

  // Synchronous authenticate + dedup + enqueue. Returns a small result with an HTTP-ish code; business processing is
  // asynchronous (drainWebhookQueue / processEvent).
  async processInbound(input: { connectionId?: string; rawBody: string; signatureHeader?: string }): Promise<{ ok: boolean; code: string; status: number; eventId?: string; deduped?: boolean }> {
    if (!this.repo || !this.connections) return { ok: false, code: 'unavailable', status: 503 };
    const conn = input.connectionId ? await this.connections.getConnection(String(input.connectionId)) : undefined;
    if (!conn) return { ok: false, code: 'not_found', status: 404 };
    const corr = randomUUID();
    if (['disabled', 'compromised', 'retired'].includes(conn.connection_status)) {
      await this.repo.recordRejected({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, syntheticId: `quarantined-${corr}`, signatureResult: 'valid', replayResult: 'ok', errorCategory: 'Endpoint Disabled', errorMessage: 'connection disabled', correlationId: corr });
      return { ok: false, code: 'connection_disabled', status: 403 };
    }
    const secret = await this.connections.getActiveSecret(conn.id, 'webhook_secret');
    if (!secret) return { ok: false, code: 'not_configured', status: 400 };
    const adapter = this.adapters(conn.provider_key);
    if (!adapter?.verifyWebhookSignature || !adapter.extractWebhookEventMeta) return { ok: false, code: 'not_supported', status: 400 };

    const verify = adapter.verifyWebhookSignature({ rawBody: input.rawBody, signatureHeader: input.signatureHeader, secret, toleranceSeconds: TOLERANCE_SECONDS });
    if (!verify.valid) {
      if (verify.reason === 'stale_timestamp') {
        await this.repo.recordRejected({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, syntheticId: `replay-${corr}`, signatureResult: 'valid', replayResult: 'blocked', errorCategory: 'Replay Detected', errorMessage: 'timestamp outside tolerance', correlationId: corr });
        await this.setWebhookStatus(conn.id, 'warning');
        await this.audit('super_admin_integration_webhook_replay_blocked', conn.id, conn.tenant_id ?? null, { provider: conn.provider_key });
        return { ok: false, code: 'replay_blocked', status: 409 };
      }
      await this.repo.recordRejected({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, syntheticId: `sig-${corr}`, signatureResult: 'invalid', replayResult: 'ok', errorCategory: 'Invalid Signature', errorMessage: verify.reason ?? 'bad signature', correlationId: corr });
      await this.setWebhookStatus(conn.id, 'signature_error');
      await this.audit('super_admin_integration_webhook_signature_failed', conn.id, conn.tenant_id ?? null, { provider: conn.provider_key, reason: verify.reason });
      return { ok: false, code: 'signature_invalid', status: 401 };
    }

    const meta = adapter.extractWebhookEventMeta(input.rawBody);
    if (!meta) return { ok: false, code: 'bad_payload', status: 400 };
    const dedup = await this.repo.dedupInsert({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, providerEventId: meta.eventId, eventType: meta.eventType, summary: meta.summary, correlationId: corr });
    if (!dedup.inserted) return { ok: true, code: 'duplicate', status: 200, deduped: true }; // idempotent — already accepted
    await this.setWebhookStatus(conn.id, 'healthy');
    await this.audit('super_admin_integration_webhook_received', dedup.id!, conn.tenant_id ?? null, { provider: conn.provider_key, eventType: meta.eventType ?? null });
    return { ok: true, code: 'accepted', status: 202, eventId: dedup.id! };
  }

  // Async processing of a queued/failed event via the pluggable handler.
  async processEvent(eventId: string): Promise<{ status: string }> {
    if (!this.repo || !this.connections) return { status: 'unavailable' };
    const ev = await this.repo.getEvent(eventId);
    if (!ev) return { status: 'not_found' };
    if (!['queued', 'processing', 'failed'].includes(ev.status)) return { status: ev.status };
    const conn = await this.connections.getConnection(ev.connection_id);
    if (!conn) { await this.repo.setStatus(eventId, 'failed', { errorCategory: 'Invalid Configuration', errorMessage: 'connection missing' }); return { status: 'failed' }; }
    // the claim: another drain already holds this event → it is not processed twice (Phase 14)
    if ((await this.repo.incrementAttempt(eventId)) === null) return { status: 'processing' };
    const handler = this.handlerFor(conn.provider_key, conn.category);
    try {
      await handler({ id: eventId, connectionId: conn.id, tenantId: conn.tenant_id ?? null, providerKey: conn.provider_key, eventType: ev.event_type, meta: { eventId: ev.provider_event_id, eventType: ev.event_type } }, { db: this.db });
      await this.repo.setStatus(eventId, 'processed', { processed: true, errorCategory: null, errorMessage: null });
      return { status: 'processed' };
    } catch (e: any) {
      await this.repo.setStatus(eventId, 'failed', { errorCategory: 'Processing Failed', errorMessage: String(e?.message ?? e) });
      return { status: 'failed' };
    }
  }

  async drainWebhookQueue(_actor: Actor, limit = 20) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    const due = await this.repo.queuedEvents(Math.min(50, Math.max(1, limit)));
    const results: any[] = [];
    for (const e of due) results.push({ eventId: e.id, ...(await this.processEvent(e.id)) });
    return { ok: true as const, status: 200, processed: results.length, results };
  }

  async retryWebhookEvent(actor: Actor, eventId?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    const ev = eventId ? await this.repo.getEvent(String(eventId)) : undefined;
    if (!ev) return { ok: false as const, error: 'not_found', status: 404 };
    if (ev.status !== 'failed') return { ok: false as const, error: 'not_retryable', status: 409 };
    if (ev.attempt_count >= ev.max_attempts) { await this.repo.markDead(ev.id, ev.error_category ?? 'Processing Failed', 'max attempts exhausted'); await this.audit('super_admin_integration_webhook_retry', ev.id, ev.tenant_id ?? null, { result: 'dead' }); return { ok: false as const, error: 'dead_letter', status: 409, eventStatus: 'dead' }; }
    const res = await this.processEvent(ev.id);
    const after = await this.repo.getEvent(ev.id);
    if (res.status !== 'processed' && after && after.attempt_count >= after.max_attempts) { await this.repo.markDead(ev.id, 'Processing Failed', 'max attempts exhausted'); await this.audit('super_admin_integration_webhook_retry', ev.id, ev.tenant_id ?? null, { result: 'dead' }); return { ok: false as const, error: 'dead_letter', status: 409, eventStatus: 'dead' }; }
    await this.audit('super_admin_integration_webhook_retry', ev.id, ev.tenant_id ?? null, { result: res.status });
    return { ok: res.status === 'processed', status: 200, eventStatus: res.status };
  }

  async listWebhookEvents(_actor: Actor, connectionId?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503, events: [] as any[] };
    if (!connectionId) return { ok: false as const, error: 'connection_required', status: 400, events: [] as any[] };
    return { ok: true as const, status: 200, events: await this.repo.listEvents(String(connectionId)) };
  }
}
