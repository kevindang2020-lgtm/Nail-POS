// booking-code-rules.ts — extras TEXT MESSAGING SETUP 12 "Booking Code Health Test" (Nov 12 2026).
// A SAFE self-test of the booking-code rules: it runs the very functions the live verification path imports from
// customer-activation-core (generateOtp, isWellFormedOtp, decideVerify, canResend) against fixed, made-up
// states — never a real customer, never the database, never the provider. NO code is sent and nothing is stored.
// The provider half (account, Verify Service / sender, recent errors) is the rest of the booking-verification health check.
// The per-device / per-IP hourly caps are counted in the request path itself (booking-verification.service.ts) against the
// same constants; they are stated here, not re-implemented.
import {
  generateOtp, isWellFormedOtp, decideVerify, canResend,
  OTP_TTL_SECONDS, OTP_MAX_ATTEMPTS, RESEND_COOLDOWN_SECONDS, MAX_CODES_PER_IP_HOUR, MAX_CODES_PER_DEVICE_HOUR,
} from '@aipowersalon/customers';

export interface BookingCodeRules {
  codeDigits: number; codeTtlSeconds: number; maxAttempts: number; resendCooldownSeconds: number; maxCodesPerDeviceHour: number; maxCodesPerIpHour: number;
}
export const BOOKING_CODE_RULES: BookingCodeRules = {
  codeDigits: 6, codeTtlSeconds: OTP_TTL_SECONDS, maxAttempts: OTP_MAX_ATTEMPTS, resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
  maxCodesPerDeviceHour: MAX_CODES_PER_DEVICE_HOUR, maxCodesPerIpHour: MAX_CODES_PER_IP_HOUR,
};

/** Each probe names the rule and whether the live function behaved as the rule says. `fns` is injectable for the test. */
export function bookingCodeSelfTest(now = Date.now(), fns = { generateOtp, isWellFormedOtp, decideVerify, canResend }): { passed: boolean; failed: string[]; probes: number } {
  const failed: string[] = [];
  const probe = (name: string, ok: boolean) => { if (!ok) failed.push(name); };
  const codes = Array.from({ length: 20 }, () => fns.generateOtp());
  probe('six_digit_codes', codes.every((c) => /^\d{6}$/.test(c) && fns.isWellFormedOtp(c)));
  probe('malformed_code_refused', !fns.isWellFormedOtp('12345') && !fns.isWellFormedOtp('1234567') && !fns.isWellFormedOtp('12a456'));
  const fresh = { attempts: 0, expiresAt: now + OTP_TTL_SECONDS * 1000, consumed: false, createdAt: now };
  probe('right_code_accepted', fns.decideVerify(fresh, true, now).ok === true);
  const reason = (s: typeof fresh, match: boolean, at = now) => { const d = fns.decideVerify(s, match, at); return d.ok ? 'ok' : (d as { reason: string }).reason; };
  probe('wrong_code_refused', reason(fresh, false) === 'incorrect');
  probe('expires', reason(fresh, true, now + OTP_TTL_SECONDS * 1000 + 1) === 'expired');
  probe('attempt_limit', reason({ ...fresh, attempts: OTP_MAX_ATTEMPTS }, true) === 'too_many_attempts');
  probe('one_time_use', reason({ ...fresh, consumed: true }, true) === 'already_used');
  probe('resend_cooldown', !fns.canResend(now, now).allowed && fns.canResend(now - RESEND_COOLDOWN_SECONDS * 1000, now).allowed);
  return { passed: failed.length === 0, failed, probes: 8 };
}
