import { describe, it, expect, vi } from 'vitest';
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

// Nest-free: fake repo + no db (audit no-op). Verifies device allocation — validation gate (incl. non-allocatable
// hardware), typed-error mapping, normalized payload pass-through, and the read 404.
function svcWith(repo: Partial<Record<string, any>>) { return new SuperAdminPlatformService(repo as any, undefined); }
const ctx = { userId: 'admin-1', email: 'a@x.com' };

describe('SuperAdminPlatformService device allocation (§36)', () => {
  it('rejects non-allocatable hardware before any repo call', async () => {
    const allocateDevice = vi.fn();
    const svc = svcWith({ allocateDevice });
    await expect(svc.allocateDevice(ctx, 'b1', { deviceId: 'd1', category: 'hardware' })).rejects.toBeInstanceOf(PlatformError);
    expect(allocateDevice).not.toHaveBeenCalled();
  });

  it('passes normalized values and maps repo invalid', async () => {
    const allocateDevice = vi.fn().mockResolvedValue({ ok: true, device: { id: 'd9', name: 'Lane 2' }, movedFromBranchId: 'b0' });
    const svc = svcWith({ allocateDevice });
    const out = await svc.allocateDevice(ctx, 'b1', { deviceId: '  d9 ', category: 'Terminal' });
    expect(out).toMatchObject({ device: { id: 'd9' }, movedFromBranchId: 'b0' });
    expect(allocateDevice.mock.calls[0][1]).toMatchObject({ deviceId: 'd9', category: 'terminal' });

    const inv = svcWith({ allocateDevice: vi.fn().mockResolvedValue({ ok: false, code: 'invalid', message: "Device not found in this branch's tenant." }) });
    await expect(inv.allocateDevice(ctx, 'b1', { deviceId: 'dX', category: 'display' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('branchDevices 404s when branch missing', async () => {
    const svc = svcWith({ branchDevices: vi.fn().mockResolvedValue(null) });
    await expect(svc.branchDevices('bX')).rejects.toMatchObject({ code: 'not_found' });
  });
});
