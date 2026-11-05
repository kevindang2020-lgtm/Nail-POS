import { describe, it, expect, vi } from 'vitest';
import { SuperAdminStaffService, SuperAdminStaffError } from './super-admin-staff.service';

// Service contract for controlled account-access support (§32): the right real mutation runs for each action, exactly
// one audit row is written with the reason + result, invalid input is rejected before any mutation, and an unknown /
// out-of-scope target yields not_found (again before any mutation). Repo is faked so we assert orchestration + ordering.
function harness(target: { userId: string; name: string; role: string; status: string } | null = { userId: 'u1', name: 'Sarah', role: 'TECHNICIAN', status: 'active' }) {
  const calls: string[] = [];
  const repo = {
    workforceAccessTarget: vi.fn(async () => { calls.push('target'); return target; }),
    revokeWorkerSessions: vi.fn(async () => { calls.push('revoke'); return 3; }),
    forceWorkerPasswordReset: vi.fn(async () => { calls.push('pwd'); }),
    resetWorkerMfa: vi.fn(async () => { calls.push('mfa'); }),
    recordWorkforceAudit: vi.fn(async () => { calls.push('audit'); }),
  };
  return { svc: new SuperAdminStaffService(repo as any), repo, calls };
}
const ctx = { userId: 'admin-1' };

describe('SuperAdminStaffService.accessSupport', () => {
  it('revokes sessions and audits with the reason + count', async () => {
    const { svc, repo, calls } = harness();
    const r = await svc.accessSupport(ctx, 'u1', { action: 'revoke_sessions', reason: 'phone lost, force logout' });
    expect(r).toEqual({ ok: true, action: 'revoke_sessions', result: { sessionsRevoked: 3 } });
    expect(repo.revokeWorkerSessions).toHaveBeenCalledWith('u1');
    expect(repo.recordWorkforceAudit).toHaveBeenCalledWith(ctx, 'workforce_session_revoke', 'u1', expect.objectContaining({ reason: 'phone lost, force logout', result: { sessionsRevoked: 3 } }));
    expect(calls).toEqual(['target', 'revoke', 'audit']); // target check → mutation → audit
  });

  it('forces a password change and resets MFA via the correct columns', async () => {
    const a = harness(); await a.svc.accessSupport(ctx, 'u1', { action: 'force_password_reset', reason: 'account recovery request' });
    expect(a.repo.forceWorkerPasswordReset).toHaveBeenCalledWith('u1');
    expect(a.repo.recordWorkforceAudit).toHaveBeenCalledWith(ctx, 'workforce_password_reset', 'u1', expect.any(Object));

    const b = harness(); const rb = await b.svc.accessSupport(ctx, 'u1', { action: 'reset_mfa', reason: 'locked out of authenticator' });
    expect(b.repo.resetWorkerMfa).toHaveBeenCalledWith('u1');
    expect(rb.result).toEqual({ mfaReset: true });
  });

  it('rejects invalid input before any mutation', async () => {
    const { svc, repo } = harness();
    await expect(svc.accessSupport(ctx, 'u1', { action: 'reset_mfa', reason: 'short' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.accessSupport(ctx, 'u1', { action: 'nope', reason: 'a long enough reason' })).rejects.toBeInstanceOf(SuperAdminStaffError);
    expect(repo.resetWorkerMfa).not.toHaveBeenCalled();
    expect(repo.recordWorkforceAudit).not.toHaveBeenCalled();
  });

  it('returns not_found for an unknown/out-of-scope worker and does not mutate', async () => {
    const { svc, repo } = harness(null);
    await expect(svc.accessSupport(ctx, 'ghost', { action: 'revoke_sessions', reason: 'valid reason here' })).rejects.toMatchObject({ code: 'not_found' });
    expect(repo.revokeWorkerSessions).not.toHaveBeenCalled();
    expect(repo.recordWorkforceAudit).not.toHaveBeenCalled();
  });
});
