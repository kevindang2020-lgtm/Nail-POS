// client.ts — One typed fetch client all API modules use. Sends the session cookie; never a tenantId.
// Base is root-relative ("") so calls are /pos-direct — matching the backend (setGlobalPrefix("")) and the Front-Desk
// domain clients. Override via window.APS_API_BASE only if the API is ever served from a separate origin.
import { runAsyncExport, type AsyncExportAs } from "@aipowersalon/api-client";   // BUILD_PLAN Phase 12: the one async export flow
import { buildApiUrl, assertNoClientTenant, normalizeError, NormalizedError } from "@aipowersalon/api-client";
import { stepUpHandler, isStepUpRequired } from "./step-up";

// Resolution order: build-time VITE_API_BASE (set when the API is hosted on a separate origin), then a runtime
// window.APS_API_BASE override, then "" (same-origin — the default when each dist/ is served behind the API).
const BASE = ((import.meta as any).env?.VITE_API_BASE as string) || (typeof window !== "undefined" && (window as any).APS_API_BASE) || "";
/** BUILD_PLAN Phase 12 (Constitution 5 #57): BASE + /api/v1 + path — every call Super Admin makes. (/auth/refresh stays put.) */
export function apiUrl(path: string, query?: Record<string, unknown>): string { return buildApiUrl(BASE, path, query); }

async function request<T>(method: string, path: string, opts?: { query?: Record<string, unknown>; body?: Record<string, unknown>; headers?: Record<string, string> }, retried = false): Promise<T> {
  if (opts?.body) assertNoClientTenant(opts.body, path);
  const res = await fetch(apiUrl(path, opts?.query), {
    method, credentials: "include",
    headers: opts?.body || opts?.headers ? { ...(opts?.body ? { "Content-Type": "application/json" } : {}), ...(opts?.headers ?? {}) } : undefined,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: unknown = null; try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    // Constitution 7 §8 — a critical action asked for a fresh step-up: prompt, then retry exactly once
    const h = stepUpHandler();
    if (!retried && h && isStepUpRequired(res.status, json) && await h()) return request<T>(method, path, opts, true);
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
async function requestText(path: string, query?: Record<string, unknown>): Promise<string> {
  const res = await fetch(apiUrl(path, query), { method: "GET", credentials: "include" });
  if (!res.ok) { let json: unknown = null; try { json = await res.json(); } catch { /* empty */ } const e: NormalizedError = normalizeError(res.status, json); throw Object.assign(new Error(e.message), e); }
  return res.text();
}
async function requestBlob(path: string, query?: Record<string, unknown>): Promise<Blob> {
  const res = await fetch(apiUrl(path, query), { method: "GET", credentials: "include" });
  if (!res.ok) { let json: unknown = null; try { json = await res.json(); } catch { /* empty */ } const e: NormalizedError = normalizeError(res.status, json); throw Object.assign(new Error(e.message), e); }
  return res.blob();
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST", credentials: "include",
    body: formData,
  });
  let json: unknown = null; try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aps:unauthorized'));
    }
    const e: NormalizedError = normalizeError(res.status, json); throw Object.assign(new Error(e.message), e);
  }
  return json as T;
}

/** The API origin ("" = same origin) — read by the session-refresh wrapper installed in main.tsx. */
export const apiBase = BASE;
// BUILD_PLAN Phase 12 (Constitution 5 §32–33): the transport the async export helper polls and downloads through — the
// same URL builder (apiUrl: base + /api/v1) and session as every other call, so statusUrl / downloadUrl get this app's prefix.
const rawGet = async (path: string, init: { query?: Record<string, unknown>; headers?: Record<string, string> }) =>
  fetch(apiUrl(path, init.query), { method: "GET", credentials: "include", headers: init.headers });
export const api = {
  /** An export through the ONE async operation contract: Prefer: respond-async → poll → download; resolves to the same
   *  value the synchronous call did (its JSON envelope, its text, or a Blob — `as`). */
  exportAsync: <T = unknown>(p: string, query?: Record<string, unknown>, as?: AsyncExportAs) => runAsyncExport<T>(rawGet, p, query, { as }),
  get: <T>(p: string, query?: Record<string, unknown>) => request<T>("GET", p, { query }),
  getBlob: (p: string, query?: Record<string, unknown>) => requestBlob(p, query),
  getText: (p: string, query?: Record<string, unknown>) => requestText(p, query),
  post: <T>(p: string, body?: Record<string, unknown>) => request<T>("POST", p, { body }),
  /** POST with one Idempotency-Key (Constitution 5 §61–66): a retry of the same submission runs once on the server. */
  postOnce: <T>(p: string, body: Record<string, unknown> | undefined, idempotencyKey: string) => request<T>("POST", p, { body, headers: { "Idempotency-Key": idempotencyKey } }),
  put: <T>(p: string, body?: Record<string, unknown>) => request<T>("PUT", p, { body }),
  patch: <T>(p: string, body?: Record<string, unknown>) => request<T>("PATCH", p, { body }),
  del: <T>(p: string) => request<T>("DELETE", p),
  upload: <T>(p: string, formData: FormData) => upload<T>(p, formData),
};
