import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { WebhookIngestService, type WebhookHandler } from './webhook-ingest.service';
import { defaultAdapterFactory } from './adapters/provider-registry';

const SECRET = 'whsec_ref_123';
const sign = (body: string, t: number) => `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;
const now = () => Math.floor(Date.now() / 1000);

function doubles(opts: { status?: string; hasSecret?: boolean } = {}) {
  const conn = { id: 'conn1', provider_key: 'clover', category: 'Payments', tenant_id: 'tenantA', connection_status: opts.status ?? 'active' };
  const events: Record<string, any> = {}; const ledger = new Set<string>(); let seq = 0;
  const connections = {
    async getConnection() { return conn; },
    async patchConnection() { /* noop */ },
    async getActiveSecret(_id: string, kind: string) { return kind === 'webhook_secret' && (opts.hasSecret ?? true) ? SECRET : null; },
  };
  const repo = {
    _events: events, _ledger: ledger,
    async recordRejected(i: any) { const id = `ev${++seq}`; events[id] = { id, status: 'rejected', ...i }; },
    async dedupInsert(i: any) { const k = `${i.connectionId}:${i.providerEventId}`; if (ledger.has(k)) return { id: null, inserted: false }; ledger.add(k); const id = `ev${++seq}`; events[id] = { id, connection_id: i.connectionId, tenant_id: i.tenantId, provider_event_id: i.providerEventId, event_type: i.eventType, status: 'queued', attempt_count: 0, max_attempts: 5 }; return { id, inserted: true }; },
    async getEvent(id: string) { return events[id]; },
    async setStatus(id: string, status: string, p: any = {}) { Object.assign(events[id], { status, error_category: p.errorCategory ?? null }); if (p.processed) events[id].processed_at = 'now'; },
    async incrementAttempt(id: string) { events[id].attempt_count++; events[id].status = 'processing'; return events[id].attempt_count; },
    async markDead(id: string) { events[id].status = 'dead'; },
    async listEvents() { return Object.values(events); },
    async queuedEvents() { return Object.values(events).filter((e: any) => e.status === 'queued'); },
  };
  return { connections, repo };
}

describe('WebhookIngestService', () => {
  const body = JSON.stringify({ id: 'evt-1', type: 'invoice.created' });

  it('accepts a valid signed event, resolves tenant from the connection, and dedups replays', async () => {
    const { connections, repo } = doubles();
    const svc = new WebhookIngestService(repo as any, connections as any, undefined);
    const a: any = await svc.processInbound({ connectionId: 'conn1', rawBody: body, signatureHeader: sign(body, now()) });
    expect(a.code).toBe('accepted'); expect(repo._events[a.eventId].tenant_id).toBe('tenantA');
    const dup: any = await svc.processInbound({ connectionId: 'conn1', rawBody: body, signatureHeader: sign(body, now()) });
    expect(dup.code).toBe('duplicate'); expect(dup.deduped).toBe(true);
  });

  it('rejects a bad signature and a stale timestamp', async () => {
    const { connections, repo } = doubles();
    const svc = new WebhookIngestService(repo as any, connections as any, undefined);
    expect((await svc.processInbound({ connectionId: 'conn1', rawBody: body, signatureHeader: `t=${now()},v1=bad` })).code).toBe('signature_invalid');
    expect((await svc.processInbound({ connectionId: 'conn1', rawBody: body, signatureHeader: sign(body, now() - 1000) })).code).toBe('replay_blocked');
  });

  it('quarantines events for a disabled connection and requires a secret', async () => {
    const dis = doubles({ status: 'disabled' });
    expect((await new WebhookIngestService(dis.repo as any, dis.connections as any, undefined).processInbound({ connectionId: 'conn1', rawBody: body, signatureHeader: sign(body, now()) })).code).toBe('connection_disabled');
    const noSec = doubles({ hasSecret: false });
    expect((await new WebhookIngestService(noSec.repo as any, noSec.connections as any, undefined).processInbound({ connectionId: 'conn1', rawBody: body, signatureHeader: sign(body, now()) })).code).toBe('not_configured');
  });

  it('processes a queued event and dead-letters a permanently failing handler', async () => {
    const { connections, repo } = doubles();
    const ok = new WebhookIngestService(repo as any, connections as any, undefined);
    const a: any = await ok.processInbound({ connectionId: 'conn1', rawBody: body, signatureHeader: sign(body, now()) });
    await ok.drainWebhookQueue({}, 10);
    expect(repo._events[a.eventId].status).toBe('processed');

    const fail: WebhookHandler = async () => { throw new Error('boom'); };
    const svc = new WebhookIngestService(repo as any, connections as any, undefined, defaultAdapterFactory, { clover: fail });
    const b2 = JSON.stringify({ id: 'evt-2', type: 'x' });
    const a2: any = await svc.processInbound({ connectionId: 'conn1', rawBody: b2, signatureHeader: sign(b2, now()) });
    repo._events[a2.eventId].max_attempts = 1;
    await svc.processEvent(a2.eventId);
    const dead: any = await svc.retryWebhookEvent({}, a2.eventId);
    expect(dead.eventStatus).toBe('dead');
  });
});
