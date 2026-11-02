// webPush.ts — the front-desk POS (a browser on the salon's PC / tablet): the ONE browser push client
// (@aipowersalon/web-push), registered as 'pos' through the authenticated /push/register (the session, never the page,
// says whose token it is). Inert until the build has VITE_FIREBASE_WEB_CONFIG + VITE_FIREBASE_VAPID_KEY.
// Developer merge (Oct 6 2026) — replaces his hooks/useWebPush.ts + public/firebase-messaging-sw.js copy.
import { createWebPushClient, webPushConfigFromEnv } from '@aipowersalon/web-push';
import { api } from '../api/client';

export const webPush = createWebPushClient({ app: 'pos', config: webPushConfigFromEnv(((import.meta as any).env ?? {}) as Record<string, string | undefined>), http: api });
