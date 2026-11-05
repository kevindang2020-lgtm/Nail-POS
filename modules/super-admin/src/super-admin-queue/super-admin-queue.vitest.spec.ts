import { describe, it, expect } from 'vitest';
import { SuperAdminQueueService, type PlatformQueueOverview, type QueueOverviewFilters } from './super-admin-queue.service';
import { SuperAdminQueueKyselyRepository } from './super-admin-queue.kysely.repository';

const ctx = { userId: 'sa1', email: 'admin@platform.test', ip: '127.0.0.1' };

describe('SuperAdminQueueService', () => {
  it('returns an honest empty overview when no DB is configured (no fabricated data)', async () => {
    const svc = new SuperAdminQueueService(new SuperAdminQueueKyselyRepository(null));
    const o = await svc.getOverview(ctx, {});
    expect(o.kpis).toEqual({ waitingNow: 0, inServiceNow: 0, vipWaiting: 0, longestWaitMin: 0, salonsWithActiveQueue: 0 });
    expect(o.items).toEqual([]);
    expect(o.tenants).toEqual([]);
    expect(o.statusBreakdown).toEqual([]);
    expect(o.tenantCount).toBe(0);
  });

  it('clamps filters (limit bounded, search/status trimmed/typed)', async () => {
    let seen: QueueOverviewFilters | null = null;
    const repo = { platformQueueOverview: async (f: QueueOverviewFilters) => { seen = f; return {} as PlatformQueueOverview; } };
    const svc = new SuperAdminQueueService(repo);
    await svc.getOverview(ctx, { limit: 999999, search: '  Jordan  ', status: 'waiting' });
    expect(seen!.limit).toBe(1000);
    expect(seen!.search).toBe('Jordan');
    expect(seen!.status).toBe('waiting');
    await svc.getOverview(ctx, { limit: -5, search: {} as any });
    expect(seen!.limit).toBe(1);
    expect(seen!.search).toBe('');
  });
});
