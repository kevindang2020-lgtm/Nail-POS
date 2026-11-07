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
/** The runtime bridge (window.Capacitor) decides; the imported module is the fallback. Never throws. */
export function isNativePlatform(): boolean {
  try {
    const cap = (globalThis as any).Capacitor ?? Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch { return false; }
}
/** Is the NATIVE side of a plugin actually installed in this shell? A statically imported JS proxy always exists, so
 *  its presence proves nothing — ask the bridge (Sep 2026 merge: keeps "report capabilities honestly" true). */
function nativePluginAvailable(name: string): boolean {
  try {
    const cap = (globalThis as any).Capacitor ?? Capacitor;
    return typeof cap?.isPluginAvailable === 'function' ? !!cap.isPluginAvailable(name) : false;
  } catch { return false; }
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
  return SecureStoragePlugin && nativePluginAvailable('SecureStoragePlugin') ? new CapacitorSecureStore(SecureStoragePlugin) : null;
}

// ── BiometricStore: Face ID / Touch ID, with the token held in a biometric-protected item ──

/** Map the plugin's biometry type to ours. Anything unrecognised is still "some biometric". */
export function toBiometryKind(t: unknown): BiometryKind {
  const v = String(t ?? '').toLowerCase();
  // Numeric values follow the plugin's BiometryType: 1 TOUCH_ID, 2 FACE_ID, 3 FINGERPRINT, 4 FACE_AUTHENTICATION.
  if (v.includes('face') || v === '2' || v === '4') return 'face';
  if (v.includes('touch') || v.includes('finger') || v === '1' || v === '3') return 'fingerprint';
  return 'none';
}

// BUILD_PLAN Phase 13 D: the item now holds the biometric DEVICE CREDENTIAL (native-faceid.ts), under a new key. The old
// key held the 15-minute access token (bug 2); clear() removes it too, so no upgraded phone keeps a token there.
const SERVER = 'com.aipowersalon.devicecredential';
const LEGACY_SERVER = 'com.aipowersalon.session';
const BIOMETRY_CURRENT_SET = 1;   // the plugin's AccessControl.BIOMETRY_CURRENT_SET

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

  /**
   * Store the device credential in a Keychain / Keystore item the OS itself guards with biometrics (BUILD_PLAN Phase 13 D):
   * accessControl BIOMETRY_CURRENT_SET — iOS SecAccessControl `.biometryCurrentSet` (WhenPasscodeSetThisDeviceOnly), Android
   * a biometric-bound Keystore key — so the secret can only be read through the OS prompt, and enrolling a new face /
   * finger invalidates it. (Before Phase 13 the item was stored WITHOUT access control and only a JS verifyIdentity() call
   * stood in front of it.) On Android a read authorizes the key for 15 s, so the post-sign-in rotation write does not prompt
   * twice. Throws rather than storing it unprotected.
   */
  async enroll(credential: string): Promise<void> {
    await this.api.setCredentials({ username: SERVER, password: credential, server: SERVER, accessControl: BIOMETRY_CURRENT_SET, authValidityDuration: 15, title: 'Turn on Face ID' });
  }

  /**
   * Prompt for Face ID (the OS prompt bound to the protected item) and return the stored credential.
   *
   * Returns **null** when the customer CANCELLED — not a failure. Returns '' when no protected item exists (never
   * enrolled, deleted, or invalidated by a biometric change) — the caller wipes its marker and asks for the password.
   * Anything else throws: a mismatch / lockout (retryable; the enrolment stays).
   */
  async unlock(): Promise<string | null> {
    try {
      const creds = await this.api.getSecureCredentials({ server: SERVER, reason: 'Sign in to AI PowerSalon', title: 'Biometric Sign In', subtitle: 'Use your biometrics to sign in' });
      return creds?.password ?? '';
    } catch (e: any) {
      // @capgo/capacitor-native-biometric codes: 11 app cancel, 15 system cancel, 16 user cancel → quiet return; 21 no protected
      // credential → ''; 10 AUTHENTICATION FAILED and every lockout code → throw (never treated as a cancel).
      const code = String(e?.code ?? '');
      const msg = String(e?.message ?? '');
      if (code === '11' || code === '15' || code === '16' || (!code && /cancel/i.test(msg))) return null;
      if (code === '21' || /no protected credentials/i.test(msg)) return '';
      throw e;
    }
  }

  async clear(): Promise<void> {
    try { await this.api.deleteCredentials({ server: SERVER }); } catch { /* nothing stored */ }
    try { await this.api.deleteCredentials({ server: LEGACY_SERVER }); } catch { /* nothing stored */ }
  }

  /** The app lock: Face ID / Touch ID with the device passcode as fallback; never reads the stored credential. */
  async verify(): Promise<boolean> {
    try {
      await this.api.verifyIdentity({ reason: 'Unlock AI PowerSalon', title: 'Unlock', subtitle: '', description: '', useFallback: true });
      return true;
    } catch { return false; }   // cancelled or failed: stays locked
  }
}

export function makeBiometrics(): BiometricStore | null {
  if (!isNativePlatform()) return null;
  return NativeBiometric && nativePluginAvailable('NativeBiometric') ? new CapacitorBiometrics(NativeBiometric) : null;
}
