// web-push.test.ts — developer merge (Oct 6 2026): the ONE browser push client, built like the native one.
import { describe, it, expect, beforeEach } from 'vitest';
import { createWebPushClient, webPushConfigFromEnv, WEB_PUSH_SW_PATH, WEB_PUSH_SW_SCOPE, type MessagingSdk, type WebPushEnv } from './web-push';

const CFG = { apiKey: 'k', projectId: 'p', messagingSenderId: '1', appId: 'a', vapidKey: 'V' };
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

let posts: { path: string; body: any }[]; let permission: string; let asked: number; let grantOnAsk: boolean;
let swRegs: { url: string; scope?: string }[]; let swListeners: ((e: { data?: unknown }) => void)[]; let tokens: string[]; let sdkLoads: number; let storage: ReturnType<typeof mem>;
const env = (): WebPushEnv => ({
  notification: { get permission() { return permission; }, async requestPermission() { asked++; permission = grantOnAsk ? 'granted' : 'denied'; return permission; } },
  serviceWorker: { async register(url, opts) { swRegs.push({ url, scope: opts?.scope }); return { scope: opts?.scope }; }, addEventListener(_t, cb) { swListeners.push(cb); } },
  storage,
});
const sdk = (): MessagingSdk => ({ initializeApp: (c) => ({ c }), getMessaging: (a) => ({ a }), getToken: async () => tokens.shift() ?? '' });
const client = (over: Partial<Parameters<typeof createWebPushClient>[0]> = {}) => createWebPushClient({
  app: 'owner', config: CFG, env: env(), loadSdk: async () => { sdkLoads++; return sdk(); },
  http: { post: async (path, body) => { posts.push({ path, body }); return { ok: true }; } }, ...over,
});
beforeEach(() => { posts = []; permission = 'default'; asked = 0; grantOnAsk = true; swRegs = []; swListeners = []; tokens = ['tok-1']; sdkLoads = 0; storage = mem(); });

describe('configuration', () => {
  it('reads the Firebase web config + VAPID key from the build env; anything missing or malformed → null (inert)', () => {
    expect(webPushConfigFromEnv({})).toBeNull();
    expect(webPushConfigFromEnv({ VITE_FIREBASE_WEB_CONFIG: '{"apiKey":"k"}', VITE_FIREBASE_VAPID_KEY: 'V' })).toBeNull();
    expect(webPushConfigFromEnv({ VITE_FIREBASE_WEB_CONFIG: 'not json', VITE_FIREBASE_VAPID_KEY: 'V' })).toBeNull();
    expect(webPushConfigFromEnv({ VITE_FIREBASE_WEB_CONFIG: JSON.stringify({ apiKey: 'k', projectId: 'p', messagingSenderId: '1', appId: 'a', authDomain: 'x.firebaseapp.com', measurementId: 'G-1' }), VITE_FIREBASE_VAPID_KEY: 'V' }))
      .toEqual({ apiKey: 'k', projectId: 'p', messagingSenderId: '1', appId: 'a', vapidKey: 'V', authDomain: 'x.firebaseapp.com' });
  });
  it('unconfigured, or a browser without Notification / service workers: nothing happens, nothing loads', async () => {
    permission = 'granted';
    const c = client({ config: null }); await c.resume(); await c.noteMeaningfulAction();
    const c2 = client({ env: { ...env(), serviceWorker: null } }); await c2.resume(); await c2.noteMeaningfulAction();
    expect(posts).toEqual([]); expect(sdkLoads).toBe(0); expect(asked).toBe(0);
  });
});

describe('permission timing (§58): never at page load', () => {
  it('resume() never prompts; a browser that already granted registers silently through the authenticated route', async () => {
    await client().resume();
    expect(asked).toBe(0); expect(posts).toEqual([]);
    permission = 'granted';
    await client().resume();
    expect(asked).toBe(0);
    expect(posts).toEqual([{ path: '/push/register', body: { platform: 'web', token: 'tok-1', app: 'owner' } }]);   // no tenantId / userId / role from the client — the session says whose token it is
    expect(swRegs).toEqual([{ url: WEB_PUSH_SW_PATH, scope: WEB_PUSH_SW_SCOPE }]);
  });
  it('the person’s own sign-in asks once; a decline (or a dismissed prompt) is not asked again', async () => {
    grantOnAsk = false;
    const c = client();
    await c.noteMeaningfulAction(); await c.noteMeaningfulAction(); await client().noteMeaningfulAction();
    expect(asked).toBe(1); expect(posts).toEqual([]);
  });
  it('a DISMISSED prompt (permission still "default") is not asked again either', async () => {
    const dismissEnv = (): WebPushEnv => ({ ...env(), notification: { get permission() { return 'default'; }, async requestPermission() { asked++; return 'default'; } } });
    await client({ env: dismissEnv() }).noteMeaningfulAction(); await client({ env: dismissEnv() }).noteMeaningfulAction();
    expect(asked).toBe(1); expect(posts).toEqual([]);
  });
  it('granted on the prompt → registered', async () => {
    await client().noteMeaningfulAction();
    expect(asked).toBe(1);
    expect(posts.map((p) => p.path)).toEqual(['/push/register']);
  });
});

describe('token rotation + sign-out (§63)', () => {
  it('a rotated token is registered and the old one handed back', async () => {
    permission = 'granted'; tokens = ['tok-1', 'tok-2'];
    await client().resume();
    await client().resume();
    expect(posts.map((p) => [p.path, p.body.token])).toEqual([['/push/register', 'tok-1'], ['/push/register', 'tok-2'], ['/push/unregister', 'tok-1']]);
  });
  it('sign-out unregisters the stored token and forgets it; a failed hand-back keeps it for next time', async () => {
    storage.setItem('aps.webpush.token', 'tok-9');
    await client().unregister();
    expect(posts).toEqual([{ path: '/push/unregister', body: { token: 'tok-9' } }]);
    expect(storage.getItem('aps.webpush.token')).toBeNull();
    storage.setItem('aps.webpush.token', 'tok-9');
    await client({ http: { post: async () => { throw new Error('offline'); } } }).unregister();
    expect(storage.getItem('aps.webpush.token')).toBe('tok-9');
  });
  it('a failing SDK / register call never throws out of sign-in', async () => {
    permission = 'granted';
    await expect(client({ loadSdk: async () => { throw new Error('no sdk'); } }).resume()).resolves.toBeUndefined();
    await expect(client({ http: { post: async () => { throw new Error('401'); } } }).resume()).resolves.toBeUndefined();
  });
});

describe('foreground messages', () => {
  it('a push the worker posts while the page is open reaches onMessage listeners as { title, body, data }; other messages are ignored', async () => {
    const seen: any[] = [];
    const c = client(); const off = c.onMessage((m) => seen.push(m));
    expect(swListeners).toHaveLength(1);
    swListeners[0]({ data: { type: 'aps-push', title: 'Tip received', body: 'You received a tip', data: { kind: 'tip' } } });
    swListeners[0]({ data: { type: 'something-else' } });
    swListeners[0]({ data: null });
    expect(seen).toEqual([{ title: 'Tip received', body: 'You received a tip', data: { kind: 'tip' } }]);
    off();
    swListeners[0]({ data: { type: 'aps-push', title: 'x', body: 'y' } });
    expect(seen).toHaveLength(1);
  });
});

// Nov 6 2026: the "Turn on notifications" banner asks from a tap — enable() / permission()
describe('enable() from the banner tap', () => {
  it('permission() reports without prompting; unconfigured is unsupported', () => {
    expect(client().permission()).toBe('prompt');
    permission = 'denied'; expect(client().permission()).toBe('denied');
    permission = 'granted'; expect(client().permission()).toBe('granted');
    expect(client({ config: null }).permission()).toBe('unsupported');
    expect(asked).toBe(0);
  });
  it('allowed → registers this browser and resolves true', async () => {
    await expect(client().enable()).resolves.toBe(true);
    expect(asked).toBe(1);
    expect(posts).toEqual([{ path: '/push/register', body: { platform: 'web', token: 'tok-1', app: 'owner' } }]);
  });
  it('blocked → nothing registered, resolves false', async () => {
    grantOnAsk = false;
    await expect(client().enable()).resolves.toBe(false);
    expect(posts).toEqual([]);
  });
});
