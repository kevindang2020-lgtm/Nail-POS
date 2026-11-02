import { describe, it, expect, vi } from 'vitest';
import { IntegrationSchedulerService, type SchedulerFinders } from './integration-scheduler.service';

describe('IntegrationSchedulerService.tick', () => {
  it('reports not-ok with no db and no finders', async () => {
    expect((await new IntegrationSchedulerService().tick({})).ok).toBe(false);
  });

  it('enqueues due sync-capable connections, drains both queues, and refreshes expiring tokens', async () => {
    const advance = vi.fn(async () => {});
    const finders: SchedulerFinders = {
      dueScheduled: async () => [{ id: 'c1', provider_key: 'quickbooks' }, { id: 'c2', provider_key: 'twilio' }], // twilio is not sync-capable → skipped
      expiringOAuth: async () => [{ id: 'c3' }],
      advanceNextSync: advance,
    };
    const sync: any = { enqueueSync: vi.fn(async () => ({ ok: true })), drainDueJobs: vi.fn(async () => ({ processed: 1 })) };
    const webhooks: any = { drainWebhookQueue: vi.fn(async () => ({ processed: 2 })) };
    const lifecycle: any = { refreshAuthentication: vi.fn(async () => ({ ok: true })) };
    const s = new IntegrationSchedulerService({} /* db present */, sync, webhooks, lifecycle, finders);

    const r = await s.tick({ id: 'admin' }, { limit: 10 });
    expect(r.ok).toBe(true);
    expect(sync.enqueueSync).toHaveBeenCalledTimes(1);               // only the sync-capable one
    expect(sync.enqueueSync).toHaveBeenCalledWith(expect.anything(), 'c1', { syncType: 'scheduled' });
    expect(advance).toHaveBeenCalledWith('c1', expect.any(Number));  // next_sync_at advanced
    expect(r.scheduledEnqueued).toBe(1);
    expect(r.syncDrained).toBe(1);
    expect(r.webhookDrained).toBe(2);
    expect(lifecycle.refreshAuthentication).toHaveBeenCalledWith(expect.anything(), 'c3');
    expect(r.tokensRefreshed).toBe(1);
  });

  it('counts refresh failures without throwing', async () => {
    const finders: SchedulerFinders = { dueScheduled: async () => [], expiringOAuth: async () => [{ id: 'c9' }], advanceNextSync: async () => {} };
    const lifecycle: any = { refreshAuthentication: async () => ({ ok: false, error: 'reauthorization_required' }) };
    const s = new IntegrationSchedulerService({}, undefined, undefined, lifecycle, finders);
    const r = await s.tick({});
    expect(r.tokensRefreshed).toBe(0); expect(r.refreshFailures).toBe(1);
  });
});
