// client.ts — One typed fetch client all API modules use. Sends the session cookie; never a tenantId.
// Base is root-relative ("") so calls are /pos-direct — matching the backend (setGlobalPrefix("")) and the Front-Desk
// domain clients. Override via window.APS_API_BASE only if the API is ever served from a separate origin.
import { runAsyncExport, type AsyncExportAs } from "@aipowersalon/api-client";   // BUILD_PLAN Phase 12: the one async export flow
import { assertNoClientTenant, normalizeError, NormalizedError } from "@aipowersalon/api-client";
import { API_ORIGIN, apiUrl } from "./apiBase";
import { record as recordApiTiming } from "./apiPerf";
import { POS_CLIENT_TYPE } from "@aipowersalon/api-contracts";
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { apiErrorMessage } from '../i18n/error-text';

// Kevin, Oct 12 2026: the POS auto-lock is enforced by the SERVER on POS device sessions. The POS says who it is on every call —
// at sign-in the server stores the session as a POS session (sessions.client_app) and idle-locks it after the salon's minutes.
// Not a credential (a client that omits it only skips the idle clock of a session it already owns).
const CLIENT_TYPE = { "X-Client-Type": POS_CLIENT_TYPE } as const;

// Resolution order: build-time VITE_API_BASE (set when the API is hosted on a separate origin), then a runtime
// window.APS_API_BASE override, then "" (same-origin — the default when each dist/ is served behind the API).
// (BUILD_PLAN Phase 12: resolved in ./apiBase, and every request goes to /api/v1/<path> — apiUrl.)
const BASE = API_ORIGIN;

// Vietnamese POS mandate §22 (WP-D1): the thrown error's message is the cashier's language — errors.<code> from ns/errors
// (i18n/error-text.ts apiErrorMessage). `code` stays the authority screens branch on; `serverMessage` keeps the server's text.
function localizedError(e: NormalizedError): Error {
  const env = e.details?.error as { details?: Record<string, unknown> } | undefined;
  const message = apiErrorMessage(e.code, env?.details ?? e.details, e.message);
  return Object.assign(new Error(message), e, { message, serverMessage: e.message });
}

async function request<T>(method: string, path: string, opts?: { query?: Record<string, unknown>; body?: Record<string, unknown>; headers?: Record<string, string> }): Promise<T> {
  if (opts?.body) assertNoClientTenant(opts.body, path);
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  try {
    const res = await fetch(apiUrl(path, opts?.query), {
      method, credentials: "include",
      headers: { ...(opts?.body ? { "Content-Type": "application/json" } : {}), ...CLIENT_TYPE, ...(opts?.headers ?? {}) },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
    let json: unknown = null; try { json = await res.json(); } catch { /* empty */ }
    // Phase 9 (authorization version): the API re-authorized this request from the CURRENT grants because the session's
    // were stale — tell the shell so the sidebar / screens ask again (shell/tenant-access.ts AUTHORIZATION_CHANGED_EVENT).
    if (typeof window !== 'undefined' && res.headers?.get?.('x-authorization-changed') === '1') window.dispatchEvent(new CustomEvent('aps:authorization-changed'));
    if (!res.ok) {
      // A 401 means the session is gone — expired, or REVOKED (e.g. the user hit "sign out other devices", or an
      // admin killed a compromised session). Without this, every screen would just surface an error and the user
      // would sit in a half-dead app. Announce it once; AuthContext listens and returns them to the login page.
      if (res.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aps:unauthorized'));
      }
      throw localizedError(normalizeError(res.status, json));
    }
    return json as T;
  } finally {
    recordApiTiming(method, path, (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
  }
}
// Multipart upload (the browser sets the boundary). Same session cookie, timing, 401 broadcast and error shape as request().
async function upload<T>(path: string, form: FormData): Promise<T> {
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  try {
    const res = await fetch(apiUrl(path), { method: "POST", credentials: "include", headers: { ...CLIENT_TYPE }, body: form });
    let json: unknown = null; try { json = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('aps:unauthorized'));
      throw localizedError(normalizeError(res.status, json));
    }
    return json as T;
  } finally {
    recordApiTiming("POST", path, (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
  }
}
// BUILD_PLAN Phase 12 (Constitution 5 §32–33): the transport the async export helper polls and downloads through — the
// same URL builder (apiUrl: base + /api/v1) and session as every other call, so statusUrl / downloadUrl get this app's prefix.
const rawGet = async (path: string, init: { query?: Record<string, unknown>; headers?: Record<string, string> }) =>
  fetch(apiUrl(path, init.query), { method: "GET", credentials: "include", headers: { ...CLIENT_TYPE, ...(init.headers ?? {}) } });
export const api = {
  /** An export through the ONE async operation contract: Prefer: respond-async → poll → download; resolves to the same
   *  value the synchronous call did (its JSON envelope, its text, or a Blob — `as`). */
  exportAsync: <T = unknown>(p: string, query?: Record<string, unknown>, as?: AsyncExportAs) => runAsyncExport<T>(rawGet, p, query, { as }),
  upload: <T>(p: string, form: FormData) => upload<T>(p, form),
  get: <T>(p: string, query?: Record<string, unknown>) => request<T>("GET", p, { query }),
  /** `headers` (optional): e.g. an Idempotency-Key for a create that must never run twice on a retry */
  post: <T>(p: string, body?: Record<string, unknown>, headers?: Record<string, string>) => request<T>("POST", p, { body, headers }),
  patch: <T>(p: string, body?: Record<string, unknown>) => request<T>("PATCH", p, { body }),
  put: <T>(p: string, body?: Record<string, unknown>) => request<T>("PUT", p, { body }),
  del: <T>(p: string) => request<T>("DELETE", p),
};
export const apiBase = BASE;
export { apiUrl };

/**
 * posHttp — Oct 21 2026 (Oct 19 audit item): THE raw-fetch helper for the POS api modules that speak RequestInit
 * (checkout, queue, booking, check-in, …). Fourteen of them carried a private copy that sent no X-Client-Type (the
 * server's POS idle clock heard nothing from a busy till) and told nobody about a 401 (a dead session was a per-screen
 * error). One place now: credentials, Accept / Content-Type, X-Client-Type, timing, the authorization-changed and
 * unauthorized announcements, and the module's own error mapping through `mapError` (409 details, 402 texts).
 * `path` is an absolute API URL (the module's BASE + path) or a bare /pos/… path.
 */
export class PosHttpError extends Error {
  /** the server's error code (ERROR_REGISTRY) — the authority; the message is its localized text */
  public code?: string;
  constructor(message: string, public status: number, public body?: any, code?: string) { super(message); this.name = 'PosHttpError'; this.code = code; }
}
/** the error code a server body carries: the standard envelope `error.code` first, then the top-level twin */
const codeOf = (body: any): string | undefined => (typeof body?.error?.code === 'string' ? body.error.code : typeof body?.code === 'string' ? body.code : undefined);
export interface PosHttpOptions {
  /** map a non-OK answer to the module's own error (return undefined for the default PosHttpError) */
  mapError?: (status: number, body: any, message: string) => Error | undefined;
}
export async function posHttp<T>(path: string, init?: RequestInit, opts?: PosHttpOptions): Promise<T> {
  const url = /^https?:\/\//.test(path) || path.startsWith('/api/') ? path : apiUrl(path);
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  try {
    const res = await fetch(url, { credentials: 'include', ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...CLIENT_TYPE, ...((init?.headers as Record<string, string>) ?? {}) } });
    if (typeof window !== 'undefined' && res.headers?.get?.('x-authorization-changed') === '1') window.dispatchEvent(new CustomEvent('aps:authorization-changed'));
    if (res.status === 401) { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('aps:unauthorized')); const m = t('errors.client.notSignedIn'); throw opts?.mapError?.(401, null, m) ?? new PosHttpError(m, 401, undefined, 'AUTH_REQUIRED'); }
    if (!res.ok) {
      let body: any; try { body = await res.json(); } catch { body = undefined; }
      const serverMessage = res.status === 403 ? (body?.error?.message || body?.message || t('pos.you_do_not_have_permission_for_1gye'))
        : (Array.isArray(body?.message) ? body.message.join(' ') : body?.error?.message || body?.message) || res.statusText;
      const code = codeOf(body);
      // §22: the message in the cashier's language for a known code; the server's English only for an unknown one
      const message = apiErrorMessage(code, body?.error?.details ?? body?.details ?? body, serverMessage);
      throw opts?.mapError?.(res.status, body, message) ?? new PosHttpError(message, res.status, body, code);
    }
    if (res.status === 204) return undefined as unknown as T;
    // an answer the screen cannot read (HTML from a proxy, a truncated body) is an error WITH the status — never a bare SyntaxError
    let parsed: any; let readable = true;
    try { const t = typeof (res as any).text === 'function' ? await res.text() : JSON.stringify(await (res as any).json()); parsed = t ? JSON.parse(t) : null; } catch { readable = false; }
    if (!readable) { const m = t('errors.client.unreadable'); throw opts?.mapError?.(res.status, undefined, m) ?? new PosHttpError(m, res.status); }
    return parsed as T;
  } finally {
    recordApiTiming((init?.method as string) || 'GET', url, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  }
}
