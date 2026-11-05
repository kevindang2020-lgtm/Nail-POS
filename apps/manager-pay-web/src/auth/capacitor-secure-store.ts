// capacitor-secure-store.ts — the Keychain/Keystore-backed token store for the native shell.
//
// `native-auth.ts` defines the `SecureStore` port and injects it, so the web build carries no native dependency.
// This is the concrete implementation.
//
// The plugin is resolved at RUNTIME: importing it statically would break the web build (and `tsc`), since it is a
// native-only package. Every failure path degrades to "no secure storage", which the caller already handles — the
// token then lives in memory for this session only.
//
// It NEVER falls back to `localStorage`. On a jailbroken device that is a plain file, and a bearer token sitting
// in one is exactly what someone holding the handset would go looking for. A token that does not survive an app
// restart is a mild annoyance; a token an attacker can read off the disk is not.
//
//   npm i capacitor-secure-storage-plugin && npx cap sync
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
    await this.api.set({ key, value });   // throws on failure — caller keeps in-memory copy for this run
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
 * do not exist there.
 */
export function makeSecureStore(): SecureStore | null {
  if (!isNativePlatform()) return null;
  return SecureStoragePlugin ? new CapacitorSecureStore(SecureStoragePlugin) : null;
}

// ── BiometricStore: Face ID / Touch ID, with credentials held in biometric-protected item ──

export function toBiometryKind(t: unknown): BiometryKind {
  const v = String(t ?? '').toLowerCase();
  if (v.includes('face') || v === '2') return 'face';
  if (v.includes('touch') || v.includes('finger') || v === '1') return 'fingerprint';
  return 'none';
}

const SERVER = 'com.aipowersalon.pay.session';

export class CapacitorBiometrics implements BiometricStore {
  constructor(private readonly api: any) {}

  async isAvailable(): Promise<{ available: boolean; kind: BiometryKind; reason?: 'unavailable' | 'not_enrolled' | 'denied' }> {
    try {
      const r = await this.api.isAvailable({ useFallback: true });
      if (r?.isAvailable) return { available: true, kind: toBiometryKind(r.biometryType) };

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

  /** Store the session credential behind biometric protection. */
  async enroll(token: string): Promise<void> {
    await this.api.setCredentials({ username: SERVER, password: token, server: SERVER });
  }

  /** Prompt for Face ID / Touch ID and return the credential. Returns null on user cancellation. */
  async unlock(): Promise<string | null> {
    try {
      await this.api.verifyIdentity({
        reason: 'Sign in to AI PowerSalon Tap to Pay',
        title: 'Biometric Sign In',
        subtitle: 'Use Face ID / Touch ID to sign in',
        description: '',
        useFallback: true,
      });
    } catch (e: any) {
      const code = String(e?.code ?? e?.message ?? '');
      if (/10|11|15|16|cancel|user.?cancel/i.test(code)) return null;
      throw e;
    }

    let creds;
    try {
      creds = await this.api.getCredentials({ server: SERVER });
    } catch (e: any) {
      throw new Error('no credential');
    }
    return creds?.password ?? null;
  }

  async hasCredentials(): Promise<boolean> {
    try {
      const creds = await this.api.getCredentials({ server: SERVER });
      return Boolean(creds?.password);
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    try { await this.api.deleteCredentials({ server: SERVER }); } catch { /* nothing stored */ }
  }
}

export function makeBiometrics(): BiometricStore | null {
  if (!isNativePlatform()) return null;
  return NativeBiometric ? new CapacitorBiometrics(NativeBiometric) : null;
}

