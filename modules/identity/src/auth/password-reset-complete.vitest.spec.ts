// password-reset-complete.vitest.spec.ts — SCAN (Oct 12): completeReset ended with a leftover test-fake call,
// `users.findForLogin("", "")` ("in prod: load by id; fake returns the user"), whose result went out as `_user` in the
// public /auth/password-reset/complete response. In production it was always null — a dead tenant/user lookup on an
// unauthenticated route, and an undocumented field. The completion answers with the fresh session and the user id only.
import { describe, it, expect, vi } from 'vitest';
import { InMemoryEphemeralGrants } from '@aipowersalon/auth';
import { PasswordResetService, type Ports } from './password-reset.service';

describe('PasswordResetService.completeReset', () => {
  it('sets the password and answers without a leftover lookup or a `_user` field', async () => {
    const clock = { now: () => 1_000_000, iso: () => '1970-01-01T00:16:40.000Z' };
    const grants = new InMemoryEphemeralGrants(() => clock.now());
    const rst = await grants.put('password_reset_session', { tenantId: 't1', userId: 'u1', tokenId: 'tok1' }, 60_000);
    const findForLogin = vi.fn(async () => ({ user: { userId: 'someone-else' } as any, tenant: {} as any }));
    const setPasswordHash = vi.fn(async () => undefined);
    const p = {
      grants, clock,
      users: { findActiveByTenantPhone: vi.fn(), findForLogin, setPasswordHash },
      tokens: { latestUsable: async () => null, markUsedOnce: async () => true },
      hasher: { hash: async (s: string) => 'h:' + s, verify: async () => false },
      sessions: { revokeAllForUser: vi.fn(async () => undefined), create: vi.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })) },
      audit: { record: async () => undefined },
    } as unknown as Ports;
    const out: any = await new PasswordResetService(p).completeReset({ resetSessionToken: rst, newPassword: 'NewSecret99!', confirmPassword: 'NewSecret99!' });
    expect(setPasswordHash).toHaveBeenCalledWith('u1', 'h:NewSecret99!');
    // Security Deep Scan C1 (P0): a reset revokes every session and mints NONE — the person signs in (and passes MFA)
    expect(out).toMatchObject({ ok: true, mustSignIn: true, userId: 'u1' });
    expect('accessToken' in out || 'refreshToken' in out).toBe(false);
    expect((p as any).sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect((p as any).sessions.create).not.toHaveBeenCalled();
    expect(findForLogin).not.toHaveBeenCalled();
    expect('_user' in out).toBe(false);
  });
});
