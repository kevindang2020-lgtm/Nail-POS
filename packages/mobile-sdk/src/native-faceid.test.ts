// native-faceid.test.ts — Face ID in the NATIVE app (BUILD_PLAN Phase 13 D, Constitution 6 §37–39, audit bug 2).
//
// The design these tests pin:
//   • Face ID unlocks a long-lived DEVICE CREDENTIAL (credential id + device id + a server-issued secret) kept in the
//     biometric-guarded Keychain / Keystore item — NEVER the 15-minute access token, never the password;
//   • signing in with it asks the SERVER for a fresh session (POST /auth/biometric/login); a scan alone is nothing;
//   • the server rotates the secret on every use and the app stores the new one;
//   • a refused credential is wiped (it can never work again); a mismatch or a network error is not.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setBiometricStore, faceIdState, enrollNativeFaceId, signInWithNativeFaceId, clearNativeFaceId, disableNativeFaceId,
  nativeFaceIdEnrolled, reconcileFaceIdUser, FaceIdError, NoBiometrics, type BiometricStore, type BiometryKind,
} from './native-faceid';
import { setSecureStore, InMemorySecureStore, loadNativeToken, saveNativeToken, deviceId } from './native-auth';
import { configureMobileSdk, resetMobileSdkHttp } from './http';

/** Stands in for the platform's biometric-protected Keychain item. */
class FakeBiometrics implements BiometricStore {
  item: string | null = null;
  available = true;
  kind: BiometryKind = 'face';
  reason: 'unavailable' | 'not_enrolled' | 'denied' | undefined;
  behaviour: 'ok' | 'cancel' | 'mismatch' = 'ok';
  async isAvailable() { return { available: this.available, kind: this.kind, reason: this.reason }; }
  async enroll(secret: string) { this.item = secret; }
  async unlock() {
    if (this.behaviour === 'cancel') return null;
    if (this.behaviour === 'mismatch') throw new Error('no match');
    return this.item;
  }
  async clear() { this.item = null; }
}
const err = (status: number, code: string) => Object.assign(new Error(code), { status, code });

let bio: FakeBiometrics;
let calls: { path: string; body: any }[];
let server: (path: string, body: any) => any;
const SECRET1 = 's'.repeat(43), SECRET2 = 't'.repeat(43);

beforeEach(async () => {
  bio = new FakeBiometrics(); setBiometricStore(bio);
  setSecureStore(new InMemorySecureStore());
  calls = [];
  server = (path) => {
    if (path === '/auth/biometric/enroll') return { ok: true, credentialId: '11111111-1111-4111-8111-111111111111', secret: SECRET1, expiresAt: '2027-01-01T00:00:00Z' };
    if (path === '/auth/biometric/login') return { ok: true, outcome: 'SUCCESS', accessToken: 'access-NEW', refreshToken: 'refresh-NEW', principal: { userId: 'u1' }, nextSecret: SECRET2 };
    if (path === '/auth/biometric/revoke') return { ok: true, revoked: 1 };
    throw err(404, 'NOT_FOUND');
  };
  resetMobileSdkHttp();
  configureMobileSdk({ apiBase: () => 'https://api.example.com', http: {
    get: async () => ({}) as any,
    post: async (path: string, body?: unknown) => { calls.push({ path, body }); return server(path, body); },
  } });
  await clearNativeFaceId();
});

describe('availability states', () => {
  it('reports available / not enrolled / denied / web', async () => {
    expect(await faceIdState()).toEqual({ status: 'available', kind: 'face' });
    bio.available = false; bio.reason = 'not_enrolled'; expect((await faceIdState()).status).toBe('not_enrolled');
    bio.reason = 'denied'; expect((await faceIdState()).status).toBe('denied');
    setBiometricStore(new NoBiometrics()); expect((await faceIdState()).status).toBe('unavailable');
  });
});

describe('enrolment: a DEVICE CREDENTIAL from the server — never the access token (bug 2)', () => {
  it('asks the server (signed in) and stores credential id + device id + secret behind biometrics', async () => {
    await saveNativeToken('access-OLD');
    await enrollNativeFaceId('u1');
    expect(calls[0].path).toBe('/auth/biometric/enroll');
    expect(calls[0].body.deviceId).toBe(await deviceId());
    const item = JSON.parse(bio.item!);
    expect(item).toEqual({ v: 1, credentialId: '11111111-1111-4111-8111-111111111111', deviceId: await deviceId(), secret: SECRET1, userId: 'u1' });
    expect(bio.item).not.toContain('access-OLD');                 // THE BUG: it used to enrol the 15-minute token
    expect(await nativeFaceIdEnrolled()).toBe(true);
  });
  it('a server refusal (no recent password) stores nothing', async () => {
    server = () => { throw err(403, 'BIOMETRIC_RECENT_AUTH_REQUIRED'); };
    await expect(enrollNativeFaceId('u1')).rejects.toMatchObject({ reason: 'recent_auth' });
    expect(bio.item).toBeNull(); expect(await nativeFaceIdEnrolled()).toBe(false);
  });
  it('refuses when the device has no biometrics enrolled — before asking the server', async () => {
    bio.available = false; bio.reason = 'not_enrolled';
    await expect(enrollNativeFaceId('u1')).rejects.toMatchObject({ reason: 'not_enrolled' });
    expect(calls).toHaveLength(0);
  });
  it('if the Keychain write fails, the server credential is revoked and nothing is left behind', async () => {
    bio.enroll = async () => { throw new Error('keychain locked'); };
    await expect(enrollNativeFaceId('u1')).rejects.toBeInstanceOf(FaceIdError);
    expect(calls.map((c) => c.path)).toEqual(['/auth/biometric/enroll', '/auth/biometric/revoke']);
  });
});

describe('sign-in: the SERVER opens a fresh session; the secret rotates', () => {
  it('scan → POST /auth/biometric/login → tokens saved, the rotated secret stored', async () => {
    await enrollNativeFaceId('u1');
    const body = await signInWithNativeFaceId();
    expect(calls[1]).toEqual({ path: '/auth/biometric/login', body: { credentialId: '11111111-1111-4111-8111-111111111111', deviceId: await deviceId(), secret: SECRET1 } });
    expect(body.principal.userId).toBe('u1');
    expect(await loadNativeToken()).toBe('access-NEW');
    expect(JSON.parse(bio.item!).secret).toBe(SECRET2);
  });
  it('a refused credential (revoked, reused, password changed, access changed) is WIPED', async () => {
    for (const code of ['BIOMETRIC_CREDENTIAL_INVALID', 'BIOMETRIC_CREDENTIAL_REUSED', 'SESSION_ENDED', 'POLICY_PASSKEYS_OFF']) {
      await enrollNativeFaceId('u1');
      server = (p) => { if (p === '/auth/biometric/login') throw err(code === 'POLICY_PASSKEYS_OFF' ? 403 : 401, code); return { ok: true, credentialId: '11111111-1111-4111-8111-111111111111', secret: SECRET1 }; };
      await expect(signInWithNativeFaceId()).rejects.toMatchObject({ reason: 'session_invalid' });
      expect(bio.item).toBeNull(); expect(await nativeFaceIdEnrolled()).toBe(false);
    }
  });
  it('a network error keeps the credential (nothing was refused)', async () => {
    await enrollNativeFaceId('u1');
    server = (p) => { if (p === '/auth/biometric/login') throw err(0, 'NETWORK_ERROR'); return {}; };
    await expect(signInWithNativeFaceId()).rejects.toMatchObject({ reason: 'failed' });
    expect(bio.item).not.toBeNull();
  });
  it('cancelling the prompt is not a failure; a mismatch does not wipe the enrolment', async () => {
    await enrollNativeFaceId('u1');
    bio.behaviour = 'cancel'; await expect(signInWithNativeFaceId()).rejects.toMatchObject({ reason: 'cancelled' });
    bio.behaviour = 'mismatch'; await expect(signInWithNativeFaceId()).rejects.toMatchObject({ reason: 'mismatch' });
    expect(bio.item).not.toBeNull();
    expect(calls.filter((c) => c.path === '/auth/biometric/login')).toHaveLength(0);   // no scan → no request
  });
  it('a legacy item (the old enrolled access token) is not a credential — wiped, password needed', async () => {
    bio.item = 'eyJhbGciOiJIUzI1NiJ9.legacy.token';
    await expect(signInWithNativeFaceId()).rejects.toMatchObject({ reason: 'session_invalid' });
    expect(bio.item).toBeNull();
  });
});

describe('sign-out / 401 / account switch clear it', () => {
  it('clearNativeFaceId removes the item, the marker and the session token', async () => {
    await enrollNativeFaceId('u1'); await saveNativeToken('x');
    await clearNativeFaceId();
    expect(bio.item).toBeNull(); expect(await nativeFaceIdEnrolled()).toBe(false); expect(await loadNativeToken()).toBeNull();
  });
  it('disableNativeFaceId tells the server and removes the item, keeping the session', async () => {
    await enrollNativeFaceId('u1'); await saveNativeToken('x');
    await disableNativeFaceId();
    expect(calls[calls.length - 1].path).toBe('/auth/biometric/revoke');
    expect(bio.item).toBeNull(); expect(await loadNativeToken()).toBe('x');
  });
  it('a DIFFERENT person signing in on this device clears the previous person’s credential', async () => {
    await enrollNativeFaceId('u1');
    await reconcileFaceIdUser('u1'); expect(bio.item).not.toBeNull();
    await reconcileFaceIdUser('u2'); expect(bio.item).toBeNull();
  });
});
