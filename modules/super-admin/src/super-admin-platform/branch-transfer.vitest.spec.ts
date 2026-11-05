import { describe, it, expect, vi } from 'vitest';
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

// Nest-free: fake repo + no db (audit no-op). Verifies the controlled transfer REQUEST orchestration — validation gate,
// typed-error mapping, options/preflight 404 + error mapping, and that the result is marked as a request (not executed).
function svcWith(repo: Partial<Record<string, any>>) { return new SuperAdminPlatformService(repo as any, undefined); }
const ctx = { userId: 'admin-1', email: 'admin@x.com' };
const goodInput = { destinationTenantId: 't2', reason: 'consolidating into the parent group', confirmName: 'Downtown' };

describe('SuperAdminPlatformService branch transfer (§33)', () => {
  it('rejects invalid input before any repo call', async () => {
    const createTransferRequest = vi.fn();
    const svc = svcWith({ createTransferRequest });
    await expect(svc.requestBranchTransfer(ctx, 'b1', { destinationTenantId: '', reason: 'x' })).rejects.toBeInstanceOf(PlatformError);
    expect(createTransferRequest).not.toHaveBeenCalled();
  });

  it('maps repo errors to typed PlatformError', async () => {
    const nf = svcWith({ createTransferRequest: vi.fn().mockResolvedValue({ ok: false, code: 'not_found', message: 'Destination tenant not found.' }) });
    await expect(nf.requestBranchTransfer(ctx, 'b1', goodInput)).rejects.toMatchObject({ code: 'not_found' });
    const inv = svcWith({ createTransferRequest: vi.fn().mockResolvedValue({ ok: false, code: 'invalid', message: 'The typed branch name does not match.' }) });
    await expect(inv.requestBranchTransfer(ctx, 'b1', goodInput)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('records a request (not an executed move) and passes normalized values', async () => {
    const createTransferRequest = vi.fn().mockResolvedValue({ ok: true, request: { id: 'req-1', status: 'requested', toTenantId: 't2' } });
    const svc = svcWith({ createTransferRequest });
    const out = await svc.requestBranchTransfer(ctx, 'b1', goodInput);
    expect(out).toMatchObject({ id: 'req-1', status: 'requested', executed: false });
    const [branchId, value, actorId] = createTransferRequest.mock.calls[0];
    expect(branchId).toBe('b1');
    expect(value.destinationTenantId).toBe('t2');
    expect(actorId).toBe('admin-1');
  });

  it('options 404s when branch missing; preflight maps errors', async () => {
    const opt = svcWith({ transferOptions: vi.fn().mockResolvedValue(null) });
    await expect(opt.branchTransferOptions('bX')).rejects.toMatchObject({ code: 'not_found' });
    const pf = svcWith({ transferPreflight: vi.fn().mockResolvedValue({ ok: false, code: 'invalid', message: 'The destination tenant must be different from the current tenant.' }) });
    await expect(pf.branchTransferPreflight('b1', 't1')).rejects.toMatchObject({ code: 'invalid' });
  });
});
