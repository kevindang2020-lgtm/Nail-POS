// push.ts — BUILD_PLAN Phase 13 D (Constitution 6 §58–63, audit bug 9): the ONE push client for the four mobile apps.
// Replaces the four copies of apps/*/src/lib/push.ts and the three pushApi.ts.
//
//   • Permission timing: NEVER at launch. The OS prompt appears after the person's first meaningful action
//     (`noteMeaningfulAction()` — a booking made, a ticket started, an approval decided …). On a later sign-in, a device
//     that already granted permission registers silently (`resume()`); one that declined is not asked again by us.
//   • Registration: POST /push/register { platform, token, app } — `app` routes the APNs topic and the server's per-app
//     targeting. A rotated token (§63: refresh, reinstall) is registered and the old one handed back.
//   • Sign-out: POST /push/unregister BEFORE the session is cleared (it is an authenticated route) — a signed-out phone
//     must stop receiving this account's pushes. A failed hand-back keeps the token for the next try.
//   • Tap (§62): the payload's typed route (api-contracts routeFromPushData — closed list, ids only) goes to the route
//     gate, which opens it only if the session may. Possessing a notification grants nothing.
//   • Android notification channels (§138) are created once, before the first registration.
// The push token is not identity (§59) and not a secret: it is kept in localStorage only so a sign-out after a relaunch
// can still hand it back. Everything is best-effort: push can never break sign-in or the app.
import { routeFromPushData, type PushAppId } from '@aipowersalon/api-contracts';
import type { RouteGate } from '../links/route-gate';

export interface PushPluginLike {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(event: string, cb: (x: any) => void): Promise<{ remove(): Promise<void> | void }> | { remove(): Promise<void> | void };
  removeAllListeners?(): Promise<void>;
  createChannel?(c: { id: string; name: string; description?: string; importance?: number; visibility?: number }): Promise<void>;
}
export interface PushHttp { post(path: string, body?: unknown): Promise<unknown> }
export interface PushClientOptions {
  app: PushAppId;
  plugin: PushPluginLike | null | undefined;
  http: PushHttp;
  gate: RouteGate;
  isNative(): boolean;
  platform(): 'ios' | 'android' | 'web';
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}
export interface PushClient {
  /** After sign-in: register silently if permission was already granted. Never prompts. */
  resume(): Promise<void>;
  /** The first meaningful action: the one moment the app may ask for permission (once). */
  noteMeaningfulAction(): Promise<void>;
  /** Sign-out: hand the token back while the session still exists. */
  unregister(): Promise<void>;
  /** Exposed for tests: what a tap does. */
  handleTap(data: Record<string, unknown> | null | undefined): Promise<boolean>;
}

const TOKEN_KEY = 'aps.push.token';         // the same key the four old copies used — tokens registered before upgrade stay revocable
const ASKED_KEY = 'aps.push.asked';
const CHANNELS = [
  { id: 'high_priority_v2', name: 'High Priority Alerts', importance: 5 },
  { id: 'default', name: 'Updates', importance: 3 },
  { id: 'alerts', name: 'Alerts', importance: 4 },
  { id: 'security', name: 'Security', importance: 5 },
];

export function createPushClient(o: PushClientOptions): PushClient {
  const st = o.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : o.storage;
  const get = (k: string) => { try { return st?.getItem(k) ?? null; } catch { return null; } };
  const set = (k: string, v: string) => { try { st?.setItem(k, v); } catch { /* private mode */ } };
  const del = (k: string) => { try { st?.removeItem(k); } catch { /* private mode */ } };
  let listening = false;
  let registering = false;

  const handleTap = async (data: Record<string, unknown> | null | undefined) => o.gate.request(routeFromPushData(data ?? null));

  const onToken = async (token: string) => {
    if (!token) return;
    const previous = get(TOKEN_KEY);
    try {
      await o.http.post('/push/register', { platform: o.platform(), token, app: o.app });
      set(TOKEN_KEY, token);
      // §63: a rotated token replaces the old one — hand the old one back so it stops being targeted
      if (previous && previous !== token) { try { await o.http.post('/push/unregister', { token: previous }); } catch { /* the provider's 410 retires it */ } }
    } catch { /* best-effort; the next sign-in registers again */ }
  };

  const listen = async () => {
    if (listening || !o.plugin) return;
    listening = true;
    try {
      await o.plugin.addListener('registration', (t: { value?: string }) => { void onToken(String(t?.value ?? '')); });
      await o.plugin.addListener('registrationError', () => { registering = false; });
      await o.plugin.addListener('pushNotificationReceived', (n: any) => {
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aps:notification', { detail: n }));
          }
        } catch {}
      });
      await o.plugin.addListener('pushNotificationActionPerformed', (a: any) => { void handleTap(a?.notification?.data); });
    } catch { listening = false; }
  };

  const register = async () => {
    if (!o.plugin || registering) return;
    registering = true;
    try {
      await listen();
      if (o.platform() === 'android' && o.plugin.createChannel) for (const c of CHANNELS) { try { await o.plugin.createChannel(c); } catch { /* exists */ } }
      await o.plugin.register();
    } catch { /* never throws out */ } finally { registering = false; }
  };

  return {
    handleTap,
    async resume() {
      if (!o.isNative() || !o.plugin) return;
      await listen();   // a tap that launched the app is routed even before permission questions
      try { if ((await o.plugin.checkPermissions())?.receive === 'granted') await register(); } catch { /* best-effort */ }
    },
    async noteMeaningfulAction() {
      if (!o.isNative() || !o.plugin) return;
      try {
        const p = (await o.plugin.checkPermissions())?.receive;
        if (p === 'granted') { await register(); return; }
        if (p === 'denied' || get(ASKED_KEY)) return;   // asked once; the OS settings are the way back
        set(ASKED_KEY, '1');
        if ((await o.plugin.requestPermissions())?.receive === 'granted') await register();
      } catch { /* best-effort */ }
    },
    async unregister() {
      const token = get(TOKEN_KEY);
      o.gate.clear();
      if (token) {
        try { await o.http.post('/push/unregister', { token }); del(TOKEN_KEY); }
        catch { return; }   // keep it — a retry at the next sign-out beats losing the only handle on it
      }
      try { await o.plugin?.removeAllListeners?.(); } catch { /* housekeeping */ }
      listening = false;
    },
  };
}
