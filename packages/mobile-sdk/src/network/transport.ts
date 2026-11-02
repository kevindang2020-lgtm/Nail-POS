// transport.ts — BUILD_PLAN Phase 13 (Constitution 6 §11–16): the ONE mobile transport.
//
// Before this, each of the four Capacitor apps had its own `api/client.ts` (they had drifted: one captured the base at
// load, one sent no bearer on uploads, none had a timeout) plus three hand-rolled `authApi.http()`. Every app now builds
// its client from `createTransport({ app, apiBase })` and keeps its exported function names, so no screen changed.
//
// What every call gets, on every method:
//   • the base read at CALL time (`apiBase()`), `/api/v1` via `buildApiUrl` (Phase 12)
//   • the credential: on NATIVE the Keychain bearer (`authHeader()`), uploads and raw export GETs included; on the WEB
//     no token exists in JavaScript — the browser sends the httpOnly cookie (`credentials: 'include'`)
//   • X-Client-Type (the app id), X-Client-Version (the build's VITE_APP_VERSION — omitted when unknown, never
//     "unknown"), X-Client-Platform (ios | android | web), X-Device-ID (the per-install id), X-Request-ID (one per
//     logical request; the server adopts it as the correlation id)
//   • a timeout by class (FAST 8 s, NORMAL 20 s, UPLOAD 120 s, LONG 60 s) with an AbortController, chained to the
//     caller's own AbortSignal
//   • retry ONLY for GET (and only on a network failure, a timeout or 502/503/504), jittered exponential backoff. A POST
//     is never retried here — a mutation that may have landed is the caller's decision, with its Idempotency-Key.
//   • `idempotencyKey` → `Idempotency-Key`
//   • errors normalised by `normalizeError` (status, code, message, action, details); a network failure is status 0
//     with code NETWORK_ERROR / NETWORK_TIMEOUT (action RETRY); a caller abort is an AbortError with code ABORTED
//   • a 401 announces `aps:unauthorized` (the app returns to sign-in) unless the caller opted out (sign-in calls)
//   • the outcome feeds NetworkState (online / offline / degraded)
import { Capacitor } from '@capacitor/core';
import { assertNoClientTenant, buildApiUrl, normalizeError, type NormalizedError, type RawResponse } from '@aipowersalon/api-client';
import { authHeader, deviceId, devicePlatform } from '../native-auth';
import { isNativePlatform } from '../capacitor-adapters';
import { networkState } from './network-state';
import { localizedErrorMessage } from '../i18n/error-message';

export type MobileAppId = 'customer' | 'tech' | 'owner' | 'manager-pay';
export type TimeoutClass = 'FAST' | 'NORMAL' | 'UPLOAD' | 'LONG';
export const TIMEOUTS: Record<TimeoutClass, number> = { FAST: 8_000, NORMAL: 20_000, UPLOAD: 120_000, LONG: 60_000 };
/** Statuses a GET is retried on: the gateway / server said "not now", not "no". */
const RETRYABLE_STATUS = new Set([502, 503, 504]);

export interface TransportConfig {
  app: MobileAppId;
  /** The API base, read on EVERY call: '' (same-origin) on the web, an absolute https origin on native. */
  apiBase: () => string;
  /** The build's version (VITE_APP_VERSION). Absent → the header is omitted. */
  appVersion?: () => string | undefined | null;
  /** Extra work on a 401 before `aps:unauthorized` is announced (manager-pay wipes its Keychain token here). */
  onUnauthorized?: () => void;
  /** GET retries after the first attempt (default 2). */
  maxRetries?: number;
  /** Injection for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Agent E (observability): one call per logical request after its final attempt — class, duration, outcome. Never a
   *  URL, path or body (privacy). A throwing hook never affects the request. */
  onTiming?: (t: { timeoutClass: TimeoutClass; ms: number; outcome: 'ok' | 'error' | 'timeout' | 'offline' | 'aborted' }) => void;
  /** Secure Tap to Pay M6-4: extra headers computed PER ATTEMPT from the exact method, URL and body string that go on the
   *  wire (manager-pay signs its /mobile-checkout calls with the phone's key — a fresh nonce for every attempt, so a GET
   *  retry is never a replay). null → nothing added. A throw fails the request (it is never sent unsigned by accident). */
  requestHeaders?: (r: { method: string; url: string; body: string | undefined; isForm: boolean }) => Promise<Record<string, string> | null>;
}

export interface RequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  timeout?: TimeoutClass;
  signal?: AbortSignal;
  idempotencyKey?: string;
  headers?: Record<string, string>;
  /** false: a 401 is just an error (sign-in, me) — no `aps:unauthorized`. Default true. */
  notifyUnauthorized?: boolean;
}

export type TransportError = Error & NormalizedError;

export interface Transport {
  readonly app: MobileAppId;
  apiBase(): string;
  apiUrl(path: string, query?: Record<string, unknown>): string;
  request<T>(method: string, path: string, opts?: RequestOptions): Promise<T>;
  get<T>(path: string, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  put<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  patch<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  del<T>(path: string, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  /** Multipart upload: bearer on native, UPLOAD timeout, never retried, the browser sets the boundary. */
  upload<T>(path: string, form: FormData, opts?: Omit<RequestOptions, 'body'>): Promise<T>;
  /** A raw GET Response (the async export helper's transport): same headers, credential and base; LONG timeout. */
  raw(path: string, init?: { query?: Record<string, unknown>; headers?: Record<string, string>; signal?: AbortSignal }): Promise<RawResponse>;
  /** The headers every call carries (client identity + credential) — for the few non-fetch consumers. */
  clientHeaders(): Promise<Record<string, string>>;
}

/** ios | android on a native shell, web in a browser (a phone's browser is still web). */
export function clientPlatform(): 'ios' | 'android' | 'web' {
  if (!isNativePlatform()) return 'web';
  try {
    const p = ((globalThis as any).Capacitor ?? Capacitor)?.getPlatform?.();
    if (p === 'ios' || p === 'android') return p;
  } catch { /* fall through */ }
  return devicePlatform() === 'android' ? 'android' : 'ios';
}

/** `cli_` + a UUID: the server's inbound-id rule ([A-Za-z0-9_.:-]{8,128}) accepts it. */
export function newClientRequestId(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return 'cli_' + c.randomUUID();
  return 'cli_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

function clientError(code: 'NETWORK_ERROR' | 'NETWORK_TIMEOUT' | 'ABORTED', message: string): TransportError {
  const e = new Error(message) as TransportError;
  Object.assign(e, { status: 0, code, message, action: code === 'ABORTED' ? 'NONE' : 'RETRY', details: {} });
  if (code === 'ABORTED') e.name = 'AbortError';
  return e;
}

export function createTransport(cfg: TransportConfig): Transport {
  const doFetch = (u: string, i: RequestInit) => (cfg.fetchImpl ?? fetch)(u, i);
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = cfg.random ?? Math.random;
  const maxRetries = Math.max(0, cfg.maxRetries ?? 2);
  const apiUrl = (path: string, query?: Record<string, unknown>) => buildApiUrl(cfg.apiBase(), path, query);

  async function clientHeaders(): Promise<Record<string, string>> {
    const h: Record<string, string> = { 'X-Client-Type': cfg.app, 'X-Client-Platform': clientPlatform() };
    const v = cfg.appVersion?.();
    if (v && v !== 'unknown') h['X-Client-Version'] = String(v);
    const d = await deviceId();
    if (d) h['X-Device-ID'] = d;
    return { ...h, ...(await authHeader()) };
  }

  /** One attempt with a timeout chained to the caller's signal. Throws a TransportError for network / timeout / abort. */
  async function attempt(url: string, init: RequestInit, budgetMs: number, signal?: AbortSignal): Promise<Response> {
    if (signal?.aborted) throw clientError('ABORTED', 'The request was cancelled.');
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, budgetMs);
    const onAbort = () => ac.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      return await doFetch(url, { ...init, signal: ac.signal });
    } catch {
      if (timedOut) throw clientError('NETWORK_TIMEOUT', 'The server took too long to answer. Check your connection and try again.');
      if (signal?.aborted) throw clientError('ABORTED', 'The request was cancelled.');
      throw clientError('NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function send(method: string, path: string, opts: RequestOptions, kind: 'json' | 'upload' | 'raw'): Promise<Response> {
    const m = method.toUpperCase();
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    if (opts.body && !isForm && typeof opts.body === 'object') assertNoClientTenant(opts.body as Record<string, unknown>, path);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(opts.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
      ...(await clientHeaders()),
      'X-Request-ID': newClientRequestId(),
      ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
    };
    const body = opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body);
    const timeoutClass: TimeoutClass = opts.timeout ?? (kind === 'upload' ? 'UPLOAD' : kind === 'raw' ? 'LONG' : 'NORMAL');
    const budget = TIMEOUTS[timeoutClass];
    const started = Date.now();
    const timing = (outcome: 'ok' | 'error' | 'timeout' | 'offline' | 'aborted') => {
      try { cfg.onTiming?.({ timeoutClass, ms: Date.now() - started, outcome }); } catch { /* never into the request path */ }
    };
    const url = apiUrl(path, opts.query);
    const retries = m === 'GET' && kind !== 'upload' ? maxRetries : 0;   // NEVER a mutation

    for (let n = 0; ; n++) {
      let res: Response | null = null;
      let err: TransportError | null = null;
      let sendHeaders = headers;
      if (cfg.requestHeaders) {
        const extra = await cfg.requestHeaders({ method: m, url, body: typeof body === 'string' ? body : undefined, isForm });   // a throw → the caller sees it; nothing is sent
        if (extra) sendHeaders = { ...headers, ...extra };
      }
      try { res = await attempt(url, { method: m, credentials: 'include', headers: sendHeaders, body }, budget, opts.signal); }
      catch (e) { err = e as TransportError; }
      if (err?.code === 'ABORTED') { timing('aborted'); throw err; }                         // the caller's decision: not a failure, not retried
      const failed = !!err || (res !== null && res.status >= 500);
      if (failed) networkState.recordFailure(); else networkState.recordSuccess();
      const retryable = !!err || (res !== null && RETRYABLE_STATUS.has(res.status));
      if (retryable && n < retries && !opts.signal?.aborted) {
        const cap = 250 * 2 ** n;                                     // 250 ms, 500 ms, 1 s …
        await sleep(Math.round(cap / 2 + random() * (cap / 2)));     // jittered: spreads a fleet's retries
        continue;
      }
      if (err) { timing(err.code === 'NETWORK_TIMEOUT' ? 'timeout' : networkState.isOnline() ? 'error' : 'offline'); throw err; }
      timing(res!.status < 500 ? 'ok' : 'error');
      return res!;
    }
  }

  async function toResult<T>(res: Response, opts: RequestOptions): Promise<T> {
    let json: unknown = null;
    try { json = await res.json(); } catch { /* empty or non-JSON body */ }
    if (!res.ok) {
      if (res.status === 401 && opts.notifyUnauthorized !== false) {
        try { cfg.onUnauthorized?.(); } catch { /* never mask the 401 */ }
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('aps:unauthorized'));
      }
      // BUILD_PLAN Phase 13 (agent B): a 426 UPDATE_REQUIRED flips the AppConfigGate to its hard update screen
      // (config/events.ts UPDATE_REQUIRED_EVENT — same name, kept literal so the transport has no dependency on it).
      if (res.status === 426 && (json as any)?.code === 'UPDATE_REQUIRED' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aps:update-required', { detail: json }));
      }
      const e = normalizeError(res.status, json);
      // V-5 (Oct 27 2026): the message in the user's language when the app has the code's text (errors.<CODE>); `code`,
      // `details` and the server's own sentence (`serverMessage`) stay for the screens that branch on them
      const message = localizedErrorMessage(e.code, e.details as Record<string, unknown>, e.message);
      throw Object.assign(new Error(message), e, { message, serverMessage: e.message }) as TransportError;
    }
    return json as T;
  }

  const request = async <T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> =>
    toResult<T>(await send(method, path, opts, 'json'), opts);

  return {
    app: cfg.app,
    apiBase: () => cfg.apiBase(),
    apiUrl,
    request,
    get: (p, o) => request('GET', p, o),
    post: (p, b, o) => request('POST', p, { ...o, body: b }),
    put: (p, b, o) => request('PUT', p, { ...o, body: b }),
    patch: (p, b, o) => request('PATCH', p, { ...o, body: b }),
    del: (p, o) => request('DELETE', p, o),
    upload: async (p, form, o = {}) => toResult(await send('POST', p, { ...o, body: form }, 'upload'), o),
    raw: async (p, init = {}) => send('GET', p, { query: init.query, headers: init.headers, signal: init.signal }, 'raw') as unknown as Promise<RawResponse>,
    clientHeaders,
  };
}
