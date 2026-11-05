import { useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { api } from '../api/client';

const firebaseConfig = {
  apiKey: "AIzaSyBfBQJ7Tlrv2aNc5MEtbvwE6uLFO3dbt9c",
  authDomain: "ai-power-salon-71823.firebaseapp.com",
  projectId: "ai-power-salon-71823",
  storageBucket: "ai-power-salon-71823.firebasestorage.app",
  messagingSenderId: "302674373949",
  appId: "1:302674373949:web:bb41b69715a36f18e1a954",
  measurementId: "G-49G251SNGJ"
};

const VAPID_KEY = "BJq7xD1DPmqV8uVQhJnVUyJAIsP0de6WBtN4rIctGMKWN3ArC-OPNd1wdK4frGyY_p40elUXtG0nSeSBRqrDwz8";

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

export function useWebPush(tenantId?: string, userType?: string, userId?: string) {
  useEffect(() => {
    if (!tenantId || !userType || !userId) {
      console.log('[Push] useWebPush waiting for credentials:', { tenantId, userType, userId });
      return;
    }

    const currentSessionKey = `${userType}:${userId}:${Capacitor.isNativePlatform() ? 'native' : 'web'}`;
    if (registeredSessionKey === currentSessionKey) {
      console.log('[Push] Already initialized for session:', currentSessionKey);
      return;
    }
    registeredSessionKey = currentSessionKey;

    const normalizedRole = 'customer';
    console.log(`[Push] Starting push setup for role=${normalizedRole}, userId=${userId}, isNative=${Capacitor.isNativePlatform()}`);

    if (Capacitor.isNativePlatform()) {
      // -------------------------------------------------------------
      // NATIVE CAPACITOR PUSH (Android / iOS)
      // -------------------------------------------------------------
      const registerNativePush = async () => {
        try {
          console.log('[Push][Native] Checking permissions...');
          let pushPerm = await PushNotifications.checkPermissions();
          if (pushPerm.receive !== 'granted') {
            pushPerm = await PushNotifications.requestPermissions();
          }

          const localPerm = await LocalNotifications.checkPermissions();
          if (localPerm.display !== 'granted') {
            await LocalNotifications.requestPermissions();
          }

          if (pushPerm.receive !== 'granted') {
            console.warn('[Push][Native] Push permission was NOT granted:', pushPerm.receive);
            return;
          }

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
              console.log('[Push][Native] Notification channel high_priority_v2 configured.');
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
              console.log('[Push][Native] FCM Token successfully received:', t.value.slice(0, 15) + '...');
              const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
              try {
                const res = await api.post('/push/register', {
                  platform,
                  token: t.value,
                  app: normalizedRole
                });
                console.log('[Push][Native] Push token saved to backend successfully! Response:', res);
              } catch (regErr) {
                console.error('[Push][Native] Failed to save push token to backend:', regErr);
              }
            }
          });

          // In foreground: Push arrives from FCM
          // Capacitor native PushNotificationsPlugin with presentationOptions: ["badge", "sound", "alert"]
          // already displays the native status bar / heads-up notification for messages with title/body.
          PushNotifications.addListener('pushNotificationReceived', async (notification: any) => {
            console.log('[Push][Native] Foreground push notification received:', notification);

            const title = (notification.title || notification.data?.title || 'New Notification').trim();
            const body = (notification.body || notification.data?.body || '').trim();
            const ref = notification.data?.reference || notification.data?.appointmentId || notification.data?.ticketId || notification.data?.queueItemId || notification.id || notification.data?.id;
            const notifId = ref ? `${ref}:::${title}` : `${title}:::${body}`;

            if (isDuplicate(notifId, 10000)) {
              console.log('[Push][Native] Suppressed duplicate notification in foreground:', title);
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
                console.log('[Push][Native] Local notification scheduled on high_priority_v2:', title);
              } catch (schedErr) {
                console.error('[Push][Native] Failed to schedule local notification:', schedErr);
              }
            }
          });

          PushNotifications.addListener('pushNotificationActionPerformed', (action: any) => {
            console.log('[Push][Native] User tapped on push notification:', action);
          });

          LocalNotifications.addListener('localNotificationActionPerformed', (action: any) => {
            console.log('[Push][Native] User tapped on local notification:', action);
          });

          console.log('[Push][Native] Calling PushNotifications.register()...');
          await PushNotifications.register();
        } catch (err) {
          console.error('[Push][Native] Native push setup error:', err);
        }
      };

      registerNativePush();
    } else {
      // -------------------------------------------------------------
      // WEB PUSH (Browser PWA / Desktop)
      // -------------------------------------------------------------
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        console.warn('[Push][Web] Browser does not support Notification or ServiceWorker.');
        return;
      }

      console.log('[Push][Web] Current Notification.permission:', Notification.permission);
      const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      const messaging = getMessaging(app);

      const requestPermissionAndGetToken = async () => {
        try {
          let permission = Notification.permission;
          if (permission !== 'granted') {
            console.log('[Push][Web] Requesting Notification.requestPermission()...');
            permission = await Notification.requestPermission();
            console.log('[Push][Web] User response:', permission);
          }

          if (permission !== 'granted') {
            console.warn('[Push][Web] Push permission denied or ignored:', permission);
            return;
          }

          console.log('[Push][Web] Registering /firebase-messaging-sw.js...');
          const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
          console.log('[Push][Web] Service worker ready at scope:', swReg.scope);

          console.log('[Push][Web] Fetching FCM token with VAPID key...');
          const currentToken = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: swReg
          });

          if (currentToken) {
            console.log('[Push][Web] Web FCM Token retrieved:', currentToken.slice(0, 15) + '... (len: ' + currentToken.length + ')');
            console.log(`[Push][Web] Calling POST /push/register platform=web, app=${normalizedRole}...`);
            const res = await api.post('/push/register', {
              platform: 'web',
              token: currentToken,
              app: normalizedRole
            });
            console.log('[Push][Web] Backend token registration response:', res);
          } else {
            console.warn('[Push][Web] No FCM token returned from Firebase.');
          }
        } catch (err) {
          console.error('[Push][Web] Error during web push registration:', err);
        }
      };

      requestPermissionAndGetToken();

      const unsubscribe = onMessage(messaging, (payload) => {
        console.log('[Push][Web] Foreground message received from Firebase:', payload);
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

      return () => {
        unsubscribe();
      };
    }
  }, [tenantId, userType, userId]);
}
