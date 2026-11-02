// webPush.ts — the Owner app in a BROWSER (the native build uses lib/mobile.ts): the ONE browser push client
// (@aipowersalon/web-push), registered as 'owner' through the authenticated /push/register. Inert until the build has
// VITE_FIREBASE_WEB_CONFIG + VITE_FIREBASE_VAPID_KEY. Developer merge (Oct 6 2026).
import { createWebPushClient, webPushConfigFromEnv } from '@aipowersalon/web-push';
import { Capacitor } from '@capacitor/core';
import { api } from '../api/client';

export const webPush = createWebPushClient({
  app: 'owner',
  // the native app registers through the Capacitor push plugin (lib/mobile.ts) — never both
  config: Capacitor.isNativePlatform() ? null : webPushConfigFromEnv(((import.meta as any).env ?? {}) as Record<string, string | undefined>),
  http: api,
});
