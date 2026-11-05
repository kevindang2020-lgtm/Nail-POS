// capacitor-adapters.ts — the concrete native implementations of the two ports.
//
// `native-auth.ts` defines `SecureStore` and `native-faceid.ts` defines `BiometricStore`. Both are injected, so
// the web build carries no native dependency. This file is the other half: the real Keychain/Keystore-backed
// implementations, wired at app start when we are running inside the Capacitor shell.
//
// ── Why everything is resolved at RUNTIME ──
//
// The plugins are native-only. Importing them statically would break the web build (and `tsc`) in every app that
// does not ship native. So they are resolved with a runtime require and **every failure path degrades to "no
// native capability"** — which the callers already treat as "use the web path" / "Face ID unavailable". Nothing
// here can fail *open*.
//
// ── Plugins to install in the native app ──
//
//   npm i capacitor-secure-storage-plugin     # Keychain (iOS) / EncryptedSharedPreferences (Android)
//   npm i @capgo/capacitor-native-biometric          # LocalAuthentication + biometric-protected Keychain items
//   npx cap sync
//
// If either is absent the app still works: it simply has no Face ID, and (without secure storage) it holds the
// token in memory for the session only. It never silently falls back to `localStorage` — on a jailbroken device
// that is a plain file, and a bearer token sitting in one is exactly what an attacker with the handset looks for.
import type { SecureStore } from './native-auth';
import type { BiometricStore, BiometryKind } from './native-faceid';

import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';

import { Capacitor } from '@capacitor/core';

/** Are we actually inside a native shell? */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

// ── SecureStore: Keychain (iOS) / EncryptedSharedPreferences (Android) ──

export class CapacitorSecureStore implements SecureStore {
  constructor(private readonly api: any) {}

  async get(key: string): Promise<string | null> {
    try {
      const r = await this.api.get({ key });
      return r?.value ?? null;
    } catch {
      return null;   // not found, or the store is locked — treat as "no token", never as an error the caller must handle
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.api.set({ key, value });   // throws on failure — the caller keeps an in-memory copy for this run
  }

  async remove(key: string): Promise<void> {
    try { await this.api.remove({ key }); } catch { /* already gone */ }
  }
}

/**
 * The real secure store, or null.
 *
 * Gated on `isNativePlatform()` as well as on the plugin resolving. Once the plugin is a real dependency it is
 * BUNDLED INTO THE WEB BUILD TOO, and would otherwise hand a browser a "secure store" backed by native APIs that
 * do not exist there. The web must never hold a token at all — its httpOnly cookie is the stronger option
 * precisely because the token never enters JavaScript.
 */
export function makeSecureStore(): SecureStore | null {
  if (!isNativePlatform()) return null;
  return SecureStoragePlugin ? new CapacitorSecureStore(SecureStoragePlugin) : null;
}

// ── BiometricStore: Face ID / Touch ID, with the token held in a biometric-protected item ──

/** Map the plugin's biometry type to ours. Anything unrecognised is still "some biometric". */
export function toBiometryKind(t: unknown): BiometryKind {
  const v = String(t ?? '').toLowerCase();
  if (v.includes('face') || v === '2') return 'face';
  if (v.includes('touch') || v.includes('finger') || v === '1') return 'fingerprint';
  return 'none';
}

const SERVER = 'com.aipowersalon.session';

export class CapacitorBiometrics implements BiometricStore {
  constructor(private readonly api: any) {}

  async isAvailable(): Promise<{ available: boolean; kind: BiometryKind; reason?: 'unavailable' | 'not_enrolled' | 'denied' }> {
    try {
      const r = await this.api.isAvailable({ useFallback: true });
      if (r?.isAvailable) return { available: true, kind: toBiometryKind(r.biometryType) };

      // The plugin reports WHY. The distinction matters to the customer: "not enrolled" is something they can fix
      // in Settings; "unavailable" is not.
      const code = String(r?.errorCode ?? '');
      if (code === '1' || code === '2' || code === '3' || code === '14' || /not.?enrolled|lockout|passcode/i.test(code)) {
        return { available: false, kind: toBiometryKind(r?.biometryType), reason: 'not_enrolled' };
      }
      if (/denied|permission/i.test(code)) return { available: false, kind: 'none', reason: 'denied' };
      return { available: false, kind: 'none', reason: 'unavailable' };
    } catch {
      return { available: false, kind: 'none', reason: 'unavailable' };   // fail closed
    }
  }

  /** Store the SESSION TOKEN behind biometric protection. Throws rather than storing it unprotected. */
  async enroll(token: string): Promise<void> {
    await this.api.setCredentials({ username: SERVER, password: token, server: SERVER });
  }

  /**
   * Prompt for Face ID and return the token.
   *
   * Returns **null** when the customer CANCELLED — that is not a failure. Anything else throws, and the caller
   * treats it as a biometric mismatch (retryable; it does not wipe the enrolment).
   */
  async unlock(): Promise<string | null> {
    try {
      await this.api.verifyIdentity({
        reason: 'Sign in to AI PowerSalon',
        title: 'Biometric Sign In',
        subtitle: 'Use your biometrics to sign in',
        description: '',
        useFallback: true,
      });
    } catch (e: any) {
      // Capacitor's native-biometric reports a user cancellation distinctly from a failed match.
      const code = String(e?.code ?? e?.message ?? '');
      if (/10|11|15|16|cancel|user.?cancel/i.test(code)) return null;
      throw e;   // mismatch / lockout → the caller surfaces "didn't match, try again or use your password"
    }

    let creds;
    try {
      creds = await this.api.getCredentials({ server: SERVER });
    } catch (e: any) {
      throw new Error('no credential');
    }
    return creds?.password ?? null;
  }

  async clear(): Promise<void> {
    try { await this.api.deleteCredentials({ server: SERVER }); } catch { /* nothing stored */ }
  }
}

export function makeBiometrics(): BiometricStore | null {
  if (!isNativePlatform()) return null;
  return NativeBiometric ? new CapacitorBiometrics(NativeBiometric) : null;
}
