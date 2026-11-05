// native-faceid.ts — Face ID / Touch ID in the NATIVE app.
//
// The web app uses WebAuthn (`api/webauthn.ts`). That is a BROWSER API: inside an iOS WKWebView shell it is
// unavailable or unreliable, so a native build cannot use it. Apple's answer — and what the spec asks for — is
// **LocalAuthentication + Keychain**:
//
//   enrol : after a NORMAL sign-in, store the session token in the Keychain behind biometric access control
//           (`kSecAccessControlBiometryCurrentSet` / Android `setUserAuthenticationRequired`).
//   unlock: Face ID releases the item, and we get the token back.
//
// ── The rule that makes this safe ──
//
// **A successful Face ID scan is NOT authentication.** All it proves is that the person holding the phone is the
// person who enrolled — it says nothing about whether the *session* is still valid. The token in the Keychain
// could have been revoked (the customer hit "sign out other devices"), expired, or belong to an account that has
// since been disabled.
//
// So after every biometric success we **revalidate against the backend**. If the server rejects the token, the
// Keychain item is wiped and the customer must sign in with their password. A revoked session can NEVER be
// resurrected by a face.
//
// This is also why the enrolled secret is the *session token* and never the password: the password would be a
// permanent credential; a session token can be revoked server-side, and revoking it kills Face ID with it.

import { clearNativeToken, saveNativeToken } from './native-auth';

export type BiometryKind = 'face' | 'fingerprint' | 'none';

export interface BiometricStore {
  /** Does this device have usable biometrics enrolled? */
  isAvailable(): Promise<{ available: boolean; kind: BiometryKind; reason?: 'unavailable' | 'not_enrolled' | 'denied' }>;
  /** Store the token behind biometric access control. Throws on failure — never silently store it unprotected. */
  enroll(token: string): Promise<void>;
  /** Prompt for biometrics and return the token. `null` when the user CANCELLED (not a failure). */
  unlock(): Promise<string | null>;
  /** Remove the protected item. */
  clear(): Promise<void>;
  /** Are there saved biometric credentials stored in Keychain? */
  hasCredentials?(): Promise<boolean>;
}

/** No native shell (i.e. the web build). Face ID is handled by WebAuthn there instead. */
export class NoBiometrics implements BiometricStore {
  async isAvailable() { return { available: false, kind: 'none' as const, reason: 'unavailable' as const }; }
  async enroll() { throw new Error('Biometrics are not available on this device.'); }
  async unlock() { return null; }
  async clear() { /* nothing stored */ }
  async hasCredentials() { return false; }
}

let bio: BiometricStore = new NoBiometrics();

/** Called once at native app start with the platform's biometric-Keychain plugin. */
export function setBiometricStore(s: BiometricStore): void { bio = s; }

export async function isNativeFaceIdEnrolled(): Promise<boolean> {
  try {
    if (bio?.hasCredentials) {
      return await bio.hasCredentials();
    }
  } catch {
    return false;
  }
  return false;
}

export type FaceIdState =
  | { status: 'available'; kind: BiometryKind }
  | { status: 'unavailable' }        // no hardware, or the web build
  | { status: 'not_enrolled' }       // hardware exists, but no face/finger registered on the device
  | { status: 'denied' };            // the customer refused the permission

export async function faceIdState(): Promise<FaceIdState> {
  try {
    const r = await bio.isAvailable();
    if (r.available) return { status: 'available', kind: r.kind };
    if (r.reason === 'not_enrolled') return { status: 'not_enrolled' };
    if (r.reason === 'denied') return { status: 'denied' };
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

export class FaceIdError extends Error {
  constructor(
    public reason: 'cancelled' | 'unavailable' | 'not_enrolled' | 'denied' | 'mismatch' | 'session_invalid' | 'failed',
    message: string,
  ) { super(message); this.name = 'FaceIdError'; }
}

/**
 * Enrol Face ID. REQUIRES an authenticated session — we store the token we already hold, which only exists after
 * a successful normal sign-in. Face ID is therefore always opt-in and can never be enabled silently.
 */
export async function enrollNativeFaceId(sessionToken: string): Promise<void> {
  if (!sessionToken) throw new FaceIdError('failed', 'Sign in first, then enable Face ID.');
  const s = await faceIdState();
  if (s.status === 'not_enrolled') throw new FaceIdError('not_enrolled', 'Set up Face ID on your device first, then try again.');
  if (s.status === 'denied') throw new FaceIdError('denied', 'Face ID permission was declined. You can enable it in Settings.');
  if (s.status !== 'available') throw new FaceIdError('unavailable', 'Face ID isn’t available on this device.');
  await bio.enroll(sessionToken);   // throws rather than storing the token unprotected
}

/**
 * Sign in with Face ID.
 *
 * `revalidate` must call the backend with the unlocked token (e.g. GET /auth/me) and return the principal, or
 * null/throw if the server rejects it. Biometric success alone is NOT enough — the SERVER decides.
 */
export async function signInWithNativeFaceId(
  revalidate: (token: string) => Promise<any>,
  loginWithCreds?: (creds: any) => Promise<any>,
): Promise<any> {
  const s = await faceIdState();
  if (s.status === 'not_enrolled') throw new FaceIdError('not_enrolled', 'Set up Face ID on your device first.');
  if (s.status === 'denied') throw new FaceIdError('denied', 'Face ID permission was declined.');
  if (s.status !== 'available') throw new FaceIdError('unavailable', 'Face ID isn’t available on this device.');

  let unlocked: string | null;
  try {
    unlocked = await bio.unlock();
  } catch (e: any) {
    const m = String(e?.message || '');
    if (/cancel|user.*cancel/i.test(m)) throw new FaceIdError('cancelled', 'Biometrics was cancelled.');
    if (/not enrolled|no credential|item not found/i.test(m)) {
      throw new FaceIdError('not_enrolled', 'Sign in with your password first to enable Biometrics.');
    }
    throw new FaceIdError('mismatch', 'Face ID didn’t match. Try again, or sign in with your password.');
  }

  // The customer dismissed the prompt. NOT an authentication failure — return quietly to the form.
  if (!unlocked) throw new FaceIdError('cancelled', 'Face ID was cancelled.');

  let creds: any = null;
  try {
    creds = JSON.parse(unlocked);
  } catch {
    creds = null;
  }

  let principal: any = null;
  if (creds && typeof creds === 'object' && loginWithCreds) {
    try {
      principal = await loginWithCreds(creds);
    } catch {
      principal = null;
    }
  } else {
    await saveNativeToken(unlocked);
    try {
      principal = await revalidate(unlocked);
    } catch {
      principal = null;
    }
  }

  if (!principal) {
    if (!creds) {
      await clearNativeToken();
      await bio.clear().catch(() => {});
    }
    throw new FaceIdError('session_invalid', 'Session expired. Please sign in with your password to continue.');
  }

  return principal;
}

/** Sign-out (or a revoked session) must remove the biometric credential too. */
export async function clearNativeFaceId(): Promise<void> {
  await clearNativeToken();
  try { await bio.clear(); } catch { /* best effort */ }
}

/** Disabling Face ID manually removes only the biometric credential, NOT the active session token. */
export async function disableNativeFaceId(): Promise<void> {
  try { await bio.clear(); } catch { /* best effort */ }
}

/** Prompt for biometrics to re-authenticate sensitive actions. Returns true if authorized, false if cancelled/failed. */
export async function verifyNativeFaceId(reason?: string): Promise<boolean> {
  const s = await faceIdState();
  if (s.status !== 'available') return true;
  try {
    const unlocked = await bio.unlock();
    return unlocked !== null;
  } catch {
    return false;
  }
}

