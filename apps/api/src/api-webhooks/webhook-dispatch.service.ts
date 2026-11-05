// webhook-dispatch.service.ts — the event dispatcher. dispatch() plans + enqueues durable delivery rows for a domain
// event; processDue() is what a worker/cron calls to pick up due rows, sign + send each (via the injectable sender),
// and persist the next retry state. Signing/retry/backoff come from the pure cores. The periodic SCHEDULER that calls
// processDue on an interval is environment-gated (cron / queue worker) and is intentionally not wired here.
import { randomBytes } from 'crypto';
import { hasPermission } from '@aipowersalon/permissions';
import { planDeliveries, nextAttemptState } from './webhook-dispatch-core';
import { sign, signatureHeader } from './webhook-delivery-core';
import { decryptSecret } from '../common/webhook-crypto';
import { defaultSender, ForbiddenError, type WebhookSender } from './api-webhooks.service';
import type { ApiWebhooksRepositoryPort } from './api-webhooks.repository';
import type { WebhookDeliveriesRepositoryPort } from './webhook-deliveries.repository';
import type { ApiWebhooksContext, WebhookEventSink, WebhookDeliveryView } from './api-webhooks.dto';
import type { LogSink } from '../logs/logs.dto';

const iso = (ms: number | null): string | null => (ms == null ? null : new Date(ms).toISOString());

export class WebhookDispatchService implements WebhookEventSink {
  constructor(
    private readonly webhooks: ApiWebhooksRepositoryPort,
    private readonly deliveries: WebhookDeliveriesRepositoryPort,
    private readonly now: () => number = () => Date.now(),
    private readonly sender: WebhookSender = defaultSender,
    private readonly logs?: LogSink,
  ) {}

  // Producer entry point — plan deliveries for all active subscribers and persist them as pending.
  async dispatch(ctx: { tenantId: string; branchId?: string; userId?: string }, eventType: string, data: unknown): Promise<void> {
    const c = ctx as ApiWebhooksContext;
    const all = await this.webhooks.listWebhooks(c);
    const targets = planDeliveries(eventType, all.map((w) => ({ id: w.id, status: w.status, events: w.events })));
    for (const webhookId of targets) {
      const envelope = { id: 'evt_' + randomBytes(8).toString('hex'), type: eventType, created: Math.floor(this.now() / 1000), data };
      await this.deliveries.insert(c, { webhookId, eventType, payload: envelope });
    }
  }

  // Worker entry point — process pending deliveries whose next_attempt_at has passed.
  async processDue(ctx: ApiWebhooksContext, nowMs: number = this.now(), limit = 50): Promise<{ processed: number; delivered: number; retried: number; failed: number; dead: number }> {
    const due = await this.deliveries.listDue(ctx, nowMs, limit);
    let delivered = 0, retried = 0, failed = 0, dead = 0;
    for (const d of due) {
      const w = await this.webhooks.getWebhook(ctx, d.webhookId);
      if (!w) { await this.deliveries.updateState(ctx, d.id, { status: 'dead', attemptCount: d.attemptCount + 1, nextAttemptAtMs: null, lastStatusCode: null, lastError: 'webhook removed' }); dead++; continue; }
      let secret: string;
      try { secret = decryptSecret(w.signingSecretEnc); }
      catch { await this.deliveries.updateState(ctx, d.id, { status: 'dead', attemptCount: d.attemptCount + 1, nextAttemptAtMs: null, lastStatusCode: null, lastError: 'signing secret unavailable' }); dead++; continue; }

      const body = JSON.stringify(d.payload);
      const ts = Math.floor(nowMs / 1000);
      const headers = { 'Content-Type': 'application/json', 'Webhook-Id': w.id, 'Webhook-Signature': signatureHeader(ts, sign(secret, ts, body)) };
      const res = await this.sender({ url: w.url, headers, body });
      const ns = nextAttemptState({ attemptCount: d.attemptCount, maxAttempts: d.maxAttempts }, { ok: res.ok, status: res.status }, nowMs);
      await this.deliveries.updateState(ctx, d.id, { status: ns.status, attemptCount: ns.attemptCount, nextAttemptAtMs: ns.nextAttemptAtMs, lastStatusCode: ns.lastStatusCode, lastError: res.ok ? null : (res.error ?? null) });
      await this.webhooks.recordDelivery(ctx, w.id, res.ok);
      if (ns.status === 'delivered') delivered++; else if (ns.status === 'pending') retried++; else if (ns.status === 'dead') dead++; else failed++;
      try {
        await this.logs?.write({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, { category: 'integration', severity: ns.status === 'delivered' ? 'info' : ns.status === 'pending' ? 'warning' : 'error', source: 'webhook', message: `Event ${d.eventType} → ${w.name}: ${ns.status}`, relatedId: w.id, status: ns.status, metadata: { httpStatus: res.status, attempt: ns.attemptCount } });
      } catch { /* logging must not break the worker */ }
    }
    return { processed: due.length, delivered, retried, failed, dead };
  }

  async listDeliveries(ctx: ApiWebhooksContext, webhookId: string, limit = 50): Promise<{ deliveries: WebhookDeliveryView[] }> {
    if (!hasPermission(ctx as any, 'pos.webhooks.manage')) throw new ForbiddenError('Missing pos.webhooks.manage');
    const rows = await this.deliveries.listForWebhook(ctx, webhookId, Math.min(200, Math.max(1, limit)));
    return { deliveries: rows.map((r) => ({ id: r.id, webhookId: r.webhookId, eventType: r.eventType, status: r.status, attemptCount: r.attemptCount, maxAttempts: r.maxAttempts, nextAttemptIso: iso(r.nextAttemptAtMs), lastStatusCode: r.lastStatusCode, lastError: r.lastError, createdIso: iso(r.createdMs), updatedIso: iso(r.updatedMs) })) };
  }
}
