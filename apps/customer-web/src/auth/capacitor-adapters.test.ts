// capacitor-adapters.test.ts — the concrete native stores.
//
// Two properties matter more than the plumbing:
//
//   1. **The WEB build gains nothing.** No plugins resolve, no stores are installed, no token is ever held. The
//      web keeps the httpOnly cookie, which is stronger — the token never enters JavaScript, so XSS cannot steal
//      it. A native code path leaking into the web build would quietly undo that.
//   2. **Nothing fails open.** A missing plugin, a locked Keychain, or a plugin error must never produce a
//      "biometrics available" or a silently-unprotected token.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapacitorSecureStore, CapacitorBiometrics, toBiometryKind, isNativePlatform, makeSecureStore, makeBiometrics } from './capacitor-adapters';
import { initNative } from './native-bootstrap';

beforeEach(() => { delete (globalThis as any).Capacitor; });

describe('the WEB build gains nothing', () => {
  it('is not a native platform', () => {
    expect(isNativePlatform()).toBe(false);
  });

  it('installs NO native store on the web — even though the plugin is bundled into the web build', () => {
    // Once the plugin is a real dependency it ships in the web bundle too. Resolving is therefore NOT the test;
    // the platform gate is. A browser must never be handed a "secure store" backed by native APIs that do not
    // exist there — and must never hold a token at all, since its httpOnly cookie is the stronger option.
    expect(makeSecureStore()).toBeNull();
    expect(makeBiometrics()).toBeNull();
  });

  it('initNative() is a no-op on the web', () => {
    expect(initNative()).toEqual({ native: false, secureStorage: false, biometrics: false });
  });

  it('a native shell WITHOUT the plugins reports the capabilities honestly — it does not pretend', () => {
    (globalThis as any).Capacitor = { isNativePlatform: () => true };
    // a native build must have an absolute API base (see below); give it one so we test the plugin path, not that
    (window as any).APS_API_BASE = 'https://api.aipowersalon.com';
    // secure storage IS installed (a real dependency); the biometric plugin is not wired here.
    const caps = initNative();
    expect(caps.native).toBe(true);
    expect(caps.biometrics).toBe(false);   // no biometric plugin → Face ID simply unavailable, honestly reported
    // → the token lives in memory for the session; it is NEVER put in localStorage instead.
    delete (window as any).APS_API_BASE;
  });
});

describe('secure storage adapter', () => {
  const api = () => ({
    get: vi.fn(async ({ key }: any) => (key === 'k' ? { value: 'tok-1' } : Promise.reject(new Error('not found')))),
    set: vi.fn(async () => ({ value: true })),
    remove: vi.fn(async () => ({ value: true })),
  });

  it('reads and writes through the plugin', async () => {
    const a = api();
    const s = new CapacitorSecureStore(a);
    await s.set('k', 'tok-1');
    expect(a.set).toHaveBeenCalledWith({ key: 'k', value: 'tok-1' });
    expect(await s.get('k')).toBe('tok-1');
  });

  it('a MISSING item reads as null, not as an error the caller must handle', async () => {
    expect(await new CapacitorSecureStore(api()).get('nope')).toBeNull();
  });

  it('a WRITE failure THROWS — it must never be mistaken for a successful store', async () => {
    const broken = { ...api(), set: vi.fn(async () => { throw new Error('keychain locked'); }) };
    await expect(new CapacitorSecureStore(broken).set('k', 'v')).rejects.toBeTruthy();
  });
});

describe('biometrics adapter — nothing fails open', () => {
  const bioApi = (over: any = {}) => ({
    isAvailable: vi.fn(async () => ({ isAvailable: true, biometryType: 'faceId' })),
    setCredentials: vi.fn(async () => {}),
    getCredentials: vi.fn(async () => ({ password: 'tok-1' })),
    deleteCredentials: vi.fn(async () => {}),
    verifyIdentity: vi.fn(async () => {}),
    ...over,
  });

  it('reports Face ID when the device has it', async () => {
    const r = await new CapacitorBiometrics(bioApi()).isAvailable();
    expect(r).toEqual({ available: true, kind: 'face' });
  });

  it('distinguishes NOT ENROLLED — something the customer can actually fix', async () => {
    const api = bioApi({ isAvailable: async () => ({ isAvailable: false, errorCode: '1' }) });
    expect(await new CapacitorBiometrics(api).isAvailable()).toMatchObject({ available: false, reason: 'not_enrolled' });
  });

  it('a plugin ERROR is UNAVAILABLE, never "available"', async () => {
    const api = bioApi({ isAvailable: async () => { throw new Error('boom'); } });
    expect(await new CapacitorBiometrics(api).isAvailable()).toMatchObject({ available: false, reason: 'unavailable' });
  });

  it('unlock returns the token after a successful scan', async () => {
    expect(await new CapacitorBiometrics(bioApi()).unlock()).toBe('tok-1');
  });

  it('a CANCELLED prompt returns null — not a failure, and the enrolment survives', async () => {
    const api = bioApi({ verifyIdentity: async () => { throw { code: '10' }; } });
    expect(await new CapacitorBiometrics(api).unlock()).toBeNull();
  });

  it('a biometric MISMATCH throws — the caller offers a retry or the password', async () => {
    const api = bioApi({ verifyIdentity: async () => { throw { code: '15', message: 'no match' }; } });
    await expect(new CapacitorBiometrics(api).unlock()).rejects.toBeTruthy();
  });

  it('enrolment stores the SESSION TOKEN, and a failure THROWS rather than storing it unprotected', async () => {
    const api = bioApi();
    await new CapacitorBiometrics(api).enroll('tok-1');
    expect(api.setCredentials).toHaveBeenCalledWith(expect.objectContaining({ password: 'tok-1' }));

    const failing = bioApi({ setCredentials: async () => { throw new Error('refused'); } });
    await expect(new CapacitorBiometrics(failing).enroll('tok-1')).rejects.toBeTruthy();
  });
});

describe('biometry kind mapping', () => {
  it('maps the plugin values', () => {
    expect(toBiometryKind('faceId')).toBe('face');
    expect(toBiometryKind('touchId')).toBe('fingerprint');
    expect(toBiometryKind('fingerprint')).toBe('fingerprint');
    expect(toBiometryKind(undefined)).toBe('none');
    expect(toBiometryKind('something-new')).toBe('none');
  });
});

// A native build with a relative API base is a DEAD app: inside the shell the origin is capacitor://localhost, so
// every request resolves to a path that does not exist. It surfaces as a generic network error on a customer's
// phone, with nothing in the build having warned you. Fail loudly, at start-up, on the developer's machine.
describe('a native build must have an absolute https API base', () => {
  it('THROWS on native when VITE_API_BASE is not set (an empty base = same-origin = capacitor://localhost)', () => {
    (globalThis as any).Capacitor = { isNativePlatform: () => true };
    // VITE_API_BASE is unset in the test env, so the resolved base is ""
    expect(() => initNative()).toThrow(/VITE_API_BASE must be an absolute https/i);
  });

  it('the WEB is unaffected — an empty base means same-origin, which is correct there', () => {
    delete (globalThis as any).Capacitor;
    expect(() => initNative()).not.toThrow();
    expect(initNative()).toEqual({ native: false, secureStorage: false, biometrics: false });
  });
});
