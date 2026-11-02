// require-totp.test.ts — Security Deep Scan C16: the any-6-digit MFA fallback for un-enrolled accounts exists ONLY when
// NODE_ENV is exactly 'development' or 'test'. On the old rule (anything but 'production' was permissive) the staging,
// unset and mistyped cases below returned false — any 6-digit code passed MFA there, Super Admin included.
import { afterEach, describe, expect, it } from 'vitest';
import { requireRealTotpEnrollment } from './security';

const prevEnv = process.env.NODE_ENV; const prevFlag = process.env.MFA_REQUIRE_TOTP;
afterEach(() => {
  if (prevEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv;
  if (prevFlag === undefined) delete process.env.MFA_REQUIRE_TOTP; else process.env.MFA_REQUIRE_TOTP = prevFlag;
});
const withEnv = (nodeEnv: string | undefined, flag?: string) => {
  if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
  if (flag === undefined) delete process.env.MFA_REQUIRE_TOTP; else process.env.MFA_REQUIRE_TOTP = flag;
  return requireRealTotpEnrollment();
};

describe('C16 — the permissive MFA fallback fails closed outside development / test', () => {
  it.each(['staging', 'prod', 'Production', 'preview', ''])('NODE_ENV=%j requires a real enrolled factor', (v) => expect(withEnv(v)).toBe(true));
  it('an UNSET NODE_ENV requires a real enrolled factor', () => expect(withEnv(undefined)).toBe(true));
  it('production requires it', () => expect(withEnv('production')).toBe(true));
  it('development and test stay permissive (no authenticator app needed locally)', () => {
    expect(withEnv('development')).toBe(false);
    expect(withEnv('test')).toBe(false);
  });
  it('MFA_REQUIRE_TOTP=1 forces it everywhere', () => {
    expect(withEnv('development', '1')).toBe(true);
    expect(withEnv('test', '1')).toBe(true);
  });
});
