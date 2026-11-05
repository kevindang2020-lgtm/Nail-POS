// apiV1.test — BUILD_PLAN Phase 12 (Constitution 5 #57): the display calls the API at /api/v1/<path> — its device API,
// the pairing flow, the realtime stream and the Go Check-In it shows between customers. Pictures stay at /media.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { submitRating, streamUrl, startPairing, mediaUrl } from './api';
import { startDisplaySession } from './goCheckInApi';

afterEach(() => { vi.unstubAllGlobals(); });
const capture = () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(String(u)); return new Response('{}', { status: 200 }); }));
  return urls;
};

describe('customer display — every API call is /api/v1', () => {
  it('device API, session API, pairing and check-in', async () => {
    const urls = capture();
    await submitRating({ mode: 'device', deviceToken: 'd' }, 5);
    await submitRating({ mode: 'session', sessionId: 's1', token: 't' }, 4);
    await startPairing('web' as any);
    await startDisplaySession('d');
    expect(urls).toEqual([
      '/api/v1/customer-display/device/rating',
      '/api/v1/customer-display/checkout/s1/rating',
      '/api/v1/customer-display/pairing',
      '/api/v1/customer-display/device/check-in/session',
    ]);
  });
  it('the realtime stream too; pictures stay at /media', () => {
    expect(streamUrl({ mode: 'device', deviceToken: 'd' })).toBe('/api/v1/customer-display/device/stream');
    expect(streamUrl({ mode: 'session', sessionId: 's1', token: 't k' })).toBe('/api/v1/customer-display/checkout/s1/stream?token=t%20k');
    expect(mediaUrl('/media/ads/a.png')).toBe('/media/ads/a.png');
    expect(mediaUrl('https://cdn.x/a.png')).toBe('https://cdn.x/a.png');
  });
});
