// client.ts — One typed fetch client all API modules use. Sends the session cookie; never a tenantId.
// Base is root-relative ("") so calls are /pos-direct — matching the backend (setGlobalPrefix("")) and the Front-Desk
// domain clients. Override via window.APS_API_BASE only if the API is ever served from a separate origin.
import { buildUrl, assertNoClientTenant, normalizeError, NormalizedError } from "./http-core";
import { authHeader } from '../auth/native-auth';

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
    // A 401 means the session is gone — expired, or REVOKED server-side (the user hit "sign out other devices",
    // or an admin killed a compromised session). Without this the app keeps rendering its shell while every
    // screen errors: it still LOOKS signed in but does nothing. Announce it; AuthContext returns them to login.
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aps:unauthorized'));
    }
    const e: NormalizedError = normalizeError(res.status, json); throw Object.assign(new Error(e.message), e);
  }
  return json as T;
}
export const api = {
  get: <T>(p: string, query?: Record<string, unknown>) => request<T>("GET", p, { query }),
  post: <T>(p: string, body?: Record<string, unknown>) => request<T>("POST", p, { body }),
  put: <T>(p: string, body?: Record<string, unknown>) => request<T>("PUT", p, { body }),
  patch: <T>(p: string, body?: Record<string, unknown>) => request<T>("PATCH", p, { body }),
  del: <T>(p: string) => request<T>("DELETE", p),
};
