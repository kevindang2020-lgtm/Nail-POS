// signOut.ts — the ONE sign-out of the Payment App (Account → Sign out, the lock screen's "Sign in again", and — Secure Tap
// to Pay §12 / §53, Oct 26 2026 — the forced full sign-in after repeated failed Face ID / passcode / password checks).
// Order: hand the push token back while the session still exists, end the session at the server, forget Face ID, then
// announce aps:unauthorized (App drops the principal → the password sign-in screen).
import { clearFaceId, resetBiometricFailures } from '@aipowersalon/mobile-sdk';
import { authApi } from '../api/authApi';
import { mobile } from './mobile';

export async function signOutNow(): Promise<void> {
  try { await mobile.push.unregister(); } catch { /* best-effort: the session end below is what matters */ }
  try { await authApi.logout(); } catch { /* best-effort: a dead session is already signed out */ }
  await clearFaceId().catch(() => undefined);
  resetBiometricFailures();
  window.dispatchEvent(new CustomEvent('aps:unauthorized'));
}
