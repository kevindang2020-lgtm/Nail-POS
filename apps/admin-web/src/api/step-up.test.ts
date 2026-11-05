// Constitution 7 §8 — the client prompts for a step-up on 403 STEP_UP_REQUIRED and retries the action exactly once.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './client';
import { setStepUpHandler } from './step-up';

const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as any;
describe('step-up retry', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); setStepUpHandler(null); });

  it('403 STEP_UP_REQUIRED → the handler is asked → the SAME request is retried once and succeeds', async () => {
    (fetch as any).mockResolvedValueOnce(res(403, { code: 'STEP_UP_REQUIRED', message: 'x' })).mockResolvedValueOnce(res(200, { ok: true }));
    const handler = vi.fn().mockResolvedValue(true); setStepUpHandler(handler);
    expect(await api.post('/super-admin/platform-staff/u2/role', { platformRole: 'PLATFORM_FINANCE', reason: 'moved to finance' })).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect((fetch as any).mock.calls).toHaveLength(2);
    expect((fetch as any).mock.calls[1][0]).toBe((fetch as any).mock.calls[0][0]);
  });
  it('a cancelled prompt leaves the action refused with the server\'s message (no retry)', async () => {
    (fetch as any).mockResolvedValueOnce(res(403, { code: 'STEP_UP_REQUIRED', message: 'This action needs you to confirm' }));
    setStepUpHandler(vi.fn().mockResolvedValue(false));
    await expect(api.post('/super-admin/tenants/t1/status', { status: 'suspended' })).rejects.toThrow(/confirm/);
    expect((fetch as any).mock.calls).toHaveLength(1);
  });
  it('never loops: a second STEP_UP_REQUIRED after the retry reaches the screen', async () => {
    (fetch as any).mockResolvedValue(res(403, { code: 'STEP_UP_REQUIRED', message: 'still required' }));
    const handler = vi.fn().mockResolvedValue(true); setStepUpHandler(handler);
    await expect(api.post('/x', {})).rejects.toThrow(/still required/);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((fetch as any).mock.calls).toHaveLength(2);
  });
  it('an ordinary 403 does not open the prompt', async () => {
    (fetch as any).mockResolvedValueOnce(res(403, { message: 'Missing permission: super_admin.billing.manage' }));
    const handler = vi.fn(); setStepUpHandler(handler);
    await expect(api.post('/x', {})).rejects.toThrow(/Missing permission/);
    expect(handler).not.toHaveBeenCalled();
  });
});
