// client.ts — the Customer App's API client: a thin wrapper over the ONE mobile transport (@aipowersalon/mobile-sdk
// createTransport — BUILD_PLAN Phase 13, Constitution 6 §11–16). The transport owns the base (read per call), /api/v1, the
// credential (Keychain bearer on native, the httpOnly cookie on the web), the client headers, timeouts, GET-only retry,
// Idempotency-Key and error normalisation. This file keeps the names every screen imports (api, apiBase, apiUrl) and adds
// the one customer-only rule: a guest never reaches private customer data.
import { runAsyncExport, type AsyncExportAs } from "@aipowersalon/api-client";   // BUILD_PLAN Phase 12: the one async export flow
import { buildApiUrl } from '@aipowersalon/api-client';
import { createTransport, recordApiLatency, type RequestOptions } from '@aipowersalon/mobile-sdk';
import { isGuest, isGuestAllowed } from '../auth/guest';

/**
 * The resolved API base. Empty means "same-origin" — correct on the web, FATAL in a native shell.
 * Re-resolved on each call, so a runtime `window.APS_API_BASE` override is honoured.
 */
export function apiBase(): string {
  return ((import.meta as any).env?.VITE_API_BASE as string)
    || (typeof window !== "undefined" && (window as any).APS_API_BASE)
    || "";
}

export const transport = createTransport({
  app: 'customer',
  apiBase,
  appVersion: () => (import.meta as any).env?.VITE_APP_VERSION as string | undefined,
  onTiming: recordApiLatency,   // C6 §119: API latency by timeout class + outcome (no URL) → client telemetry
});

/** The API base + /api/v1 + path, resolved per call. (/auth/refresh and /media stay where they are.) */
export function apiUrl(path: string, query?: Record<string, unknown>): string { return buildApiUrl(apiBase(), path, query); }   // = transport.apiUrl

type Opts = Omit<RequestOptions, 'body' | 'query'>;
// GUEST MODE: a guest has no session and must never reach private customer data. The backend refuses (these routes sit
// behind the session middleware); we refuse here too, before the request is sent. Two independent barriers.
function guard(path: string): void {
  if (isGuest() && !isGuestAllowed(path)) {
    throw Object.assign(new Error('Sign in to continue.'), { code: 'guest_requires_account', status: 401 });
  }
}
async function call<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
  guard(path);
  return transport.request<T>(method, path, opts);
}

export const api = {
  /** An export through the ONE async operation contract: Prefer: respond-async → poll → download. */
  exportAsync: <T = unknown>(p: string, query?: Record<string, unknown>, as?: AsyncExportAs) => { guard(p); return runAsyncExport<T>((path, init) => transport.raw(path, init), p, query, { as }); },
  /** Multipart upload — bearer on native, UPLOAD timeout, never retried. */
  upload: <T>(p: string, form: FormData, opts?: Opts) => { guard(p); return transport.upload<T>(p, form, opts); },
  get: <T>(p: string, query?: Record<string, unknown>, opts?: Opts) => call<T>('GET', p, { ...opts, query }),
  post: <T>(p: string, body?: Record<string, unknown>, opts?: Opts) => call<T>('POST', p, { ...opts, body }),
  patch: <T>(p: string, body?: Record<string, unknown>, opts?: Opts) => call<T>('PATCH', p, { ...opts, body }),
  del: <T>(p: string, opts?: Opts) => call<T>('DELETE', p, opts ?? {}),
};
