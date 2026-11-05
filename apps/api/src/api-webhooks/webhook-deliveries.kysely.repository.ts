// webhook-deliveries.kysely.repository.ts — production adapter over tenant_webhook_deliveries.
import { type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ApiWebhooksContext } from './api-webhooks.dto';
import type { WebhookDeliveriesRepositoryPort, StoredDelivery, NewDelivery, DeliveryStatePatch } from './webhook-deliveries.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { WEBHOOK_DELIVERY } from './webhook-delivery-lifecycle';

const toMs = (v: unknown): number | null => { if (v == null) return null; if (v instanceof Date) return v.getTime(); const n = Date.parse(String(v)); return Number.isNaN(n) ? null : n; };

export class KyselyWebhookDeliveriesRepository implements WebhookDeliveriesRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  private map = (r: any): StoredDelivery => ({ id: r.id, webhookId: r.webhook_id, eventType: r.event_type, payload: r.payload ?? null, status: r.status, attemptCount: r.attempt_count, maxAttempts: r.max_attempts, nextAttemptAtMs: toMs(r.next_attempt_at), lastStatusCode: r.last_status_code ?? null, lastError: r.last_error ?? null, createdMs: toMs(r.created_at) ?? Date.now(), updatedMs: toMs(r.updated_at) ?? Date.now() });

  async insert(ctx: ApiWebhooksContext, d: NewDelivery): Promise<StoredDelivery> {
    const r = await this.db.insertInto('tenant_webhook_deliveries').values({ tenant_id: ctx.tenantId, webhook_id: d.webhookId, event_type: d.eventType, payload: (d.payload ?? null) as any, status: 'pending', attempt_count: 0, max_attempts: d.maxAttempts ?? 5 } as any).returningAll().executeTakeFirstOrThrow();
    return this.map(r);
  }
  async listDue(ctx: ApiWebhooksContext, nowMs: number, limit: number): Promise<StoredDelivery[]> {
    const rows = await this.db.selectFrom('tenant_webhook_deliveries').selectAll().where('tenant_id', '=', ctx.tenantId).where('status', '=', 'pending')
      .where((eb) => eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', new Date(nowMs) as any)]))
      .orderBy('created_at', 'asc').limit(limit).execute().catch(() => []);
    return rows.map(this.map);
  }
  async listForWebhook(ctx: ApiWebhooksContext, webhookId: string, limit: number): Promise<StoredDelivery[]> {
    const rows = await this.db.selectFrom('tenant_webhook_deliveries').selectAll().where('tenant_id', '=', ctx.tenantId).where('webhook_id', '=', webhookId).orderBy('created_at', 'desc').limit(limit).execute().catch(() => []);
    return rows.map(this.map);
  }
  async updateState(ctx: ApiWebhooksContext, id: string, patch: DeliveryStatePatch): Promise<void> {
    await this.db.updateTable('tenant_webhook_deliveries').set({ status: patch.status, attempt_count: patch.attemptCount, next_attempt_at: (patch.nextAttemptAtMs == null ? null : new Date(patch.nextAttemptAtMs)) as any, last_status_code: patch.lastStatusCode, last_error: patch.lastError, updated_at: new Date() as any } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where(canMoveToSql(WEBHOOK_DELIVERY, patch.status) as any).executeTakeFirst().catch(() => undefined);
  }
}
