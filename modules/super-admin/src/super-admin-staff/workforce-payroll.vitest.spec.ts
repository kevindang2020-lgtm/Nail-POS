import { describe, it, expect, vi } from 'vitest';
import { SuperAdminStaffService } from './super-admin-staff.service';

// Service contract for payroll-sync (§35): summary reconciles + reports configured, events carry a retryable flag +
// blocked reason, and retry validates reason → eligibility → records ONE backed-off attempt → audits. Permanent errors,
// exhausted attempts, unknown events, and missing reasons are all refused before any mutation. No amounts anywhere.
function harness(rec: { id: string; status: string; errorCode: string | null; attemptCount: number; maxAttempts: number } | null = { id: 'e1', status: 'failed', errorCode: 'PROVIDER_OUTAGE', attemptCount: 1, maxAttempts: 5 }) {
  const repo = {
    payrollSyncCounts: vi.fn(async () => [{ status: 'synced', count: 90 }, { status: 'failed', count: 10 }]),
    payrollSyncEvents: vi.fn(async () => [
      { id: 'e1', userId: 'u1', workerName: 'Noah', tenant: 'Glow', provider: 'gusto', eventType: 'hours_export', status: 'failed', errorCode: 'PROVIDER_OUTAGE', errorMessage: 'timeout', attemptCount: 1, maxAttempts: 5, lastAttemptAt: null, nextRetryAt: null },
      { id: 'e2', userId: 'u2', workerName: 'Ana', tenant: 'Glow', provider: 'gusto', eventType: 'worker_provision', status: 'failed', errorCode: 'MAPPING_MISSING', errorMessage: 'no external id', attemptCount: 0, maxAttempts: 5, lastAttemptAt: null, nextRetryAt: null },
    ]),
    getPayrollSyncEventRecord: vi.fn(async () => rec),
    recordPayrollRetryAttempt: vi.fn(async () => ({ status: 'retrying', attemptCount: (rec?.attemptCount ?? 0) + 1 })),
    recordWorkforceAudit: vi.fn(async () => undefined),
  };
  return { svc: new SuperAdminStaffService(repo as any), repo };
}
const ctx = { userId: 'admin-1' };

describe('SuperAdminStaffService payroll sync (§35)', () => {
  it('summarizes (reconciled + configured) and flags retryability per event', async () => {
    const { svc } = harness();
    const { summary, events } = await svc.getPayrollSync(ctx);
    expect(summary).toMatchObject({ total: 100, successful: 90, failed: 10, successRate: 90, configured: true });
    const e1 = events.find((e) => e.id === 'e1')!; const e2 = events.find((e) => e.id === 'e2')!;
    expect(e1.retryable).toBe(true); expect(e1.retryBlockedReason).toBeNull();
    expect(e2.retryable).toBe(false); // permanent MAPPING_MISSING
    expect(e2.retryBlockedReason).toMatch(/permanent/);
  });

  it('retries a transient failure: records one backed-off attempt and audits it', async () => {
    const { svc, repo } = harness();
    const r = await svc.retryPayrollSync(ctx, 'e1', { reason: 'provider outage cleared' });
    expect(r.status).toBe('retrying'); expect(r.attemptCount).toBe(2);
    expect(typeof r.nextRetryAt).toBe('string');
    expect(repo.recordPayrollRetryAttempt).toHaveBeenCalledWith('e1', expect.any(String));
    expect(repo.recordWorkforceAudit).toHaveBeenCalledWith(ctx, 'workforce_payroll_sync_retried', 'e1', expect.objectContaining({ reason: 'provider outage cleared', attemptCount: 2 }));
  });

  it('refuses to retry a permanent mapping failure (no mutation)', async () => {
    const { svc, repo } = harness({ id: 'e2', status: 'failed', errorCode: 'MAPPING_MISSING', attemptCount: 0, maxAttempts: 5 });
    await expect(svc.retryPayrollSync(ctx, 'e2', { reason: 'please try again' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.recordPayrollRetryAttempt).not.toHaveBeenCalled();
    expect(repo.recordWorkforceAudit).not.toHaveBeenCalled();
  });

  it('refuses to retry an exhausted event', async () => {
    const { svc, repo } = harness({ id: 'e3', status: 'failed', errorCode: 'PROVIDER_OUTAGE', attemptCount: 5, maxAttempts: 5 });
    await expect(svc.retryPayrollSync(ctx, 'e3', { reason: 'one more try please' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.recordPayrollRetryAttempt).not.toHaveBeenCalled();
  });

  it('requires a reason and a known event', async () => {
    const a = harness();
    await expect(a.svc.retryPayrollSync(ctx, 'e1', { reason: 'no' })).rejects.toMatchObject({ code: 'invalid' });
    expect(a.repo.getPayrollSyncEventRecord).not.toHaveBeenCalled();
    const b = harness(null);
    await expect(b.svc.retryPayrollSync(ctx, 'ghost', { reason: 'a valid reason here' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
