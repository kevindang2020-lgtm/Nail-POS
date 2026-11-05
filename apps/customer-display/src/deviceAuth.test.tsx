// deviceAuth.test.tsx — 23-inch dual-screen spec §8–§12 on the display: the credential never rides an address, it is
// kept in the device's store, a provisioning link's token is moved there and wiped from the address bar at once, a
// refused credential is forgotten (back to pairing), and the pairing screen shows a code — never a salon login.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { HeaderEventSource } from './headerEventSource';
import { DEVICE_TOKEN_KEY, credentialStore, resetAddressTokenMemo, takeTokenFromAddress } from './deviceCredential';
import { useCredentials } from './useCredentials';

const enc = new TextEncoder();
function streamResponse(chunks: string[], ok = true) {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({ pull(c) { if (i < chunks.length) c.enqueue(enc.encode(chunks[i++])); else c.close(); } });
  return { ok, status: ok ? 200 : 403, body } as unknown as Response;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('HeaderEventSource — the stream with the credential in a header (§12)', () => {
  it('sends the header, parses SSE frames (LF and CRLF, multi-line data, comments), then reports the end as an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse([': hello\n\n', 'id: r0:1\ndata: {"event":"connected"}\n\n', 'data: {"a":\r\ndata: 1}\r\n\r\n']));
    const es = new HeaderEventSource('/customer-display/device/stream', { 'x-device-token': 'tok' }, fetchImpl as any);
    const seen: string[] = []; const opened = vi.fn(); const errored = vi.fn();
    es.onopen = opened; es.onmessage = (m) => seen.push(m.data); es.onerror = errored;
    for (let k = 0; k < 10; k++) await tick();
    expect(fetchImpl).toHaveBeenCalledWith('/customer-display/device/stream', expect.objectContaining({ headers: { Accept: 'text/event-stream', 'x-device-token': 'tok' } }));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['{"event":"connected"}', '{"a":\n1}']);
    expect(errored).toHaveBeenCalledTimes(1);   // the stream ended: the realtime client reconnects
    expect(es.readyState).toBe(HeaderEventSource.CLOSED);
  });
  it('a refused stream (403) is an error, never an open stream', async () => {
    const es = new HeaderEventSource('/s', {}, vi.fn().mockResolvedValue(streamResponse([], false)) as any);
    const opened = vi.fn(); const errored = vi.fn(); es.onopen = opened; es.onerror = errored;
    for (let k = 0; k < 5; k++) await tick();
    expect(opened).not.toHaveBeenCalled();
    expect(errored).toHaveBeenCalledTimes(1);
  });
  it('close() is silent and final', async () => {
    const es = new HeaderEventSource('/s', {}, vi.fn().mockReturnValue(new Promise(() => undefined)) as any);
    const errored = vi.fn(); es.onerror = errored;
    es.close();
    await tick();
    expect(errored).not.toHaveBeenCalled();
    expect(es.readyState).toBe(HeaderEventSource.CLOSED);
  });
});

describe('where the credential lives', () => {
  beforeEach(() => { localStorage.clear(); resetAddressTokenMemo(); window.history.replaceState({}, '', '/'); });
  afterEach(() => { window.history.replaceState({}, '', '/'); });

  it('a browser display keeps it in its own storage (no native shell here)', async () => {
    const s = credentialStore();
    expect(s.kind).toBe('browser');
    await s.set('tok-1');
    expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBe('tok-1');
    expect(await s.get()).toBe('tok-1');
    await s.remove();
    expect(await s.get()).toBeNull();
  });

  it('a provisioning link\'s token is taken and WIPED from the address bar (other parameters kept)', () => {
    window.history.replaceState({}, '', '/?lang=en#device=old-token&x=1');
    expect(takeTokenFromAddress()).toBe('old-token');
    expect(window.location.href).not.toContain('old-token');
    expect(window.location.search).toBe('?lang=en');
    expect(window.location.hash).toBe('#x=1');
    expect(takeTokenFromAddress()).toBe('old-token');   // once per page load, even if asked twice
  });

  it('useCredentials: none → unpaired; paired → ready with the token stored; forget → unpaired and removed', async () => {
    const { result } = renderHook(() => useCredentials());
    await act(async () => { await tick(); });
    expect(result.current.status).toBe('unpaired');
    await act(async () => { await result.current.paired('tok-2'); });
    expect(result.current).toMatchObject({ status: 'ready', creds: { mode: 'device', deviceToken: 'tok-2' } });
    expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBe('tok-2');
    await act(async () => { await result.current.forget(); });
    expect(result.current.status).toBe('unpaired');
    expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBeNull();
  });

  it('useCredentials: a stored token is used on start; an old address token is migrated into the store', async () => {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'stored');
    const a = renderHook(() => useCredentials());
    await act(async () => { await tick(); });
    expect(a.result.current.creds).toEqual({ mode: 'device', deviceToken: 'stored' });
    a.unmount();
    resetAddressTokenMemo();
    window.history.replaceState({}, '', '/#device=from-link');
    const b = renderHook(() => useCredentials());
    expect(b.result.current.creds).toEqual({ mode: 'device', deviceToken: 'from-link' });
    expect(window.location.href).not.toContain('from-link');
    expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBe('from-link');
  });

  it('a one-off session link still runs that checkout', () => {
    window.history.replaceState({}, '', '/?session=s1&token=t1');
    const { result } = renderHook(() => useCredentials());
    expect(result.current).toMatchObject({ status: 'ready', creds: { mode: 'session', sessionId: 's1', token: 't1' } });
  });
});
