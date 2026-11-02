// customer-password.vitest.spec.ts — Profile → Security password rules.
//
// The case that drove this: a customer who activated the app with an SMS one-time code has NO password.
// `changeOwnPasswordCore` demands the current password and throws when no hash exists — so the app's own prompt
// ("Create a password to make future sign-ins easier") led nowhere. `createOwnPasswordCore` fixes that, and the
// critical rule is that it must NOT become an account-takeover primitive: it refuses to overwrite an existing
// password, so a session alone can never silently replace a password the attacker doesn't know.
import { describe, it, expect, beforeEach } from 'vitest';
import { createOwnPasswordCore, changeOwnPasswordCore, AccountError } from '../auth/account-core';
import { hashPassword, verifyPassword } from '@aipowersalon/auth';

const USER = 'u1';

function makeDeps(initialHash: string | null) {
  const store: { hash: string | null } = { hash: initialHash };
  return {
    store,
    deps: {
      async loadPasswordHash() { return store.hash; },
      verify: verifyPassword,
      hash: hashPassword,
      async setPassword(_u: string, h: string) { store.hash = h; },
      async loadConfirmedTotpSecret() { return null; },
      matchTotpStep: () => null,
      async markTotpStepUsed() { return true; },
      now: () => Date.now(),
    },
  };
}

describe('create a FIRST password (OTP-activated customer)', () => {
  let d: ReturnType<typeof makeDeps>;
  beforeEach(() => { d = makeDeps(null); });     // no password yet — the OTP-activated case

  it('sets a password when none exists', async () => {
    await createOwnPasswordCore(d.deps, USER, { newPassword: 'Str0ng-Passphrase!', confirmPassword: 'Str0ng-Passphrase!' });
    expect(d.store.hash).toBeTruthy();
    expect(await verifyPassword('Str0ng-Passphrase!', d.store.hash!)).toBe(true);
  });

  it('stores only a HASH — never the plaintext', async () => {
    await createOwnPasswordCore(d.deps, USER, { newPassword: 'Str0ng-Passphrase!', confirmPassword: 'Str0ng-Passphrase!' });
    expect(d.store.hash).not.toContain('Str0ng-Passphrase!');
  });

  it('enforces the existing password policy (mismatch is rejected)', async () => {
    await expect(createOwnPasswordCore(d.deps, USER, { newPassword: 'Str0ng-Passphrase!', confirmPassword: 'different' }))
      .rejects.toBeInstanceOf(AccountError);
    expect(d.store.hash).toBeNull();
  });

  it('rejects a weak password via the shared policy', async () => {
    await expect(createOwnPasswordCore(d.deps, USER, { newPassword: '123', confirmPassword: '123' }))
      .rejects.toMatchObject({ code: 'policy' });
  });

  it('SECURITY: it REFUSES to overwrite an existing password — a session alone is not enough', async () => {
    const withPw = makeDeps(await hashPassword('the-real-password'));
    await expect(withPw.deps.loadPasswordHash()).resolves.toBeTruthy();

    await expect(createOwnPasswordCore(withPw.deps, USER, { newPassword: 'Attacker-Chosen-1!', confirmPassword: 'Attacker-Chosen-1!' }))
      .rejects.toMatchObject({ code: 'password_already_set' });

    // the real password is untouched — no account takeover
    expect(await verifyPassword('the-real-password', withPw.store.hash!)).toBe(true);
  });
});

describe('change an EXISTING password', () => {
  it('requires the current password', async () => {
    const d = makeDeps(await hashPassword('current-Passphrase-1!'));
    await expect(changeOwnPasswordCore(d.deps as any, USER, {
      currentPassword: 'wrong', newPassword: 'New-Passphrase-2!', confirmPassword: 'New-Passphrase-2!',
    })).rejects.toMatchObject({ code: 'invalid_current' });
  });

  it('the OLD password stops working after a successful change', async () => {
    const d = makeDeps(await hashPassword('current-Passphrase-1!'));
    await changeOwnPasswordCore(d.deps as any, USER, {
      currentPassword: 'current-Passphrase-1!', newPassword: 'New-Passphrase-2!', confirmPassword: 'New-Passphrase-2!',
    });
    expect(await verifyPassword('New-Passphrase-2!', d.store.hash!)).toBe(true);
    expect(await verifyPassword('current-Passphrase-1!', d.store.hash!)).toBe(false);
  });

  it('a customer with NO password cannot use change (they must create first)', async () => {
    const d = makeDeps(null);
    await expect(changeOwnPasswordCore(d.deps as any, USER, {
      currentPassword: '', newPassword: 'New-Passphrase-2!', confirmPassword: 'New-Passphrase-2!',
    })).rejects.toMatchObject({ code: 'not_found' });
  });
});
