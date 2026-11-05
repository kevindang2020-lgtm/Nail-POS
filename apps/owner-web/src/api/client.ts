// client.ts — the Owner app API client, built on the ONE mobile transport (@aipowersalon/mobile-sdk createTransport):
// /api/v1 URLs, the session cookie on the web and the Keychain bearer on native, client identity headers, timeouts, GET-only
// retry, normalised errors and `aps:unauthorized` on a 401. The exported names are unchanged, so no screen changed.
import { createTransport, configureMobileSdk } from '@aipowersalon/mobile-sdk';

const isNativeCheck = () => typeof window !== "undefined" && (
  Boolean((window as any).Capacitor?.isNativePlatform?.()) ||
  window.location.protocol === 'capacitor:' ||
  window.location.protocol === 'ionic:'
);
const DEFAULT_NATIVE_BASE = "https://app.aipowersalon.com:3000";

/**
 * The resolved API base.
 * Resolution order: build-time VITE_API_BASE, then runtime window.APS_API_BASE,
 * then https://app.aipowersalon.com:3000 if running inside native shell, otherwise "" (same-origin for web).
 */
export function apiBase(): string {
  return ((import.meta as any).env?.VITE_API_BASE as string)
    || (typeof window !== "undefined" && (window as any).APS_API_BASE)
    || (isNativeCheck() ? DEFAULT_NATIVE_BASE : "")
    || "";
}

/** The transport every API module of this app goes through (also used by authApi and the realtime stream). */
export const transport = createTransport({
  app: 'owner',
  apiBase,
  appVersion: () => (import.meta as any).env?.VITE_APP_VERSION as string | undefined,
});

export const api = {
  get: <T>(p: string, query?: Record<string, unknown>) => transport.get<T>(p, { query }),
  post: <T>(p: string, body?: Record<string, unknown>) => transport.post<T>(p, body),
  put: <T>(p: string, body?: Record<string, unknown>) => transport.put<T>(p, body),
  patch: <T>(p: string, body?: Record<string, unknown>) => transport.patch<T>(p, body),
  del: <T>(p: string) => transport.del<T>(p),
  upload: <T>(p: string, form: FormData) => transport.upload<T>(p, form),
};

// The SDK's auth helpers (WebAuthn, Face ID, the native bootstrap) call the API through this app's client.
configureMobileSdk({ http: api, apiBase });
