import { describe, it, expect, vi } from 'vitest';
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

// Nest-free: construct the service with a fake repo and no db (audit is a no-op without db). Verifies the controlled
// Add Branch orchestration — pure validation gate, typed-error mapping from the repo result, and the success path.
function svcWith(repo: Partial<Record<string, any>>) {
  return new SuperAdminPlatformService(repo as any, undefined);
}
const ctx = { userId: 'admin-1', email: 'admin@x.com' };

describe('SuperAdminPlatformService.createBranch (controlled Add Branch)', () => {
  it('rejects invalid input before any repo call', async () => {
    const createBranch = vi.fn();
    const svc = svcWith({ createBranch });
    await expect(svc.createBranch(ctx, { tenantId: '', name: 'A' })).rejects.toBeInstanceOf(PlatformError);
    expect(createBranch).not.toHaveBeenCalled();
  });

  it('maps a repo not_found result to a PlatformError(not_found)', async () => {
    const svc = svcWith({ createBranch: vi.fn().mockResolvedValue({ ok: false, code: 'not_found', message: 'Parent tenant not found.' }) });
    await expect(svc.createBranch(ctx, { tenantId: 't-missing', name: 'Downtown' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('maps a repo duplicate result to a PlatformError(invalid)', async () => {
    const svc = svcWith({ createBranch: vi.fn().mockResolvedValue({ ok: false, code: 'invalid', message: 'A branch with this name or address already exists for this tenant.' }) });
    await expect(svc.createBranch(ctx, { tenantId: 't1', name: 'Downtown' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('passes normalized values to the repo and returns the created branch', async () => {
    const createBranch = vi.fn().mockResolvedValue({ ok: true, branch: { id: 'b-new', name: 'Glamour Downtown', status: 'pending', tenantId: 't1', city: 'NYC', state: 'NY' } });
    const svc = svcWith({ createBranch });
    const out = await svc.createBranch(ctx, { tenantId: '  t1 ', name: '  Glamour Downtown ', city: 'NYC', openingStatus: 'planned' });
    expect(out).toMatchObject({ id: 'b-new', status: 'pending' });
    const passed = createBranch.mock.calls[0][0];
    expect(passed.tenantId).toBe('t1'); // trimmed
    expect(passed.name).toBe('Glamour Downtown'); // trimmed
    expect(passed.status).toBe('pending'); // planned → pending
    expect(passed.verificationStatus).toBe('draft');
  });
});
