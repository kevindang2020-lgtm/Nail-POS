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
const REFRESH_KEY = 'aps.session.refresh';   // Constitution 3 Step 2b: the rotating refresh token, beside the access token in the Keychain/Keystore

/**
 * In-memory fallback. Used on the web (where it is never populated) and in tests.
 * KEYED, like the interface says. It used to hold ONE value and ignore the key — `set(v)` silently took the KEY
 * as the value — which only mattered once a second key (the device id) shared the store: minting a device id
 * overwrote the session token slot. A test for that second key found it.
 */
export class InMemorySecureStore implements SecureStore {
  private readonly m = new Map<string, string>();
  async get(key: string) { return this.m.get(key) ?? null; }
  async set(key: string, value: string) { this.m.set(key, value); }
  async remove(key: string) { this.m.delete(key); }
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
  try { await store.remove(REFRESH_KEY); } catch { /* nothing else we can do */ }
}
/** Constitution 3 Step 2b: the refresh token the server issued to this native client (never on the web). */
export async function saveNativeRefreshToken(token: string | null | undefined): Promise<void> {
  if (!token) return;
  try { await store.set(REFRESH_KEY, token); } catch { /* the session still works until its access token expires */ }
}
export async function loadNativeRefreshToken(): Promise<string | null> {
  try { return await store.get(REFRESH_KEY); } catch { return null; }
}
/** Save both tokens from a login / select-branch / refresh response (native only; the web gets neither). */
export async function saveNativeSession(body: any): Promise<void> {
  await saveNativeToken(tokenFromResponse(body));
  await saveNativeRefreshToken(typeof body?.refreshToken === 'string' ? body.refreshToken : null);
}
/** The store installAuthRefresh needs on native: the Keychain-backed pair. */
export const nativeTokenStore = {
  loadAccess: () => loadNativeToken(),
  loadRefresh: () => loadNativeRefreshToken(),
  save: async (access: string | null, refresh: string | null) => { await saveNativeToken(access); await saveNativeRefreshToken(refresh); },
};

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
  const t = body?.accessToken || body?.token;
  return typeof t === 'string' && t.length > 0 ? t : null;
}

// ── Device identity (Constitution 12 §144–146) ──
//
// So the sessions list can say "Maria's iPhone (ios) · last used 2 minutes ago" instead of a blank row, and a lost
// phone can be revoked BY NAME. The id is a random value minted once per install and kept in the same secure store as
// the token; the name is a best-effort label. Both are DISPLAY data for the device's owner — no authorization ever
// rests on them, which is why the server accepts them from the client at all.
const DEVICE_KEY = 'aps.device.id';
export function devicePlatform(): 'ios' | 'android' | 'web' {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'web';
}
export function deviceName(appLabel: string): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const model = /iPad/i.test(ua) ? 'iPad' : /iPhone/i.test(ua) ? 'iPhone' : /Android/i.test(ua) ? 'Android phone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : 'Device';
  return `${model} · ${appLabel}`.slice(0, 80);
}
// Secure Tap to Pay M6-4: an app whose device id is ALSO a payment-device identity (manager-pay: the id its P-256 key is
// registered under) adopts that id here, so the login body (sessions.device_id — what a device revoke ends), the
// X-Device-ID header and the signed requests all name ONE id. null returns to the per-install secure-store id.
let adopted: string | null = null;
export function adoptDeviceId(id: string | null): void { adopted = id && /^[A-Za-z0-9_-]{16,128}$/.test(id) ? id : null; }
/** Per-install id, minted once and kept in the secure store. Never a hardware identifier (none is available, and none is needed). */
export async function deviceId(): Promise<string | null> {
  if (adopted) return adopted;
  try {
    const existing = await store.get(DEVICE_KEY);
    if (existing) return existing;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    await store.set(DEVICE_KEY, id);
    return id;
  } catch { return null; }
}
/** The `device` field for the login body. */
export async function deviceIdentity(appLabel: string): Promise<{ id: string | null; name: string; platform: string }> {
  return { id: await deviceId(), name: deviceName(appLabel), platform: devicePlatform() };
}

// ── Small non-token entries in the same secure store (BUILD_PLAN Phase 13 D) ──
// The Face ID marker (which credential this device holds, and whose — never the secret itself, which sits in the
// biometric-guarded item) lives here so screens can show "Face ID on" without prompting.
export async function secureStoreGet(key: string): Promise<string | null> { try { return await store.get(key); } catch { return null; } }
export async function secureStoreSet(key: string, value: string): Promise<void> { try { await store.set(key, value); } catch { /* the session still works */ } }
export async function secureStoreRemove(key: string): Promise<void> { try { await store.remove(key); } catch { /* already gone */ } }
