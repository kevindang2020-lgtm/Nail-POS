// native-faceid.ts — Face ID / Touch ID in the NATIVE app (BUILD_PLAN Phase 13 D, Constitution 6 §37–39, audit bug 2).
//
// The web app uses WebAuthn (webauthn.ts). Inside the iOS WKWebView that is unavailable or unreliable, so a native build
// uses LocalAuthentication + a biometric-guarded Keychain / Keystore item (capacitor-adapters.ts).
//
// ── What the item holds (Phase 13) ──
//
// A long-lived DEVICE CREDENTIAL the server issued at enrolment: { credentialId, deviceId, secret }. It used to hold the
// 15-minute ACCESS token, which made Face ID useless — it only "worked" while the session was alive anyway (bug 2).
//
//   enrol : signed in, after a recent password sign-in → POST /auth/biometric/enroll → the item stores the credential
//   unlock: Face ID releases the item → POST /auth/biometric/login → the server checks the account, the device and the
//           salon's policy and opens a FRESH session; it also ROTATES the secret, which the item stores
//
// ── The rule ──
//
// A successful scan is NOT authentication; it proves who holds the phone. The SERVER decides whether that still means a
// session. A credential it refuses (revoked, reused, password changed, access changed, Face ID switched off) is wiped and
// can never be tried again — a revoked session is never resurrected by a face. A mismatch, a cancel or a network error
// leaves it in place. Biometric data never leaves the device (§37).
import { clearNativeToken, saveNativeSession, deviceId, devicePlatform, deviceName, secureStoreGet, secureStoreSet, secureStoreRemove } from './native-auth';
import { sdkHttp } from './http';

export type BiometryKind = 'face' | 'fingerprint' | 'none';

export interface BiometricStore {
  /** Does this device have usable biometrics enrolled? */
  isAvailable(): Promise<{ available: boolean; kind: BiometryKind; reason?: 'unavailable' | 'not_enrolled' | 'denied' }>;
  /** Store the device credential behind biometric access control. Throws on failure — never stores it unprotected. */
  enroll(secret: string): Promise<void>;
  /** Prompt for biometrics and return the stored credential. `null` when the user CANCELLED (not a failure). */
  unlock(): Promise<string | null>;
  /** Remove the protected item. */
  clear(): Promise<void>;
  /** Prompt for biometrics (device passcode fallback) WITHOUT reading the item — the app lock (§245). */
  verify?(): Promise<boolean>;
}

/** No native shell (the web build). Face ID is WebAuthn there. */
export class NoBiometrics implements BiometricStore {
  async isAvailable() { return { available: false, kind: 'none' as const, reason: 'unavailable' as const }; }
  async enroll() { throw new Error('Biometrics are not available on this device.'); }
  async unlock() { return null; }
  async clear() { /* nothing stored */ }
}

let bio: BiometricStore = new NoBiometrics();
/** Called once at native app start with the platform's biometric-Keychain plugin. */
export function setBiometricStore(s: BiometricStore): void { bio = s; }

export type FaceIdState =
  | { status: 'available'; kind: BiometryKind }
  | { status: 'unavailable' }
  | { status: 'not_enrolled' }
  | { status: 'denied' };

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
    public reason: 'cancelled' | 'unavailable' | 'not_enrolled' | 'denied' | 'mismatch' | 'session_invalid' | 'recent_auth' | 'policy_off' | 'failed',
    message: string,
  ) { super(message); this.name = 'FaceIdError'; }
}

/** Not a secret: which credential (and whose) this device holds, so screens can show "Face ID on" without a prompt and a
 *  different person signing in can clear it. Lives in the secure store beside the device id. */
const MARKER_KEY = 'aps.bio.credential';
interface Marker { credentialId: string; userId: string | null }
async function readMarker(): Promise<Marker | null> {
  try { const v = await secureStoreGet(MARKER_KEY); return v ? (JSON.parse(v) as Marker) : null; } catch { return null; }
}
interface StoredCredential { v: 1; credentialId: string; deviceId: string; secret: string; userId: string | null }
function parseCredential(raw: string | null): StoredCredential | null {
  try { const j = raw ? JSON.parse(raw) : null; return j && j.v === 1 && typeof j.credentialId === 'string' && typeof j.secret === 'string' && typeof j.deviceId === 'string' ? j : null; }
  catch { return null; }   // the pre-Phase-13 item held a bare access token — not a credential
}
const status = (e: any): number => Number(e?.status ?? e?.statusCode ?? 0);
const code = (e: any): string => String(e?.code ?? e?.error?.code ?? '');

/** Is a Face ID credential enrolled on this device (no prompt)? */
export async function nativeFaceIdEnrolled(): Promise<boolean> { return !!(await readMarker()); }

/**
 * Enrol Face ID for the signed-in person. The SERVER requires a session that proved the password in the last 10
 * minutes (or a step-up) — Face ID is always opt-in and can never be enabled silently or from a Face-ID-opened session.
 */
export async function enrollNativeFaceId(userId?: string | null): Promise<void> {
  const s = await faceIdState();
  if (s.status === 'not_enrolled') throw new FaceIdError('not_enrolled', 'Set up Face ID on your device first, then try again.');
  if (s.status === 'denied') throw new FaceIdError('denied', 'Face ID permission was declined. You can enable it in Settings.');
  if (s.status !== 'available') throw new FaceIdError('unavailable', 'Face ID isn’t available on this device.');
  const dev = await deviceId();
  if (!dev) throw new FaceIdError('failed', 'This device could not be identified. Try again.');
  const platform = devicePlatform();
  let r: { credentialId: string; secret: string };
  try {
    r = await sdkHttp().post<{ credentialId: string; secret: string }>('/auth/biometric/enroll', { deviceId: dev, deviceName: deviceName('AIPowerSalon'), platform: platform === 'web' ? null : platform });
  } catch (e) {
    if (code(e) === 'BIOMETRIC_RECENT_AUTH_REQUIRED') throw new FaceIdError('recent_auth', 'Confirm your password to turn on Face ID.');
    if (code(e) === 'POLICY_PASSKEYS_OFF') throw new FaceIdError('policy_off', 'Your salon has turned Face ID sign-in off.');
    throw new FaceIdError('failed', 'Face ID could not be turned on. Try again.');
  }
  const item: StoredCredential = { v: 1, credentialId: r.credentialId, deviceId: dev, secret: r.secret, userId: userId ?? null };
  try {
    await bio.enroll(JSON.stringify(item));   // throws rather than storing it unprotected
  } catch {
    try { await sdkHttp().post('/auth/biometric/revoke', { deviceId: dev }); } catch { /* it expires unused */ }
    throw new FaceIdError('failed', 'Face ID could not be turned on. Try again.');
  }
  await secureStoreSet(MARKER_KEY, JSON.stringify({ credentialId: r.credentialId, userId: userId ?? null } satisfies Marker));
}

/** Wipe the credential locally (the server has refused it, or it is not ours any more). */
async function wipeCredential(): Promise<void> {
  try { await bio.clear(); } catch { /* best effort */ }
  await secureStoreRemove(MARKER_KEY);
}

/**
 * Sign in with Face ID: unlock the device credential and ask the SERVER for a fresh session. Returns the login body
 * (principal; the token pair is saved to the Keychain here). Throws FaceIdError.
 */
export async function signInWithNativeFaceId(): Promise<any> {
  const s = await faceIdState();
  if (s.status === 'not_enrolled') throw new FaceIdError('not_enrolled', 'Set up Face ID on your device first.');
  if (s.status === 'denied') throw new FaceIdError('denied', 'Face ID permission was declined.');
  if (s.status !== 'available') throw new FaceIdError('unavailable', 'Face ID isn’t available on this device.');

  let raw: string | null;
  try { raw = await bio.unlock(); }
  catch { throw new FaceIdError('mismatch', 'Face ID didn’t match. Try again, or sign in with your password.'); }
  if (raw === null) throw new FaceIdError('cancelled', 'Face ID was cancelled.');

  const cred = parseCredential(raw);
  if (!cred) { await wipeCredential(); throw new FaceIdError('session_invalid', 'Sign in with your password to turn Face ID back on.'); }

  let body: any;
  try {
    body = await sdkHttp().post<any>('/auth/biometric/login', { credentialId: cred.credentialId, deviceId: cred.deviceId, secret: cred.secret });
  } catch (e) {
    const st = status(e);
    if (st === 401 || st === 403 || st === 404) {   // refused / switched off: it can never work again
      await wipeCredential();
      throw new FaceIdError('session_invalid', code(e) === 'POLICY_PASSKEYS_OFF' ? 'Your salon has turned Face ID sign-in off. Sign in with your password.' : 'Sign in with your password to turn Face ID back on.');
    }
    throw new FaceIdError('failed', 'Couldn’t reach the server. Check your connection and try again.');
  }
  await saveNativeSession(body);
  // The server spent the old secret: store the new one (no prompt needed to write). If this write fails the next Face ID
  // sign-in presents the spent secret, the server treats that as theft and the person signs in with the password once.
  if (typeof body?.nextSecret === 'string') {
    try { await bio.enroll(JSON.stringify({ ...cred, secret: body.nextSecret } satisfies StoredCredential)); } catch { /* see above */ }
  }
  const { nextSecret: _n, credentialExpiresAt: _x, ...rest } = body ?? {};
  return rest;
}

/** Remove the credential AND the session token. Since Nov 5 2026 only manager-pay calls this on sign-out / 401 (customer,
 *  tech and owner keep Face ID through a normal sign-out — see faceid-signout.ts and migration 841). */
export async function clearNativeFaceId(): Promise<void> {
  await clearNativeToken();
  await wipeCredential();
}

/** Turn Face ID off on this device: the server revokes the credential, the Keychain item goes; the session stays. */
export async function disableNativeFaceId(): Promise<void> {
  try { const dev = await deviceId(); if (dev) await sdkHttp().post('/auth/biometric/revoke', { deviceId: dev }); } catch { /* the local wipe still stops it */ }
  await wipeCredential();
}

/** Account switch on a shared device (§35–36): a credential enrolled by someone else is cleared when this person signs in. */
export async function reconcileFaceIdUser(userId: string | null | undefined): Promise<void> {
  const m = await readMarker();
  if (m && userId && m.userId && m.userId !== userId) await wipeCredential();
}

/** App lock (§245–246): does the person holding the phone pass Face ID / Touch ID / the device passcode? Reveals nothing
 *  and signs nobody in — it only lifts the client-side cover over an already signed-in app. */
export async function verifyDeviceOwner(): Promise<boolean> {
  if ((await faceIdState()).status !== 'available' || !bio.verify) return false;
  try { return await bio.verify(); } catch { return false; }
}
