import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearNativeToken } from './native-auth';
import { clearFaceId } from './faceid';
import { signalSignedOut } from '@aipowersalon/mobile-sdk';
import { registerPushToken, unregisterPushToken } from '../lib/push';
import { authApi, type Principal } from '../api/authApi';
import { exitGuestMode } from './guest';

// Client-side auth state for the Customer app. On mount it restores the session via GET /auth/me (the server reads the
// httpOnly cookie set at login and returns the principal, so a page reload keeps the user signed in); login stores the
// principal returned by POST /auth/login; logout clears the cookie + state. A 401 from any request drops the principal
// so the sign-in screen renders instead of a broken shell. Cross-origin deployments must serve the cookie SameSite=None
// + Secure for the reload restore to reach the API — that is server/deploy config, not this client.
interface AuthShape { principal: Principal | null; loading: boolean; setPrincipal: (p: Principal | null) => void; logout: () => Promise<void>; }
const AuthCtx = createContext<AuthShape>({ principal: null, loading: true, setPrincipal: () => {}, logout: async () => {} });

import { useWebPush } from '@aipowersalon/mobile-sdk/web-push';
import { api } from '../api/client';
import { openPushRoute } from '../lib/mobile-shell';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  useWebPush({ http: api, tenantId: principal?.tenantId || 'SYSTEM', userType: 'customer', userId: principal?.userId, app: 'customer', onTap: openPushRoute });

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (alive) {
        console.warn('[Auth] authApi.me() timed out after 3.5s; falling back to unauthenticated');
        setLoading(false);
      }
    }, 3500);

    authApi.me()
      .then((p) => { if (alive) setPrincipal(p && (p as any).role ? (p as Principal) : null); })
      .catch(() => { if (alive) setPrincipal(null); })
      .finally(() => {
        clearTimeout(timer);
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  // The session can die underneath us (expiry, or server-side revocation). The API client announces the 401;
  // drop the principal so the sign-in screen renders instead of a broken shell.
  useEffect(() => {
    const onUnauthorized = () => {
      // NATIVE: the session is gone (expired, or REVOKED server-side). The stored bearer token is now dead — if we
      // leave it in the Keychain it is resent on every request forever, and Face ID would keep unlocking a
      // credential the server has already rejected. Wipe it, then show the sign-in screen.
      void clearNativeToken();
      void clearFaceId();   // the device credential dies with the session (packages/mobile-sdk faceid.ts)
      setPrincipal(null);
    };
    window.addEventListener('aps:unauthorized', onUnauthorized);
    return () => window.removeEventListener('aps:unauthorized', onUnauthorized);
  }, []);
  const logout = async () => {
    exitGuestMode();
    await unregisterPushToken().catch(() => {});
    try { await authApi.logout(); } catch { /* ignore */ }
    await clearNativeToken();
    await clearFaceId();
    signalSignedOut();   // closes the live stream: a signed-out phone keeps no channel to the salon
    setPrincipal(null);
  };

  // Once a session exists (fresh login or restored via /auth/me), register this device's push token so
  // backgrounded-app pushes are delivered. No-ops on web; best-effort and never blocks the UI.
  useEffect(() => { if (principal) { void registerPushToken(); } }, [principal]);

  return <AuthCtx.Provider value={{ principal, loading, setPrincipal, logout }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
