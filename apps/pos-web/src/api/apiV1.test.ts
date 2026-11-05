// apiV1.test — BUILD_PLAN Phase 12 (Constitution 5 #57): the POS calls the API at /api/v1/<path> — the shared client,
// the domain clients that fetch for themselves, uploads, CSV exports and the stream. Pictures stay at /media.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, apiUrl } from './client';
import { posQueueApi } from './posQueueApi';
import { posBookingApi } from './posBookingApi';
import { mediaUrl } from './posDisplayAdsApi';

afterEach(() => { vi.unstubAllGlobals(); });
const capture = () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(String(u)); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); }));
  return urls;
};

describe('pos-web — every API call is /api/v1', () => {
  it('the shared client: get with a query, post, upload', async () => {
    const urls = capture();
    await api.get('/pos/customers', { q: 'ann', page: 0 });
    await api.post('/pos/tickets', { note: 'x' });
    await api.upload('/pos/customers/import', new FormData());
    expect(urls).toEqual(['/api/v1/pos/customers?q=ann&page=0', '/api/v1/pos/tickets', '/api/v1/pos/customers/import']);
  });
  it('the domain clients that call fetch themselves', async () => {
    const urls = capture();
    await posQueueApi.kpis();
    await posBookingApi.state({});
    expect(urls).toEqual(['/api/v1/pos/queue/kpis', '/api/v1/pos/booking/state']);
  });
  it('apiUrl spells the stream and keeps the cookie-scoped refresh and pictures where they are', () => {
    expect(apiUrl('/realtime/stream')).toBe('/api/v1/realtime/stream');
    expect(apiUrl('/auth/refresh')).toBe('/auth/refresh');
    expect(mediaUrl('/media/ads/a.png')).toBe('/media/ads/a.png');
  });
});
