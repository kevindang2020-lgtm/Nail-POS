// webauthn.ts — the browser half of Face ID / Touch ID.
//
// The backend hands back `{ handle, options }`; the browser runs the ceremony with the platform authenticator and
// posts the result back under the same handle. Base64url conversion is the fiddly part — the WebAuthn API wants
// ArrayBuffers, JSON wants strings.
//
// Two things this deliberately does NOT do:
//   • It never decides whether the ceremony succeeded. The browser only produces a signature; ONLY the server's
//     verifier decides if it is valid. A frontend that "checks" a biometric is theatre.
//   • It never stores anything about the credential locally. The credential lives in the secure enclave.
import { api } from './client';

const b64urlToBuf = (s: string): ArrayBuffer => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
};

const bufToB64url = (b: ArrayBuffer): string => {
  const bytes = new Uint8Array(b);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Is a platform authenticator (Face ID / Touch ID) actually usable here? */
export async function isFaceIdAvailable(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
    const fn = (window.PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof fn !== 'function') return false;
    return await fn.call(window.PublicKeyCredential);
  } catch { return false; }
}

/** Enroll Face ID. Requires an authenticated session — the server takes the user from the session, not from us. */
export async function enrollFaceId(deviceLabel?: string): Promise<void> {
  const { handle, options } = await api.post<any>('/auth/webauthn/register/begin', {});

  const publicKey: any = {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    user: { ...options.user, id: b64urlToBuf(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c: any) => ({ ...c, id: b64urlToBuf(c.id) })),
    authenticatorSelection: { ...(options.authenticatorSelection || {}), userVerification: 'required' },
  };

  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Face ID setup was cancelled.');
  const r = cred.response as AuthenticatorAttestationResponse;

  await api.post('/auth/webauthn/register/finish', {
    handle,
    credentialId: cred.id,
    clientDataJSON: bufToB64url(r.clientDataJSON),
    attestationObject: bufToB64url(r.attestationObject),
    deviceLabel: deviceLabel || navigator.userAgent.slice(0, 80),
  });
}

/** Sign in with Face ID. The session cookie is set by the server on success. */
export async function signInWithFaceId(hint?: string): Promise<void> {
  const { handle, options } = await api.post<any>('/auth/webauthn/authenticate/begin', { emailOrPhone: hint });

  const publicKey: any = {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c: any) => ({ ...c, id: b64urlToBuf(c.id) })),
    userVerification: 'required',
  };

  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Face ID sign-in was cancelled.');
  const r = cred.response as AuthenticatorAssertionResponse;

  // The SERVER verifies the signature. Reaching this line proves nothing on its own.
  await api.post('/auth/webauthn/authenticate/finish', {
    handle,
    credentialId: cred.id,
    clientDataJSON: bufToB64url(r.clientDataJSON),
    authenticatorData: bufToB64url(r.authenticatorData),
    signature: bufToB64url(r.signature),
  });
}
