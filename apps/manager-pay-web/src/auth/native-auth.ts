// native-auth.ts — how the NATIVE mobile app holds its session.
//
// On the web, the session is an httpOnly cookie: JavaScript never sees the token, so an XSS bug cannot steal it.
// Nothing changes there.
//
// A native shell cannot use that cookie at all. Inside Capacitor/WebView the page origin is
// `capacitor://localhost`, so a call to `api.aipowersalon.com` is cross-site and a `SameSite=Lax` cookie is never
// sent. So native gets the token in the login response (the server returns it ONLY to native — it decides from
// the unforgeable `Origin` header, so a browser, and any XSS in it, can never ask for one) and sends it as
// `Authorization: Bearer`.
//
// ── Where the token lives ──
//
// The **Keychain (iOS) / Keystore (Android)**, never `localStorage`. On a rooted/jailbroken device localStorage
// is a plain file; the Keychain is hardware-backed and can be bound to biometric unlock.
//
// This module talks to whatever secure-storage plugin the shell provides
// (`@capacitor/preferences` with the Keychain backend, `capacitor-secure-storage-plugin`, etc.). It is injected
// rather than imported, so the web build stays free of native dependencies — and, importantly, **the web build
// never stores a token at all**, because it never receives one.

export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const KEY = 'aps.session.token';

/** In-memory fallback. Used on the web (where it is never populated) and in tests. */
export class InMemorySecureStore implements SecureStore {
  private v: string | null = null;
  async get() { return this.v; }
  async set(v: string) { this.v = v; }
  async remove() { this.v = null; }
}

let store: SecureStore = new InMemorySecureStore();
let cached: string | null = null;

/** Called once at native app start with the platform's Keychain/Keystore-backed store. */
export function setSecureStore(s: SecureStore): void {
  store = s;
  cached = null;
}

/** Persist the token the server issued to this native client. */
export async function saveNativeToken(token: string | null | undefined): Promise<void> {
  if (!token) return;
  cached = token;
  try { await store.set(KEY, token); } catch { /* keep the in-memory copy; the session still works this run */ }
}

export async function loadNativeToken(): Promise<string | null> {
  if (cached) return cached;
  try { cached = await store.get(KEY); } catch { cached = null; }
  return cached;
}

/** Sign-out must remove it. A token left in the Keychain outlives the sign-out and is exactly what an attacker
 *  with the device would look for. */
export async function clearNativeToken(): Promise<void> {
  cached = null;
  try { await store.remove(KEY); } catch { /* nothing else we can do */ }
}

/**
 * The Authorization header for a native request, or `{}` on the web.
 *
 * On the web this is ALWAYS empty: the browser sends the httpOnly cookie by itself, and there is no token to
 * send — which is the point.
 */
export async function authHeader(): Promise<Record<string, string>> {
  const t = await loadNativeToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Pull the token out of a login/select-branch response. Absent on the web — nothing to do there. */
export function tokenFromResponse(body: any): string | null {
  const t = body?.accessToken;
  return typeof t === 'string' && t.length > 0 ? t : null;
}
