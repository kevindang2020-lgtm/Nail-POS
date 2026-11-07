// webPush.ts — Super Admin's browser push: the ONE browser push client (@aipowersalon/web-push), registered as 'admin'
// through the authenticated /push/register. Nov 6 2026: replaces the developer's hooks/useWebPush.ts copy, which asked
// for permission at sign-in, logged the token to the console, and depended on a gstatic service worker the app's CSP
// blocks. Inert until the build has VITE_FIREBASE_WEB_CONFIG + VITE_FIREBASE_VAPID_KEY (the same values as the POS).
import { createWebPushClient, webPushConfigFromEnv } from '@aipowersalon/web-push';
import { api } from '../api/client';

export const webPush = createWebPushClient({ app: 'admin', config: webPushConfigFromEnv(((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {})), http: api });
