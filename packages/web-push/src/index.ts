// @aipowersalon/web-push — browser push for the desktop apps (pos-web, owner-web, admin-web): ONE client, ONE worker.
// Developer merge (Oct 6 2026) — replaces his three useWebPush.ts + firebase-messaging-sw.js copies. See web-push.ts.
export { createWebPushClient, webPushConfigFromEnv, WEB_PUSH_SW_PATH, WEB_PUSH_SW_SCOPE } from './web-push';
export { WebPushToast } from './toast';
export type { WebPushClient, WebPushClientOptions, WebPushAppId, WebPushConfig, WebPushHttp, WebPushMessage, WebPushEnv, MessagingSdk } from './web-push';
