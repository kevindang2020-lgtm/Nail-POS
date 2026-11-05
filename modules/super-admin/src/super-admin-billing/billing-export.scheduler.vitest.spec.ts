import { describe, it, expect, vi } from 'vitest';
import { exportWorkerTick, billingExportWorkerEnabled } from './billing-export.scheduler';

describe('billingExportWorkerEnabled', () => {
  it('is off unless explicitly enabled', () => {
    expect(billingExportWorkerEnabled({} as any)).toBe(false);
    expect(billingExportWorkerEnabled({ BILLING_EXPORT_WORKER_ENABLED: 'true' } as any)).toBe(true);
    expect(billingExportWorkerEnabled({ BILLING_EXPORT_WORKER_ENABLED: '1' } as any)).toBe(true);
  });
});

describe('exportWorkerTick', () => {
  it('processes pending jobs and sweeps expired links', async () => {
    const svc = { processPendingExportJobs: vi.fn().mockResolvedValue({ processed: 2 }), expireStaleExportJobs: vi.fn().mockResolvedValue({ expired: 1 }) };
    const r = await exportWorkerTick(svc);
    expect(r).toEqual({ processed: 2, expired: 1 });
    expect(svc.processPendingExportJobs).toHaveBeenCalledWith(5);
  });
  it('never throws — a failing tick is swallowed and logged', async () => {
    const svc = { processPendingExportJobs: vi.fn().mockRejectedValue(new Error('boom')), expireStaleExportJobs: vi.fn() };
    const errs: string[] = [];
    const r = await exportWorkerTick(svc, { log: () => {}, error: (m) => errs.push(m) });
    expect(r).toEqual({ processed: 0, expired: 0 });
    expect(errs[0]).toMatch(/boom/);
  });
});
