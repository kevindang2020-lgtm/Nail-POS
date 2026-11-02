// client.test — Constitution 9 Phase 15: the shared client end-to-end against a fake EventSource, the §175 channel
// API, the §191–193 fallback poller, and the §26/§246 registry-parity contract with the server.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRealtimeClient, FallbackPoller, CHANNELS } from './client';
import { EVENTS, screensToRefetch } from './core';

/** A controllable EventSource: tests push frames, errors and opens by hand. */
class FakeES {
  static instances: FakeES[] = [];
  onopen: any = null; onmessage: any = null; onerror: any = null; closed = false;
  constructor(public url: string) { FakeES.instances.push(this); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  frame(d: unknown) { this.onmessage?.({ data: JSON.stringify(d) }); }
  fail() { this.onerror?.(); }
}
const fakeWindow = () => {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    addEventListener: (n: string, f: () => void) => { (listeners[n] ??= []).push(f); },
    document: { hidden: false, addEventListener: (n: string, f: () => void) => { (listeners[n] ??= []).push(f); } },
    fire: (n: string) => { for (const f of listeners[n] ?? []) f(); },
    EventSource: FakeES,
  } as any;
};
const mk = (post?: any) => {
  FakeES.instances = [];
  const win = fakeWindow();
  const client = createRealtimeClient({ streamPath: '/realtime/stream', post, eventSourceFactory: (p) => new FakeES(p) as any, windowRef: win, now: () => 1_000_000 });
  return { client, win, es: () => FakeES.instances[FakeES.instances.length - 1] };
};

describe('the shared client on a fake stream', () => {
  it('connects, dispatches events with the server\'s screens, and never dispatches ping/connected/presence frames', () => {
    const { client, es } = mk(); const seen: any[] = [];
    client.onEvent((d) => seen.push(d)); client.connect(); es().open();
    es().frame({ event: 'connected', seq: 0 }); es().frame({ event: 'ping' }); es().frame({ event: 'presence_registered', connectionId: 'c-1' });
    es().frame({ event: EVENTS.queueUpdated, screens: ['queue'], seq: 1 });
    expect(seen).toEqual([{ event: 'queue_updated', screens: ['queue'], payload: undefined }]);
    expect(client.status()).toBe('CONNECTED');
  });
  it('§33 a sequence gap mid-stream triggers a reconcile; §182 a duplicate seq is dropped; §36 resync_required reconciles', () => {
    const { client, es } = mk(); const reasons: string[] = []; const seen: string[] = [];
    client.onReconcile((r) => reasons.push(r)); client.onEvent((d) => seen.push(d.event)); client.connect(); es().open();
    es().frame({ event: 'connected', seq: 10 });
    es().frame({ event: EVENTS.queueUpdated, seq: 11 });
    es().frame({ event: EVENTS.ticketPaid, seq: 13 });              // 12 lost
    es().frame({ event: EVENTS.ticketPaid, seq: 13 });              // duplicate
    es().frame({ event: 'resync_required', reason: 'slow_client', seq: 20 });
    expect(reasons).toEqual(['sequence_gap', 'slow_client']);
    expect(seen).toEqual(['queue_updated', 'ticket_paid']);          // the duplicate did not dispatch
  });
  it('§37 an error closes the socket, reports RECONNECTING, and reopens after a backoff; the reopen reconciles (§34–36)', () => {
    vi.useFakeTimers();
    const { client, es } = mk(); const statuses: string[] = []; const reasons: string[] = [];
    client.onStatus((s) => statuses.push(s)); client.onReconcile((r) => reasons.push(r)); client.connect(); es().open();
    const first = es(); first.fail();
    expect(first.closed).toBe(true);
    expect(statuses[statuses.length - 1]).toBe('RECONNECTING');
    vi.advanceTimersByTime(60_000);
    expect(FakeES.instances.length).toBe(2);                         // reopened once, not in a tight loop
    es().open();
    expect(reasons).toEqual(['reconnected']);
    vi.useRealTimers();
  });
  it('Phase 14: reports AWAY/ONLINE for its own connection through the injected post; nothing before presence_registered', () => {
    const post = vi.fn(async () => ({}));
    const { client, es, win } = mk(post); client.connect(); es().open();
    win.document.hidden = true; win.fire('visibilitychange');
    expect(post).not.toHaveBeenCalled();                             // no connectionId yet
    win.document.hidden = false; win.fire('visibilitychange');
    es().frame({ event: 'presence_registered', connectionId: 'c-9' });
    win.document.hidden = true; win.fire('visibilitychange');
    expect(post).toHaveBeenCalledWith('/realtime/presence', { connectionId: 'c-9', state: 'AWAY' });
  });
  it('§32 a two-room stream tracks each slot on its own: interleaved seqs from r0 and r1 are NOT a gap', () => {
    const { client, es } = mk(); const reasons: string[] = []; const seen: string[] = [];
    client.onReconcile((r) => reasons.push(r)); client.onEvent((d) => seen.push(d.event)); client.connect(); es().open();
    es().frame({ event: 'connected', seq: 0, seqs: { r0: 0, r1: 5 } });
    es().frame({ event: EVENTS.queueUpdated, seq: 1, stream: 'r0' });
    es().frame({ event: EVENTS.followUpTaskUpdated, seq: 6, stream: 'r1' });
    es().frame({ event: EVENTS.queueUpdated, seq: 2, stream: 'r0' });
    es().frame({ event: EVENTS.followUpTaskUpdated, seq: 8, stream: 'r1' });     // r1 skipped 7 → gap
    expect(reasons).toEqual(['sequence_gap']);
    expect(seen).toEqual(['queue_updated', 'follow_up_task_updated', 'queue_updated', 'follow_up_task_updated']);
  });
  it('§175 subscribe by channel filters by the central vocabulary; §173 unsubscribe stops delivery', () => {
    const { client, es } = mk(); const q: string[] = [];
    client.connect(); es().open(); es().frame({ event: 'connected', seq: 0 });
    const off = client.subscribe({ channel: 'branch.queue', onEvent: (d) => q.push(d.event) });
    es().frame({ event: EVENTS.queueUpdated, seq: 1 }); es().frame({ event: EVENTS.reportsUpdated, seq: 2 });
    expect(q).toEqual(['queue_updated']);
    off(); es().frame({ event: EVENTS.queueUpdated, seq: 3 });
    expect(q).toEqual(['queue_updated']);
  });
  it('every CHANNELS name is a registry event (§25/§26 — no invented vocabulary)', () => {
    const all = new Set(Object.values(EVENTS) as string[]);
    for (const [ch, names] of Object.entries(CHANNELS)) for (const n of names) expect(all.has(n), `${ch} → ${n}`).toBe(true);
  });
});

describe('graceful gateway shutdown', () => {
  it('reconnect_requested closes the socket and reopens within the requested jitter window — not the full backoff ladder', () => {
    vi.useFakeTimers();
    const { client, es } = mk(); const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s)); client.connect(); es().open();
    const first = es();
    first.frame({ event: 'reconnect_requested', reason: 'server_shutdown', jitterMs: 2000 });
    expect(first.closed).toBe(true);
    expect(statuses[statuses.length - 1]).toBe('RECONNECTING');
    expect(FakeES.instances.length).toBe(1);                 // not synchronously — spread out
    vi.advanceTimersByTime(2000);
    expect(FakeES.instances.length).toBe(2);                 // reopened within the jitter window
    vi.useRealTimers();
  });
});

describe('§191–193 FallbackPoller', () => {
  it('polls every 10s only after 15s down, reports the fallback state, and stops the instant the stream is back', () => {
    vi.useFakeTimers();
    const poll = vi.fn(); const states: boolean[] = [];
    const p = new FallbackPoller(poll, { intervalMs: 10_000, graceMs: 15_000, onStateChange: (s) => states.push(s) });
    p.onStatus('RECONNECTING');
    vi.advanceTimersByTime(14_999); expect(poll).not.toHaveBeenCalled();      // a blip never starts polling
    vi.advanceTimersByTime(1);      expect(poll).toHaveBeenCalledTimes(1);     // §192 UI told, first poll immediate
    vi.advanceTimersByTime(20_000); expect(poll).toHaveBeenCalledTimes(3);
    p.onStatus('CONNECTED');                                                    // §193
    vi.advanceTimersByTime(60_000); expect(poll).toHaveBeenCalledTimes(3);
    expect(states).toEqual([true, false]);
    vi.useRealTimers();
  });
  it('§173 stop() during the grace period disarms it — an unmounted screen never starts polling later', () => {
    vi.useFakeTimers();
    const poll = vi.fn(); const p = new FallbackPoller(poll, { graceMs: 15_000 });
    p.onStatus('RECONNECTING'); vi.advanceTimersByTime(5_000); p.stop();
    vi.advanceTimersByTime(120_000);
    expect(poll).not.toHaveBeenCalled(); expect(p.polling).toBe(false);
    vi.useRealTimers();
  });
  it('§191 refuses an interval under 5s', () => {
    expect(() => new FallbackPoller(() => {}, { intervalMs: 500 })).toThrow(/§191/);
  });
});

describe('§26/§246 one registry (Constitution 13 §77)', () => {
  it('this package carries NO copy of the registry — it re-exports @aipowersalon/realtime-contracts, the module the API emits from', () => {
    const here = readFileSync(resolve(__dirname, './core.ts'), 'utf8');
    expect(here).toMatch(/export \{[^}]*\bEVENTS\b[^}]*\} from '@aipowersalon\/realtime-contracts'/);
    for (const copy of ['export const EVENTS = {', 'const AFFECTS', 'export const EVENT_VERSIONS']) expect(here.includes(copy), `core.ts declares its own ${copy}`).toBe(false);
    // and the registry it re-exports is the real one: every routed event is a registered name
    expect(screensToRefetch('queue_updated').length).toBeGreaterThan(0);
    expect(Object.values(EVENTS)).toContain('queue_updated');
  });
});

// BUILD_PLAN Phase 13 (Constitution 6 §28–32, bug 1): NATIVE realtime. The Capacitor shell has no cookie and EventSource
// cannot send a header, so before EVERY (re)connect the client asks `streamUrl()` — which on native fetches a fresh
// single-use ticket and returns the ABSOLUTE stream URL with ?ticket=. A ticket is never reused across reconnects.
describe('native mode: a fresh stream URL (ticket) before each connect', () => {
  const mkNative = (streamUrl: () => Promise<string>) => {
    FakeES.instances = [];
    const win = fakeWindow();
    const client = createRealtimeClient({ streamPath: '/tech/stream', streamUrl, eventSourceFactory: (p) => new FakeES(p) as any, windowRef: win, now: () => 1_000_000 });
    return { client, win, es: () => FakeES.instances[FakeES.instances.length - 1] };
  };
  it('connects to the URL streamUrl() resolves (absolute, with a ticket), and asks again on reconnect', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { client, es } = mkNative(async () => `https://api.example.test/api/v1/tech/stream?ticket=t${++n}`);
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(es().url).toBe('https://api.example.test/api/v1/tech/stream?ticket=t1');
    es().open(); es().fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeES.instances.length).toBe(2);
    expect(es().url).toBe('https://api.example.test/api/v1/tech/stream?ticket=t2');   // a NEW ticket, never the used one
    client.disconnect();
    vi.useRealTimers();
  });
  it('a failed ticket request is a connection error: backoff, then try again', async () => {
    vi.useFakeTimers();
    let n = 0; const statuses: string[] = [];
    const { client, es } = mkNative(async () => { n++; if (n === 1) throw new Error('401'); return 'https://api.example.test/s?ticket=ok'; });
    client.onStatus((s) => statuses.push(s));
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeES.instances.length).toBe(0);
    expect(statuses).toContain('RECONNECTING');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(es().url).toBe('https://api.example.test/s?ticket=ok');
    client.disconnect();
    vi.useRealTimers();
  });
  it('disconnect() while a ticket is in flight opens nothing; after disconnect a tab resume does not reopen', async () => {
    vi.useFakeTimers();
    let resolve!: (u: string) => void;
    const { client, win } = mkNative(() => new Promise<string>((r) => { resolve = r; }));
    client.connect();
    client.disconnect();
    resolve('https://api.example.test/s?ticket=late');
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeES.instances.length).toBe(0);
    win.document.hidden = true; win.fire('visibilitychange');
    win.document.hidden = false; win.fire('visibilitychange');
    win.fire('online');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeES.instances.length).toBe(0);
    vi.useRealTimers();
  });
});

describe('logout: disconnect is final until the next connect', () => {
  it('after disconnect the online event and a tab resume do not reopen the stream (web too)', () => {
    vi.useFakeTimers();
    const { client, win } = mk();
    client.connect();
    expect(FakeES.instances.length).toBe(1);
    client.disconnect();
    win.fire('online');
    win.document.hidden = true; win.fire('visibilitychange');
    win.document.hidden = false; win.fire('visibilitychange');
    vi.advanceTimersByTime(120_000);
    expect(FakeES.instances.length).toBe(1);
    client.connect();                                   // signing in again reconnects — once
    expect(FakeES.instances.length).toBe(2);
    vi.useRealTimers();
  });
});

// §43 (Oct 28 2026): the server projects resourceType / resourceId / resourceVersion on every frame (since Oct 21); the client
// never read resourceVersion, so a late frame of an OLDER state still triggered a repaint. Now it is dropped — and frames of
// the same version (one change, several events) all still dispatch.
describe('§43 stale frames by resourceVersion', () => {
  it('drops a strictly older frame for the same resource; equal and newer versions dispatch; other resources are independent', () => {
    const { client, es } = mk(); const seen: string[] = [];
    client.onEvent((d) => seen.push(`${d.event}@${(d.payload as any)?.resourceVersion}`)); client.connect(); es().open();
    es().frame({ event: 'connected', seq: 0 });
    const f = (seq: number, event: string, v: number, id = 'tk1') => es().frame({ event, seq, payload: { eventId: `e${seq}`, resourceType: 'ticket', resourceId: id, resourceVersion: v, resourceVersionSource: 'aggregate' } });
    f(1, EVENTS.ticketPaid, 5);
    f(2, EVENTS.queueUpdated, 5);   // same change, another event — dispatched
    f(3, EVENTS.ticketPaid, 4);     // late, older — dropped
    f(4, EVENTS.ticketPaid, 6);
    f(5, EVENTS.ticketPaid, 1, 'tk2');   // another ticket — its own history
    expect(seen).toEqual(['ticket_paid@5', 'queue_updated@5', 'ticket_paid@6', 'ticket_paid@1']);
  });
  it('a payload-sourced version (possibly another counter) never drops a frame', () => {
    const { client, es } = mk(); const seen: string[] = [];
    client.onEvent((d) => seen.push(d.event)); client.connect(); es().open();
    es().frame({ event: 'connected', seq: 0 });
    es().frame({ event: EVENTS.queueUpdated, seq: 1, payload: { eventId: 'p1', resourceType: 'settings', resourceId: 's', resourceVersion: 9, resourceVersionSource: 'payload' } });
    es().frame({ event: EVENTS.queueUpdated, seq: 2, payload: { eventId: 'p2', resourceType: 'settings', resourceId: 's', resourceVersion: 3, resourceVersionSource: 'payload' } });
    expect(seen).toEqual(['queue_updated', 'queue_updated']);
  });
  it('a frame without a resourceVersion is never dropped by it', () => {
    const { client, es } = mk(); const seen: string[] = [];
    client.onEvent((d) => seen.push(d.event)); client.connect(); es().open();
    es().frame({ event: 'connected', seq: 0 });
    es().frame({ event: EVENTS.queueUpdated, seq: 1, payload: { eventId: 'a', resourceType: 'ticket', resourceId: 'tk1', resourceVersion: 9, resourceVersionSource: 'aggregate' } });
    es().frame({ event: EVENTS.queueUpdated, seq: 2, payload: { eventId: 'b', resourceType: 'ticket', resourceId: 'tk1', resourceVersion: null } });
    expect(seen).toEqual(['queue_updated', 'queue_updated']);
  });
});
