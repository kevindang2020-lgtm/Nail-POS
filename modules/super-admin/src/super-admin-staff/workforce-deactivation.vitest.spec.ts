import { describe, it, expect, vi } from 'vitest';
import { SuperAdminStaffService } from './super-admin-staff.service';

// Service contract for terminated-user access cleanup (§33): runs only on inactive/suspended workers, revokes BOTH
// sessions and device tokens, audits once, never touches status; refuses active workers and unknown targets before any
// mutation. The queue passes the repo rows straight through.
function harness(target: { userId: string; name: string; role: string; status: string } | null) {
  const calls: string[] = [];
  const repo = {
    workforceAccessTarget: vi.fn(async () => { calls.push('target'); return target; }),
    revokeWorkerSessions: vi.fn(async () => { calls.push('sessions'); return 2; }),
    revokeWorkerDeviceTokens: vi.fn(async () => { calls.push('devices'); return 1; }),
    recordWorkforceAudit: vi.fn(async () => { calls.push('audit'); }),
    deactivationQueue: vi.fn(async () => [{ workerId: 'u9', name: 'Old Hand', role: 'TECHNICIAN', tenant: 'Glamour', status: 'inactive', activeSessions: 1, appRegistrations: 0 }]),
  };
  return { svc: new SuperAdminStaffService(repo as any), repo, calls };
}
const ctx = { userId: 'admin-1' };

describe('SuperAdminStaffService.deactivateAccess', () => {
  it('revokes sessions + device tokens and audits for an inactive worker', async () => {
    const { svc, repo, calls } = harness({ userId: 'u1', name: 'Gone', role: 'TECHNICIAN', status: 'inactive' });
    const r = await svc.deactivateAccess(ctx, 'u1', { reason: 'terminated, clean up access' });
    expect(r).toEqual({ ok: true, result: { sessionsRevoked: 2, devicesRevoked: 1 } });
    expect(repo.revokeWorkerSessions).toHaveBeenCalledWith('u1');
    expect(repo.revokeWorkerDeviceTokens).toHaveBeenCalledWith('u1');
    expect(repo.recordWorkforceAudit).toHaveBeenCalledWith(ctx, 'workforce_access_deactivated', 'u1', expect.objectContaining({ status: 'inactive', result: { sessionsRevoked: 2, devicesRevoked: 1 } }));
    expect(calls).toEqual(['target', 'sessions', 'devices', 'audit']);
  });

  it('refuses to deactivate an active worker (no mutation, no audit)', async () => {
    const { svc, repo } = harness({ userId: 'u2', name: 'Working', role: 'MANAGER', status: 'active' });
    await expect(svc.deactivateAccess(ctx, 'u2', { reason: 'a long enough reason' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.revokeWorkerSessions).not.toHaveBeenCalled();
    expect(repo.revokeWorkerDeviceTokens).not.toHaveBeenCalled();
    expect(repo.recordWorkforceAudit).not.toHaveBeenCalled();
  });

  it('rejects a short reason for a deactivatable worker', async () => {
    const { svc, repo } = harness({ userId: 'u3', name: 'X', role: 'RECEPTION', status: 'suspended' });
    await expect(svc.deactivateAccess(ctx, 'u3', { reason: 'short' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.revokeWorkerSessions).not.toHaveBeenCalled();
  });

  it('returns not_found for an unknown/out-of-scope worker', async () => {
    const { svc, repo } = harness(null);
    await expect(svc.deactivateAccess(ctx, 'ghost', { reason: 'a valid reason here' })).rejects.toMatchObject({ code: 'not_found' });
    expect(repo.revokeWorkerSessions).not.toHaveBeenCalled();
  });

  it('passes the deactivation queue through from the repo', async () => {
    const { svc } = harness(null);
    const q = await svc.getDeactivationQueue(ctx);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ workerId: 'u9', status: 'inactive', activeSessions: 1 });
  });
});
