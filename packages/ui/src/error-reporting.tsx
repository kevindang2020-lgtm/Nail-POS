// error-reporting.tsx — Constitution 11 §125–130, §197–200: the one error boundary and reporter every web app uses.
//
// Seven apps had NO error boundary: an unexpected render error unmounted the whole tree and left a blank screen,
// with nothing sent anywhere. This gives each app, in one line at its root:
//   • a boundary that catches render errors and shows a recoverable screen, never a stack trace (§200);
//   • the request id of the most recent FAILED API call, shown as "Reference: req_…" so support can find the exact
//     server-side log lines (§198, §200) — captured by `noteResponse()` from each app's http client;
//   • global handlers for uncaught errors and unhandled promise rejections (§199);
//   • a best-effort report to POST /client-telemetry/errors — keepalive, fire-and-forget, deduplicated, capped per
//     page load, and it never throws: a reporter that crashes the page it is reporting on is worse than none (§284).
//
// PRIVACY (§130). The reporter sends message, stack, the route PATH (never the query string or hash) and the version.
// The server scrubs again, but nothing sensitive should leave the browser in the first place, so the message and
// stack are truncated here and the query string is never read.
import React from 'react';

export type ClientApp = 'pos' | 'admin' | 'owner' | 'tech' | 'customer' | 'manager-pay' | 'customer-display' | 'kiosk';
export type ErrorKind = 'render' | 'unhandled' | 'promise' | 'api';

interface Config { app: ClientApp; version: string; apiBase: string; send?: (url: string, body: string) => void }
let config: Config | null = null;
let lastFailedRequestId: string | null = null;
const sentFingerprints = new Set<string>();
let sentThisPage = 0;
export const MAX_REPORTS_PER_PAGE = 20;

const REQUEST_ID = /^req_[0-9A-Za-z]{10,40}$/;

/** Call once at app start. `send` is injectable for tests; the default uses fetch with keepalive. */
export function configureErrorReporting(c: Config): void {
  config = c;
  sentFingerprints.clear(); sentThisPage = 0; lastFailedRequestId = null;
}

/**
 * Each app's http client calls this with every response. A failed response's request id is remembered so the error
 * screen (and any crash report that follows) can quote it. Successful responses are ignored — the reference that
 * helps support is the one for the call that went WRONG.
 */
export function noteResponse(res: { ok: boolean; headers?: { get(name: string): string | null } } | null | undefined): void {
  try {
    if (!res || res.ok) return;
    const id = res.headers?.get('x-request-id');
    if (id && REQUEST_ID.test(id)) lastFailedRequestId = id;
  } catch { /* never */ }
}

export function lastRequestReference(): string | null { return lastFailedRequestId; }

let currentScreen: string | null = null;
/** Apps whose navigation is in memory (the tech / owner tab stacks never change the URL) name the visible screen here,
 *  so a crash report says WHERE it happened (Constitution 6 §118). A route template or path only — the server strips ids. */
export function setCurrentScreen(screen: string | null): void { currentScreen = screen ? String(screen).split('?')[0].slice(0, 120) : null; }

function currentPath(): string {
  if (currentScreen) return currentScreen;
  try { return typeof window !== 'undefined' ? window.location.pathname : '/'; } catch { return '/'; }   // PATH only (§130)
}

/** Constitution 6 §118: ios | android inside the Capacitor shell, web otherwise. Reads the Capacitor global (no import —
 *  packages/ui stays plugin-free). */
export function resolveClientPlatform(g: any = globalThis): 'ios' | 'android' | 'web' {
  try {
    const cap = g?.Capacitor;
    if (!cap?.isNativePlatform?.()) return 'web';
    const p = cap.getPlatform?.();
    return p === 'ios' || p === 'android' ? p : 'web';
  } catch { return 'web'; }
}

/** Best-effort, deduplicated, capped. Never throws, never awaits. */
export function reportClientError(kind: ErrorKind, error: unknown): void {
  try {
    if (!config || sentThisPage >= MAX_REPORTS_PER_PAGE) return;
    const e = error as { message?: unknown; stack?: unknown } | undefined;
    const message = String(e?.message ?? error ?? '').slice(0, 500);
    const stack = String(e?.stack ?? '').slice(0, 4000);
    const fingerprint = `${kind}|${message}|${stack.split('\n')[1] ?? ''}`;
    if (sentFingerprints.has(fingerprint)) return;                 // one report per distinct error per page
    sentFingerprints.add(fingerprint); sentThisPage++;
    const body = JSON.stringify({ app: config.app, kind, message, stack, route: currentPath(), version: config.version, platform: resolveClientPlatform(), requestId: lastFailedRequestId });
    const url = `${config.apiBase.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}/api/v1/client-telemetry/errors`;   // BUILD_PLAN Phase 12
    const send = config.send ?? ((u: string, b: string) => {
      void fetch(u, { method: 'POST', body: b, headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'include' }).catch(() => undefined);
    });
    send(url, body);
  } catch { /* a reporter never throws */ }
}

let globalsInstalled = false;
/** Uncaught errors and unhandled rejections (§199). Idempotent. */
export function installGlobalErrorHandlers(target: Pick<Window, 'addEventListener'> = window): void {
  if (globalsInstalled) return;
  globalsInstalled = true;
  target.addEventListener('error', (ev: any) => reportClientError('unhandled', ev?.error ?? ev?.message));
  target.addEventListener('unhandledrejection', (ev: any) => reportClientError('promise', ev?.reason));
}
export function resetGlobalHandlersForTests(): void { globalsInstalled = false; }

interface BoundaryState { error: Error | null; reference: string | null }

/**
 * The root boundary. Catches render errors below it, reports them, and shows a plain recovery screen with the
 * reference — never the error message or stack (§200: a message can carry data; a stack is for the server log).
 */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode; fallback?: (p: { reference: string | null; retry: () => void }) => React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, reference: null };
  static getDerivedStateFromError(error: Error): Partial<BoundaryState> { return { error, reference: lastRequestReference() }; }
  componentDidCatch(error: Error): void { reportClientError('render', error); }
  private retry = () => this.setState({ error: null, reference: null });
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ reference: this.state.reference, retry: this.retry });
    return (
      <div role="alert" style={{ padding: 32, maxWidth: 480, margin: '48px auto', textAlign: 'center', fontFamily: 'inherit' }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong on this screen</h1>
        <p style={{ marginBottom: 16 }}>Your data is safe. Try again, or reload the page.</p>
        {this.state.reference && (
          <p style={{ fontSize: 13, opacity: 0.8, marginBottom: 16 }}>
            If this keeps happening, give support this reference: <code data-testid="error-reference">{this.state.reference}</code>
          </p>
        )}
        <button type="button" onClick={this.retry} style={{ padding: '10px 20px', marginRight: 8 }}>Try again</button>
        <button type="button" onClick={() => { try { window.location.reload(); } catch { /* noop */ } }} style={{ padding: '10px 20px' }}>Reload</button>
      </div>
    );
  }
}

/**
 * The same resolution order every app's http client already uses: build-time VITE_API_BASE, then a runtime
 * window.APS_API_BASE, then "" (same origin). One copy here so the reporter posts where the app's API lives.
 */
export function resolveApiBase(env: Record<string, unknown> | undefined = (import.meta as any).env): string {
  try {
    return String(env?.VITE_API_BASE || (typeof window !== 'undefined' && (window as any).APS_API_BASE) || '');
  } catch { return ''; }
}
/** VITE_APP_VERSION when the build sets it; "unknown" until the deploy pipeline does (recorded in the final report). */
export function resolveAppVersion(env: Record<string, unknown> | undefined = (import.meta as any).env): string {
  try { return String(env?.VITE_APP_VERSION || 'unknown'); } catch { return 'unknown'; }
}

let fetchObserved = false;
/**
 * Wraps window.fetch ONCE so every response in the app reaches noteResponse() — twenty-plus call sites across the
 * apps, none of them edited. It reads only `ok` and one header, never the body, and returns the identical Response;
 * a rejection passes through untouched. No URL matching is needed: only our API sets a valid x-request-id, and
 * noteResponse ignores anything that is not one. Idempotent.
 */
export function installFetchObserver(target: { fetch: typeof fetch } = window): void {
  if (fetchObserved || typeof target.fetch !== 'function') return;
  fetchObserved = true;
  const original = target.fetch.bind(target);
  target.fetch = (async (...args: Parameters<typeof fetch>) => {
    const res = await original(...args);
    noteResponse(res);
    return res;
  }) as typeof fetch;
}
export function resetFetchObserverForTests(): void { fetchObserved = false; }

/**
 * One call at each app's root: configure, install the global handlers and the fetch observer. Returns nothing to
 * await and cannot throw — an app must start even if error reporting cannot.
 */
export function initErrorReporting(app: ClientApp): void {
  try {
    configureErrorReporting({ app, version: resolveAppVersion(), apiBase: resolveApiBase() });
    installGlobalErrorHandlers();
    installFetchObserver();
  } catch { /* never block app start */ }
}
