import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearNativeToken } from './native-auth';
import { signalSignedOut } from '@aipowersalon/mobile-sdk';
import { registerPushToken, unregisterPushToken } from '../lib/push';
import { authApi, type Principal } from '../api/authApi';

// Client-side auth state for the Technician app. On mount it attempts a session restore via /auth/me; login stores the
// principal returned by POST /auth/login (the httpOnly cookie is set by the server and rides along on later requests);
// logout clears the cookie + state. NOTE: backend route-gating (middleware/guards) is a separate integration step, so
// today this gate is client-side and a page reload won't auto-restore until /auth/me is wired to the session.
interface AuthShape { principal: Principal | null; loading: boolean; setPrincipal: (p: Principal | null) => void; logout: () => Promise<void>; }
const AuthCtx = createContext<AuthShape>({ principal: null, loading: true, setPrincipal: () => {}, logout: async () => {} });

import { useWebPush } from '@aipowersalon/mobile-sdk/web-push';
import { api } from '../api/client';
import { openPushRoute } from '../lib/mobile-shell';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  useWebPush({ http: api, tenantId: principal?.tenantId || 'SYSTEM', userType: principal?.role || 'owner', userId: principal?.userId, onTap: openPushRoute });

  useEffect(() => {
    let alive = true;
    authApi.me()
      .then((p) => { if (alive) setPrincipal(p && (p as any).role ? (p as Principal) : null); })
      .catch(() => { if (alive) setPrincipal(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // The session can die underneath us (expiry, or server-side revocation). The API client announces the 401;
  // drop the principal so the login screen renders instead of a broken shell.
  useEffect(() => {
    const onUnauthorized = () => {
      // NATIVE: the session is gone (expired, or REVOKED server-side). The stored bearer token is now dead — if we
      // leave it in the Keychain it is resent on every request forever, and Face ID would keep unlocking a
      // credential the server has already rejected. Wipe it, then show the sign-in screen.
      void clearNativeToken();
      setPrincipal(null);
    };
    window.addEventListener('aps:unauthorized', onUnauthorized);
    return () => window.removeEventListener('aps:unauthorized', onUnauthorized);
  }, []);
  const logout = async () => {
    // Hand the PUSH token back FIRST — /push/unregister is authenticated, so it must run while the session still
    // exists; clearing the cookie first would leave this device registered (and receiving pushes) forever.
    // See tech-web/src/lib/push.ts for the incident behind this ordering.
    await unregisterPushToken();
    try { await authApi.logout(); } catch { /* ignore */ }
    // A token left in the Keychain outlives the sign-out — exactly what someone with the device would look for.
    await clearNativeToken();
    signalSignedOut();   // closes the live stream: a signed-out phone keeps no channel to the salon
    setPrincipal(null);
  };

  // Once a session exists (fresh login or restored via /auth/me), register this device's push token so
  // backgrounded-app pushes are delivered. No-ops on web; best-effort and never blocks the UI.
  useEffect(() => { if (principal) { void registerPushToken(); } }, [principal]);

  return <AuthCtx.Provider value={{ principal, loading, setPrincipal, logout }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
