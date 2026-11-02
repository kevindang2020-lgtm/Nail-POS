// webauthn-wiring.vitest.spec.ts — Face ID must never silently mint an UNREVOCABLE session.
//
// The Face ID module injects the SessionStore optionally. That is right for a no-database dev run — but if the DI
// token ever fails to resolve in production, the store would be `undefined`, the minted token would carry no
// `sid`, and the resulting biometric session could NEVER be revoked. You could not kill it when the device is
// lost, which is the single most likely reason you would need to.
//
// This codebase has been bitten by exactly this shape repeatedly (a security control that quietly disables
// itself and leaves every test green), so the wiring fails LOUDLY instead.
import { describe, it, expect, afterEach } from 'vitest';
import { makeWebAuthnPorts } from './webauthn.kysely';

const prevUrl = process.env.DATABASE_URL;
const prevDriver = process.env.REPO_DRIVER;
afterEach(() => {
  if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl;
  if (prevDriver === undefined) delete process.env.REPO_DRIVER; else process.env.REPO_DRIVER = prevDriver;
});

const fakeDb: any = {};

describe('Face ID session wiring', () => {
  it('REFUSES to start when a database is configured but the SessionStore did not resolve', () => {
    process.env.DATABASE_URL = 'postgres://localhost/x';
    expect(() => makeWebAuthnPorts(fakeDb, undefined))
      .toThrow(/could never be revoked|refusing to start/i);
  });

  it('is fine when the store IS wired', () => {
    process.env.DATABASE_URL = 'postgres://localhost/x';
    const store: any = { async create() { return 'sid-1'; }, async isRevoked() { return false; }, async revoke() {} };
    expect(() => makeWebAuthnPorts(fakeDb, store)).not.toThrow();
  });

  it('is fine with NO database (dev/tests) — no store required', () => {
    delete process.env.DATABASE_URL;
    delete process.env.REPO_DRIVER;
    expect(() => makeWebAuthnPorts(null as any, undefined)).not.toThrow();
  });

  it('binds a cryptographic RNG (a predictable challenge would defeat the whole ceremony)', () => {
    delete process.env.DATABASE_URL;
    const ports = makeWebAuthnPorts(null as any, undefined);
    const a = ports.rng.bytes(32);
    const b = ports.rng.bytes(32);
    expect(a).toHaveLength(32);
    expect(a).not.toEqual(b);                       // not a fixed/stubbed value
    expect(ports.rng.token()).not.toBe(ports.rng.token());
  });
});
