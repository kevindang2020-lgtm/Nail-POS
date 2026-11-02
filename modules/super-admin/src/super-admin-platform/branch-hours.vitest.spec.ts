import { describe, it, expect, vi } from 'vitest';
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

// Nest-free: fake repo + no db (audit no-op). Verifies the hours editor — validation gate, typed-error mapping, the
// normalized day payload passed to the repo, and the read 404.
function svcWith(repo: Partial<Record<string, any>>) { return new SuperAdminPlatformService(repo as any, undefined); }
const ctx = { userId: 'admin-1', email: 'a@x.com' };

describe('SuperAdminPlatformService branch hours (§37)', () => {
  it('rejects an invalid week before any repo call', async () => {
    const setBranchHours = vi.fn();
    const svc = svcWith({ setBranchHours });
    await expect(svc.setBranchHours(ctx, 'b1', { days: [{ dayOfWeek: 1, isClosed: false, opensAt: '18:00', closesAt: '09:00' }] })).rejects.toBeInstanceOf(PlatformError);
    expect(setBranchHours).not.toHaveBeenCalled();
  });

  it('passes validated/normalized days and maps repo not_found', async () => {
    const setBranchHours = vi.fn().mockResolvedValue({ ok: true, count: 2 });
    const svc = svcWith({ setBranchHours });
    const out = await svc.setBranchHours(ctx, 'b1', { days: [{ dayOfWeek: 1, isClosed: false, opensAt: '09:00', closesAt: '17:00' }, { dayOfWeek: 0, isClosed: true, opensAt: '09:00', closesAt: '10:00' }] });
    expect(out).toMatchObject({ count: 2 });
    const passed = setBranchHours.mock.calls[0][1];
    expect(passed[0].dayOfWeek).toBe(0); // sorted ascending
    expect(passed[0].opensAt).toBe(null); // closed day cleared
    expect(passed[1].opensAt).toBe('09:00');

    const nf = svcWith({ setBranchHours: vi.fn().mockResolvedValue({ ok: false, code: 'not_found', message: 'Branch not found.' }) });
    await expect(nf.setBranchHours(ctx, 'bX', { days: [{ dayOfWeek: 1, isClosed: true }] })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('branchHours read 404s when branch missing', async () => {
    const svc = svcWith({ getBranchHours: vi.fn().mockResolvedValue(null) });
    await expect(svc.branchHours('bX')).rejects.toMatchObject({ code: 'not_found' });
  });
});
