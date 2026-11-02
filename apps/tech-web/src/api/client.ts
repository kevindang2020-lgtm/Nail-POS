// client.ts — the Technician App's API client: a thin wrapper over the ONE mobile transport (@aipowersalon/mobile-sdk
// createTransport — BUILD_PLAN Phase 13, Constitution 6 §11–16). The transport owns the base (read per call), /api/v1, the
// credential (Keychain bearer on native — uploads included — and the httpOnly cookie on the web), the client headers,
// timeouts, GET-only retry, Idempotency-Key and error normalisation. This file keeps the names every screen imports.
import { runAsyncExport, type AsyncExportAs } from "@aipowersalon/api-client";   // BUILD_PLAN Phase 12: the one async export flow
import { buildApiUrl } from '@aipowersalon/api-client';
import { createTransport, recordApiLatency, type RequestOptions } from '@aipowersalon/mobile-sdk';

/**
 * The resolved API base: build-time VITE_API_BASE, then runtime window.APS_API_BASE, otherwise "" (same-origin on the
 * web). A native build must be given an absolute https VITE_API_BASE (mobile-sdk initNative refuses anything else).
 * Read on every call, so a runtime override is honoured.
 */
export function apiBase(): string {
  return ((import.meta as any).env?.VITE_API_BASE as string)
    || (typeof window !== "undefined" && (window as any).APS_API_BASE)
    || "";
}

export const transport = createTransport({
  app: 'tech',
  apiBase,
  appVersion: () => (import.meta as any).env?.VITE_APP_VERSION as string | undefined,
  onTiming: recordApiLatency,   // C6 §119: API latency by timeout class + outcome (no URL) → client telemetry
});

/** The API base + /api/v1 + path, resolved per call. (/auth/refresh and /media stay where they are.) */
export function apiUrl(path: string, query?: Record<string, unknown>): string { return buildApiUrl(apiBase(), path, query); }   // = transport.apiUrl

type Opts = Omit<RequestOptions, 'body' | 'query'>;
export const api = {
  /** An export through the ONE async operation contract: Prefer: respond-async → poll → download. */
  exportAsync: <T = unknown>(p: string, query?: Record<string, unknown>, as?: AsyncExportAs) => runAsyncExport<T>((path, init) => transport.raw(path, init), p, query, { as }),
  /** Multipart upload — bearer on native, UPLOAD timeout, never retried. */
  upload: <T>(p: string, form: FormData, opts?: Opts) => transport.upload<T>(p, form, opts),
  get: <T>(p: string, query?: Record<string, unknown>, opts?: Opts) => transport.get<T>(p, { ...opts, query }),
  post: <T>(p: string, body?: Record<string, unknown>, opts?: Opts) => transport.post<T>(p, body, opts),
  patch: <T>(p: string, body?: Record<string, unknown>, opts?: Opts) => transport.patch<T>(p, body, opts),
  del: <T>(p: string, opts?: Opts) => transport.del<T>(p, opts),
};
