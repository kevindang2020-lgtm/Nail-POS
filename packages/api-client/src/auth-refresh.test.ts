// auth-refresh.test.ts — Constitution 3 Step 2b: the 15-minute session is renewed silently.
import { describe, it, expect, vi } from 'vitest';
import { installAuthRefresh, refreshableUrl } from './auth-refresh';

type Call = { url: string; init?: RequestInit };
function fakeServer(opts: { refreshOk?: boolean; failPaths?: string[] } = {}) {
  const calls: Call[] = []; let session = 1; let refreshes = 0;
  const fetchImpl = vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url; calls.push({ url, init });
    if (url.endsWith('/auth/refresh')) { refreshes++; await new Promise((r) => setTimeout(r, 5)); if (opts.refreshOk === false) return new Response('{}', { status: 401 }); session++; return new Response(JSON.stringify({ ok: true, accessToken: 'A' + session, refreshToken: 'R' + session }), { status: 200 }); }
    if (opts.failPaths?.some((p) => url.includes(p))) return new Response('{"message":"Invalid password"}', { status: 401 });
    if (url.endsWith('/auth/login')) return new Response('{}', { status: 200 });
    const authed = (init?.headers instanceof Headers ? init.headers.get('Authorization') : (init?.headers as any)?.Authorization);
    const fresh = session > 1 || (authed && authed !== 'Bearer A1');
    return fresh ? new Response('{"ok":true}', { status: 200 }) : new Response('{}', { status: 401 });
  });
  return { calls, fetchImpl, refreshes: () => refreshes };
}

describe('installAuthRefresh', () => {
  it('a 401 from an API route → one refresh → the original request is retried and succeeds', async () => {
    const s = fakeServer(); const win: any = { fetch: s.fetchImpl };
    installAuthRefresh(win, { apiBase: 'https://api.test' });
    const r = await win.fetch('https://api.test/pos/booking/state', { credentials: 'include' });
    expect(r.status).toBe(200);
    expect(s.calls.map((c) => c.url)).toEqual(['https://api.test/pos/booking/state', 'https://api.test/auth/refresh', 'https://api.test/pos/booking/state']);
  });
  it('single flight: five concurrent 401s share ONE refresh', async () => {
    const s = fakeServer(); const win: any = { fetch: s.fetchImpl };
    installAuthRefresh(win, { apiBase: 'https://api.test' });
    const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => win.fetch(`https://api.test/pos/x${i}`)));
    expect(rs.every((r: Response) => r.status === 200)).toBe(true);
    expect(s.refreshes()).toBe(1);
  });
  it('a wrong password (401 on /auth/login, /auth/mfa, /customer/auth…) is NOT hidden by a refresh', async () => {
    const s = fakeServer({ failPaths: ['/auth/login', '/auth/mfa/verify', '/customer/auth/register'] }); const win: any = { fetch: s.fetchImpl };
    installAuthRefresh(win, { apiBase: 'https://api.test' });
    for (const p of ['/auth/login', '/auth/mfa/verify', '/customer/auth/register']) expect((await win.fetch('https://api.test' + p, { method: 'POST' })).status).toBe(401);
    expect(s.refreshes()).toBe(0);
  });
  it('a failed refresh hands the 401 to the app and stops refreshing until a sign-in succeeds', async () => {
    const s = fakeServer({ refreshOk: false }); const win: any = { fetch: s.fetchImpl };
    installAuthRefresh(win, { apiBase: 'https://api.test' });
    expect((await win.fetch('https://api.test/pos/a')).status).toBe(401);
    expect((await win.fetch('https://api.test/pos/b')).status).toBe(401);
    expect(s.refreshes()).toBe(1);   // the second 401 did not refresh again
    await win.fetch('https://api.test/auth/login', { method: 'POST' });
    await win.fetch('https://api.test/pos/c');
    expect(s.refreshes()).toBe(2);   // re-armed by the successful sign-in
  });
  it('native: the refresh sends the stored refresh token, saves the ROTATED pair, and the retry carries the new bearer', async () => {
    const s = fakeServer(); const win: any = { fetch: s.fetchImpl };
    let access = 'A1', refresh = 'R1';
    installAuthRefresh(win, { apiBase: 'https://api.test', native: { loadAccess: async () => access, loadRefresh: async () => refresh, save: async (a, r) => { access = a!; refresh = r!; } } });
    const r = await win.fetch('https://api.test/tech/me', { headers: { Authorization: 'Bearer A1' } });
    expect(r.status).toBe(200);
    expect(JSON.parse(String(s.calls[1].init?.body))).toEqual({ refreshToken: 'R1' });
    expect([access, refresh]).toEqual(['A2', 'R2']);
    expect((s.calls[2].init?.headers as Headers).get('Authorization')).toBe('Bearer A2');
  });
  it('requests to another origin are never touched', () => {
    expect(refreshableUrl('https://maps.example.com/x', 'https://api.test')).toBe(false);
    expect(refreshableUrl('https://api.test/pos/x', 'https://api.test')).toBe(true);
    expect(refreshableUrl('/pos/x', '', 'https://pos.test')).toBe(true);
    expect(refreshableUrl('/auth/refresh', '', 'https://pos.test')).toBe(false);
    expect(refreshableUrl('/auth/me', '', 'https://pos.test')).toBe(true);   // the startup probe IS rescued (a returning user after 15 idle minutes)
    expect(refreshableUrl('/api/v1/auth/biometric/login', '', 'https://pos.test')).toBe(false);   // Phase 13 D: a refused Face ID credential is not an expired session
    expect(refreshableUrl('/api/v1/auth/biometric/enroll', '', 'https://pos.test')).toBe(true);
  });
});
