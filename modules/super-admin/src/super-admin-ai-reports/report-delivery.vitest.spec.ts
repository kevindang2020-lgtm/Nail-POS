import { describe, it, expect, beforeEach } from 'vitest';
import { ReportDeliveryService, DeliveryError } from './report-delivery.service';
import { InMemoryReportDeliveryRepository } from './report-delivery.repository';

let repo: InMemoryReportDeliveryRepository; let svc: ReportDeliveryService;
beforeEach(() => { repo = new InMemoryReportDeliveryRepository(); svc = new ReportDeliveryService(repo); });

describe('ReportDeliveryService', () => {
  it('enqueues eligible recipients and EXCLUDES a foreign-tenant recipient (never delivered)', async () => {
    const run = { scopeType: 'tenant', tenantId: 'tA' };
    const res = await svc.enqueue('run1', run, [
      { id: 'r1', tenantId: 'tA', active: true },
      { id: 'r2', tenantId: 'tB', active: true },          // other tenant → excluded
      { id: 'r3', isPlatform: true, active: true },
    ]);
    expect(res.queued).toBe(2);
    expect(res.excludedCount).toBe(1);
    expect(res.excluded[0]).toMatchObject({ recipientId: 'r2' });
    const foreign = repo.rows.find((d) => d.recipientId === 'r2')!;
    expect(foreign.status).toBe('excluded');
    expect(foreign.excludedReason).toMatch(/different tenant/);
  });

  it('is idempotent per (run, recipient) — re-enqueue does not duplicate', async () => {
    const run = { scopeType: 'tenant', tenantId: 'tA' };
    await svc.enqueue('run1', run, [{ id: 'r1', tenantId: 'tA', active: true }]);
    await svc.enqueue('run1', run, [{ id: 'r1', tenantId: 'tA', active: true }]);
    expect(repo.rows.filter((d) => d.recipientId === 'r1')).toHaveLength(1);
  });

  it('marks delivered / failed and computes the aggregate summary + success rate', async () => {
    const run = { scopeType: 'platform', tenantId: null };
    await svc.enqueue('run2', run, [{ id: 'r1', isPlatform: true }, { id: 'r2', isPlatform: true }]);
    const [d1, d2] = repo.rows.filter((d) => d.runId === 'run2');
    await svc.markDelivered(d1.id);
    await svc.markFailed(d2.id, 'Recipient Unreachable');
    const s = await svc.summary('run2');
    expect(s.counts).toMatchObject({ delivered: 1, failed: 1, total: 2 });
    expect(s.aggregateStatus).toBe('partially_delivered');
    expect(s.successRatePct).toBe(50);
  });

  it('retry re-queues a failed delivery WITHOUT regenerating the report; non-retryable is rejected', async () => {
    const run = { scopeType: 'platform', tenantId: null };
    await svc.enqueue('run3', run, [{ id: 'r1', isPlatform: true }]);
    const d = repo.rows.find((x) => x.runId === 'run3')!;
    await svc.markFailed(d.id, 'Delivery Provider Timeout');
    const retried = await svc.retry(d.id);
    expect(retried!.status).toBe('queued');
    expect(retried!.attemptCount).toBe(2);
    await svc.markDelivered(d.id);
    await expect(svc.retry(d.id)).rejects.toMatchObject({ code: 'conflict' }); // delivered is not retryable
  });

  it('requires a run id and at least one recipient; 404s unknown delivery', async () => {
    await expect(svc.enqueue('', { scopeType: 'platform', tenantId: null }, [{ id: 'r1', isPlatform: true }])).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.enqueue('run4', { scopeType: 'platform', tenantId: null }, [])).rejects.toBeInstanceOf(DeliveryError);
    await expect(svc.retry('ghost')).rejects.toMatchObject({ code: 'not_found' });
  });
});
