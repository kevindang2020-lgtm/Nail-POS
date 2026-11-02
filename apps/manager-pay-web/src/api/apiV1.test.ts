// apiV1.test — BUILD_PLAN Phase 12 (Constitution 5 #57): manager-pay-web calls the API at /api/v1/<path>. The legacy spelling still
// works on the server (apps already installed); every build from here on uses /api/v1. /auth/refresh stays put (the
// refresh cookie is Path=/auth/refresh) and so do /media pictures.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, apiUrl } from './client';

afterEach(() => { vi.unstubAllGlobals(); });
const capture = () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(String(u)); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); }));
  return urls;
};

describe('manager-pay-web — every API call is /api/v1', () => {
  it('get with a query and post', async () => {
    const urls = capture();
    await api.get('/mobile-checkout/queue', { limit: 5, skip: undefined });
    await api.post('/mobile-checkout/queue', { x: 1 });
    expect(urls).toEqual(['/api/v1/mobile-checkout/queue?limit=5', '/api/v1/mobile-checkout/queue']);
  });
  it('the stream address and the paths that stay put', () => {
    expect(apiUrl('/realtime/stream')).toBe('/api/v1/realtime/stream');
    expect(apiUrl('/auth/login')).toBe('/api/v1/auth/login');
    expect(apiUrl('/auth/refresh')).toBe('/auth/refresh');
    expect(apiUrl('/media/a.png')).toBe('/media/a.png');
  });
});
