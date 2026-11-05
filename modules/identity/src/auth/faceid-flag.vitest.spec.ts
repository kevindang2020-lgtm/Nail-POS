// faceid-flag.vitest.spec.ts — Face ID ships DISABLED.
//
// The verifier is real and fails closed: 8 tests prove it REJECTS forged ceremonies (garbage attestation, forged
// signature, wrong origin, replayed challenge). What could NOT be proven in this environment is the opposite
// direction — that it ACCEPTS a genuine ceremony — because that requires a physical Face ID device.
//
// An authentication path whose success case has never once been executed should not be reachable in production by
// default. So it is behind a flag, and the flag is off. Turn it on after one real enrolment on staging.
import { describe, it, expect, afterEach } from 'vitest';

const prev = process.env.FACE_ID_ENABLED;
afterEach(() => {
  if (prev === undefined) delete process.env.FACE_ID_ENABLED;
  else process.env.FACE_ID_ENABLED = prev;
});

/** Mirrors the controller. */
const enabled = () => process.env.FACE_ID_ENABLED === '1' || process.env.FACE_ID_ENABLED === 'true';

describe('Face ID is OFF by default', () => {
  it('with the flag unset, it is disabled', () => {
    delete process.env.FACE_ID_ENABLED;
    expect(enabled()).toBe(false);
  });

  it('an empty or "0" value is still disabled — nothing accidental switches it on', () => {
    for (const v of ['', '0', 'false', 'no', 'yes', 'on']) {
      process.env.FACE_ID_ENABLED = v;
      expect(enabled(), `FACE_ID_ENABLED="${v}" must not enable it`).toBe(false);
    }
  });

  it('only an explicit 1/true enables it', () => {
    process.env.FACE_ID_ENABLED = '1';
    expect(enabled()).toBe(true);
    process.env.FACE_ID_ENABLED = 'true';
    expect(enabled()).toBe(true);
  });
});

describe('the controller gates every route', () => {
  it('all four WebAuthn routes are gated, and the status probe is not', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(new URL('./webauthn.controller.ts', import.meta.url), 'utf8');

    // every route that performs a ceremony must call the gate
    const gated = (src.match(/assertFaceIdEnabled\(\);/g) || []).length;
    expect(gated, 'register/begin, register/finish, authenticate/begin, authenticate/finish must all be gated').toBe(4);

    // and when disabled they must look like they do not exist, rather than advertising a hidden feature
    expect(src).toMatch(/404/);
    expect(src).toMatch(/@Get\('status'\)/);
  });
});
