// booking-code-rules — extras TEXT MESSAGING SETUP 12: the self-test runs the live rule functions; a broken rule is caught.
import { describe, it, expect } from 'vitest';
import { generateOtp, isWellFormedOtp, decideVerify, canResend } from '@aipowersalon/customers';
import { bookingCodeSelfTest, BOOKING_CODE_RULES } from './booking-code-rules';

describe('booking code self-test', () => {
  it('passes against the real rules and states them', () => {
    expect(bookingCodeSelfTest()).toEqual({ passed: true, failed: [], probes: 8 });
    expect(BOOKING_CODE_RULES).toMatchObject({ codeDigits: 6, codeTtlSeconds: 600, maxAttempts: 5, resendCooldownSeconds: 60 });
  });
  it('catches a rule that stopped working (expiry ignored, codes too short, no cooldown) — never a false pass', () => {
    const broken = {
      generateOtp: () => '12345', isWellFormedOtp,
      decideVerify: (s: Parameters<typeof decideVerify>[0], m: boolean, now?: number) => decideVerify(s ? { ...s, expiresAt: Number.MAX_SAFE_INTEGER } : s, m, now),
      canResend: () => ({ allowed: true, retryAfterSeconds: 0 }),
    };
    const r = bookingCodeSelfTest(Date.now(), broken);
    expect(r.passed).toBe(false);
    expect(r.failed).toEqual(['six_digit_codes', 'expires', 'resend_cooldown']);
    expect(bookingCodeSelfTest(Date.now(), { generateOtp, isWellFormedOtp, decideVerify, canResend }).passed).toBe(true);
  });
});
