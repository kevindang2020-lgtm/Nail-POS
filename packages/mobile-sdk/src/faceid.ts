// faceid.ts — one Face ID entry point; the right mechanism per platform.
//
//   NATIVE  → the biometric DEVICE CREDENTIAL (native-faceid.ts, BUILD_PLAN Phase 13 D): Face ID unlocks a long-lived,
//             revocable, rotating credential and the server opens a fresh session. WebAuthn is a BROWSER API and is
//             unreliable inside an iOS WKWebView.
//   WEB     → WebAuthn (webauthn.ts), with the real fail-closed server-side verifier.
//
// Both are switched on by the server (FACE_ID_ENABLED, after one real-device check on staging) — the app never offers a
// button that cannot work. Neither path can mint a session on the client.
import {
  faceIdState, signInWithNativeFaceId, enrollNativeFaceId, clearNativeFaceId, disableNativeFaceId, nativeFaceIdEnrolled, reconcileFaceIdUser,
} from './native-faceid';
import { signInWithFaceId as webSignIn, enrollFaceId as webEnroll, isFaceIdAvailable as webAvailable } from './webauthn';
import { loadNativeToken } from './native-auth';
import { sdkHttp } from './http';
import { isNativePlatform } from './capacitor-adapters';

export type FaceIdMode = 'native' | 'web' | 'none';

async function serverEnabled(path: string): Promise<boolean> {
  try { return !!(await sdkHttp().get<{ enabled: boolean }>(path))?.enabled; }
  catch { return false; }   // can't ask → don't offer it
}

export async function faceIdMode(): Promise<FaceIdMode> {
  if (isNativePlatform() || (await faceIdState()).status === 'available') {
    if ((await faceIdState()).status === 'available' && await serverEnabled('/auth/biometric/status')) return 'native';
    return 'none';
  }
  if (await serverEnabled('/auth/webauthn/status') && await webAvailable()) return 'web';
  return 'none';
}

/** Enrol. Requires an authenticated session that recently proved the password — Face ID is always opt-in. */
export async function enrollFaceId(userId?: string | null): Promise<void> {
  if ((await faceIdMode()) === 'native') { await enrollNativeFaceId(userId); return; }
  await webEnroll();
}

/**
 * Sign in. `revalidate` loads the principal (GET /auth/me) once the server has opened the session — on native after
 * POST /auth/biometric/login, on the web after the WebAuthn assertion set the cookie.
 */
export async function signInWithFaceId(revalidate: (token: string) => Promise<any>, hint?: string): Promise<any> {
  if ((await faceIdMode()) === 'native') {
    const body = await signInWithNativeFaceId();
    return revalidate(String(body?.accessToken ?? ''));
  }
  await webSignIn(hint);
  return revalidate('');
}

/** Remove the credential AND the session token on this phone. Since Nov 5 2026 a normal sign-out and a 401 do NOT call
 *  this in customer / tech / owner (Face ID survives sign-out; the server ends it when trust ends — migration 705);
 *  manager-pay, a phone often shared at the front desk, still does. */
export const clearFaceId = clearNativeFaceId;
/** "Face ID" toggle off: the server revokes the credential; the session stays. */
export const disableFaceId = disableNativeFaceId;
export { reconcileFaceIdUser };

/** Is Face ID switched on for this device (no prompt)? Replaces the three localStorage flags the apps kept (bug 14). */
export async function isFaceIdEnrolled(): Promise<boolean> {
  return (await faceIdMode()) === 'native' ? nativeFaceIdEnrolled() : false;
}

/** Can Face ID be enabled now? Native: signed in (a native token exists) and the device supports it. */
export async function canEnrollFaceId(): Promise<boolean> {
  const m = await faceIdMode();
  if (m === 'web') return true;
  return m === 'native' && !!(await loadNativeToken());
}
