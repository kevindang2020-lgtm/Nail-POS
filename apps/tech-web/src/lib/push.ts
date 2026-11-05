// push.ts — registers this device's push token with the backend (POST /push/register) so the technician gets
// New-Assignment pushes when the app is backgrounded/closed (spec §10/§32). Foreground liveness is the SSE stream
// (useTechStream); push is only needed when the app is not in front.
//
// Web vs native:
//   • Web (browser): there is no FCM/APNs device token to hand the backend, so this is a no-op. The SSE stream
//     already covers the open-app case.
//   • Native (Capacitor iOS/Android): we lazily load @capacitor/push-notifications, ask permission, register with the
//     OS, and POST the returned token. The plugin is imported by a *variable* module name so the web Vite build never
//     tries to resolve it (the plugin only exists in the native shell).
//
// Everything is wrapped so a push failure can NEVER break login or the app — push is best-effort.
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { techApi } from '../api/techApi';

let registered = false; // register once per session (the OS token is stable; re-POSTing on every render is wasteful)

// The token we handed the backend. Kept so we can HAND IT BACK on sign-out.
//
// == THE BUG THIS CLOSES ==================================================================================
//
// `techApi.unregisterPush(token)` and `POST /push/unregister` (which revokes the row) have both existed the whole
// time. NOTHING HAS EVER CALLED EITHER, and this file had no unregister function to call them from.
//
// So `logout()` cleared the session cookie, cleared the Keychain — with a comment that reads:
//
//     "A token left in the Keychain outlives the sign-out — exactly what someone with the device would look for."
//
// — and then left the PUSH token registered. Same threat, one line apart. A technician signs out and her device
// keeps receiving New-Assignment pushes for that salon: customer names, appointment details, queue alerts, on the
// lock screen of a phone she has signed out of, on a phone she may have handed back, sold, or lost.
//
// Persisted, not just held in memory: the module reloads on every app launch, and a token registered yesterday
// must still be revocable when she signs out today.
const TOKEN_KEY = 'aps.push.token';
const remember = (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } };
const forget = () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };
const lastToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };

export async function registerPushToken(): Promise<void> {
  try {
    return; // DISABLED: We use Firebase Messaging (FCM) via useWebPush instead.
    if (registered) return;
    // Web build / browser preview: no native token. Bail quietly (SSE covers the foreground case).
    if (!Capacitor?.isNativePlatform?.()) return;
    registered = true;

    const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';
    
    // Add registration listeners
    PushNotifications.addListener('registration', (t: { value: string }) => {
      if (!t?.value) return;
      console.log('[Push] Native Token:', t.value);
      remember(t.value);   // so sign-out can hand it back
      techApi.registerPush(platform, t.value).catch(() => { /* best-effort */ });
    });

    PushNotifications.addListener('registrationError', () => { registered = false; });

    PushNotifications.addListener('pushNotificationReceived', (notification: any) => {
      console.log('[Push] Push received in foreground:', notification);
      window.dispatchEvent(new CustomEvent('aps:notification', { detail: { notification } }));
    });

    const perm = await PushNotifications.requestPermissions();
    if (perm?.receive === 'granted') {
      await PushNotifications.register();
    } else {
      console.warn('[Push] User denied push permission');
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
    await techApi.unregisterPush(token);
    forget();
  } catch {
    // leave the token stored — a retry on the next sign-out is better than losing the only handle we have on it
    return;
  }

  try {
    if (!Capacitor?.isNativePlatform?.()) return;
    const pkg = '@capacitor-firebase/messaging';
    const mod: any = await import(/* @vite-ignore */ pkg).catch(() => null);
    await mod?.FirebaseMessaging?.removeAllListeners?.();
  } catch { /* the server-side revoke is what matters; the listeners are housekeeping */ }
}
