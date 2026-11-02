import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authApi, type Principal } from '../api/authApi';
import { setOfflineCacheScope, clearOfflineReadCache } from '../api/offline-read-cache';
import { setDraftScope } from '../api/offline-drafts';
import { rememberSession, forgetSession, offlineSessionPrincipal, isNoConnection } from './offline-session';
import { webPush } from '../lib/webPush';   // developer merge (Oct 6 2026): browser push for the front desk (inert until configured)
import { WebPushToast } from '@aipowersalon/web-push';

// Client-side auth state for the POS. Restores via /auth/me on mount; login stores the principal returned by
// POST /auth/login (the httpOnly cookie rides along on later requests); logout clears cookie + state. Backend
// route-gating (middleware/guards) is a separate integration step, so today this gate is client-side and a reload
// won't auto-restore until /auth/me reflects the session.
/** offline: the POS was opened with no connection on the last user's remembered session (read-only, Decision 33). */
interface AuthShape { principal: Principal | null; loading: boolean; offline: boolean; setPrincipal: (p: Principal | null) => void; logout: () => Promise<void>; }
const AuthCtx = createContext<AuthShape>({ principal: null, loading: true, offline: false, setPrincipal: () => {}, logout: async () => {} });

// The offline copies / drafts belong to this user at this salon. Scoped when the principal is SET (not only in an effect),
// so the screens' first offline fetch already finds the right scope.
function scopeTo(p: Principal | null): void {
  const sc = p?.userId ? `${p.tenantId ?? ''}:${p.branchId ?? ''}:${p.userId}` : '';
  if (sc) setOfflineCacheScope(sc);
  setDraftScope(sc);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipalState] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  // Every principal that comes from the SERVER (login, /auth/me) is remembered for an offline reopen.
  const setPrincipal = (p: Principal | null) => {
    if (p) rememberSession(p); scopeTo(p); setPrincipalState(p); setOffline(false);
    // a person's own sign-in is the meaningful action behind the browser's push prompt (§58: never at page load)
    if (p) void webPush.noteMeaningfulAction();
  };
  // a session restored on load registers silently when the browser already allowed notifications; never prompts
  const signedInUserId = principal?.userId;
  useEffect(() => { if (signedInUserId && !offline) void webPush.resume(); }, [signedInUserId, offline]);
  useEffect(() => {
    let alive = true;
    authApi.me()
      .then((p) => { if (!alive) return; const ok = p && (p as any).role ? (p as Principal) : null; if (ok) rememberSession(ok); scopeTo(ok); setPrincipalState(ok); setOffline(false); })
      .catch((e) => {
        if (!alive) return;
        // Decision 33: no connection at all → the last user's remembered session, read-only (see offline-session.ts).
        const remembered = isNoConnection(e) ? offlineSessionPrincipal() : null;
        if (remembered) { scopeTo(remembered); setPrincipalState(remembered); setOffline(true); } else setPrincipalState(null);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  // Back online after an offline open: the server decides at once — a valid session continues, anything else signs out.
  useEffect(() => {
    if (!offline) return;
    const recheck = () => {
      authApi.me()
        .then((p) => { if (p && (p as any).role) { rememberSession(p as Principal); scopeTo(p as Principal); setPrincipalState(p as Principal); setOffline(false); } else { forgetSession(); setPrincipalState(null); setOffline(false); } })
        .catch((e) => { if (!isNoConnection(e)) { forgetSession(); setPrincipalState(null); setOffline(false); } });
    };
    window.addEventListener('online', recheck);
    return () => window.removeEventListener('online', recheck);
  }, [offline]);
  // A session can die underneath us — it expires, or it is REVOKED server-side ("sign out other devices", or an
  // admin killing a compromised session). The API client announces the 401; we drop the principal, which renders
  // the login screen instead of leaving the user in a broken shell.
  useEffect(() => {
    const onUnauthorized = () => { forgetSession(); setPrincipalState(null); setOffline(false); };   // revoked / expired: never reopen offline
    window.addEventListener('aps:unauthorized', onUnauthorized);
    return () => window.removeEventListener('aps:unauthorized', onUnauthorized);
  }, []);
  // Decision 33: offline copies belong to this user at this salon — a different sign-in drops them.
  useEffect(() => {
    const sc = principal?.userId ? `${principal.tenantId ?? ''}:${principal.branchId ?? ''}:${principal.userId}` : '';
    if (sc) setOfflineCacheScope(sc);
    setDraftScope(sc);   // Decision 33: offline draft notes are this user's at this salon (kept on sign-out, invisible to others)
  }, [principal?.userId, principal?.tenantId, principal?.branchId]);
  const logout = async () => { 
    await webPush.unregister();   // authenticated — BEFORE the session goes; a shared front-desk PC stops receiving this account's pushes
    try { await authApi.logout(); } catch { /* ignore */ } 
    localStorage.removeItem('pos_locked');
    clearOfflineReadCache();
    forgetSession();   // Decision 33: a signed-out device never reopens offline
    setPrincipalState(null); setOffline(false); 
  };
  return <AuthCtx.Provider value={{ principal, loading, offline, setPrincipal, logout }}>{children}<WebPushToast client={webPush} /></AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
