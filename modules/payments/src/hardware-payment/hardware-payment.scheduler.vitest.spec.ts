import { describe, it, expect, vi, afterEach } from 'vitest';
import { previousBillingMonth, runMonthlyTick } from './hardware-payment.reconciliation-job';

describe('Hardware payment monthly tick', () => {
  afterEach(() => { delete process.env.HARDWARE_PAYMENT_CRON_ENABLED; });

  it('computes the month that just closed (UTC, with year rollover)', () => {
    expect(previousBillingMonth(new Date(Date.UTC(2026, 6, 1)))).toBe('2026-06');   // Jul 1 → Jun
    expect(previousBillingMonth(new Date(Date.UTC(2026, 6, 15)))).toBe('2026-06');
    expect(previousBillingMonth(new Date(Date.UTC(2026, 0, 10)))).toBe('2025-12');  // Jan → Dec, prev year
  });

  it('does nothing unless HARDWARE_PAYMENT_CRON_ENABLED is set (no surprise charges in dev/test)', async () => {
    const job = { runMonthly: vi.fn() };
    await runMonthlyTick(job as any);
    expect(job.runMonthly).not.toHaveBeenCalled();
  });

  it('reconciles the previous month when enabled', async () => {
    process.env.HARDWARE_PAYMENT_CRON_ENABLED = '1';
    const job = { runMonthly: vi.fn().mockResolvedValue({ plansProcessed: 0, invoicesCreated: 0, shortfallsChargedCents: 0, skippedNoVolume: 0, failures: 0 }) };
    await runMonthlyTick(job as any);
    expect(job.runMonthly).toHaveBeenCalledWith(previousBillingMonth());
  });

  it('swallows job errors (a failed tick never crashes the process)', async () => {
    process.env.HARDWARE_PAYMENT_CRON_ENABLED = 'true';
    const job = { runMonthly: vi.fn().mockRejectedValue(new Error('boom')) };
    await expect(runMonthlyTick(job as any)).resolves.toBeUndefined();
  });
});
