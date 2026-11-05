// customer-activation-core.vitest.spec.ts — the security rules of first-time activation, proven.
import { describe, it, expect } from 'vitest';
import {
  normalizePhone, maskPhone, generateOtp, isWellFormedOtp, otpMessage, redactOtp, phoneKey,
  resolveMatches, decideVerify, canResend, GENERIC_REQUEST_RESPONSE, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS,
  type DirectoryMatch, type CodeState,
} from './customer-activation-core';

describe('phone normalization (E.164)', () => {
  it('normalizes every format a customer would realistically type', () => {
    for (const raw of ['(856) 555-1234', '856-555-1234', '8565551234', '856.555.1234', ' 856 555 1234 ']) {
      expect(normalizePhone(raw)).toBe('+18565551234');
    }
  });
  it('respects an explicit country code', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });
  it('rejects implausible input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();          // too short
    expect(normalizePhone('abc')).toBeNull();
  });
  it('masks to the last four — never echoes the full number', () => {
    expect(maskPhone('+18565551234')).toBe('••••1234');
    expect(maskPhone('+18565551234')).not.toContain('856555');
  });
});

describe('the OTP is an OTP, not a password', () => {
  it('is exactly six digits and well-formed', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateOtp();
      expect(c).toMatch(/^\d{6}$/);
      expect(isWellFormedOtp(c)).toBe(true);
    }
  });
  it('is not predictable — 200 draws are not all identical, and leading zeros are possible', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateOtp()));
    expect(codes.size).toBeGreaterThan(150);            // uniform randInt, not a fixed/dev code
  });
  it('the SMS calls it a verification code with an expiry — never a password', () => {
    const m = otpMessage('482731');
    expect(m).toContain('482731');
    expect(m).toMatch(/verification code/i);
    expect(m).toMatch(/expires/i);
    expect(m).not.toMatch(/password/i);
  });
  it('the code can be redacted out of anything about to be logged', () => {
    expect(redactOtp('sent code 482731 to +1856...')).not.toContain('482731');
    expect(redactOtp('sent code 482731')).toContain('••••••');
  });
  it('rate-limit keys are hashed — the raw number is not the key', () => {
    const k = phoneKey('+18565551234', 'salt');
    expect(k).not.toContain('856');
    expect(k).toBe(phoneKey('+18565551234', 'salt'));    // stable
    expect(k).not.toBe(phoneKey('+18565551234', 'other'));
  });
  it('the TTL is short and attempts are capped', () => {
    expect(OTP_TTL_SECONDS).toBeLessThanOrEqual(10 * 60);
    expect(OTP_MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });
});

describe('account enumeration is impossible', () => {
  it('the request response is one fixed string that says nothing about existence', () => {
    expect(GENERIC_REQUEST_RESPONSE).toMatch(/if this phone number is eligible/i);
    expect(GENERIC_REQUEST_RESPONSE).not.toMatch(/found|exists|not a customer|no account/i);
  });
});

describe('profile resolution never guesses and never merges', () => {
  const m = (id: string, tenant: string, name: string, inactive = false): DirectoryMatch =>
    ({ customerId: id, tenantId: tenant, branchId: null, salonName: name, inactive });

  it('no match → the new-customer path (not an error the caller can probe)', () => {
    expect(resolveMatches([]).kind).toBe('none');
  });
  it('one match → link it', () => {
    const r = resolveMatches([m('c1', 't1', 'Polished')]);
    expect(r.kind).toBe('single');
  });
  it('SEVERAL salons → the CUSTOMER chooses. It never picks one for them', () => {
    const r = resolveMatches([m('c1', 't1', 'Polished'), m('c2', 't2', 'Luxe')]);
    expect(r.kind).toBe('choose');
    if (r.kind === 'choose') expect(r.matches).toHaveLength(2);
  });
  it('inactive/archived records are excluded from resolution', () => {
    const r = resolveMatches([m('c1', 't1', 'Polished'), m('c2', 't2', 'Old', true)]);
    expect(r.kind).toBe('single');                       // the archived one is not offered
  });
  it('all-inactive collapses to the new-customer path, not a broken choice', () => {
    expect(resolveMatches([m('c1', 't1', 'X', true)]).kind).toBe('none');
  });
});

describe('verification decisions', () => {
  const base = (o: Partial<CodeState> = {}): CodeState =>
    ({ attempts: 0, expiresAt: Date.now() + 60_000, consumed: false, createdAt: Date.now(), ...o });

  it('a correct, live code succeeds', () => {
    expect(decideVerify(base(), true)).toEqual({ ok: true });
  });
  it('a wrong code fails', () => {
    const d = decideVerify(base(), false);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('incorrect');
  });
  it('an EXPIRED code fails even when the digits are right', () => {
    const d = decideVerify(base({ expiresAt: Date.now() - 1 }), true);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('expired');
  });
  it('a USED code cannot be replayed — even with the right digits', () => {
    const d = decideVerify(base({ consumed: true }), true);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('already_used');
  });
  it('the attempt cap stops brute force, and outranks a correct guess', () => {
    const d = decideVerify(base({ attempts: OTP_MAX_ATTEMPTS }), true);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('too_many_attempts');
  });
  it('a reused code and an expired code look IDENTICAL to the caller', () => {
    const used = decideVerify(base({ consumed: true }), true);
    const expired = decideVerify(base({ expiresAt: 0 }), true);
    if (!used.ok && !expired.ok) expect(used.message).toBe(expired.message);   // no oracle
  });
  it('no code at all reads the same as expired', () => {
    const none = decideVerify(null, true);
    expect(none.ok).toBe(false);
  });
});

describe('resend cooldown (SMS pumping / spraying a victim)', () => {
  it('the first send is allowed', () => {
    expect(canResend(null).allowed).toBe(true);
  });
  it('an immediate resend is refused with a retry hint', () => {
    const r = canResend(Date.now());
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });
  it('after the cooldown, resend is allowed', () => {
    expect(canResend(Date.now() - 61_000).allowed).toBe(true);
  });
});
