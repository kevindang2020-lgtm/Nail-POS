// session-lifetime.vitest.spec — Constitution 12 §23/§152 (finding M4): privileged sessions are shorter.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sessionTtlSeconds, SUPER_ADMIN_TTL_CEILING_S } from '@aipowersalon/auth';

const H = 3600;
describe('session lifetime by role', () => {
  it('SUPER_ADMIN defaults to 8 hours', () => expect(sessionTtlSeconds('SUPER_ADMIN', false, {})).toBe(8 * H));
  it('"Remember me" does NOT extend a SUPER_ADMIN session (was 30 days)', () => expect(sessionTtlSeconds('SUPER_ADMIN', true, {})).toBe(8 * H));
  it('configuration may shorten it, never lengthen it past the 12 h ceiling', () => {
    expect(sessionTtlSeconds('SUPER_ADMIN', false, { AUTH_SESSION_TTL_SUPER_ADMIN: String(2 * H) })).toBe(2 * H);
    expect(sessionTtlSeconds('SUPER_ADMIN', false, { AUTH_SESSION_TTL_SUPER_ADMIN: String(90 * 24 * H) })).toBe(SUPER_ADMIN_TTL_CEILING_S);
  });
  it('the general AUTH_SESSION_TTL cannot lengthen a SUPER_ADMIN session either', () => {
    expect(sessionTtlSeconds('SUPER_ADMIN', true, { AUTH_SESSION_TTL: String(30 * 24 * H), AUTH_SESSION_TTL_REMEMBER: String(90 * 24 * H) })).toBe(8 * H);
  });
  it('a nonsense tiny value is floored at 5 minutes, not zero', () => expect(sessionTtlSeconds('SUPER_ADMIN', false, { AUTH_SESSION_TTL_SUPER_ADMIN: '1' })).toBe(300));
  it('every other role keeps today\'s behaviour exactly: 12 h, or 30 days with remember-me', () => {
    for (const r of ['OWNER', 'MANAGER', 'FRONT_DESK', 'TECHNICIAN', 'CUSTOMER']) {
      expect(sessionTtlSeconds(r, false, {})).toBe(12 * H);
      expect(sessionTtlSeconds(r, true, {})).toBe(30 * 24 * H);
    }
  });
});

describe('wiring', () => {
  it('the session row AND the cookie both take their lifetime from sessionTtlSeconds — they can never disagree', () => {
    const src = readFileSync(join(process.cwd(), 'src/auth/auth.controller.ts'), 'utf8');
    expect(src.match(/sessionTtlSeconds\(result\.principal\?\.role/g)?.length).toBe(2);
    expect(src).not.toMatch(/AUTH_SESSION_TTL_REMEMBER/);        // no second, inline copy of the policy left behind
  });
});
