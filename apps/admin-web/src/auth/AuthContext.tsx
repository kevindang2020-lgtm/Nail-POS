import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authApi, type Principal } from '../api/authApi';

// Client-side auth state for the Super-Admin app. On mount it attempts a session restore via /auth/me; login stores the
// principal returned by POST /auth/login (the httpOnly cookie is set by the server and rides along on later requests);
// logout clears the cookie + state. NOTE: backend route-gating (middleware/guards) is a separate integration step, so
// today this gate is client-side and a page reload won't auto-restore until /auth/me is wired to the session.
interface AuthShape { principal: Principal | null; loading: boolean; setPrincipal: (p: Principal | null) => void; logout: () => Promise<void>; }
const AuthCtx = createContext<AuthShape>({ principal: null, loading: true, setPrincipal: () => {}, logout: async () => {} });

import { webPush } from '../lib/webPush';
import { WebPushToast } from '@aipowersalon/web-push';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  // Nov 6 2026: registers silently when notifications are already allowed; never prompts (AdminLayout's banner asks from a tap)
  const signedInUserId = principal?.userId;
  useEffect(() => { if (signedInUserId) void webPush.resume(); }, [signedInUserId]);

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
    const onUnauthorized = () => setPrincipal(null);
    window.addEventListener('aps:unauthorized', onUnauthorized);
    return () => window.removeEventListener('aps:unauthorized', onUnauthorized);
  }, []);
  // the push token goes back FIRST — /push/unregister needs the session
  const logout = async () => { await webPush.unregister(); try { await authApi.logout(); } catch { /* ignore */ } setPrincipal(null); };

  return <AuthCtx.Provider value={{ principal, loading, setPrincipal, logout }}>{children}<WebPushToast client={webPush} /></AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
