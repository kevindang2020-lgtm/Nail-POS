// native-faceid.test.ts — Face ID in the NATIVE app.
//
// The rule everything here defends: **a successful Face ID scan is NOT authentication.** It proves who is holding
// the phone; it proves nothing about whether the SESSION is still valid. The token in the Keychain may have been
// revoked ("sign out other devices"), expired, or belong to an account since disabled.
//
// So after every biometric success the token is revalidated against the backend, and if the server refuses it the
// credential is wiped. A revoked session can never be resurrected by a face.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setBiometricStore, faceIdState, enrollNativeFaceId, signInWithNativeFaceId, clearNativeFaceId,
  FaceIdError, NoBiometrics, type BiometricStore, type BiometryKind,
} from './native-faceid';
import { setSecureStore, InMemorySecureStore, loadNativeToken } from './native-auth';

/** Stands in for the platform's biometric-protected Keychain item. */
class FakeBiometrics implements BiometricStore {
  item: string | null = null;
  available = true;
  kind: BiometryKind = 'face';
  reason: 'unavailable' | 'not_enrolled' | 'denied' | undefined;
  /** what unlock() does: 'ok' | 'cancel' | 'mismatch' */
  behaviour: 'ok' | 'cancel' | 'mismatch' = 'ok';

  async isAvailable() { return { available: this.available, kind: this.kind, reason: this.reason }; }
  async enroll(token: string) { this.item = token; }
  async unlock() {
    if (this.behaviour === 'cancel') return null;               // the user dismissed the prompt
    if (this.behaviour === 'mismatch') throw new Error('no match');
    return this.item;
  }
  async clear() { this.item = null; }
}

let bio: FakeBiometrics;
beforeEach(async () => {
  bio = new FakeBiometrics();
  setBiometricStore(bio);
  setSecureStore(new InMemorySecureStore());
  await clearNativeFaceId();
});

describe('availability states', () => {
  it('reports available when the device has biometrics enrolled', async () => {
    expect(await faceIdState()).toEqual({ status: 'available', kind: 'face' });
  });

  it('distinguishes NOT ENROLLED from unavailable — the customer can fix one of these', async () => {
    bio.available = false; bio.reason = 'not_enrolled';
    expect((await faceIdState()).status).toBe('not_enrolled');
  });

  it('distinguishes DENIED permission', async () => {
    bio.available = false; bio.reason = 'denied';
    expect((await faceIdState()).status).toBe('denied');
  });

  it('the WEB build has no native biometrics (it uses WebAuthn instead)', async () => {
    setBiometricStore(new NoBiometrics());
    expect((await faceIdState()).status).toBe('unavailable');
  });
});

describe('enrolment is opt-in and requires a real session', () => {
  it('stores the SESSION TOKEN behind biometrics — never the password', async () => {
    await enrollNativeFaceId('tok-123');
    expect(bio.item).toBe('tok-123');
    // a session token can be revoked server-side; a password could not.
  });

  it('refuses to enrol with no session — Face ID can never be enabled silently', async () => {
    await expect(enrollNativeFaceId('')).rejects.toBeInstanceOf(FaceIdError);
    expect(bio.item).toBeNull();
  });

  it('refuses when the device has no biometrics enrolled, and says so usefully', async () => {
    bio.available = false; bio.reason = 'not_enrolled';
    await expect(enrollNativeFaceId('tok-123')).rejects.toMatchObject({ reason: 'not_enrolled' });
    expect(bio.item).toBeNull();
  });

  it('never stores the token UNPROTECTED when enrolment fails', async () => {
    const failing: BiometricStore = {
      async isAvailable() { return { available: true, kind: 'face' as const }; },
      async enroll() { throw new Error('keychain refused'); },
      async unlock() { return null; },
      async clear() {},
    };
    setBiometricStore(failing);
    await expect(enrollNativeFaceId('tok-123')).rejects.toBeTruthy();
  });
});

describe('sign-in: the SERVER decides, not the face', () => {
  it('a successful scan + a VALID session signs the customer in', async () => {
    await enrollNativeFaceId('tok-123');
    const revalidate = vi.fn(async () => ({ userId: 'u1', role: 'CUSTOMER' }));

    const principal = await signInWithNativeFaceId(revalidate);

    expect(revalidate).toHaveBeenCalledWith('tok-123');          // the server was actually asked
    expect(principal.role).toBe('CUSTOMER');
    expect(await loadNativeToken()).toBe('tok-123');
  });

  it('THE RULE: a REVOKED session is not resurrected by a face — and the credential is WIPED', async () => {
    await enrollNativeFaceId('tok-revoked');
    // the customer hit "sign out other devices"; the server now refuses this token
    const revalidate = vi.fn(async () => null);

    await expect(signInWithNativeFaceId(revalidate)).rejects.toMatchObject({ reason: 'session_invalid' });

    expect(bio.item).toBeNull();                                 // wiped from the Keychain…
    expect(await loadNativeToken()).toBeNull();                  // …and from memory
    // otherwise Face ID would prompt forever and fail every time, and a dead token would linger on the device.
  });

  it('a server ERROR during revalidation is treated as invalid, not as success', async () => {
    await enrollNativeFaceId('tok-123');
    const revalidate = vi.fn(async () => { throw new Error('500'); });
    await expect(signInWithNativeFaceId(revalidate)).rejects.toMatchObject({ reason: 'session_invalid' });
  });

  it('CANCELLING the prompt is not an authentication failure', async () => {
    await enrollNativeFaceId('tok-123');
    bio.behaviour = 'cancel';
    const revalidate = vi.fn();

    await expect(signInWithNativeFaceId(revalidate)).rejects.toMatchObject({ reason: 'cancelled' });

    expect(revalidate).not.toHaveBeenCalled();
    expect(bio.item).toBe('tok-123');                            // the enrolment survives — they can try again
  });

  it('a biometric MISMATCH fails but does NOT wipe the enrolment (the real owner can retry)', async () => {
    await enrollNativeFaceId('tok-123');
    bio.behaviour = 'mismatch';

    await expect(signInWithNativeFaceId(vi.fn())).rejects.toMatchObject({ reason: 'mismatch' });
    expect(bio.item).toBe('tok-123');
  });

  it('one device user cannot open another customer\'s account: the token is the identity, and the SERVER checks it', async () => {
    await enrollNativeFaceId('tok-customer-A');
    // the server resolves the principal FROM THE TOKEN — the app cannot ask to be someone else.
    const revalidate = vi.fn(async (t: string) => (t === 'tok-customer-A' ? { userId: 'A' } : null));
    const p = await signInWithNativeFaceId(revalidate);
    expect(p.userId).toBe('A');
    expect(revalidate).toHaveBeenCalledWith('tok-customer-A');
  });
});

describe('sign-out', () => {
  it('removes the biometric credential from the device', async () => {
    await enrollNativeFaceId('tok-123');
    await clearNativeFaceId();
    expect(bio.item).toBeNull();
    expect(await loadNativeToken()).toBeNull();
  });
});
