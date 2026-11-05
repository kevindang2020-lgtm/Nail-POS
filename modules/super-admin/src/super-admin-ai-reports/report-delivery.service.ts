// Report-delivery engine — validates recipient eligibility server-side, creates recipient-level delivery rows (ineligible
// recipients recorded as `excluded` with a reason, never delivered), retries delivery-only failures WITHOUT regenerating
// the report, and reports the aggregate run delivery status + success rate by a documented rule.
import { validateRecipientEligibility, isRetryable, canDeliveryTransition, aggregateDeliveryStatus, deliverySuccessRate, type Recipient, type RunScope } from './report-delivery-core';
import type { ReportDeliveryRepositoryPort } from './report-delivery.repository';

export class DeliveryError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); } }

export class ReportDeliveryService {
  constructor(private readonly repo: ReportDeliveryRepositoryPort) {}

  // Enqueue deliveries for a run. run.tenantId defines the scope isolation; each recipient is validated before a row is
  // created. Idempotent per (run, recipient), so re-enqueueing is safe.
  async enqueue(runId: string, run: RunScope, recipients: Recipient[], opts: { allowExternal?: boolean; channel?: string } = {}) {
    const rid = String(runId || '').trim();
    if (!rid) throw new DeliveryError('invalid', 'runId is required');
    if (!Array.isArray(recipients) || recipients.length === 0) throw new DeliveryError('invalid', 'at least one recipient is required');
    const channel = opts.channel || 'email';
    let queued = 0; const excluded: { recipientId: string; reason: string }[] = [];
    for (const r of recipients) {
      const elig = validateRecipientEligibility(r, run, { allowExternal: opts.allowExternal });
      if (elig.ok) { await this.repo.insert({ runId: rid, recipientId: String(r.id), recipientType: r.type || 'user', recipientTenant: r.tenantId ?? null, channel, status: 'pending', excludedReason: null }); queued += 1; }
      else { await this.repo.insert({ runId: rid, recipientId: String(r.id), recipientType: r.type || 'user', recipientTenant: r.tenantId ?? null, channel, status: 'excluded', excludedReason: elig.reason }); excluded.push({ recipientId: String(r.id), reason: elig.reason }); }
    }
    return { runId: rid, queued, excludedCount: excluded.length, excluded };
  }

  async markDelivered(deliveryId: string) { return this.setStatus(deliveryId, 'delivered', { incrementAttempt: true, delivered: true }); }
  async markFailed(deliveryId: string, failureCategory: string) { return this.setStatus(deliveryId, 'failed', { incrementAttempt: true, failureCategory }); }

  private async setStatus(deliveryId: string, status: string, opts: { failureCategory?: string | null; incrementAttempt?: boolean; delivered?: boolean }) {
    const d = await this.repo.get(String(deliveryId || ''));
    if (!d) throw new DeliveryError('not_found', 'Delivery not found');
    if (!canDeliveryTransition(d.status, status)) throw new DeliveryError('conflict', `cannot move delivery from "${d.status}" to "${status}"`);
    return this.repo.updateStatus(d.id, status, opts);
  }

  // Delivery-only retry: re-queues a failed/bounced recipient delivery. It NEVER regenerates the report run.
  async retry(deliveryId: string) {
    const d = await this.repo.get(String(deliveryId || ''));
    if (!d) throw new DeliveryError('not_found', 'Delivery not found');
    if (!isRetryable(d.status)) throw new DeliveryError('conflict', `delivery status "${d.status}" is not retryable`);
    return this.repo.updateStatus(d.id, 'queued', { incrementAttempt: true, failureCategory: null });
  }

  async summary(runId: string) {
    const counts = await this.repo.countsByRun(String(runId || ''));
    return { runId, counts, aggregateStatus: aggregateDeliveryStatus(counts), successRatePct: deliverySuccessRate(counts.delivered, counts.total) };
  }
  async listByRun(runId: string) { return this.repo.listByRun(String(runId || '')); }
}
