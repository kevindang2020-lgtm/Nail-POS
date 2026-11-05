// auth-refresh.ts — Constitution 3 Step 2b (Oct 3 2026): access tokens now live 15 minutes, so every app must renew its
// session SILENTLY instead of signing the user out. One wrapper around window.fetch per app (installed in main.tsx), so
// every API call — whatever file makes it — gets the same rule:
//   • a 401 from an API route → POST /auth/refresh ONCE (single-flight: concurrent 401s share one refresh) → retry the
//     original request ONCE with the new session;
//   • never for the sign-in routes themselves (login, refresh, logout, MFA, password reset, WebAuthn, customer auth) — a
//     wrong password is a 401 that a refresh must not hide;
//   • a failed refresh leaves the original 401 to the app (its existing "please sign in" path) and switches refreshing
//     OFF until a sign-in succeeds — no storm of refresh calls from a page with no session;
//   • web: the refresh token is an httpOnly cookie scoped to /auth/refresh — this code never sees it. Native (Capacitor):
//     the injected `native` store holds both tokens; the refresh sends them and saves the rotated pair.
import { buildApiUrl } from './api-version';

export interface NativeTokenStore {
  loadAccess(): Promise<string | null>;
  loadRefresh(): Promise<string | null>;
  save(access: string | null, refresh: string | null): Promise<void>;
}
export interface AuthRefreshOptions { apiBase?: string; native?: NativeTokenStore | null }

const NO_REFRESH = /\/(auth\/(login|refresh|logout|mfa|password-reset|webauthn|biometric\/login|super-admin|select-branch)|customer\/auth|public)\b/;   // Phase 13 D: a refused Face ID credential is an answer, not an expired session
/** Does this request go to our API (relative, or under apiBase) and is it a route a refresh may rescue? */
export function refreshableUrl(url: string, apiBase = '', origin = typeof location !== 'undefined' ? location.origin : ''): boolean {
  let path: string;
  try {
    const u = new URL(url, origin || 'http://localhost');
    const base = apiBase ? new URL(apiBase, origin || 'http://localhost') : null;
    if (base && u.origin !== base.origin) return false;
    if (!base && origin && u.origin !== origin) return false;
    path = u.pathname;
  } catch { return false; }
  return !NO_REFRESH.test(path);
}

export function installAuthRefresh(win: { fetch: typeof fetch }, opts: AuthRefreshOptions = {}): () => void {
  const original = win.fetch.bind(win);
  const base = (opts.apiBase ?? '').replace(/\/$/, '');
  let inflight: Promise<boolean> | null = null;
  let dead = false;   // a refresh failed: stay quiet until a sign-in succeeds

  const doRefresh = async (): Promise<boolean> => {
    try {
      const nativeRefresh = opts.native ? await opts.native.loadRefresh() : null;
      const nativeAccess = opts.native ? await opts.native.loadAccess() : null;
      const res = await original(buildApiUrl(base, '/auth/refresh'), {   // stays /auth/refresh: the cookie's Path (api-version.ts)
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(nativeAccess ? { Authorization: `Bearer ${nativeAccess}` } : {}) },
        body: JSON.stringify(nativeRefresh ? { refreshToken: nativeRefresh } : {}),
      });
      if (!res.ok) return false;
      if (opts.native) {
        const j: any = await res.json().catch(() => ({}));
        if (typeof j?.accessToken === 'string') await opts.native.save(j.accessToken, typeof j.refreshToken === 'string' ? j.refreshToken : null);
      }
      return true;
    } catch { return false; }
  };
  const refreshOnce = (): Promise<boolean> => {
    // Cleared as soon as it settles: callers that arrived while it ran already hold this promise (single flight); a 401
    // that arrives LATER must get a fresh refresh, not this one's old answer.
    if (!inflight) inflight = doRefresh().finally(() => { inflight = null; });
    return inflight;
  };

  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const retryable = !(input instanceof Request) || !(input as Request).body;   // a streamed Request body cannot be resent
    const copy = input instanceof Request ? (input as Request).clone() : input;
    const res = await original(input as any, init);
    if (/\/auth\/(login|refresh)\b/.test(url) && res.ok) dead = false;   // a successful sign-in re-arms refreshing
    if (res.status !== 401 || dead || !retryable || !refreshableUrl(url, base)) return res;
    const ok = await refreshOnce();
    if (!ok) { dead = true; return res; }
    let retryInit = init;
    if (opts.native) {
      const access = await opts.native.loadAccess();
      if (access) { const h = new Headers(init?.headers ?? (copy instanceof Request ? (copy as Request).headers : undefined)); h.set('Authorization', `Bearer ${access}`); retryInit = { ...(init ?? {}), headers: h }; }
    }
    return original(copy as any, retryInit);
  };
  win.fetch = wrapped as typeof fetch;
  return () => { win.fetch = original as typeof fetch; };
}
