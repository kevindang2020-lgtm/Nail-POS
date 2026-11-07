// web-push.ts — developer merge (Oct 6 2026): browser push for the three DESKTOP apps (pos-web, owner-web, admin-web).
//
// The developer added `useWebPush.ts` + `firebase-messaging-sw.js` to each app — three identical copies, the Firebase
// web config and VAPID key hard-coded, the token POSTed to an UNAUTHENTICATED `/public/push/register` with a client-
// supplied tenant / user / role (anyone could bind their browser to any user's pushes), the permission prompt fired at
// every page load, and foreground messages shown with `alert()`. This is the ONE client for all three apps, built the
// way the native push client (packages/mobile-sdk push.ts, Constitution 6 §58–63) is:
//   • config from the build environment (VITE_FIREBASE_WEB_CONFIG, VITE_FIREBASE_VAPID_KEY) — unset → inert, no prompt;
//   • registration through the AUTHENTICATED route the server already has: POST /push/register { platform: 'web',
//     token, app } — the session, never the client, says whose token it is;
//   • permission never at page load: a device that already granted registers silently on sign-in (resume()); the
//     prompt comes once, after the person's own sign-in (noteMeaningfulAction()); a decline is not re-asked;
//   • sign-out hands the token back (POST /push/unregister) so a shared front-desk PC stops receiving an account's pushes;
//   • ONE same-origin service worker (sw.js, served by tooling/vite/web-push-sw.mjs — no CDN script, the apps' CSP is
//     `script-src 'self'`) shows background pushes and posts foreground ones to the page (onMessage → an in-app toast).
// FCM web tokens come from the Firebase JS SDK (loaded on demand — nothing loads unless push is configured); the server's
// FCM v1 provider (FCM_SERVICE_ACCOUNT_JSON) delivers to `platform: 'web'` tokens already.
import type { PushAppId } from '@aipowersalon/api-contracts';

export interface WebPushConfig { apiKey: string; projectId: string; messagingSenderId: string; appId: string; vapidKey: string; authDomain?: string }
export interface WebPushHttp { post(path: string, body?: unknown): Promise<unknown> }
export interface WebPushMessage { title: string; body: string; data: Record<string, string> }
/** The pieces of the Firebase JS SDK the client needs — injected so tests (and a build without the SDK) run without it. */
export interface MessagingSdk {
  initializeApp(config: Record<string, string>): unknown;
  getMessaging(app: unknown): unknown;
  getToken(messaging: unknown, opts: { vapidKey: string; serviceWorkerRegistration: unknown }): Promise<string>;
  deleteToken?(messaging: unknown): Promise<boolean>;
}
export interface WebPushEnv {
  notification?: { permission: string; requestPermission(): Promise<string> } | null;
  serviceWorker?: { register(url: string, opts?: { scope?: string }): Promise<unknown>; addEventListener?(type: 'message', cb: (e: { data?: unknown }) => void): void } | null;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}
/** the desktop POS registers as 'pos': it receives only uncategorized pushes (no typed category targets the front desk) */
export type WebPushAppId = PushAppId | 'pos' | 'admin';
export interface WebPushClientOptions {
  app: WebPushAppId;
  config: WebPushConfig | null;
  http: WebPushHttp;
  env?: WebPushEnv;
  loadSdk?: () => Promise<MessagingSdk>;
  /** where tooling/vite/web-push-sw.mjs serves the worker; its scope keeps it OFF the page (it never controls navigation / caching) */
  swUrl?: string;
}
export interface WebPushClient {
  /** sign-in / page load with a session: registers silently if permission was already granted. Never prompts. */
  resume(): Promise<void>;
  /** the person's own sign-in (or another deliberate action): asks once if never asked; registers when granted. */
  noteMeaningfulAction(): Promise<void>;
  /** Nov 6 2026: the permission as it stands, without prompting ('unsupported' when push is not configured / available). */
  permission(): 'granted' | 'prompt' | 'denied' | 'unsupported';
  /** Nov 6 2026: the "Turn on notifications" tap — asks (the browser needs the person's click), registers when allowed. */
  enable(): Promise<boolean>;
  /** sign-out, BEFORE the session is cleared: hands the token back; a failed hand-back keeps it for next time. */
  unregister(): Promise<void>;
  /** a push that arrived while the page is open (the worker posts it instead of showing it) — show an in-app toast */
  onMessage(cb: (m: WebPushMessage) => void): () => void;
}

export const WEB_PUSH_SW_PATH = '/aps-push-sw.js';
export const WEB_PUSH_SW_SCOPE = '/aps-push/';
const TOKEN_KEY = 'aps.webpush.token', ASKED_KEY = 'aps.webpush.asked';

/** VITE_FIREBASE_WEB_CONFIG = the Firebase console's web-app config as JSON; VITE_FIREBASE_VAPID_KEY = Cloud Messaging → Web Push certificate key pair. */
export function webPushConfigFromEnv(env: Record<string, string | undefined>): WebPushConfig | null {
  const raw = String(env.VITE_FIREBASE_WEB_CONFIG ?? '').trim(); const vapidKey = String(env.VITE_FIREBASE_VAPID_KEY ?? '').trim();
  if (!raw || !vapidKey) return null;
  let c: any; try { c = JSON.parse(raw); } catch { return null; }
  const s = (k: string) => (typeof c?.[k] === 'string' ? c[k].trim() : '');
  if (!s('apiKey') || !s('projectId') || !s('messagingSenderId') || !s('appId')) return null;
  return { apiKey: s('apiKey'), projectId: s('projectId'), messagingSenderId: s('messagingSenderId'), appId: s('appId'), vapidKey, ...(s('authDomain') ? { authDomain: s('authDomain') } : {}) };
}

const defaultEnv = (): WebPushEnv => {
  const g: any = globalThis as any;
  return {
    notification: typeof g.Notification !== 'undefined' ? g.Notification : null,
    serviceWorker: typeof g.navigator !== 'undefined' && g.navigator?.serviceWorker ? g.navigator.serviceWorker : null,
    storage: (() => { try { return g.localStorage ?? null; } catch { return null; } })(),
  };
};
const defaultLoadSdk = async (): Promise<MessagingSdk> => {
  const [app, messaging] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  return { initializeApp: app.initializeApp as any, getMessaging: messaging.getMessaging as any, getToken: messaging.getToken as any, deleteToken: messaging.deleteToken as any };
};

export function createWebPushClient(o: WebPushClientOptions): WebPushClient {
  const env = o.env ?? defaultEnv();
  const st = env.storage ?? null;
  const get = (k: string) => { try { return st?.getItem(k) ?? null; } catch { return null; } };
  const set = (k: string, v: string) => { try { st?.setItem(k, v); } catch { /* private mode */ } };
  const del = (k: string) => { try { st?.removeItem(k); } catch { /* private mode */ } };
  const supported = !!(o.config && env.notification && env.serviceWorker);
  const listeners = new Set<(m: WebPushMessage) => void>();
  let registering = false; let listening = false; let messaging: unknown = null;

  const listen = () => {
    if (listening || !env.serviceWorker?.addEventListener) return;
    listening = true;
    env.serviceWorker.addEventListener('message', (e) => {
      const d: any = e?.data;
      if (!d || d.type !== 'aps-push') return;
      const m: WebPushMessage = { title: String(d.title ?? ''), body: String(d.body ?? ''), data: typeof d.data === 'object' && d.data ? d.data : {} };
      for (const cb of listeners) { try { cb(m); } catch { /* a listener never breaks delivery */ } }
    });
  };

  const register = async () => {
    if (!supported || registering) return;
    registering = true;
    try {
      listen();
      const sdk = await (o.loadSdk ?? defaultLoadSdk)();
      const reg = await env.serviceWorker!.register(o.swUrl ?? WEB_PUSH_SW_PATH, { scope: WEB_PUSH_SW_SCOPE });
      const { vapidKey, ...firebase } = o.config!;
      messaging = sdk.getMessaging(sdk.initializeApp(firebase as Record<string, string>));
      const token = await sdk.getToken(messaging, { vapidKey, serviceWorkerRegistration: reg });
      if (!token) return;
      const previous = get(TOKEN_KEY);
      await o.http.post('/push/register', { platform: 'web', token, app: o.app });
      set(TOKEN_KEY, token);
      if (previous && previous !== token) { try { await o.http.post('/push/unregister', { token: previous }); } catch { /* the provider's 410 retires it */ } }
    } catch { /* best-effort: push can never break sign-in or the page */ } finally { registering = false; }
  };

  return {
    async resume() {
      if (!supported) return;
      listen();
      if (env.notification!.permission === 'granted') await register();
    },
    async noteMeaningfulAction() {
      if (!supported) return;
      const p = env.notification!.permission;
      if (p === 'granted') { await register(); return; }
      if (p === 'denied' || get(ASKED_KEY)) return;   // asked once; the browser's site settings are the way back
      set(ASKED_KEY, '1');
      let granted = false;
      try { granted = (await env.notification!.requestPermission()) === 'granted'; } catch { granted = false; }
      if (granted) await register();
    },
    permission() {
      if (!supported) return 'unsupported';
      const p = env.notification!.permission;
      return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
    },
    async enable() {
      if (!supported) return false;
      let granted = env.notification!.permission === 'granted';
      if (!granted) { try { granted = (await env.notification!.requestPermission()) === 'granted'; } catch { granted = false; } }
      set(ASKED_KEY, '1');
      if (granted) await register();
      return granted;
    },
    async unregister() {
      const token = get(TOKEN_KEY);
      if (!token) return;
      try { await o.http.post('/push/unregister', { token }); del(TOKEN_KEY); } catch { /* kept for the next sign-out */ }
    },
    onMessage(cb) { listeners.add(cb); listen(); return () => { listeners.delete(cb); }; },
  };
}
