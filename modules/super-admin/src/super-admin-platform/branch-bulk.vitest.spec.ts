import { describe, it, expect, vi } from 'vitest';
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

// Nest-free: fake repo + no db (audit no-op). Verifies bulk status — validation gate, per-branch results pass-through,
// the rolled-up summary, and that partial failures are returned (not thrown).
function svcWith(repo: Partial<Record<string, any>>) { return new SuperAdminPlatformService(repo as any, undefined); }
const ctx = { userId: 'admin-1', email: 'a@x.com' };

describe('SuperAdminPlatformService bulk status (§27)', () => {
  it('rejects empty selection before any repo call', async () => {
    const bulkApplyStatus = vi.fn();
    const svc = svcWith({ bulkApplyStatus });
    await expect(svc.bulkBranchStatus(ctx, { branchIds: [], status: 'suspended', reason: 'sweep' })).rejects.toBeInstanceOf(PlatformError);
    expect(bulkApplyStatus).not.toHaveBeenCalled();
  });

  it('summarizes per-branch outcomes and surfaces partial failures', async () => {
    const bulkApplyStatus = vi.fn().mockResolvedValue([
      { id: 'a', name: 'A', ok: true, message: 'active → suspended' },
      { id: 'b', name: 'B', ok: false, message: 'Cannot change closed → suspended.' },
      { id: 'c', name: 'C', ok: true, message: 'active → suspended' },
    ]);
    const svc = svcWith({ bulkApplyStatus });
    const out = await svc.bulkBranchStatus(ctx, { branchIds: ['a', 'b', 'c'], status: 'Suspended', reason: 'fraud sweep' });
    expect(out.status).toBe('suspended'); // normalized
    expect(out.summary).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
    expect(out.results).toHaveLength(3);
    expect(bulkApplyStatus).toHaveBeenCalledWith(['a', 'b', 'c'], 'suspended');
  });
});
