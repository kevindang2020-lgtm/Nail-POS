import { describe, it, expect, vi } from 'vitest';
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

// Nest-free: fake repo + no db (audit no-op). Verifies the Assign Manager orchestration — validation gate, typed-error
// mapping from the repo result, normalized payload pass-through, and the assignable-managers 404.
function svcWith(repo: Partial<Record<string, any>>) { return new SuperAdminPlatformService(repo as any, undefined); }
const ctx = { userId: 'admin-1', email: 'admin@x.com' };

describe('SuperAdminPlatformService manager assignment (§34)', () => {
  it('rejects invalid input before any repo call', async () => {
    const assignBranchManager = vi.fn();
    const svc = svcWith({ assignBranchManager });
    await expect(svc.assignBranchManager(ctx, 'b1', { managerUserId: '' })).rejects.toBeInstanceOf(PlatformError);
    expect(assignBranchManager).not.toHaveBeenCalled();
  });

  it('maps repo not_found and invalid to typed errors', async () => {
    const nf = svcWith({ assignBranchManager: vi.fn().mockResolvedValue({ ok: false, code: 'not_found', message: 'Branch not found.' }) });
    await expect(nf.assignBranchManager(ctx, 'bX', { managerUserId: 'u1', reason: 'promote' })).rejects.toMatchObject({ code: 'not_found' });
    const inv = svcWith({ assignBranchManager: vi.fn().mockResolvedValue({ ok: false, code: 'invalid', message: 'That user belongs to a different tenant than this branch.' }) });
    await expect(inv.assignBranchManager(ctx, 'b1', { managerUserId: 'u2', reason: 'promote' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('passes normalized values to the repo and returns the result', async () => {
    const assignBranchManager = vi.fn().mockResolvedValue({ ok: true, branch: { id: 'b1', name: 'Downtown' }, manager: { id: 'u9', name: 'Sam Green', email: 's@x.com' }, movedFromBranchId: 'b0' });
    const svc = svcWith({ assignBranchManager });
    const out = await svc.assignBranchManager(ctx, 'b1', { managerUserId: '  u9 ', reason: '  promote ', effectiveDate: '2026-07-01' });
    expect(out).toMatchObject({ manager: { id: 'u9' }, movedFromBranchId: 'b0' });
    const passed = assignBranchManager.mock.calls[0][1];
    expect(passed.managerUserId).toBe('u9'); // trimmed
    expect(passed.reason).toBe('promote');
    expect(passed.effectiveDate).toBe('2026-07-01');
  });

  it('assignableManagers 404s when the branch is missing', async () => {
    const svc = svcWith({ assignableManagers: vi.fn().mockResolvedValue(null) });
    await expect(svc.assignableManagers('bX')).rejects.toMatchObject({ code: 'not_found' });
  });
});
