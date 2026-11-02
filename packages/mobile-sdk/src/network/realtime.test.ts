// realtime.test — BUILD_PLAN Phase 13 (Constitution 6 §28–32, bug 1): the stream URL each app's realtime client opens.
// Web: the relative /api/v1 path (the cookie authenticates). Native: a fresh single-use ticket, the ABSOLUTE base, the
// device id — and never the bearer token in the URL. Logout / a dead session disconnects the stream.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTransport } from './transport';
import { realtimeStreamUrl, bindRealtimeToSession, signalSignedOut, SIGNED_OUT_EVENT } from './realtime';
import { setSecureStore, InMemorySecureStore, saveNativeToken, clearNativeToken, deviceId } from '../native-auth';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('realtimeStreamUrl', () => {
  beforeEach(async () => { setSecureStore(new InMemorySecureStore()); await clearNativeToken(); });

  it('web: the /api/v1 stream path on the (same-origin) base, no ticket request', async () => {
    const fetchImpl = vi.fn();
    const t = createTransport({ app: 'tech', apiBase: () => '', fetchImpl: fetchImpl as any });
    expect(await realtimeStreamUrl(t, '/tech/stream', { native: () => false })()).toBe('/api/v1/tech/stream');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('native: POSTs /realtime/stream-ticket with the bearer, returns the ABSOLUTE url with ?ticket=&device= — never the token', async () => {
    await saveNativeToken('secret-bearer-token');
    const calls: Array<{ url: string; init: any }> = [];
    let n = 0;
    const fetchImpl = vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return json(200, { ticket: `tick${++n}`, expiresIn: 60 }); });
    const t = createTransport({ app: 'tech', apiBase: () => 'https://api.example.test', fetchImpl: fetchImpl as any });
    const resolve = realtimeStreamUrl(t, '/tech/stream', { native: () => true });
    const u1 = await resolve();
    const dev = await deviceId();
    expect(u1).toBe(`https://api.example.test/api/v1/tech/stream?ticket=tick1&device=${dev}`);
    expect(u1).not.toContain('secret-bearer-token');
    expect(calls[0].url).toBe('https://api.example.test/api/v1/realtime/stream-ticket');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe('Bearer secret-bearer-token');
    expect(await resolve()).toContain('ticket=tick2');                       // a fresh ticket per (re)connect
  });

  it('native: a refused ticket rejects (the realtime client backs off and retries)', async () => {
    const t = createTransport({ app: 'owner', apiBase: () => 'https://api.example.test', fetchImpl: (async () => json(401, { code: 'UNAUTHENTICATED' })) as any });
    await expect(realtimeStreamUrl(t, '/owner/stream', { native: () => true })()).rejects.toMatchObject({ status: 401 });
  });
});

describe('bindRealtimeToSession', () => {
  it('disconnects on sign-out and on a dead session (aps:unauthorized); unbind stops listening', () => {
    const client = { disconnect: vi.fn() };
    const unbind = bindRealtimeToSession(client);
    signalSignedOut();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent('aps:unauthorized'));
    expect(client.disconnect).toHaveBeenCalledTimes(2);
    unbind();
    window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT));
    expect(client.disconnect).toHaveBeenCalledTimes(2);
  });
});
