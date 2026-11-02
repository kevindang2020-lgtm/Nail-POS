// useAdPlaylist.test.tsx — the display's advertising over time (spec §72–§74, §102, §108, §114): it asks for THIS
// display's list, again when the server says a schedule changes and when realtime nudges; it keeps playing its saved
// list through a network drop and a restart — until validUntil; it reports what was on screen. The network is faked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CustomerDisplayAdPlaylist } from '@aipowersalon/api-contracts/customer';

const net = vi.hoisted(() => ({ fetchAdPlaylist: vi.fn(), postAdDisplays: vi.fn() }));
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), fetchAdPlaylist: net.fetchAdPlaylist, postAdDisplays: net.postAdDisplays }));

import { useAdPlaylist } from './useAdPlaylist';
import { AdAssetCache, type AdAssetDeps } from './adAssets';
import { PLAYLIST_STORE_KEY } from './adPlaylist';
import { REPORT_FLUSH_MS } from './adReports';

const creds = { mode: 'device' as const, deviceToken: 'dev-token' };
const VIEW = { panelHeight: 1080, dpr: 1 };
const ad = (id: string) => ({
  id, version: 1, fit: 'cover' as const, focalX: 0.5, focalY: 0.5, durationSeconds: 10, headline: null, subheadline: null, description: null, ctaText: null, qr: null,
  image: { url: `/media/display-ads/${id}/medium.webp`, width: 720, height: 1080 }, imageLarge: { url: `/media/display-ads/${id}/large.webp`, width: 1280, height: 1920 }, fullscreenImage: null,
});
const list = (o: Partial<CustomerDisplayAdPlaylist> = {}): CustomerDisplayAdPlaylist => ({
  enabled: true, offReason: null, ads: [ad('a1')], fullScreenIdle: { enabled: false, afterSeconds: 60 }, playlistVersion: 'v1',
  generatedAt: new Date().toISOString(), refreshAfterSeconds: 600, validUntil: null, ...o,
});
// pictures are always "ready" here (the cache itself is tested in ads.test.ts)
const assets = () => new AdAssetCache({ fetch: async () => new Response(new Blob(['x']), { status: 200 }), caches: null, createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined, probe: async () => true } as AdAssetDeps);
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(1); }); };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  net.fetchAdPlaylist.mockReset(); net.postAdDisplays.mockReset();
  net.postAdDisplays.mockResolvedValue({ accepted: 1, duplicate: false });
});
afterEach(() => { vi.useRealTimers(); });

describe('the playlist over time', () => {
  it('fetched for this display, saved on the device (ad content only), played once its picture is ready', async () => {
    net.fetchAdPlaylist.mockResolvedValue(list());
    const { result } = renderHook(() => useAdPlaylist(creds, 0, VIEW, { assets: assets() }));
    await flush(); await flush();
    expect(net.fetchAdPlaylist).toHaveBeenCalledWith(creds);
    expect(result.current.usable).toBe(true);
    expect(result.current.panelAds.map((a) => a.id)).toEqual(['a1']);
    expect(JSON.parse(localStorage.getItem(PLAYLIST_STORE_KEY)!).playlistVersion).toBe('v1');
  });

  it('asks again when the server says a schedule changes, and at once on a realtime nudge', async () => {
    net.fetchAdPlaylist.mockResolvedValue(list({ refreshAfterSeconds: 120 }));
    const { rerender } = renderHook(({ n }) => useAdPlaylist(creds, n, VIEW, { assets: assets() }), { initialProps: { n: 0 } });
    await flush();
    expect(net.fetchAdPlaylist).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(119_000); });
    expect(net.fetchAdPlaylist).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(net.fetchAdPlaylist).toHaveBeenCalledTimes(2);
    rerender({ n: 1 });   // customer_display_ads_updated on this device's channel
    await flush();
    expect(net.fetchAdPlaylist).toHaveBeenCalledTimes(3);
  });

  it('§72 a network drop: the saved list keeps playing; after a restart with no network too', async () => {
    net.fetchAdPlaylist.mockResolvedValueOnce(list());
    const first = renderHook(() => useAdPlaylist(creds, 0, VIEW, { assets: assets() }));
    await flush(); await flush();
    first.unmount();
    net.fetchAdPlaylist.mockRejectedValue(new TypeError('offline'));
    const { result } = renderHook(() => useAdPlaylist(creds, 0, VIEW, { assets: assets() }));
    await flush(); await flush();
    expect(result.current.usable).toBe(true);
    expect(result.current.panelAds.map((a) => a.id)).toEqual(['a1']);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_500); });   // retries every 30 s meanwhile
    expect(net.fetchAdPlaylist.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('§114 offline past validUntil: the saved list stops — the salon\'s branded panel instead of an ad that may have ended', async () => {
    const until = new Date(Date.now() + 60_000).toISOString();
    net.fetchAdPlaylist.mockResolvedValueOnce(list({ validUntil: until }));
    net.fetchAdPlaylist.mockRejectedValue(new TypeError('offline'));
    const { result } = renderHook(() => useAdPlaylist(creds, 0, VIEW, { assets: assets() }));
    await flush(); await flush();
    expect(result.current.panelAds).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(result.current.usable).toBe(false);
    expect(result.current.panelAds).toHaveLength(0);
  });

  it('switched off by the salon: nothing plays, nothing full-screen', async () => {
    net.fetchAdPlaylist.mockResolvedValue(list({ enabled: false, offReason: 'disabled_by_salon', ads: [] }));
    const { result } = renderHook(() => useAdPlaylist(creds, 0, VIEW, { assets: assets() }));
    await flush();
    expect(result.current.panelAds).toHaveLength(0);
    expect(result.current.fullScreenIdle.enabled).toBe(false);
  });

  it('a one-off session display has no advertising at all (and never calls the ads API)', async () => {
    const { result } = renderHook(() => useAdPlaylist({ mode: 'session', sessionId: 's', token: 't' }, 0, VIEW, { assets: assets() }));
    await flush();
    expect(net.fetchAdPlaylist).not.toHaveBeenCalled();
    expect(result.current.panelAds).toHaveLength(0);
  });
});

describe('§108 displays are reported in batches', () => {
  it('each slot ≥ 1 s is sent within a minute', async () => {
    net.fetchAdPlaylist.mockResolvedValue(list());
    const { result } = renderHook(() => useAdPlaylist(creds, 0, VIEW, { assets: assets() }));
    await flush();
    act(() => { result.current.onShown('a1', 10_000); result.current.onShown('a1', 200); });
    await act(async () => { await vi.advanceTimersByTimeAsync(REPORT_FLUSH_MS + 10); });
    expect(net.postAdDisplays).toHaveBeenCalledTimes(1);
    const [c, report] = net.postAdDisplays.mock.calls[0];
    expect(c).toEqual(creds);
    expect(report.displays).toHaveLength(1);
    expect(report.displays[0]).toMatchObject({ adId: 'a1', durationMs: 10_000 });
    expect(report.batchId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});
