import { signalSignedOut, syncUserLocale, setBusinessTimeZone } from '@aipowersalon/mobile-sdk';   // Phase 13: logout disconnects realtime
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearNativeToken, clearFaceId, disableFaceId, reconcileFaceIdUser } from '@aipowersalon/mobile-sdk';   // Phase 13 D: Face ID = a device credential
import { authApi, type Principal } from '../api/authApi';
import { api } from '../api/client';
import { mobile } from '../lib/mobile';   // Phase 13 D: the ONE push client (+ push-tap / link routing)
import { useWebPush, PUSH_ENABLED_EVENT } from '@aipowersalon/mobile-sdk/web-push';
import { isNativePlatform } from '@aipowersalon/mobile-sdk';
import { type UserLocaleContext } from '@aipowersalon/api-contracts';   // C6 §97–99 (Phase 13 E): the locale wire shape

// Client-side auth state for the Technician app. On mount it attempts a session restore via /auth/me; login stores the
// principal returned by POST /auth/login (the httpOnly cookie is set by the server and rides along on later requests);
// logout clears the cookie + state. NOTE: backend route-gating (middleware/guards) is a separate integration step, so
// today this gate is client-side and a page reload won't auto-restore until /auth/me is wired to the session.
interface AuthShape { principal: Principal | null; loading: boolean; setPrincipal: (p: Principal | null) => void; logout: (opts?: { endFaceId?: boolean }) => Promise<void>; }
const AuthCtx = createContext<AuthShape>({ principal: null, loading: true, setPrincipal: () => {}, logout: async () => {} });


export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  // Browser push on the WEB build only (Nov 2026, the developer tree's shared hook); on the phone the ONE push client
  // (lib/mobile.ts) registers — once allowed from the "Turn on notifications" banner (aps:push-enabled), never at sign-in.
  useWebPush({ http: api, tenantId: principal?.tenantId || 'SYSTEM', userType: principal?.role || 'technician', userId: isNativePlatform() ? undefined : principal?.userId, onTap: (d) => { void mobile.push.handleTap(d); } });
  useEffect(() => {
    const onEnabled = () => { void mobile.push.resume(); };
    window.addEventListener(PUSH_ENABLED_EVENT, onEnabled);
    return () => window.removeEventListener(PUSH_ENABLED_EVENT, onEnabled);
  }, []);

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
      // Face ID stays (Nov 5 2026, Constitution 6 §37 as Kevin changed it): an expired session is routine; a REVOKED one
      // already ended the credential on the server (migration 841), and the next Face ID sign-in then wipes it here.
      setPrincipal(null);
    };
    window.addEventListener('aps:unauthorized', onUnauthorized);
    return () => window.removeEventListener('aps:unauthorized', onUnauthorized);
  }, []);
  const logout = async (opts?: { endFaceId?: boolean }) => {
    // Hand the PUSH token back FIRST. `POST /push/unregister` is authenticated, so it has to happen while the
    // session still exists — clearing the cookie first would leave the device registered forever.
    //
    // That is exactly what used to happen. `techApi.unregisterPush` and the route behind it both existed and
    // nothing called either, so a technician signed out and her phone kept receiving New-Assignment pushes for
    // that salon — customer names, appointment details, queue alerts — on the lock screen of a device she had
    // signed out of. The line below about the Keychain shows this threat was already understood; the push token
    // was simply left behind.
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

  // Once a technician session exists (fresh login or restored via /auth/me), register this device's push token so
  // backgrounded-app assignment pushes are delivered (§32). No-ops on web; best-effort and never blocks the UI.
  useEffect(() => { if (principal) { void mobile.push.resume(); void reconcileFaceIdUser((principal as any).userId); } }, [principal]);   // Phase 13 D: no permission prompt here (§58 timing); another person's Face ID is cleared (§36)

  // C6 §97–99 (Phase 13 E): the user's saved language + the branch time zone dates are shown in; signed out → device zone.
  useEffect(() => { if (principal) void syncUserLocale(() => api.get<UserLocaleContext>('/tech/me/locale')); else setBusinessTimeZone(null); }, [principal]);
  return <AuthCtx.Provider value={{ principal, loading, setPrincipal, logout }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
