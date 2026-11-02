// password-reset-roles.vitest.spec.ts — who can get back in, and who must never.
//
// This is a security allowlist. It decides who can take over an account with a salon code, a phone number, and a
// six-digit SMS code. Every entry on it, and every absence from it, is a decision — so both are pinned here.
import { describe, it, expect } from 'vitest';
import { isResetAllowedRole, RESET_ALLOWED_ROLES, GENERIC_RESET_MESSAGE } from './password-reset-core';

describe('who may reset their own password', () => {
  it('the salon staff who run the business', () => {
    expect(isResetAllowedRole('OWNER')).toBe(true);
    expect(isResetAllowedRole('MANAGER')).toBe(true);
    expect(isResetAllowedRole('FRONT_DESK')).toBe(true);
    expect(isResetAllowedRole('RECEPTION')).toBe(true);
  });

  it('AND THE TECHNICIAN — she was excluded, while her app showed her a button that lied', () => {
    // tech-web/LoginScreen.tsx calls requestPasswordReset(). With TECHNICIAN off this list the server returned
    // "we sent temporary login instructions to the phone number on file" and sent NOTHING, forever. The POS had
    // no way for a manager to reset her either. She was locked out permanently — and since her password now spans
    // every salon she works at (auth/password-scope.ts), that is every job she has.
    //
    // The bar she has to pass is identical to an owner's: the salon code, the phone on the account, and physical
    // receipt of the SMS. Her account is strictly LESS privileged than an owner's. Allowing it is safer than the
    // status quo, not looser.
    expect(isResetAllowedRole('TECHNICIAN')).toBe(true);
  });

  it('NEVER a SUPER_ADMIN — an SMS code must not be able to take the platform', () => {
    expect(isResetAllowedRole('SUPER_ADMIN')).toBe(false);
  });

  it('NEVER a CUSTOMER on this flow — customers have their own, and this one grants staff access', () => {
    expect(isResetAllowedRole('CUSTOMER')).toBe(false);
  });

  it('never an unknown or empty role — the list is an allowlist, not a denylist', () => {
    for (const r of ['', 'ADMIN', 'admin', 'owner', 'ROOT', 'undefined', 'null']) {
      expect(isResetAllowedRole(r), `${r || '(empty)'} must not be able to reset a password`).toBe(false);
    }
  });

  it('the list itself is exactly these five — a sixth must be a deliberate act, not a drift', () => {
    expect([...RESET_ALLOWED_ROLES].sort()).toEqual(
      ['FRONT_DESK', 'MANAGER', 'OWNER', 'RECEPTION', 'TECHNICIAN'],
    );
  });
});

describe('the request never leaks whether an account exists', () => {
  it('there is exactly ONE message, and it promises nothing it cannot keep', () => {
    // The UI must not upgrade this into "we sent you a code" — the server deliberately will not tell it whether
    // it did. Both new reset screens (owner-web, tech-web) say "if an account matches", not "we sent".
    expect(GENERIC_RESET_MESSAGE).toMatch(/if this account exists/i);
    expect(GENERIC_RESET_MESSAGE).not.toMatch(/\bwe have sent\b|\byour code\b/i);
  });
});
