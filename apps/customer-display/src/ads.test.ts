// ads.test.ts — the display's advertising plumbing (23-inch spec §58–§60, §72, §108, §114): which list may play, which
// picture to download, the on-device picture cache, and the display counts. No network: every dependency is a fake.
import { describe, it, expect, vi } from 'vitest';
import type { CustomerDisplayAd, CustomerDisplayAdPlaylist } from '@aipowersalon/api-contracts/customer';
import { asPlaylist, fullscreenImage, loadPlaylist, nextFetchDelayMs, panelImage, playlistUsable, savePlaylist, toSlides, PLAYLIST_STORE_KEY, PLAYLIST_RETRY_MS } from './adPlaylist';
import { AdAssetCache, type AdAssetDeps } from './adAssets';
import { AdReportQueue, MIN_DISPLAY_MS, REPORT_MAX_BATCH, REPORT_STORE_KEY } from './adReports';

const ad = (id: string, o: Partial<CustomerDisplayAd> = {}): CustomerDisplayAd => ({
  id, version: 1, fit: 'cover', focalX: 0.5, focalY: 0.4, durationSeconds: 10,
  image: { url: `/media/display-ads/${id}/medium.webp`, width: 720, height: 1080 },
  imageLarge: { url: `/media/display-ads/${id}/large.webp`, width: 1280, height: 1920 },
  fullscreenImage: null, headline: 'Deluxe spa pedicure', subheadline: null, description: null, ctaText: null, qr: null, ...o,
});
const list = (o: Partial<CustomerDisplayAdPlaylist> = {}): CustomerDisplayAdPlaylist => ({
  enabled: true, offReason: null, ads: [ad('a1'), ad('a2')], fullScreenIdle: { enabled: false, afterSeconds: 60 },
  playlistVersion: 'v1', generatedAt: '2026-10-06T15:00:00.000Z', refreshAfterSeconds: 600, validUntil: null, ...o,
});
const memStore = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('§114 which list may play', () => {
  const now = Date.parse('2026-10-06T15:10:00.000Z');
  it('ads on and something to play — until its validUntil', () => {
    expect(playlistUsable(list(), now)).toBe(true);
    expect(playlistUsable(list({ validUntil: '2026-10-06T15:30:00.000Z' }), now)).toBe(true);
    expect(playlistUsable(list({ validUntil: '2026-10-06T15:00:00.000Z' }), now)).toBe(false);   // a schedule may have ended it
    expect(playlistUsable(list({ validUntil: 'garbage' }), now)).toBe(false);
  });
  it('switched off, or empty → the salon\'s branded panel', () => {
    expect(playlistUsable(list({ enabled: false, offReason: 'disabled_by_salon' }), now)).toBe(false);
    expect(playlistUsable(list({ ads: [] }), now)).toBe(false);
    expect(playlistUsable(null, now)).toBe(false);
  });
  it('asks again when the server says (5 s … 15 min), or in 30 s after a failure', () => {
    expect(nextFetchDelayMs(list({ refreshAfterSeconds: 120 }), false)).toBe(120_000);
    expect(nextFetchDelayMs(list({ refreshAfterSeconds: 1 }), false)).toBe(5_000);
    expect(nextFetchDelayMs(list({ refreshAfterSeconds: 99_999 }), false)).toBe(900_000);
    expect(nextFetchDelayMs(list(), true)).toBe(PLAYLIST_RETRY_MS);
    expect(nextFetchDelayMs(null, false)).toBe(PLAYLIST_RETRY_MS);
  });
});

describe('§72 the saved list — ad content only, and a corrupted value is ignored', () => {
  it('round-trips through storage, and nothing but the playlist is written', () => {
    const s = memStore();
    savePlaylist(s, list());
    expect([...s.m.keys()]).toEqual([PLAYLIST_STORE_KEY]);
    expect(loadPlaylist(s)?.playlistVersion).toBe('v1');
    const saved = s.m.get(PLAYLIST_STORE_KEY)!;
    expect(saved).not.toMatch(/firstName|customer|phone|ticket|tenant|branch/i);
  });
  it('garbage, foreign JSON or a broken picture entry is not a playlist', () => {
    const s = memStore();
    s.setItem(PLAYLIST_STORE_KEY, '{not json'); expect(loadPlaylist(s)).toBeNull();
    s.setItem(PLAYLIST_STORE_KEY, JSON.stringify({ hello: 1 })); expect(loadPlaylist(s)).toBeNull();
    expect(asPlaylist({ ...list(), ads: [{ ...ad('x'), image: { url: '', width: 1, height: 1 } }] })).toBeNull();
    expect(loadPlaylist(null)).toBeNull();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => undefined };
    expect(loadPlaylist(broken)).toBeNull();
    expect(() => savePlaylist(broken, list())).not.toThrow();
  });
});

describe('§71 the display downloads only what it shows', () => {
  it('the 1080 px copy for a 1080 px panel; the 1920 px copy on a high-density or taller screen', () => {
    expect(panelImage(ad('a'), 1080, 1).url).toMatch(/medium/);
    expect(panelImage(ad('a'), 768, 1).url).toMatch(/medium/);
    expect(panelImage(ad('a'), 1080, 1.5).url).toMatch(/large/);
    expect(panelImage(ad('a'), 1440, 1).url).toMatch(/large/);
  });
  it('§56 full screen: the landscape creative when there is one; otherwise the poster WHOLE (contain), never cropped', () => {
    const full = { url: '/media/display-ads/b/full.webp', width: 1920, height: 1080 };
    expect(fullscreenImage(ad('b', { fullscreenImage: full }))).toEqual({ image: full, fit: 'cover' });
    expect(fullscreenImage(ad('a'))).toEqual({ image: ad('a').imageLarge, fit: 'contain' });
  });
  it('only ads whose picture is ready become slides — a picture that will not load is skipped, not shown broken', () => {
    const ready = new Map([['/media/display-ads/a2/medium.webp', 'blob:a2']]);
    const slides = toSlides([ad('a1'), ad('a2')], (x) => ({ image: x.image, fit: x.fit }), (u) => ready.get(u) ?? null);
    expect(slides.map((s) => s.id)).toEqual(['a2']);
    expect(slides[0].image.url).toBe('blob:a2');
    expect(slides[0]).toMatchObject({ durationSeconds: 10, fit: 'cover', headline: 'Deluxe spa pedicure' });
  });
});

describe('§72 the on-device picture cache', () => {
  function fakeDeps(o: Partial<AdAssetDeps> & { stored?: Map<string, Blob> } = {}) {
    const stored = o.stored ?? new Map<string, Blob>();
    const cache = {
      match: vi.fn(async (u: string) => (stored.has(u) ? new Response(stored.get(u)!, { status: 200, headers: { 'content-type': 'image/webp' } }) : undefined)),
      put: vi.fn(async (u: string, r: Response) => { stored.set(u, await r.blob()); }),
      delete: vi.fn(async (u: string | Request) => stored.delete(typeof u === 'string' ? u : new URL(u.url).pathname)),
      keys: vi.fn(async () => [...stored.keys()].map((k) => ({ url: 'http://display.local' + k }) as Request)),
    };
    let n = 0;
    const deps: AdAssetDeps = {
      fetch: vi.fn(async () => new Response(new Blob(['img']), { status: 200, headers: { 'content-type': 'image/webp' } })),
      caches: { open: vi.fn(async () => cache as unknown as Cache) },
      createObjectURL: vi.fn(() => `blob:${++n}`),
      revokeObjectURL: vi.fn(),
      probe: vi.fn(async () => false),
      ...o,
    };
    return { deps, cache, stored };
  }

  it('downloads once, keeps a copy on the device, and serves later prepares from memory', async () => {
    const { deps, cache, stored } = fakeDeps();
    const c = new AdAssetCache(deps);
    await c.prepare(['/media/a.webp', '/media/b.webp']);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(cache.put).toHaveBeenCalledTimes(2);
    expect([...stored.keys()].sort()).toEqual(['/media/a.webp', '/media/b.webp']);
    expect(c.resolve('/media/a.webp')).toMatch(/^blob:/);
    await c.prepare(['/media/a.webp', '/media/b.webp']);
    expect(deps.fetch).toHaveBeenCalledTimes(2);   // nothing downloaded again
  });

  it('after a restart with no network, the pictures come from the device copy', async () => {
    const stored = new Map<string, Blob>([['/media/a.webp', new Blob(['saved'])]]);
    const { deps } = fakeDeps({ stored, fetch: vi.fn(async () => { throw new TypeError('offline'); }) });
    const c = new AdAssetCache(deps);
    await c.prepare(['/media/a.webp']);
    expect(c.resolve('/media/a.webp')).toMatch(/^blob:/);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('no device cache and no CORS: falls back to the browser\'s own loader; nothing → not ready', async () => {
    const { deps } = fakeDeps({ caches: null, fetch: vi.fn(async () => { throw new TypeError('cors'); }), probe: vi.fn(async (u: string) => u.includes('/ok')) });
    const c = new AdAssetCache(deps);
    await c.prepare(['/media/ok.webp', '/media/missing.webp']);
    expect(c.resolve('/media/ok.webp')).toBe('/media/ok.webp');
    expect(c.resolve('/media/missing.webp')).toBeNull();
  });

  it('a picture no longer in the playlist is dropped from memory and from the device', async () => {
    const { deps, stored } = fakeDeps();
    const c = new AdAssetCache(deps);
    await c.prepare(['/media/a.webp', '/media/b.webp']);
    await c.prepare(['/media/b.webp']);
    expect(c.resolve('/media/a.webp')).toBeNull();
    expect(c.resolve('/media/b.webp')).toMatch(/^blob:/);
    expect([...stored.keys()]).toEqual(['/media/b.webp']);
    expect(deps.revokeObjectURL).toHaveBeenCalled();
  });

  it('a non-image answer (an error page) is never cached as an ad picture', async () => {
    const { deps, cache } = fakeDeps({ fetch: vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) });
    const c = new AdAssetCache(deps);
    await c.prepare(['/media/a.webp']);
    expect(cache.put).not.toHaveBeenCalled();
    expect(c.resolve('/media/a.webp')).toBeNull();
  });
});

describe('§108 display counts — displays, never views', () => {
  const t0 = Date.parse('2026-10-06T15:00:00.000Z');
  it('a slot of at least a second is a display; shorter ones are not; durations are capped at 2 minutes', async () => {
    const sent: any[] = []; let now = t0;
    const q = new AdReportQueue(async (r) => { sent.push(r); }, null, () => now, () => 'batch-0001');
    q.record('a1', 10_000); q.record('a2', MIN_DISPLAY_MS - 1); q.record('a3', 999_999);
    expect(await q.flush()).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].batchId).toBe('batch-0001');
    expect(sent[0].displays).toEqual([
      { adId: 'a1', shownAt: new Date(t0 - 10_000).toISOString(), durationMs: 10_000 },
      { adId: 'a3', shownAt: new Date(t0 - 120_000).toISOString(), durationMs: 120_000 },
    ]);
    now += 1;
    expect(await q.flush()).toBe(true);   // nothing left: no empty batch
    expect(sent).toHaveLength(1);
  });

  it('a failed batch is retried with the SAME id (the server counts it once); new displays wait for the next batch', async () => {
    const sent: any[] = []; let fail = true; let id = 0;
    const q = new AdReportQueue(async (r) => { sent.push(structuredClone(r)); if (fail) throw new Error('offline'); }, null, () => t0, () => `batch-000${++id}`);
    q.record('a1', 5_000);
    expect(await q.flush()).toBe(false);
    q.record('a2', 5_000);
    fail = false;
    expect(await q.flush()).toBe(true);
    expect(sent.map((r) => [r.batchId, r.displays.map((d: any) => d.adId)])).toEqual([['batch-0001', ['a1']], ['batch-0001', ['a1']]]);
    expect(await q.flush()).toBe(true);
    expect(sent[sent.length - 1]).toMatchObject({ batchId: 'batch-0002', displays: [{ adId: 'a2' }] });
  });

  it('kept on the device across a restart; batches of at most 100; nothing older than a day', async () => {
    const s = memStore(); let now = t0;
    const q1 = new AdReportQueue(async () => { throw new Error('offline'); }, s, () => now);
    for (let i = 0; i < 150; i++) q1.record(`a${i}`, 2_000);
    expect(JSON.parse(s.getItem(REPORT_STORE_KEY)!).queue).toHaveLength(150);
    const sent: any[] = [];
    const q2 = new AdReportQueue(async (r) => { sent.push(r); }, s, () => now);
    expect(q2.size()).toBe(150);
    await q2.flush(); await q2.flush();
    expect(sent.map((r) => r.displays.length)).toEqual([REPORT_MAX_BATCH, 50]);
    // a day later, stale displays are dropped instead of being refused by the server
    q2.record('old', 2_000);
    now += 24 * 3_600_000;
    await q2.flush();
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(s.m.get(REPORT_STORE_KEY))).not.toMatch(/firstName|phone|ticket/i);
  });
});
