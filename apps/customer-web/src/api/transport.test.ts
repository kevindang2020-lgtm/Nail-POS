// transport.test — BUILD_PLAN Phase 13 (Constitution 6 §11–16): customer-web's client is the ONE mobile transport.
// Its exported names are unchanged (screens untouched); every call names the app; native sends the bearer on every
// method (uploads included); the realtime stream asks for a single-use ticket on native and opens the ABSOLUTE url (bug 1).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { api, apiUrl, apiBase, transport } from './client';
import { setSecureStore, InMemorySecureStore, saveNativeToken, clearNativeToken, realtimeStreamUrl } from '@aipowersalon/mobile-sdk';

const calls: Array<{ url: string; init: any }> = [];
const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
beforeEach(async () => { calls.length = 0; setSecureStore(new InMemorySecureStore()); await clearNativeToken(); vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url: String(url), init }); return ok({ ticket: 'tk', expiresIn: 60 }); })); });
afterEach(() => { vi.unstubAllGlobals(); delete (window as any).APS_API_BASE; });

describe('customer-web — the one transport', () => {
  it('keeps the exported names and names the app on every call', async () => {
    expect(typeof api.get).toBe('function'); expect(typeof apiUrl).toBe('function'); expect(typeof apiBase).toBe('function');
    expect(transport.app).toBe('customer');
    await api.get('/customer/home');
    expect(calls[0].url).toBe('/api/v1/customer/home');
    expect(calls[0].init.headers['X-Client-Type']).toBe('customer');
    expect(calls[0].init.headers['X-Client-Platform']).toBe('web');
    expect(calls[0].init.headers['X-Request-ID']).toMatch(/^cli_/);
  });
  it('native: the bearer rides every method (uploads included), on the base read at call time', async () => {
    await saveNativeToken('native-tok');
    (window as any).APS_API_BASE = 'https://api.example.test';
    await api.get('/customer/home'); await api.post('/customer/home', {}); await api.del('/customer/home');
    const fd = new FormData(); fd.append('file', new Blob(['x']), 'a.png'); await api.upload('/customer/profile/avatar', fd);
    for (const c of calls) { expect(c.init.headers.Authorization).toBe('Bearer native-tok'); expect(c.url.startsWith('https://api.example.test/api/v1/')).toBe(true); }
  });
  it('native realtime: a ticket from /realtime/stream-ticket, then the absolute stream url — no bearer in it', async () => {
    await saveNativeToken('native-tok');
    (window as any).APS_API_BASE = 'https://api.example.test';
    const url = await realtimeStreamUrl(transport, '/customer/stream', { native: () => true })();
    expect(calls[0].url).toBe('https://api.example.test/api/v1/realtime/stream-ticket');
    expect(url.startsWith('https://api.example.test/api/v1/customer/stream?ticket=tk')).toBe(true);
    expect(url).not.toContain('native-tok');
  });
  it('a guest never reaches private customer data — refused before anything is sent', async () => {
    const guest = await import('../auth/guest');
    const spy = vi.spyOn(guest, 'isGuest').mockReturnValue(true);
    await expect(api.get('/customer/rewards')).rejects.toMatchObject({ code: 'guest_requires_account' });
    expect(calls).toHaveLength(0);
    spy.mockRestore();
  });
});
