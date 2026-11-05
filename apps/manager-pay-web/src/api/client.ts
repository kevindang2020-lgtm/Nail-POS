// client.ts — the Manager Tap to Pay API client, built on the ONE mobile transport (@aipowersalon/mobile-sdk createTransport):
// /api/v1 URLs, the session cookie on the web and the Keychain bearer on native, client identity headers, timeouts, GET-only
// retry, normalised errors and `aps:unauthorized` on a 401. The exported names are unchanged, so no screen changed.
import { createTransport, configureMobileSdk } from '@aipowersalon/mobile-sdk';
import { clearNativeToken } from '../auth/native-auth';

// Resolution order: build-time VITE_API_BASE (set when the API is hosted on a separate origin), then a runtime
// window.APS_API_BASE override, then "" (same-origin — the default when each dist/ is served behind the API).
const BASE = ((import.meta as any).env?.VITE_API_BASE as string) || (typeof window !== "undefined" && (window as any).APS_API_BASE) || "";

const isNativeCheck = () => typeof window !== "undefined" && (
  Boolean((window as any).Capacitor?.isNativePlatform?.()) ||
  window.location.protocol === 'capacitor:' ||
  window.location.protocol === 'ionic:'
);
const DEFAULT_NATIVE_BASE = "https://app.aipowersalon.com:3000";

/**
 * The resolved API base. Empty means "same-origin" — correct on the web, FATAL in a native shell.
 *
 * Re-resolved on each call rather than captured at module load, so a runtime `window.APS_API_BASE` override is
 * actually honoured (and so the start-up check sees what the app will really use).
 */
export function apiBase(): string {
  const envBase = (import.meta as any).env?.VITE_API_BASE as string;
  if (envBase) return envBase;
  const runtimeBase = typeof window !== "undefined" ? (window as any).APS_API_BASE : "";
  if (isNativeCheck()) {
    return runtimeBase || DEFAULT_NATIVE_BASE;
  }
  if (typeof window !== "undefined" && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return "";
  }
  return runtimeBase || "";
}

/** The transport every API module of this app goes through (also used by authApi and the realtime stream). */
export const transport = createTransport({
  app: 'manager-pay',
  apiBase,
  appVersion: () => (import.meta as any).env?.VITE_APP_VERSION as string | undefined,
  // The session is gone (expired, or revoked server-side): the stored bearer is dead — wipe it so it is not resent forever.
  // (This app holds its principal in a screen rather than an AuthContext, so the clear happens at the source of the 401.)
  onUnauthorized: () => { void clearNativeToken(); },
});

export const api = {
  get: <T>(p: string, query?: Record<string, unknown>) => transport.get<T>(p, { query }),
  post: <T>(p: string, body?: Record<string, unknown>) => transport.post<T>(p, body),
  patch: <T>(p: string, body?: Record<string, unknown>) => transport.patch<T>(p, body),
  del: <T>(p: string) => transport.del<T>(p),
};

// The SDK's auth helpers (WebAuthn, Face ID, the native bootstrap) call the API through this app's client.
configureMobileSdk({ http: api, apiBase });
