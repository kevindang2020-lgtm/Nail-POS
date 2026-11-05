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

function plugin(name: string): any | null {
  try {
    const req: NodeRequire = eval('require');
    return req(name);
  } catch {
    return null;
  }
}

export function isNativePlatform(): boolean {
  try {
    const cap = (globalThis as any).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

export class CapacitorSecureStore implements SecureStore {
  constructor(private readonly api: any) {}

  async get(key: string): Promise<string | null> {
    try {
      const r = await this.api.get({ key });
      return r?.value ?? null;
    } catch {
      return null;   // missing, or the store is locked — "no token", never an error the caller must handle
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.api.set({ key, value });   // throws on failure — never mistaken for a successful store
  }

  async remove(key: string): Promise<void> {
    try { await this.api.remove({ key }); } catch { /* already gone */ }
  }
}

export function makeSecureStore(): SecureStore | null {
  // Gated on the platform, not just on the plugin resolving. Now that the plugin is a real dependency it is
  // BUNDLED INTO THE WEB BUILD TOO — without this, a browser would be handed a "secure store" backed by native
  // APIs that do not exist there. The web must hold no token at all; its httpOnly cookie is the stronger option.
  if (!isNativePlatform()) return null;
  const api = plugin('capacitor-secure-storage-plugin')?.SecureStoragePlugin;
  return api ? new CapacitorSecureStore(api) : null;
}
