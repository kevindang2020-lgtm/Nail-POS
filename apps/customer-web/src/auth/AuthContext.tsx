import { signalSignedOut, syncUserLocale, setBusinessTimeZone } from '@aipowersalon/mobile-sdk';   // Phase 13: logout disconnects realtime
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearNativeToken, clearFaceId, disableFaceId, reconcileFaceIdUser, isNativePlatform } from '@aipowersalon/mobile-sdk';   // Phase 13 D: Face ID = a device credential
import { useWebPush, PUSH_ENABLED_EVENT } from '@aipowersalon/mobile-sdk/web-push';
import { mobile } from '../lib/mobile';   // Phase 13 D: the ONE push client (+ push-tap / link routing)
import { authApi, type Principal } from '../api/authApi';
import { api } from '../api/client';
import { type UserLocaleContext } from '@aipowersalon/api-contracts';   // C6 §97–99 (Phase 13 E): the locale wire shape
import { exitGuestMode } from './guest';

// Client-side auth state for the Customer app. On mount it restores the session via GET /auth/me (the server reads the
// httpOnly cookie set at login and returns the principal, so a page reload keeps the user signed in); login stores the
// principal returned by POST /auth/login; logout clears the cookie + state. A 401 from any request drops the principal
// so the sign-in screen renders instead of a broken shell. Cross-origin deployments must serve the cookie SameSite=None
// + Secure for the reload restore to reach the API — that is server/deploy config, not this client.
interface AuthShape { principal: Principal | null; loading: boolean; setPrincipal: (p: Principal | null) => void; logout: (opts?: { endFaceId?: boolean }) => Promise<void>; }
const AuthCtx = createContext<AuthShape>({ principal: null, loading: true, setPrincipal: () => {}, logout: async () => {} });


export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  // Browser push on the WEB build only (Nov 2026, the developer tree's shared hook); on the phone the ONE push client
  // (lib/mobile.ts) registers — once allowed from the "Turn on notifications" banner (aps:push-enabled), never at sign-in.
  useWebPush({ http: api, tenantId: principal?.tenantId || 'SYSTEM', userType: 'customer', userId: isNativePlatform() ? undefined : principal?.userId, app: 'customer', onTap: (d) => { void mobile.push.handleTap(d); } });
  useEffect(() => {
    const onEnabled = () => { void mobile.push.resume(); };
    window.addEventListener(PUSH_ENABLED_EVENT, onEnabled);
    return () => window.removeEventListener(PUSH_ENABLED_EVENT, onEnabled);
  }, []);

  useEffect(() => {
    let alive = true;
    // A hung /auth/me (cold start on a bad network) must not hold the app on the loading screen: after 3.5 s show the
    // signed-out UI; if /auth/me answers later it still restores the session.
    const timer = setTimeout(() => { if (alive) setLoading(false); }, 3500);
    authApi.me()
      .then((p) => { if (alive) setPrincipal(p && (p as any).role ? (p as Principal) : null); })
      .catch(() => { if (alive) setPrincipal(null); })
      .finally(() => { clearTimeout(timer); if (alive) setLoading(false); });
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  // The session can die underneath us (expiry, or server-side revocation). The API client announces the 401;
  // drop the principal so the sign-in screen renders instead of a broken shell.
  useEffect(() => {
    const onUnauthorized = () => {
      // NATIVE: the session is gone (expired, or REVOKED server-side). The stored bearer token is now dead — if we
      // leave it in the Keychain it is resent on every request forever, and Face ID would keep unlocking a
      // credential the server has already rejected. Wipe it, then show the sign-in screen.
      void clearNativeToken();
      // Face ID stays (Nov 5 2026, Constitution 6 §37 as Kevin changed it): an expired session is routine; a REVOKED one
      // already ended the credential on the server (migration 841), and the next Face ID sign-in then wipes it here.
      setPrincipal(null);
    };
    window.addEventListener('aps:unauthorized', onUnauthorized);
    return () => window.removeEventListener('aps:unauthorized', onUnauthorized);
  }, []);
  const logout = async (opts?: { endFaceId?: boolean }) => {
    exitGuestMode();   // signing out (or a guest leaving) always lands on the sign-in screen
    // Hand the PUSH token back FIRST — /push/unregister is authenticated, so it must run while the session still
    // exists; clearing the cookie first would leave this device registered (and receiving pushes) forever.
    // See tech-web/src/lib/push.ts for the incident behind this ordering.
    await mobile.push.unregister();
    // Face ID stays on after sign-out unless the person chose "Also turn off Face ID" — that revoke needs the session.
    if (opts?.endFaceId) { try { await disableFaceId(); } catch { /* the local wipe still happens below */ } }
    try { await authApi.logout(); } catch { /* ignore */ }
    signalSignedOut();   // BUILD_PLAN Phase 13 (C6 §35): end the realtime stream with the session — no live channel after sign-out
    // A token left in the Keychain outlives the sign-out — exactly what someone with the device would look for.
    await clearNativeToken();
    if (opts?.endFaceId) await clearFaceId();   // Nov 6 2026: only when the person chose to turn Face ID off
    setPrincipal(null);
  };

  // Once a session exists (fresh login or restored via /auth/me), register this device's push token so
  // backgrounded-app pushes are delivered. No-ops on web; best-effort and never blocks the UI.
  useEffect(() => { if (principal) { void mobile.push.resume(); void reconcileFaceIdUser((principal as any).userId); } }, [principal]);   // Phase 13 D: no permission prompt here (§58 timing); another person's Face ID is cleared (§36)

  // C6 §97–99 (Phase 13 E): the user's saved language + the branch time zone dates are shown in; signed out → device zone.
  useEffect(() => { if (principal) void syncUserLocale(() => api.get<UserLocaleContext>('/customer/me/locale')); else setBusinessTimeZone(null); }, [principal]);
  return <AuthCtx.Provider value={{ principal, loading, setPrincipal, logout }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
