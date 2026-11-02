// transport.test — BUILD_PLAN Phase 13 (Constitution 6 §11–16): the ONE mobile transport. Headers, timeouts, GET-only
// retry, caller abort, Idempotency-Key, bearer on every method (uploads included), the base read at call time, and the
// network state it feeds.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTransport, TIMEOUTS } from './transport';
import { networkState, resetNetworkState } from './network-state';
import { setSecureStore, InMemorySecureStore, saveNativeToken, clearNativeToken } from '../native-auth';

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };
function fakeFetch(responses: Array<Response | Error | ((init: any) => Promise<Response>)>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    const r = responses.length > 1 ? responses.shift()! : responses[0];
    if (r instanceof Error) throw r;
    if (typeof r === 'function') return r(init);
    return r.clone();
  });
  return { impl: impl as unknown as typeof fetch, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noSleep = async () => undefined;

let base = 'https://api.example.test';
const mk = (f: { impl: typeof fetch }, extra: Record<string, unknown> = {}) =>
  createTransport({ app: 'tech', apiBase: () => base, appVersion: () => '1.4.0', fetchImpl: f.impl, sleep: noSleep, random: () => 0.5, ...extra });

describe('mobile transport', () => {
  beforeEach(async () => { setSecureStore(new InMemorySecureStore()); await clearNativeToken(); resetNetworkState(); base = 'https://api.example.test'; });

  it('sends the client headers on every call (app, version, platform, device, request id) and /api/v1 on the base', async () => {
    const f = fakeFetch([json(200, { ok: true })]);
    const t = mk(f);
    await t.get('/tech/queue', { query: { day: '2026-10-09' } });
    const { url, init } = f.calls[0];
    expect(url).toBe('https://api.example.test/api/v1/tech/queue?day=2026-10-09');
    expect(init.headers['X-Client-Type']).toBe('tech');
    expect(init.headers['X-Client-Version']).toBe('1.4.0');
    expect(init.headers['X-Client-Platform']).toBe('web');
    expect(init.headers['X-Device-ID']).toMatch(/^[0-9a-f]{32}$/);
    expect(init.headers['X-Request-ID']).toMatch(/^cli_[A-Za-z0-9_.:-]{8,}$/);
    expect(init.credentials).toBe('include');
  });

  it('omits X-Client-Version when the build has none (never sends "unknown")', async () => {
    const f = fakeFetch([json(200, {})]);
    await createTransport({ app: 'owner', apiBase: () => '', fetchImpl: f.impl, sleep: noSleep }).get('/owner/x');
    expect(f.calls[0].init.headers['X-Client-Version']).toBeUndefined();
    expect(f.calls[0].url).toBe('/api/v1/owner/x');
  });

  it('reads the base at CALL time (a runtime override is honoured)', async () => {
    const f = fakeFetch([json(200, {})]);
    const t = mk(f);
    base = 'https://other.example.test';
    await t.get('/x');
    expect(f.calls[0].url.startsWith('https://other.example.test/api/v1/x')).toBe(true);
  });

  it('native: the bearer rides EVERY method, uploads included', async () => {
    await saveNativeToken('tok123');
    const f = fakeFetch([json(200, {})]);
    const t = mk(f);
    await t.get('/a'); await t.post('/b', { x: 1 }); await t.patch('/c', {}); await t.put('/d', {}); await t.del('/e');
    const fd = new FormData(); fd.append('file', new Blob(['x']), 'x.png');
    await t.upload('/f', fd);
    await t.raw('/g', { headers: { Prefer: 'respond-async' } });
    expect(f.calls).toHaveLength(7);
    for (const c of f.calls) expect(c.init.headers.Authorization).toBe('Bearer tok123');
    const up = f.calls[5];
    expect(up.init.body).toBe(fd);
    expect(up.init.headers['Content-Type']).toBeUndefined();   // the browser sets the multipart boundary
    expect(f.calls[6].init.headers.Prefer).toBe('respond-async');
  });

  it('web: no bearer at all (the httpOnly cookie is the credential)', async () => {
    const f = fakeFetch([json(200, {})]);
    await mk(f).post('/b', {});
    expect(f.calls[0].init.headers.Authorization).toBeUndefined();
  });

  it('sends Idempotency-Key when asked, and JSON bodies with Content-Type', async () => {
    const f = fakeFetch([json(200, {})]);
    await mk(f).post('/tech/queue/1/start', { a: 1 }, { idempotencyKey: 'idem_abc' });
    expect(f.calls[0].init.headers['Idempotency-Key']).toBe('idem_abc');
    expect(f.calls[0].init.headers['Content-Type']).toBe('application/json');
    expect(f.calls[0].init.body).toBe('{"a":1}');
  });

  it('refuses a client-supplied tenantId before sending', async () => {
    const f = fakeFetch([json(200, {})]);
    await expect(mk(f).post('/owner/x', { tenantId: 't' })).rejects.toThrow(/tenantId/);
    expect(f.calls).toHaveLength(0);
  });

  it('retries a GET on a network failure / 503 with backoff, then succeeds', async () => {
    const f = fakeFetch([new TypeError('Failed to fetch'), json(503, { code: 'SERVICE_UNAVAILABLE' }), json(200, { ok: 1 })]);
    const sleeps: number[] = [];
    const t = mk(f, { sleep: async (ms: number) => { sleeps.push(ms); } });
    expect(await t.get('/x')).toEqual({ ok: 1 });
    expect(f.calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);               // exponential
    expect(f.calls[0].init.headers['X-Request-ID']).toBe(f.calls[2].init.headers['X-Request-ID']);   // one logical request
  });

  it('NEVER retries a POST / PATCH / PUT / DELETE / upload — even on a network failure', async () => {
    for (const m of ['post', 'patch', 'put', 'del'] as const) {
      const f = fakeFetch([new TypeError('Failed to fetch'), json(200, {})]);
      await expect((mk(f) as any)[m]('/x', {})).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
      expect(f.calls, m).toHaveLength(1);
    }
    const f = fakeFetch([json(503, {}), json(200, {})]);
    await expect(mk(f).post('/x', {})).rejects.toMatchObject({ status: 503 });
    expect(f.calls).toHaveLength(1);
  });

  it('does not retry a 4xx GET', async () => {
    const f = fakeFetch([json(404, { code: 'NOT_FOUND', message: 'nope' }), json(200, {})]);
    await expect(mk(f).get('/x')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'nope' });
    expect(f.calls).toHaveLength(1);
  });

  it('times out with the class budget (FAST 8 s / NORMAL 20 s / UPLOAD 120 s / LONG 60 s)', async () => {
    expect(TIMEOUTS).toEqual({ FAST: 8000, NORMAL: 20000, UPLOAD: 120000, LONG: 60000 });
    vi.useFakeTimers();
    try {
      const hang = (init: any) => new Promise<Response>((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      const f = fakeFetch([hang]);
      const p = mk(f).post('/x', {}, { timeout: 'FAST' });
      const caught = p.catch((e) => e);
      await vi.advanceTimersByTimeAsync(7999);
      expect(f.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(await caught).toMatchObject({ code: 'NETWORK_TIMEOUT', status: 0, action: 'RETRY' });
    } finally { vi.useRealTimers(); }
  });

  it("a caller's AbortSignal cancels the call and is NOT retried", async () => {
    const ac = new AbortController();
    const hang = (init: any) => new Promise<Response>((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const f = fakeFetch([hang]);
    const p = mk(f).get('/x', { signal: ac.signal });
    await vi.waitFor(() => expect(f.calls).toHaveLength(1));
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError', code: 'ABORTED' });
    expect(f.calls).toHaveLength(1);
    expect(networkState.get().failures).toBe(0);                // a cancel is not a network failure
  });

  it('a 401 announces aps:unauthorized and runs onUnauthorized — unless the caller opts out (sign-in calls)', async () => {
    const seen: string[] = [];
    window.addEventListener('aps:unauthorized', () => seen.push('evt'));
    const onUnauthorized = vi.fn();
    const f = fakeFetch([json(401, { code: 'UNAUTHENTICATED' })]);
    await expect(mk(f, { onUnauthorized }).get('/x')).rejects.toMatchObject({ status: 401, action: 'REAUTHENTICATE' });
    expect(seen).toEqual(['evt']); expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(mk(f, { onUnauthorized }).post('/auth/login', {}, { notifyUnauthorized: false })).rejects.toMatchObject({ status: 401 });
    expect(seen).toEqual(['evt']); expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('a 426 UPDATE_REQUIRED announces aps:update-required with the body (agent B\'s AppConfigGate listens)', async () => {
    const got: unknown[] = [];
    const h = (e: Event) => got.push((e as CustomEvent).detail);
    window.addEventListener('aps:update-required', h);
    const body = { code: 'UPDATE_REQUIRED', message: 'Update', storeUrl: 'https://store.example/app', minimumVersion: '2.0.0' };
    const f = fakeFetch([json(426, body)]);
    await expect(mk(f).get('/x')).rejects.toMatchObject({ status: 426, code: 'UPDATE_REQUIRED' });
    expect(got).toEqual([body]);
    await expect(mk(fakeFetch([json(426, { code: 'OTHER' })])).get('/x')).rejects.toMatchObject({ status: 426 });
    expect(got).toHaveLength(1);
    window.removeEventListener('aps:update-required', h);
  });

  it('reports one timing per logical request (class, ms, outcome) — no URL, no path', async () => {
    const seen: any[] = [];
    const f = fakeFetch([new TypeError('Failed to fetch'), json(200, {})]);
    await mk(f, { onTiming: (t: any) => seen.push(t) }).get('/secret/path', { timeout: 'FAST' });
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]).sort()).toEqual(['ms', 'outcome', 'timeoutClass']);
    expect(seen[0]).toMatchObject({ timeoutClass: 'FAST', outcome: 'ok' });
    const g = fakeFetch([json(500, {})]);
    await mk(g, { maxRetries: 0, onTiming: (t: any) => seen.push(t), }).post('/x', {}).catch(() => undefined);
    expect(seen[1]).toMatchObject({ timeoutClass: 'NORMAL', outcome: 'error' });
    await mk(fakeFetch([json(200, {})]), { onTiming: () => { throw new Error('hook'); } }).get('/x');   // a broken hook never breaks a call
  });

  it('feeds the network state: repeated failures → degraded, a success → online', async () => {
    const f = fakeFetch([new TypeError('Failed to fetch')]);
    const t = mk(f, { maxRetries: 0 });
    expect(networkState.get().status).toBe('online');
    await t.get('/x').catch(() => undefined);
    await t.get('/x').catch(() => undefined);
    expect(networkState.get().status).toBe('degraded');
    const ok = fakeFetch([json(200, {})]);
    await mk(ok).get('/x');
    expect(networkState.get().status).toBe('online');
  });
});
