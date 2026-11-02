// deviceCredential.ts — where a paired display keeps its DEVICE credential (23-inch spec §12).
//
//   the Android / iOS display app ── the platform's secure store (Android Keystore-backed storage / iOS Keychain) through
//                                    @aipowersalon/mobile-sdk — the same adapter every AIPowerSalon app uses
//   that app without the plugin ──── memory only: the display re-pairs after a restart rather than writing the credential
//                                    to a plain file (mobile-sdk's rule: a native app never falls back to localStorage)
//   a browser (the POS's second ──── the browser's storage for this origin: there is no user session to hold it instead,
//   monitor)                         and the credential is a DEVICE principal — it shows this display's own checkout and
//                                    takes the customer's own taps, nothing else — revocable from the POS at any time
//
// No salon login is ever entered on, or stored by, the customer display.
import { isNativePlatform, makeSecureStore } from '@aipowersalon/mobile-sdk';
import type { DisplayPlatform } from '@aipowersalon/api-contracts/customer';

export const DEVICE_TOKEN_KEY = 'aps.customerDisplay.deviceToken';

export interface CredentialStore {
  readonly kind: 'secure' | 'browser' | 'memory';
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  remove(): Promise<void>;
}

function browserStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

let memory: string | null = null;
const memoryStore: CredentialStore = {
  kind: 'memory',
  async get() { return memory; },
  async set(t) { memory = t; },
  async remove() { memory = null; },
};

export function credentialStore(): CredentialStore {
  const secure = makeSecureStore();
  if (secure) {
    return {
      kind: 'secure',
      get: () => secure.get(DEVICE_TOKEN_KEY),
      // a failed write keeps the credential in memory for this run (the store may be locked); the next start re-reads
      set: async (t) => { memory = t; await secure.set(DEVICE_TOKEN_KEY, t).catch(() => undefined); },
      remove: async () => { memory = null; await secure.remove(DEVICE_TOKEN_KEY); },
    };
  }
  if (isNativePlatform()) return memoryStore;
  const ls = browserStorage();
  if (!ls) return memoryStore;
  return {
    kind: 'browser',
    async get() { try { return ls.getItem(DEVICE_TOKEN_KEY); } catch { return memory; } },
    async set(t) { memory = t; try { ls.setItem(DEVICE_TOKEN_KEY, t); } catch { /* private mode: memory only */ } },
    async remove() { memory = null; try { ls.removeItem(DEVICE_TOKEN_KEY); } catch { /* already gone */ } },
  };
}

/** What the display reports it runs on (the device's type in the POS). */
export function displayPlatform(): DisplayPlatform {
  try {
    const p = (globalThis as any).Capacitor?.getPlatform?.();
    if (isNativePlatform() && (p === 'android' || p === 'ios')) return p;
  } catch { /* not native */ }
  return 'web';
}

/**
 * The provisioning link from before pairing existed carried the credential in the address (`#device=…` / `?device=…`).
 * It is wiped from the address bar AND the history entry at once — whatever else happens — and returned for the store.
 */
let takenFromAddress: string | null | undefined;
/** tests only: forget that the address was already read */
export function resetAddressTokenMemo(): void { takenFromAddress = undefined; }
export function takeTokenFromAddress(): string | null {
  if (takenFromAddress !== undefined) return takenFromAddress;   // once per page load (React may run an initializer twice)
  takenFromAddress = readAndWipeAddressToken();
  return takenFromAddress;
}
function readAndWipeAddressToken(): string | null {
  if (typeof location === 'undefined' || typeof history === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const token = q.get('device') || q.get('deviceToken') || h.get('device') || h.get('deviceToken');
  if (!token) return null;
  for (const k of ['device', 'deviceToken']) { q.delete(k); h.delete(k); }
  const search = q.toString(); const hash = h.toString();
  try { history.replaceState(history.state, '', `${location.pathname}${search ? `?${search}` : ''}${hash ? `#${hash}` : ''}`); } catch { /* sandboxed */ }
  return token;
}
