// client.ts — One typed fetch client all API modules use. Sends the session cookie; never a tenantId.
// Base is root-relative ("") so calls are /pos-direct — matching the backend (setGlobalPrefix("")) and the Front-Desk
// domain clients. Override via window.APS_API_BASE only if the API is ever served from a separate origin.
import { buildUrl, assertNoClientTenant, normalizeError, NormalizedError } from "./http-core";
import { authHeader, clearNativeToken } from '../auth/native-auth';

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

async function request<T>(method: string, path: string, opts?: { query?: Record<string, unknown>; body?: Record<string, unknown> }): Promise<T> {
  if (opts?.body) assertNoClientTenant(opts.body, path);
  // NATIVE: send the bearer token from the Keychain/Keystore. On the WEB this is always empty — the browser sends
  // the httpOnly cookie itself and there is no token in JavaScript to send, which is the protection we keep.
  const bearer = await authHeader();

  const res = await fetch(buildUrl(apiBase(), path, opts?.query), {
    method, credentials: "include",
    headers: { ...(opts?.body ? { "Content-Type": "application/json" } : {}), ...bearer },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: unknown = null; try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    // A 401 means the session is gone — expired, or REVOKED server-side ("sign out other devices", or an admin
    // killing a compromised session). Announce it so the app can return the user to sign-in rather than keep
    // rendering a shell where every screen errors.
    if (res.status === 401 && typeof window !== 'undefined') {
      // NATIVE: the session is gone (expired, or revoked server-side). The stored bearer token is dead — leaving
      // it in the Keychain means it is resent on every request forever. Wipe it. (This app holds its principal in
      // a screen rather than an AuthContext, so the clear happens here, at the source of the 401.)
      void clearNativeToken();
      window.dispatchEvent(new CustomEvent('aps:unauthorized'));
    }
    const e: NormalizedError = normalizeError(res.status, json); throw Object.assign(new Error(e.message), e);
  }
  return json as T;
}
export const api = {
  get: <T>(p: string, query?: Record<string, unknown>) => request<T>("GET", p, { query }),
  post: <T>(p: string, body?: Record<string, unknown>) => request<T>("POST", p, { body }),
  patch: <T>(p: string, body?: Record<string, unknown>) => request<T>("PATCH", p, { body }),
  del: <T>(p: string) => request<T>("DELETE", p),
};
