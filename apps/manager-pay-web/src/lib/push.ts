// push.ts — registers this device's push token with the backend (POST /push/register) so the manager gets payment/checkout pushes
// when the app is backgrounded/closed. Mirrors tech-web/src/lib/push.ts, including its sign-out revoke — see the
// incident write-up there: a registered token MUST be handed back on sign-out (before the session is cleared, since
// /push/unregister is authenticated), or the device keeps receiving this account's pushes after sign-out.
//
// Web vs native:
//   • Web (browser): no FCM/APNs device token exists, so this is a no-op.
//   • Native (Capacitor iOS/Android): lazily load @capacitor/push-notifications, ask permission, register with the
//     OS, and POST the returned token. The plugin is imported by a *variable* module name so the web Vite build never
//     tries to resolve it (the plugin only exists in the native shell).
//
// Everything is wrapped so a push failure can NEVER break login or the app — push is best-effort.
import { Capacitor } from '@capacitor/core';
import { pushApi } from '../api/pushApi';

let registered = false; // register once per session (the OS token is stable; re-POSTing on every render is wasteful)

// The token we handed the backend. Kept so we can HAND IT BACK on sign-out.
//
// Persisted (not held in a variable) so the token registered on a previous launch is still revocable at sign-out —
// the module reloads on every app launch. The original incident behind this design lives in tech-web/src/lib/push.ts:
// a sign-out that clears the session but leaves the push token registered keeps delivering this account's pushes
// (names, appointments, payment alerts) to the lock screen of a device the user no longer holds.
const TOKEN_KEY = 'aps.push.token';
const remember = (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } };
const forget = () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };
const lastToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };

export async function registerPushToken(): Promise<void> {
  try {
    if (registered) return;
    // Web build / browser preview: no native token. Bail quietly (SSE covers the foreground case).
    if (!Capacitor?.isNativePlatform?.()) return;
    registered = true;

    const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';
    const pkg = '@capacitor/push-notifications';
    const mod: any = await import(/* @vite-ignore */ pkg).catch(() => null);
    const PushNotifications = mod?.PushNotifications;
    if (!PushNotifications) return; // plugin not present in this shell — nothing to do

    // POST the token to the backend when the OS hands it to us.
    PushNotifications.addListener('registration', (t: { value: string }) => {
      if (!t?.value) return;
      remember(t.value);   // so sign-out can hand it back
      pushApi.registerPush(platform, t.value).catch(() => { /* best-effort */ });
    });
    // Surfacing registration errors is non-fatal; we just don't get pushes.
    PushNotifications.addListener('registrationError', () => { registered = false; });

    const perm = await PushNotifications.requestPermissions();
    if (perm?.receive === 'granted') {
      await PushNotifications.register();
    } else {
      registered = false; // allow a later retry if the user grants permission afterwards
    }
  } catch {
    registered = false; // never throw out of here
  }
}


/**
 * Hand the push token back on sign-out, so this device stops receiving a salon's pushes.
 *
 * Must run BEFORE the session cookie is cleared — `POST /push/unregister` is an authenticated route, and a
 * logout that clears the cookie first would leave the token registered forever, which is the bug.
 *
 * Best-effort and never throws: a failed unregister must not trap somebody in a session they are trying to leave.
 * But it is never reported as done when it was not — it simply returns, and the token stays in localStorage so a
 * later sign-in and sign-out can try again.
 */
export async function unregisterPushToken(): Promise<void> {
  const token = lastToken();
  registered = false;
  if (!token) return;

  try {
    await pushApi.unregisterPush(token);
    forget();
  } catch {
    // leave the token stored — a retry on the next sign-out is better than losing the only handle we have on it
    return;
  }

  try {
    if (!Capacitor?.isNativePlatform?.()) return;
    const pkg = '@capacitor/push-notifications';
    const mod: any = await import(/* @vite-ignore */ pkg).catch(() => null);
    await mod?.PushNotifications?.removeAllListeners?.();
  } catch { /* the server-side revoke is what matters; the listeners are housekeeping */ }
}
