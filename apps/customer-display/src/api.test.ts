import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readCreds, streamSource, streamUrl, submitRating, type Creds } from './api';

// readCreds drives how the kiosk authenticates. Getting precedence wrong (device vs session) would point a paired iPad at the
// wrong endpoint, so these lock the exact rules: device token wins, session needs BOTH id and token, hash is a fallback.
const setUrl = (u: string) => window.history.pushState({}, '', u);

describe('readCreds', () => {
  beforeEach(() => setUrl('/'));

  it('reads a device token from the query string', () => {
    setUrl('/?device=dev-abc');
    expect(readCreds()).toEqual({ mode: 'device', deviceToken: 'dev-abc' });
  });

  it('reads a session id + token from the query string', () => {
    setUrl('/?session=sess-1&token=tok-1');
    expect(readCreds()).toEqual({ mode: 'session', sessionId: 'sess-1', token: 'tok-1' });
  });

  it('prefers a device token over session params when both are present', () => {
    setUrl('/?device=dev-9&session=sess-1&token=tok-1');
    expect(readCreds()).toEqual({ mode: 'device', deviceToken: 'dev-9' });
  });

  it('accepts the camelCase aliases (deviceToken / sessionId)', () => {
    setUrl('/?deviceToken=dev-x');
    expect(readCreds()).toEqual({ mode: 'device', deviceToken: 'dev-x' });
  });

  it('falls back to the hash fragment when the query string is empty', () => {
    setUrl('/#session=sess-h&token=tok-h');
    expect(readCreds()).toEqual({ mode: 'session', sessionId: 'sess-h', token: 'tok-h' });
  });

  it('returns null when a session id is present without a token', () => {
    setUrl('/?session=sess-1');
    expect(readCreds()).toBeNull();
  });

  it('returns null when no credentials are present', () => {
    setUrl('/?foo=bar');
    expect(readCreds()).toBeNull();
  });
});

describe('streamUrl / streamSource', () => {
  it('a paired display\'s stream address carries NO credential — it rides the x-device-token header (§12)', async () => {
    const c: Creds = { mode: 'device', deviceToken: 'd 1' };
    const url = streamUrl(c);
    expect(url).toMatch(/\/customer-display\/device\/stream$/);
    expect(url).not.toContain('d%201');
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => undefined));   // the stream stays open
    vi.stubGlobal('fetch', fetchMock);
    const es = streamSource(c)!(url);
    await Promise.resolve();
    const [u, init] = fetchMock.mock.calls[0];
    expect(u).toBe(url);
    expect(init.headers['x-device-token']).toBe('d 1');
    expect(init.headers.Accept).toBe('text/event-stream');
    es.close();
    vi.unstubAllGlobals();
  });

  it('a one-off session display keeps the browser EventSource (no factory)', () => {
    expect(streamSource({ mode: 'session', sessionId: 's', token: 't' })).toBeUndefined();
  });

  it('carries the session token as a query param', () => {
    const c: Creds = { mode: 'session', sessionId: 's/1', token: 't/1' };
    const url = streamUrl(c);
    expect(url).toContain('/customer-display/checkout/s%2F1/stream?token=t%2F1');
  });
});

describe('submitRating', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('posts the rating to the session endpoint with the display token header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ state: 'payment_success' }) });
    vi.stubGlobal('fetch', fetchMock);
    await submitRating({ mode: 'session', sessionId: 's1', token: 'tok1' }, 5);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/customer-display/checkout/s1/rating');
    expect(init.method).toBe('POST');
    expect(init.headers['x-display-token']).toBe('tok1');
    expect(JSON.parse(init.body)).toEqual({ rating: 5 });
  });

  it('posts to the device endpoint with the device token header in device mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ state: 'payment_success' }) });
    vi.stubGlobal('fetch', fetchMock);
    await submitRating({ mode: 'device', deviceToken: 'dev1' }, 3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/customer-display/device/rating');
    expect(init.headers['x-device-token']).toBe('dev1');
    expect(JSON.parse(init.body)).toEqual({ rating: 3 });
  });
});
