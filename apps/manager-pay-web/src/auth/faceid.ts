// faceid.ts — one Face ID entry point; the right mechanism per platform.
//
//   NATIVE  → Apple/Android biometrics + Keychain (native-faceid.ts). WebAuthn is a BROWSER API and is
//             unavailable/unreliable inside an iOS WKWebView, so a native build cannot use it.
//   WEB     → WebAuthn (api/webauthn.ts), with the real fail-closed server-side verifier.
//
// Native is preferred when present. The rule is the same on both paths and is enforced by the server, not here:
// **a biometric success is not authentication.** Native revalidates the unlocked token against the backend;
// WebAuthn's signature is verified server-side. Neither path can mint a session on the client.
import { faceIdState, signInWithNativeFaceId, enrollNativeFaceId, clearNativeFaceId, disableNativeFaceId, isNativeFaceIdEnrolled, verifyNativeFaceId } from './native-faceid';
import { signInWithFaceId as webSignIn, enrollFaceId as webEnroll, isFaceIdAvailable as webAvailable } from '../api/webauthn';
import { loadNativeToken } from './native-auth';
import { api } from '../api/client';

export type FaceIdMode = 'native' | 'web' | 'none';

async function serverEnabled(): Promise<boolean> {
  try {
    const r = await api.get<{ enabled: boolean }>('/auth/webauthn/status');
    return !!r?.enabled;
  } catch {
    return false;
  }
}

export async function faceIdMode(): Promise<FaceIdMode> {
  try {
    const s = await faceIdState();
    if (s.status === 'available') return 'native';
  } catch {
    /* ignore and check web */
  }

  try {
    if (await serverEnabled()) {
      if (await webAvailable()) return 'web';
    }
  } catch {
    /* ignore */
  }

  return 'none';
}

const BIO_CREDS_KEY = 'aps_pay_pending_bio_creds';

export function setPendingBioCreds(c: any) {
  if (c) {
    try { sessionStorage.setItem(BIO_CREDS_KEY, JSON.stringify(c)); } catch { /* ignore */ }
  } else {
    try { sessionStorage.removeItem(BIO_CREDS_KEY); } catch { /* ignore */ }
  }
}

export function getPendingBioCreds(): any {
  try {
    const raw = sessionStorage.getItem(BIO_CREDS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Enrol. Requires an authenticated session on both paths — Face ID is always opt-in. */
export async function enrollFaceId(): Promise<void> {
  if ((await faceIdMode()) === 'native') {
    const creds = getPendingBioCreds();
    if (creds) {
      await enrollNativeFaceId(JSON.stringify(creds));
      return;
    }
    const token = await loadNativeToken();
    if (!token) throw new Error('Sign in first, then enable Face ID.');
    await enrollNativeFaceId(token);
    return;
  }
  await webEnroll();
}

/** Sign in. */
export async function signInWithFaceId(
  revalidate: (token: string) => Promise<any>,
  loginWithCreds?: (creds: any) => Promise<any>,
  hint?: string,
): Promise<any> {
  if ((await faceIdMode()) === 'native') return signInWithNativeFaceId(revalidate, loginWithCreds);
  await webSignIn(hint);
  return revalidate('');
}

export async function isFaceIdEnrolled(): Promise<boolean> {
  if ((await faceIdMode()) === 'native') {
    return await isNativeFaceIdEnrolled();
  }
  return false;
}

export const clearFaceId = clearNativeFaceId;
export const disableFaceId = disableNativeFaceId;

/** Prompt biometric re-authentication for sensitive actions like store switch, refund, or settings changes. */
export async function verifySensitiveAction(action: string): Promise<boolean> {
  if ((await faceIdMode()) === 'native') {
    return await verifyNativeFaceId(action);
  }
  return true;
}


