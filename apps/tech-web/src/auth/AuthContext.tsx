import { signalSignedOut, syncUserLocale, setBusinessTimeZone } from '@aipowersalon/mobile-sdk';   // Phase 13: logout disconnects realtime
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearNativeToken, clearFaceId, reconcileFaceIdUser } from '@aipowersalon/mobile-sdk';   // Phase 13 D: Face ID = a device credential, cleared with the session
import { authApi, type Principal } from '../api/authApi';
import { api } from '../api/client';
import { mobile } from '../lib/mobile';   // Phase 13 D: the ONE push client (+ push-tap / link routing)
import { type UserLocaleContext } from '@aipowersalon/api-contracts';   // C6 §97–99 (Phase 13 E): the locale wire shape

// Client-side auth state for the Technician app. On mount it attempts a session restore via /auth/me; login stores the
// principal returned by POST /auth/login (the httpOnly cookie is set by the server and rides along on later requests);
// logout clears the cookie + state. NOTE: backend route-gating (middleware/guards) is a separate integration step, so
// today this gate is client-side and a page reload won't auto-restore until /auth/me is wired to the session.
interface AuthShape { principal: Principal | null; loading: boolean; setPrincipal: (p: Principal | null) => void; logout: () => Promise<void>; }
const AuthCtx = createContext<AuthShape>({ principal: null, loading: true, setPrincipal: () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

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
      void clearFaceId();   // Phase 13 D (C6 §35, bug 2): a dead session ends Face ID on this device too
      setPrincipal(null);
    };
    window.addEventListener('aps:unauthorized', onUnauthorized);
    return () => window.removeEventListener('aps:unauthorized', onUnauthorized);
  }, []);
  const logout = async () => {
    // Hand the PUSH token back FIRST. `POST /push/unregister` is authenticated, so it has to happen while the
    // session still exists — clearing the cookie first would leave the device registered forever.
    //
    // That is exactly what used to happen. `techApi.unregisterPush` and the route behind it both existed and
    // nothing called either, so a technician signed out and her phone kept receiving New-Assignment pushes for
    // that salon — customer names, appointment details, queue alerts — on the lock screen of a device she had
    // signed out of. The line below about the Keychain shows this threat was already understood; the push token
    // was simply left behind.
    await mobile.push.unregister();

    try { await authApi.logout(); } catch { /* ignore */ }
    signalSignedOut();   // BUILD_PLAN Phase 13 (C6 §35): end the realtime stream with the session — no live channel after sign-out
    // A token left in the Keychain outlives the sign-out — exactly what someone with the device would look for.
    await clearNativeToken();
    await clearFaceId();   // Phase 13 D: the server revoked the credential at /auth/logout; the Keychain item goes too
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
