// Verifies the async customer-import worker (Roadmap Phase 3): the enable gate is off unless explicitly set, the pure
// tick processes queued jobs, and a throwing service never propagates (a bad tick must not crash the worker).
import { describe, it, expect, vi } from 'vitest';
import { customerImportWorkerEnabled, customerImportWorkerTick } from './customer-import.scheduler';

describe('customer-import worker', () => {
  it('is disabled unless CUSTOMER_IMPORT_WORKER_ENABLED is truthy', () => {
    expect(customerImportWorkerEnabled({} as any)).toBe(false);
    expect(customerImportWorkerEnabled({ CUSTOMER_IMPORT_WORKER_ENABLED: 'false' } as any)).toBe(false);
    expect(customerImportWorkerEnabled({ CUSTOMER_IMPORT_WORKER_ENABLED: 'true' } as any)).toBe(true);
    expect(customerImportWorkerEnabled({ CUSTOMER_IMPORT_WORKER_ENABLED: '1' } as any)).toBe(true);
    expect(customerImportWorkerEnabled({ CUSTOMER_IMPORT_WORKER_ENABLED: 'on' } as any)).toBe(true);
  });

  it('tick processes queued jobs and reports the count', async () => {
    const svc = { processPendingImportJobs: vi.fn(async () => ({ processed: 3 })) };
    const r = await customerImportWorkerTick(svc);
    expect(r.processed).toBe(3);
    expect(svc.processPendingImportJobs).toHaveBeenCalledWith(5);
  });

  it('tick swallows errors — a bad job never crashes the worker', async () => {
    const svc = { processPendingImportJobs: vi.fn(async () => { throw new Error('boom'); }) };
    const r = await customerImportWorkerTick(svc);
    expect(r.processed).toBe(0); // fail-safe, no throw
  });
});
