// mobile-biometric.ts — Constitution 6 §37–39 (BUILD_PLAN Phase 13, D; audit bug 2): the biometric DEVICE CREDENTIAL.
//
// Face ID / Touch ID unlocks a long-lived, single-device, revocable credential kept in the Keychain / Keystore item that
// the OS guards with biometrics. It is NOT the access token (that lives 15 minutes) and not the password. Signing in with
// it mints a FRESH session on the server, which re-checks the account, the device and the salon's policy:
//
//   enroll : POST /auth/biometric/enroll  (signed in + a recent password sign-in or step-up)  → { credentialId, secret }
//   login  : POST /auth/biometric/login   { credentialId, deviceId, secret }                   → the normal login body
//            and a ROTATED secret (the old one is spent; presenting a spent one again revokes the credential — theft)
//   revoke : POST /auth/biometric/revoke  (signed in)  — and automatically on sign-out, password change, device revoke
//
// The secret is 32 random bytes, stored server-side only as a SHA-256 hash; it never appears in a URL or a log.

export const BIOMETRIC_CREDENTIAL_DAYS = 90;           // sliding: each successful use extends it
export const BIOMETRIC_ENROLL_FRESH_SECONDS = 600;     // enrolment needs a password sign-in (or step-up) this recent

export interface BiometricEnrollBody { deviceId: string; deviceName?: string; platform?: 'ios' | 'android' }
export interface BiometricEnrollResponse { ok: true; credentialId: string; secret: string; expiresAt: string }
export interface BiometricLoginBody { credentialId: string; deviceId: string; secret: string }
/** The login body (principal, and for native the token pair) plus the rotated credential secret. */
export interface BiometricLoginResponse { nextSecret: string; credentialExpiresAt: string; [k: string]: unknown }
export interface BiometricStatusResponse { ok: true; enabled: boolean }
export interface BiometricRevokeBody { deviceId: string }
export interface BiometricRevokeResponse { ok: true; revoked: number }

/** Error codes the endpoints answer (all in the error registry). A client that gets BIOMETRIC_CREDENTIAL_INVALID must
 *  delete its stored credential — it can never work again. */
export const BIOMETRIC_ERRORS = {
  INVALID: 'BIOMETRIC_CREDENTIAL_INVALID',
  REUSED: 'BIOMETRIC_CREDENTIAL_REUSED',
  RECENT_AUTH: 'BIOMETRIC_RECENT_AUTH_REQUIRED',
  POLICY_OFF: 'POLICY_PASSKEYS_OFF',
} as const;

const SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/;
export function isBiometricSecret(v: unknown): v is string { return typeof v === 'string' && SECRET_RE.test(v); }
