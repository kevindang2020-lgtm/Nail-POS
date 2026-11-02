// push.test.ts — BUILD_PLAN Phase 13 D (Constitution 6 §58–63): the one push client.
import { describe, it, expect, beforeEach } from 'vitest';
import { createPushClient, type PushPluginLike } from './push';
import { createRouteGate } from '../links/route-gate';
import type { PushRoute } from '@aipowersalon/api-contracts';

class FakePlugin implements PushPluginLike {
  perm = 'prompt'; asked = 0; registered = 0; channels: string[] = [];
  listeners: Record<string, ((x: any) => void)[]> = {};
  grantOnAsk = true;
  async checkPermissions() { return { receive: this.perm }; }
  async requestPermissions() { this.asked++; this.perm = this.grantOnAsk ? 'granted' : 'denied'; return { receive: this.perm }; }
  async register() { this.registered++; }
  async addListener(e: string, cb: (x: any) => void) { (this.listeners[e] ??= []).push(cb); return { remove() {} }; }
  async removeAllListeners() { this.listeners = {}; }
  async createChannel(c: { id: string }) { this.channels.push(c.id); }
  emit(e: string, x: any) { for (const cb of this.listeners[e] ?? []) cb(x); }
}
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const flush = () => new Promise((r) => setTimeout(r, 0));

let plugin: FakePlugin; let posts: { path: string; body: any }[]; let opened: PushRoute[]; let signedIn: boolean; let storage: ReturnType<typeof mem>;
const client = (over: Partial<Parameters<typeof createPushClient>[0]> = {}) => createPushClient({
  app: 'tech', plugin, storage, isNative: () => true, platform: () => 'android',
  http: { post: async (path, body) => { posts.push({ path, body }); return { ok: true }; } },
  gate: createRouteGate({ canOpen: () => signedIn, open: (r) => opened.push(r) }), ...over,
});
beforeEach(() => { plugin = new FakePlugin(); posts = []; opened = []; signedIn = true; storage = mem(); });

describe('permission timing (§58): never at launch', () => {
  it('resume() at sign-in never prompts; a device that already granted registers silently', async () => {
    const c = client();
    await c.resume(); expect(plugin.asked).toBe(0); expect(plugin.registered).toBe(0);
    plugin.perm = 'granted'; await client().resume(); expect(plugin.asked).toBe(0); expect(plugin.registered).toBe(1);
  });
  it('the first meaningful action asks once; a decline is not re-asked', async () => {
    plugin.grantOnAsk = false;
    const c = client();
    await c.noteMeaningfulAction(); await c.noteMeaningfulAction();
    expect(plugin.asked).toBe(1); expect(plugin.registered).toBe(0);
  });
  it('a dismissed prompt (still "prompt") is not re-asked by the app either', async () => {
    plugin.requestPermissions = async () => { plugin.asked++; return { receive: 'prompt' }; };
    const c = client();
    await c.noteMeaningfulAction(); await c.noteMeaningfulAction(); await client().noteMeaningfulAction();
    expect(plugin.asked).toBe(1);
  });
  it('the web build does nothing at all', async () => {
    const c = client({ isNative: () => false });
    await c.noteMeaningfulAction(); await c.resume();
    expect(plugin.asked + plugin.registered).toBe(0);
  });
  it('Android channels exist before the first registration (§138)', async () => {
    await client().noteMeaningfulAction();
    // high_priority_v2: the channel the FCM provider sends to (push-providers.ts channel_id) and the AndroidManifest default
    expect(plugin.channels).toEqual(['high_priority_v2', 'default', 'alerts', 'security']);
  });
});

describe('registration + rotation (§63)', () => {
  it('posts the token with this app’s id; a rotated token replaces and hands back the old one', async () => {
    const c = client(); await c.noteMeaningfulAction();
    plugin.emit('registration', { value: 'tok-1' }); await flush();
    expect(posts).toEqual([{ path: '/push/register', body: { platform: 'android', token: 'tok-1', app: 'tech' } }]);
    plugin.emit('registration', { value: 'tok-2' }); await flush(); await flush();
    expect(posts.slice(1)).toEqual([{ path: '/push/register', body: { platform: 'android', token: 'tok-2', app: 'tech' } }, { path: '/push/unregister', body: { token: 'tok-1' } }]);
  });
});

describe('sign-out hands the token back (the incident behind tech-web’s old push.ts)', () => {
  it('unregisters the stored token, then forgets it', async () => {
    storage.setItem('aps.push.token', 'tok-9');
    await client().unregister();
    expect(posts).toEqual([{ path: '/push/unregister', body: { token: 'tok-9' } }]);
    expect(storage.getItem('aps.push.token')).toBeNull();
  });
  it('a failed hand-back keeps the token for the next sign-out', async () => {
    storage.setItem('aps.push.token', 'tok-9');
    await client({ http: { post: async () => { throw new Error('offline'); } } }).unregister();
    expect(storage.getItem('aps.push.token')).toBe('tok-9');
  });
});

describe('tap routing (§62): a notification names a destination, the session decides', () => {
  it('opens the typed route when the session may', async () => {
    const c = client(); await c.resume();
    plugin.emit('pushNotificationActionPerformed', { notification: { data: { category: 'QUEUE_ASSIGNMENT', route: 'queue', queueItemId: 'q1' } } }); await flush();
    expect(opened).toEqual([{ name: 'queue', params: { queueItemId: 'q1' } }]);
  });
  it('signed out: nothing opens until sign-in, then it opens through the same check', async () => {
    signedIn = false;
    const gate = createRouteGate({ canOpen: () => signedIn, open: (r) => opened.push(r) });
    const c = client({ gate });
    expect(await c.handleTap({ category: 'APPROVAL_REQUIRED' })).toBe(false);
    expect(opened).toEqual([]);
    signedIn = true; expect(await gate.retry()).toBe(true);
    expect(opened).toEqual([{ name: 'approvals', params: {} }]);
  });
  it('an unknown route or a URL in the payload opens nothing', async () => {
    const c = client();
    expect(await c.handleTap({ route: 'https://evil.example' })).toBe(false);
    expect(await c.handleTap({ route: 'admin' })).toBe(false);
    expect(opened).toEqual([]);
  });
  it('sign-out drops a pending route', async () => {
    signedIn = false;
    const gate = createRouteGate({ canOpen: () => signedIn, open: (r) => opened.push(r) });
    const c = client({ gate });
    await c.handleTap({ category: 'PAYROLL' });
    await c.unregister(); signedIn = true;
    expect(await gate.retry()).toBe(false);
  });
});
