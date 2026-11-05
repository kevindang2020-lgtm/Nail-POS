// offline-read-cache.test.ts — Functional Decision 33: offline, the allow-listed reads (today's board, queue, live
// schedule, catalog) come from this device's last copy; every write is refused before it leaves; copies are per user and
// cleared on sign-out; customer and payment reads are never stored.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installOfflineReadCache, setOfflineCacheScope, clearOfflineReadCache, offlineCacheKey, offlineWriteMessage, OFFLINE_CACHE_SERVED } from './offline-read-cache';

let net: ReturnType<typeof vi.fn>; let uninstall: () => void; let online = true; let clock = Date.parse('2026-10-01T14:00:00Z');
const board = { bookings: { items: [{ appointmentId: 'a1', customerName: 'Grace' }] } };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear(); online = true; clock = Date.parse('2026-10-01T14:00:00Z');
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  net = vi.fn(async (url: any, init?: any) => {
    if (!online) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(String(url).includes('/pos/booking/state') ? board : { ok: true, url: String(url), method: init?.method ?? 'GET' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  (window as any).fetch = net;
  uninstall = installOfflineReadCache(window as any, localStorage, () => clock);
  setOfflineCacheScope('t1:b1:u1');
});
afterEach(() => { uninstall(); });

describe('offline read cache (Decision 33)', () => {
  it('only the allow-listed reads are kept — never customers, payments or reports', () => {
    expect(offlineCacheKey('https://api.x/pos/booking/state?date=2026-10-01')).toBe('/pos/booking/state?date=2026-10-01');
    expect(offlineCacheKey('/pos/queue/state')).toBe('/pos/queue/state');
    expect(offlineCacheKey('/pos/services')).toBe('/pos/services');
    for (const u of ['/pos/customers/c1', '/pos/customers', '/pos/checkout/tickets/t1', '/pos/reports/sales', '/pos/booking/changes?since=x']) expect(offlineCacheKey(u)).toBeNull();
  });

  it('online it stores the board; offline it serves that copy, says when it was saved, and labels the response', async () => {
    await (await fetch('/pos/booking/state?date=2026-10-01')).json(); await flush();
    online = false; clock += 30 * 60_000;
    const seen: any[] = []; window.addEventListener(OFFLINE_CACHE_SERVED, (e) => seen.push((e as CustomEvent).detail));
    const res = await fetch('/pos/booking/state?date=2026-10-01');
    expect(await res.json()).toEqual(board);
    expect(res.headers.get('X-Offline-Copy')).toBe('2026-10-01T14:00:00.000Z');
    expect(seen[0]).toMatchObject({ savedAt: Date.parse('2026-10-01T14:00:00Z') });
  });

  it('a dropped connection the browser has not noticed yet still falls back to the copy', async () => {
    await fetch('/pos/queue/state'); await flush();
    net.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });   // still "online", request fails
    expect(await (await fetch('/pos/queue/state')).json()).toMatchObject({ ok: true });
  });

  it('offline, every write is refused before it leaves the device — checkout, refund, booking', async () => {
    online = false;
    for (const [url, method] of [['/pos/checkout/tickets/t1/pay/card', 'POST'], ['/pos/checkout/tickets/t1/refund', 'POST'], ['/pos/booking/appointments', 'POST'], ['/pos/customers/c1', 'PATCH']]) {
      const res = await fetch(url, { method });
      expect(res.status).toBe(503);
      expect((await res.json()).message).toBe(offlineWriteMessage());
    }
    expect(net).not.toHaveBeenCalled();
  });

  it('online writes pass straight through; nothing is stored for them', async () => {
    await fetch('/pos/booking/appointments', { method: 'POST', body: '{}' }); await flush();
    expect(net).toHaveBeenCalledTimes(1);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('aps_offline:'))).toEqual([]);
  });

  it('copies are per user: a different sign-in, sign-out, or a day-old copy are never served', async () => {
    await fetch('/pos/booking/state'); await flush();
    setOfflineCacheScope('t1:b1:u2');                      // someone else signs in on this device
    expect(Object.keys(localStorage).filter((k) => k.startsWith('aps_offline:'))).toEqual([]);   // the first user's copies are deleted, not just hidden
    online = false;
    await expect(fetch('/pos/booking/state')).rejects.toThrow();
    online = true; await fetch('/pos/booking/state'); await flush();
    clearOfflineReadCache();                               // sign-out
    online = false;
    await expect(fetch('/pos/booking/state')).rejects.toThrow();
    online = true; setOfflineCacheScope('t1:b1:u2'); await fetch('/pos/booking/state'); await flush();
    online = false; clock += 25 * 3_600_000;               // the copy is from yesterday
    await expect(fetch('/pos/booking/state')).rejects.toThrow();
  });

  it('nothing is served from a copy that was never saved (no fabricated screen)', async () => {
    online = false;
    await expect(fetch('/pos/services')).rejects.toThrow();
  });
});
