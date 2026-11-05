// client.ts — One typed fetch client all API modules use. Sends the session cookie; never a tenantId.
// Base is root-relative ("") so calls are /pos-direct — matching the backend (setGlobalPrefix("")) and the Front-Desk
// domain clients. Override via window.APS_API_BASE only if the API is ever served from a separate origin.
import { buildUrl, assertNoClientTenant, normalizeError, NormalizedError } from "./http-core";
import { isGuest, isGuestAllowed } from '../auth/guest';
import { authHeader } from '../auth/native-auth';

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
 * The resolved API base.
 */
export function apiBase(): string {
  return ((import.meta as any).env?.VITE_API_BASE as string)
    || (typeof window !== "undefined" && (window as any).APS_API_BASE)
    || (isNativeCheck() ? DEFAULT_NATIVE_BASE : "")
    || "";
}

async function request<T>(method: string, path: string, opts?: { query?: Record<string, unknown>; body?: Record<string, unknown> }): Promise<T> {
  if (opts?.body) assertNoClientTenant(opts.body, path);
  // GUEST MODE: a guest has no session, and must never reach private customer data. The backend already refuses
  // (these routes sit behind the session middleware), but we refuse here too — before the request is even sent —
  // so a guest can never so much as ask for someone's rewards balance or appointments. Two independent barriers.
  if (isGuest() && !isGuestAllowed(path)) {
    const e: any = new Error('Sign in to continue.');
    e.code = 'guest_requires_account';
    e.status = 401;
    throw e;
  }

  // NATIVE: send the bearer token from the Keychain. On the WEB this is always empty — the browser sends the
  // httpOnly cookie itself and there is no token in JavaScript to send, which is exactly the protection we keep.
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
    // Background endpoints (e.g. push-token registration, telemetry) must never kick the user out of their session.
    const isBackgroundRoute = /^\/(push|client-telemetry)(\/|$)/.test(path);
    if (res.status === 401 && typeof window !== 'undefined' && !isBackgroundRoute) {
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
