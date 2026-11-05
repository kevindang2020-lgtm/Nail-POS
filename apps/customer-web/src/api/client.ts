// client.ts — the Customer app API client, built on the ONE mobile transport (@aipowersalon/mobile-sdk createTransport):
// /api/v1 URLs, the session cookie on the web and the Keychain bearer on native, client identity headers, timeouts, GET-only
// retry, normalised errors and `aps:unauthorized` on a 401. The exported names are unchanged, so no screen changed.
import { createTransport, configureMobileSdk } from '@aipowersalon/mobile-sdk';
import { isGuest, isGuestAllowed } from '../auth/guest';

const isNativeCheck = () => typeof window !== "undefined" && (
  Boolean((window as any).Capacitor?.isNativePlatform?.()) ||
  window.location.protocol === 'capacitor:' ||
  window.location.protocol === 'ionic:'
);
const DEFAULT_NATIVE_BASE = "https://app.aipowersalon.com:3000";

/**
 * The resolved API base.
 */
export function apiBase(): string {
  return ((import.meta as any).env?.VITE_API_BASE as string)
    || (typeof window !== "undefined" && (window as any).APS_API_BASE)
    || (isNativeCheck() ? DEFAULT_NATIVE_BASE : "")
    || "";
}

/** The transport every API module of this app goes through (also used by authApi and the realtime stream). */
export const transport = createTransport({
  app: 'customer',
  apiBase,
  appVersion: () => (import.meta as any).env?.VITE_APP_VERSION as string | undefined,
});

// Guest mode is browsing only: a private route is refused here, before any request goes out.
function guard(path: string): void {
  if (isGuest() && !isGuestAllowed(path)) {
    const e: any = new Error('Sign in to continue.');
    e.code = 'guest_requires_account';
    e.status = 401;
    throw e;
  }
}
// Background calls (push registration, telemetry) never send the user back to sign-in on a 401.
const background = (path: string) => /^\/(push|client-telemetry)(\/|$)/.test(path);
const call = async <T>(method: string, p: string, o: { query?: Record<string, unknown>; body?: unknown } = {}): Promise<T> => {
  guard(p);
  return transport.request<T>(method, p, { ...o, notifyUnauthorized: !background(p) });
};

export const api = {
  get: <T>(p: string, query?: Record<string, unknown>) => call<T>('GET', p, { query }),
  post: <T>(p: string, body?: Record<string, unknown>) => call<T>('POST', p, { body }),
  patch: <T>(p: string, body?: Record<string, unknown>) => call<T>('PATCH', p, { body }),
  del: <T>(p: string) => call<T>('DELETE', p),
  upload: <T>(p: string, form: FormData) => { guard(p); return transport.upload<T>(p, form); },
};

// The SDK's auth helpers (WebAuthn, Face ID, the native bootstrap) call the API through this app's client.
configureMobileSdk({ http: api, apiBase });
