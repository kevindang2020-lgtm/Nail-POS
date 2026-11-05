// account-core.vitest.spec.ts — gate matrix for changeOwnPasswordCore: current-password verify, shared policy,
// step-up TOTP when a confirmed factor exists (incl. monotonic replay rejection), and that ONLY the new hash is stored.
import { describe, it, expect } from 'vitest';
import { changeOwnPasswordCore, AccountError, type ChangePasswordDeps } from './account-core';

function fakes(opts: { storedHash?: string | null; totpSecret?: string | null; matchStep?: number | null; markUsed?: boolean } = {}) {
  const calls: { setPassword: string[]; marked: number[] } = { setPassword: [], marked: [] };
  const d: ChangePasswordDeps = {
    loadPasswordHash: async () => (opts.storedHash === undefined ? 'scrypt$stored' : opts.storedHash),
    verify: async (plain, hash) => hash === 'scrypt$stored' && plain === 'Current-Pass-1',
    hash: async (plain) => 'scrypt$' + plain,
    setPassword: async (_id, hash) => { calls.setPassword.push(hash); },
    loadConfirmedTotpSecret: async () => opts.totpSecret ?? null,
    matchTotpStep: () => (opts.matchStep === undefined ? null : opts.matchStep),
    markTotpStepUsed: async (_id, step) => { calls.marked.push(step); return opts.markUsed ?? true; },
    now: () => 1_700_000_000_000,
  };
  return { d, calls };
}
const code = async (p: Promise<unknown>) => p.then(() => null, (e) => (e instanceof AccountError ? e.code : 'other'));
const input = (over: Partial<{ currentPassword: string; newPassword: string; confirmPassword: string; mfaCode?: string }> = {}) => ({
  currentPassword: 'Current-Pass-1', newPassword: 'Brand-New-Pass-9', confirmPassword: 'Brand-New-Pass-9', ...over,
});

describe('changeOwnPasswordCore', () => {
  it('rejects a wrong current password (and never stores anything)', async () => {
    const { d, calls } = fakes();
    expect(await code(changeOwnPasswordCore(d, 'u1', input({ currentPassword: 'nope' })))).toBe('invalid_current');
    expect(calls.setPassword).toHaveLength(0);
  });

  it('enforces the shared policy: short, mismatch, and same-as-current all fail with policy', async () => {
    const { d } = fakes();
    expect(await code(changeOwnPasswordCore(d, 'u1', input({ newPassword: 'short1', confirmPassword: 'short1' })))).toBe('policy');
    expect(await code(changeOwnPasswordCore(d, 'u1', input({ confirmPassword: 'Different-Pass-9' })))).toBe('policy');
    expect(await code(changeOwnPasswordCore(d, 'u1', input({ newPassword: 'Current-Pass-1', confirmPassword: 'Current-Pass-1' })))).toBe('policy');
  });

  it('without MFA: succeeds, stores ONLY the new hash, reports stepUp=password', async () => {
    const { d, calls } = fakes();
    const out = await changeOwnPasswordCore(d, 'u1', input());
    expect(out).toEqual({ ok: true, stepUp: 'password' });
    expect(calls.setPassword).toEqual(['scrypt$Brand-New-Pass-9']);
  });

  it('with a confirmed factor: a missing code is mfa_required, a wrong code is invalid_mfa', async () => {
    const noCode = fakes({ totpSecret: 'SECRET', matchStep: null });
    expect(await code(changeOwnPasswordCore(noCode.d, 'u1', input()))).toBe('mfa_required');
    expect(await code(changeOwnPasswordCore(noCode.d, 'u1', input({ mfaCode: '000000' })))).toBe('invalid_mfa');
    expect(noCode.calls.setPassword).toHaveLength(0);
  });

  it('with a confirmed factor: a live code succeeds (stepUp=password+mfa) and the step is marked used', async () => {
    const { d, calls } = fakes({ totpSecret: 'SECRET', matchStep: 56_666_666 });
    const out = await changeOwnPasswordCore(d, 'u1', input({ mfaCode: '123456' }));
    expect(out).toEqual({ ok: true, stepUp: 'password+mfa' });
    expect(calls.marked).toEqual([56_666_666]);
    expect(calls.setPassword).toEqual(['scrypt$Brand-New-Pass-9']);
  });

  it('a REPLAYED code is rejected by the monotonic guard and nothing is stored', async () => {
    const { d, calls } = fakes({ totpSecret: 'SECRET', matchStep: 56_666_666, markUsed: false });
    expect(await code(changeOwnPasswordCore(d, 'u1', input({ mfaCode: '123456' })))).toBe('replayed_mfa');
    expect(calls.setPassword).toHaveLength(0);
  });

  it('unknown account fails closed with not_found', async () => {
    const { d } = fakes({ storedHash: null });
    expect(await code(changeOwnPasswordCore(d, 'ghost', input()))).toBe('not_found');
  });
});
