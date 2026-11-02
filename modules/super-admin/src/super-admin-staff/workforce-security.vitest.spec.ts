import { describe, it, expect, vi } from 'vitest';
import { SuperAdminStaffService } from './super-admin-staff.service';

// Service contract for suspicious activity (§37): alerts are assembled from the repo's real signals (threshold-filtered,
// severity-ordered), and a review records an audited decision keyed to the stable alert key without mutating records.
function harness(signals: any[]) {
  const repo = { securitySignals: vi.fn(async () => signals), recordWorkforceAudit: vi.fn(async () => undefined) };
  return { svc: new SuperAdminStaffService(repo as any), repo };
}
const ctx = { userId: 'admin-1' };

describe('SuperAdminStaffService security activity (§37)', () => {
  it('assembles + orders alerts and drops below-threshold signals', async () => {
    const { svc } = harness([
      { type: 'role_churn', userId: 'u1', name: 'A', tenant: 'T', status: 'active', count: 2 }, // below threshold 3 → dropped
      { type: 'terminated_access', userId: 'u2', name: 'Gone', tenant: 'T', status: 'inactive', count: 1 }, // critical
      { type: 'permission_denials', userId: 'u3', name: 'C', tenant: 'T', status: 'active', count: 6 }, // warning
    ]);
    const { alerts, total } = await svc.getSecurityActivity(ctx);
    expect(total).toBe(2);
    expect(alerts[0]).toMatchObject({ type: 'terminated_access', severity: 'critical', key: 'terminated_access:u2' });
    expect(alerts[1]).toMatchObject({ type: 'permission_denials', severity: 'warning' });
    expect(alerts.find((a) => a.type === 'role_churn')).toBeUndefined();
  });

  it('returns no alerts when nothing trips (honest empty)', async () => {
    const { svc } = harness([]);
    const { alerts, total } = await svc.getSecurityActivity(ctx);
    expect(total).toBe(0); expect(alerts).toEqual([]);
  });

  it('records an audited review decision keyed to the alert', async () => {
    const { svc, repo } = harness([]);
    const r = await svc.reviewSecurityAlert(ctx, { alertKey: 'terminated_access:u2', resolution: 'escalated', reason: 'handed to security team' });
    expect(r).toEqual({ ok: true, alertKey: 'terminated_access:u2', resolution: 'escalated' });
    expect(repo.recordWorkforceAudit).toHaveBeenCalledWith(ctx, 'workforce_security_reviewed', 'terminated_access:u2', expect.objectContaining({ resolution: 'escalated', reason: 'handed to security team' }));
  });

  it('rejects an invalid review before auditing', async () => {
    const { svc, repo } = harness([]);
    await expect(svc.reviewSecurityAlert(ctx, { alertKey: 'k', resolution: 'nope', reason: 'a valid reason here' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.reviewSecurityAlert(ctx, { alertKey: 'k', resolution: 'dismissed', reason: 'x' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.recordWorkforceAudit).not.toHaveBeenCalled();
  });
});
