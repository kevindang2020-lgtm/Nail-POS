import { describe, it, expect, vi } from 'vitest';
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

// Nest-free orchestration test for the status lifecycle command.
function svcWith(repo: Partial<Record<string, any>>) {
  return new SuperAdminPlatformService(repo as any, undefined);
}
const ctx = { userId: 'admin-1', email: 'admin@x.com' };

describe('SuperAdminPlatformService.changeBranchStatus (lifecycle)', () => {
  it('404s when the branch is missing', async () => {
    const svc = svcWith({ getBranchForStatus: vi.fn().mockResolvedValue(null) });
    await expect(svc.changeBranchStatus(ctx, 'nope', { status: 'paused', reason: 'x reason' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects an illegal transition (active → closed must go via closing)', async () => {
    const apply = vi.fn();
    const svc = svcWith({ getBranchForStatus: vi.fn().mockResolvedValue({ id: 'b1', name: 'Downtown', status: 'active' }), applyBranchStatus: apply });
    await expect(svc.changeBranchStatus(ctx, 'b1', { status: 'closed', reason: 'shutting down' })).rejects.toMatchObject({ code: 'invalid' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('requires typed confirmation for suspend', async () => {
    const apply = vi.fn();
    const svc = svcWith({ getBranchForStatus: vi.fn().mockResolvedValue({ id: 'b1', name: 'Downtown', status: 'active' }), applyBranchStatus: apply });
    await expect(svc.changeBranchStatus(ctx, 'b1', { status: 'suspended', reason: 'fraud review' })).rejects.toBeInstanceOf(PlatformError);
    expect(apply).not.toHaveBeenCalled();
  });

  it('reports a concurrent change when the guarded update affects 0 rows', async () => {
    const svc = svcWith({ getBranchForStatus: vi.fn().mockResolvedValue({ id: 'b1', name: 'Downtown', status: 'active' }), applyBranchStatus: vi.fn().mockResolvedValue(null) });
    await expect(svc.changeBranchStatus(ctx, 'b1', { status: 'paused', reason: 'maintenance window' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('applies a valid transition with the from-guard and returns from/to', async () => {
    const apply = vi.fn().mockResolvedValue({ id: 'b1', name: 'Downtown', status: 'paused' });
    const svc = svcWith({ getBranchForStatus: vi.fn().mockResolvedValue({ id: 'b1', name: 'Downtown', status: 'active' }), applyBranchStatus: apply });
    const out = await svc.changeBranchStatus(ctx, 'b1', { status: 'paused', reason: 'maintenance window' });
    expect(out).toMatchObject({ id: 'b1', from: 'active', to: 'paused' });
    expect(apply).toHaveBeenCalledWith('b1', 'active', 'paused');
  });

  it('accepts suspend with the correct typed branch name', async () => {
    const apply = vi.fn().mockResolvedValue({ id: 'b1', name: 'Downtown', status: 'suspended' });
    const svc = svcWith({ getBranchForStatus: vi.fn().mockResolvedValue({ id: 'b1', name: 'Downtown', status: 'active' }), applyBranchStatus: apply });
    const out = await svc.changeBranchStatus(ctx, 'b1', { status: 'suspended', reason: 'fraud review', confirmName: 'downtown' });
    expect(out).toMatchObject({ to: 'suspended' });
  });
});
