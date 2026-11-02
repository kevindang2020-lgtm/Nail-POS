// webhook-deliveries.repository.ts — durable delivery-ledger port + in-memory adapter. No seed (rows are created at
// dispatch time). Tenant-scoped.
import type { ApiWebhooksContext } from './api-webhooks.dto';

export interface StoredDelivery {
  id: string; webhookId: string; eventType: string; payload: unknown; status: string; attemptCount: number; maxAttempts: number;
  nextAttemptAtMs: number | null; lastStatusCode: number | null; lastError: string | null; createdMs: number; updatedMs: number;
}
export interface NewDelivery { webhookId: string; eventType: string; payload: unknown; maxAttempts?: number }
export interface DeliveryStatePatch { status: string; attemptCount: number; nextAttemptAtMs: number | null; lastStatusCode: number | null; lastError: string | null }

export interface WebhookDeliveriesRepositoryPort {
  insert(ctx: ApiWebhooksContext, d: NewDelivery): Promise<StoredDelivery>;
  listDue(ctx: ApiWebhooksContext, nowMs: number, limit: number): Promise<StoredDelivery[]>;
  listForWebhook(ctx: ApiWebhooksContext, webhookId: string, limit: number): Promise<StoredDelivery[]>;
  updateState(ctx: ApiWebhooksContext, id: string, patch: DeliveryStatePatch): Promise<void>;
}

let seq = 1;
export class InMemoryWebhookDeliveriesRepository implements WebhookDeliveriesRepositoryPort {
  private byTenant = new Map<string, StoredDelivery[]>();
  private arr(t: string): StoredDelivery[] { if (!this.byTenant.has(t)) this.byTenant.set(t, []); return this.byTenant.get(t)!; }

  async insert(ctx: ApiWebhooksContext, d: NewDelivery): Promise<StoredDelivery> {
    const now = Date.now();
    const row: StoredDelivery = { id: `del_${seq++}`, webhookId: d.webhookId, eventType: d.eventType, payload: d.payload, status: 'pending', attemptCount: 0, maxAttempts: d.maxAttempts ?? 5, nextAttemptAtMs: null, lastStatusCode: null, lastError: null, createdMs: now, updatedMs: now };
    this.arr(ctx.tenantId).push(row); return { ...row };
  }
  async listDue(ctx: ApiWebhooksContext, nowMs: number, limit: number): Promise<StoredDelivery[]> {
    return this.arr(ctx.tenantId).filter((r) => r.status === 'pending' && (r.nextAttemptAtMs == null || r.nextAttemptAtMs <= nowMs)).sort((a, b) => a.createdMs - b.createdMs).slice(0, limit).map((r) => ({ ...r }));
  }
  async listForWebhook(ctx: ApiWebhooksContext, webhookId: string, limit: number): Promise<StoredDelivery[]> {
    return this.arr(ctx.tenantId).filter((r) => r.webhookId === webhookId).sort((a, b) => b.createdMs - a.createdMs).slice(0, limit).map((r) => ({ ...r }));
  }
  async updateState(ctx: ApiWebhooksContext, id: string, patch: DeliveryStatePatch): Promise<void> {
    const r = this.arr(ctx.tenantId).find((x) => x.id === id); if (!r) return;
    r.status = patch.status; r.attemptCount = patch.attemptCount; r.nextAttemptAtMs = patch.nextAttemptAtMs; r.lastStatusCode = patch.lastStatusCode; r.lastError = patch.lastError; r.updatedMs = Date.now();
  }
}
