// web-push.ts — the Firebase / Capacitor push registration hook shared by the Customer, Owner and Technician apps
// (was three byte-for-byte copies). Native: FCM/APNs via @capacitor/push-notifications, a foreground local copy, and taps
// routed to the app's gate (onTap). Web: Firebase Messaging with the service worker. The token is registered with
// POST /push/register through the app's own transport. Imported from '@aipowersalon/mobile-sdk/web-push' so apps that do
// not use push never bundle Firebase.
import { useEffect, useRef, useState } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';

// Nov 6 2026: the Firebase web config comes from the BUILD, not the source (the security scan's secret check fails on a
// hard-coded Google API key, and a build should not ship one fixed project). Same variables as POS and Super Admin
// (@aipowersalon/web-push webPushConfigFromEnv). Without them, BROWSER push stays off; the native apps are unaffected
// (they register through Capacitor with google-services.json / APNs, not this config).
const BUILD_ENV: Record<string, string | undefined> = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
function firebaseWebConfig(): Record<string, string> | null {
  try { const raw = BUILD_ENV.VITE_FIREBASE_WEB_CONFIG; const c = raw ? JSON.parse(raw) : null; return c && c.apiKey && c.projectId ? c : null; } catch { return null; }
}
const firebaseConfig = firebaseWebConfig();
const VAPID_KEY = BUILD_ENV.VITE_FIREBASE_VAPID_KEY || '';

// Nov 6 2026 — permission is asked from a TAP only (the "Turn on notifications" banner), never at sign-in.
export const PUSH_ENABLED_EVENT = 'aps:push-enabled';
export type PushPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';
/** The signed-in session's registration, run when the person allows notifications (module-level: survives remounts). */
let registerOnEnable: (() => void) | null = null;

/** The current notification permission, without prompting. */
export async function pushPermission(): Promise<PushPermission> {
  try {
    if (Capacitor.isNativePlatform()) {
      const p = await PushNotifications.checkPermissions();
      return p.receive === 'granted' ? 'granted' : p.receive === 'denied' ? 'denied' : 'prompt';
    }
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
    if (!firebaseConfig || !VAPID_KEY) return 'unsupported';   // browser push not configured for this build: no banner
    const p = Notification.permission;
    return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
  } catch { return 'unsupported'; }
}

/** Ask for permission — call from the person's tap. On "allow" the signed-in push hook registers this device. */
export async function enablePush(): Promise<boolean> {
  try {
    let granted = false;
    if (Capacitor.isNativePlatform()) {
      granted = (await PushNotifications.requestPermissions()).receive === 'granted';
      if (granted) { try { await LocalNotifications.requestPermissions(); } catch { /* the foreground copy is optional */ } }
    } else if (typeof window !== 'undefined' && 'Notification' in window) {
      granted = (await Notification.requestPermission()) === 'granted';
    }
    if (granted) { registerOnEnable?.(); if (typeof window !== 'undefined') window.dispatchEvent(new Event(PUSH_ENABLED_EVENT)); }
    return granted;
  } catch { return false; }
}

/** For the banner: show it to a signed-in person whose device has not decided yet and who did not snooze it. */
export function usePushPrompt(signedIn: boolean, snoozed: () => boolean, snooze: () => void): { visible: boolean; enable: () => Promise<boolean>; dismiss: () => void } {
  const [state, setState] = useState<PushPermission | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!signedIn) { setState(null); return; }
    let alive = true;
    void pushPermission().then((p) => { if (alive) setState(p); });
    return () => { alive = false; };
  }, [signedIn]);
  const visible = signedIn && state === 'prompt' && !hidden && !snoozed();
  const enable = async () => { const ok = await enablePush(); if (ok) { setHidden(true); setState('granted'); } return ok; };
  const dismiss = () => { snooze(); setHidden(true); };
  return { visible, enable, dismiss };
}

// Module-level deduplication cache for foreground notifications
const recentPushes = new Map<string, number>();

function isDuplicate(key: string, ttlMs = 10000): boolean {
  const now = Date.now();
  for (const [k, time] of recentPushes.entries()) {
    if (now - time > 30000) recentPushes.delete(k);
  }
  const lastTime = recentPushes.get(key) || 0;
  if (now - lastTime < ttlMs) {
    return true;
  }
  recentPushes.set(key, now);
  return false;
}

let registeredSessionKey: string | null = null;

export interface WebPushOptions {
  /** The app's authenticated POST (the transport): registers the device token with POST /push/register. */
  http: { post(path: string, body?: Record<string, unknown>): Promise<unknown> };
  tenantId?: string;
  userType?: string;
  userId?: string;
  /** The push `app` id. Default: from userType ('technician' → 'tech'). */
  app?: string;
  /** A tapped notification (native push or the foreground local copy): its data, for the app's route gate. */
  onTap?: (data: Record<string, unknown> | null) => void;
}

export function useWebPush(o: WebPushOptions): void {
  const { tenantId, userType, userId, app: appId } = o;
  const tap = useRef(o.onTap); tap.current = o.onTap;
  const http = useRef(o.http); http.current = o.http;
  useEffect(() => {
    if (!tenantId || !userType || !userId) {
      
      return;
    }

    const currentSessionKey = `${userType}:${userId}:${Capacitor.isNativePlatform() ? 'native' : 'web'}`;
    if (registeredSessionKey === currentSessionKey) {
      return;
    }
    registeredSessionKey = currentSessionKey;

    const normalizedRole = appId ?? (userType.toLowerCase() === 'technician' ? 'tech' : userType.toLowerCase());
    

    if (Capacitor.isNativePlatform()) {
      // -------------------------------------------------------------
      // NATIVE CAPACITOR PUSH (Android / iOS)
      // -------------------------------------------------------------
      const registerNativePush = async () => {
        try {
          // Nov 6 2026: never PROMPT here (sign-in is not the person asking). Register only when notifications are already
          // allowed; otherwise the "Turn on notifications" banner asks from a tap (enablePush) and fires aps:push-enabled.
          const pushPerm = await PushNotifications.checkPermissions();
          if (pushPerm.receive !== 'granted') return;

          // Create high priority notification channels on Android 8+
          if (Capacitor.getPlatform() === 'android') {
            try {
              const channelConfig = {
                id: 'high_priority_v2',
                name: 'High Priority Alerts',
                description: 'Urgent salon alerts and booking updates',
                importance: 5 as const,
                visibility: 1 as const,
                vibration: true,
                sound: 'default'
              };
              await PushNotifications.createChannel(channelConfig);
              await LocalNotifications.createChannel(channelConfig);
            } catch (chanErr) {
              console.warn('[Push][Native] Channel creation notice:', chanErr);
            }
          }

          PushNotifications.removeAllListeners();
          LocalNotifications.removeAllListeners();

          PushNotifications.addListener('registrationError', (err: any) => {
            console.error('[Push][Native] Push registration error from OS/FCM:', err);
          });

          PushNotifications.addListener('registration', async (t: { value: string }) => {
            if (t?.value) {
              
              const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
              try {
                await http.current.post('/push/register', {
                  platform,
                  token: t.value,
                  app: normalizedRole
                });
              } catch (regErr) {
                console.error('[Push][Native] Failed to save push token to backend:', regErr);
              }
            }
          });

          // In foreground: Push arrives from FCM
          // Capacitor native PushNotificationsPlugin with presentationOptions: ["badge", "sound", "alert"]
          // already displays the native status bar / heads-up notification for messages with title/body.
          PushNotifications.addListener('pushNotificationReceived', async (notification: any) => {

            const title = (notification.title || notification.data?.title || 'New Notification').trim();
            const body = (notification.body || notification.data?.body || '').trim();
            const ref = notification.data?.reference || notification.data?.appointmentId || notification.data?.ticketId || notification.data?.queueItemId || notification.id || notification.data?.id;
            const notifId = ref ? `${ref}:::${title}` : `${title}:::${body}`;

            if (isDuplicate(notifId, 10000)) {
              return;
            }

            // Tell in-app components (like notification bell count) to update immediately
            window.dispatchEvent(new CustomEvent('aps:notification', { detail: { notification } }));
            window.dispatchEvent(new CustomEvent('aps:push_received', { detail: { notification } }));

            // On mobile native (iOS / Android) in foreground, schedule local notification so the popup banner appears on device.
            const shouldScheduleLocal = Capacitor.isNativePlatform();

            if (shouldScheduleLocal && (title || body)) {
              try {
                let hash = 0;
                for (let i = 0; i < notifId.length; i++) {
                  hash = (hash << 5) - hash + notifId.charCodeAt(i);
                  hash |= 0;
                }
                const stableId = Math.abs(hash) % 900000 + 100000;

                await LocalNotifications.schedule({
                  notifications: [
                    {
                      id: stableId,
                      title,
                      body,
                      channelId: 'high_priority_v2',
                      smallIcon: 'ic_launcher',
                      schedule: { at: new Date(Date.now() + 100) },
                      extra: notification.data || {}
                    }
                  ]
                });
              } catch (schedErr) {
                console.error('[Push][Native] Failed to schedule local notification:', schedErr);
              }
            }
          });

          // A tap names a destination (the typed route in the payload); the app's route gate opens it after its session check.
          PushNotifications.addListener('pushNotificationActionPerformed', (action: any) => {
            tap.current?.((action?.notification?.data ?? null) as Record<string, unknown> | null);
          });

          LocalNotifications.addListener('localNotificationActionPerformed', (action: any) => {
            tap.current?.((action?.notification?.extra ?? null) as Record<string, unknown> | null);
          });

          await PushNotifications.register();
        } catch (err) {
          console.error('[Push][Native] Native push setup error:', err);
        }
      };

      registerOnEnable = () => { void registerNativePush(); };
      void registerNativePush();
    } else {
      // -------------------------------------------------------------
      // WEB PUSH (Browser PWA / Desktop)
      // -------------------------------------------------------------
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        console.warn('[Push][Web] Browser does not support Notification or ServiceWorker.');
        return;
      }

      if (!firebaseConfig || !VAPID_KEY) return;   // browser push not configured for this build
      const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      const messaging = getMessaging(app);

      const requestPermissionAndGetToken = async () => {
        try {
          // Nov 6 2026: never prompt here — browsers block a prompt the person did not start (see enablePush)
          if (Notification.permission !== 'granted') return;

          // Nov 5 2026: the ONE CSP-safe worker (packages/web-push/src/sw.js, emitted as /aps-push-sw.js by
          // tooling/vite/web-push-sw.mjs). The old /firebase-messaging-sw.js importScripts'd Firebase from gstatic,
          // which the apps' `script-src 'self'` policy blocks, and tech/customer did not ship it at all.
          const swReg = await navigator.serviceWorker.register('/aps-push-sw.js', { scope: '/aps-push/' });

          const currentToken = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: swReg
          });

          if (currentToken) {
            
            await http.current.post('/push/register', {
              platform: 'web',
              token: currentToken,
              app: normalizedRole
            });
          } else {
            console.warn('[Push][Web] No FCM token returned from Firebase.');
          }
        } catch (err) {
          console.error('[Push][Web] Error during web push registration:', err);
        }
      };

      registerOnEnable = () => { void requestPermissionAndGetToken(); };
      void requestPermissionAndGetToken();

      const unsubscribe = onMessage(messaging, (payload) => {
        const title = (payload.notification?.title || payload.data?.title || 'New Notification').trim();
        const body = (payload.notification?.body || payload.data?.body || '').trim();
        const ref = payload.data?.reference || payload.data?.appointmentId || payload.data?.ticketId || payload.data?.queueItemId || payload.messageId;
        const key = ref ? `${ref}:::${title}` : `${title}:::${body}`;
        if (isDuplicate(key, 10000)) return;

        window.dispatchEvent(new CustomEvent('aps:notification', { detail: payload }));
        if (Notification.permission === 'granted') {
          try {
            new Notification(title, { body, icon: '/favicon.ico' });
          } catch {}
        }
      });

      // The worker posts foreground pushes as { type: 'aps-push' } and notification taps as { type: 'aps-push-tap' }
      // (it is plain Web Push, so Firebase's onMessage never sees them).
      const onSwMessage = (e: MessageEvent) => {
        const m = e?.data as { type?: string; title?: string; body?: string; data?: Record<string, string> } | null;
        if (!m || typeof m !== 'object') return;
        if (m.type === 'aps-push-tap') { if (m.data) tap.current?.(m.data); return; }
        if (m.type !== 'aps-push') return;
        const title = String(m.title || m.data?.title || 'New Notification').trim();
        const body = String(m.body || m.data?.body || '').trim();
        const ref = m.data?.reference || m.data?.appointmentId || m.data?.ticketId || m.data?.queueItemId;
        if (isDuplicate(ref ? `${ref}:::${title}` : `${title}:::${body}`, 10000)) return;
        window.dispatchEvent(new CustomEvent('aps:notification', { detail: { notification: { title, body }, data: m.data || {} } }));
      };
      navigator.serviceWorker.addEventListener('message', onSwMessage);

      return () => {
        unsubscribe();
        navigator.serviceWorker.removeEventListener('message', onSwMessage);
      };
    }
  }, [tenantId, userType, userId, appId]);
}
